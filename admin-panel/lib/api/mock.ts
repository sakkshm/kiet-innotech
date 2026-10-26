/**
 * In-browser mock of the admin API, persisted to localStorage so actions survive reloads.
 * It enforces the same role scoping and rules the FastAPI backend will: a department admin
 * asking for another department's data gets an ApiError, exactly as the real API would respond.
 */
import { isOutsideAdmin, isTypeAdmin, scopedTypes, scopeName } from "../scope";
import {
  CONFIGURED_BY_SERVER,
  type AdminInput,
  type AdminTeamInput,
  type AdminStudent,
  type AdminTeam,
  type AdminUser,
  type ArchiveResult,
  type BulkResult,
  type AcceptResult,
  type AuditEntry,
  type FinalistBoard,
  type FinalistSummary,
  type NominationInput,
  type Page,
  type RegistrationState,
  type PublishResult,
  type Schedule,
  type ScheduleInput,
  type StatusCounts,
  type Stats,
  type StudentQuery,
  type TeamQuery,
  type TeamSummary,
  type TimelinePoint,
} from "../admin-types";
import { getMockEmail } from "../auth/session";
import { formatIst } from "../format";
import { categories, departments } from "../content";
import { finalistQuota, NOMINATIONS_DEADLINE, normaliseInstitution, REGISTRATION_CLOSES, REGISTRATION_OPENS, routeFor, TEAM_MIN_SIZE, needsApproval } from "../rules";
import type { ParticipantType, TeamStatus } from "../types";
import { ApiError, DEFAULT_PAGE_SIZE, type AdminApi } from "./contract";
import { createSeed, MOCK_DB_VERSION, type MockDb, type StudentRecord } from "./seed";

export const MOCK_STORAGE_KEY = "innotech-admin-mock";
const LATENCY_MS = 300;
const MAX_PAGE_SIZE = 100;

let memoryDb: MockDb | null = null;

function load(): MockDb {
  try {
    const raw = window.localStorage.getItem(MOCK_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as MockDb;
      if (parsed.version === MOCK_DB_VERSION) return parsed;
    }
  } catch {
    // Fall through to the in-memory copy or a fresh seed.
  }
  if (memoryDb) return memoryDb;
  const db = createSeed();
  save(db);
  return db;
}

function save(db: MockDb) {
  memoryDb = db;
  try {
    window.localStorage.setItem(MOCK_STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Storage full or blocked: keep working from memory for this page load.
  }
}

/** Deletes all mock changes; the next call reseeds the demo data. */
export function resetMockData() {
  memoryDb = null;
  try {
    window.localStorage.removeItem(MOCK_STORAGE_KEY);
  } catch {
    // Nothing stored.
  }
}

const delay = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

/** Timestamps for new actions always come after the seeded October data. */
function now(db: MockDb) {
  db.clock = Math.max(Date.now(), db.clock + 60_000);
  return new Date(db.clock).toISOString();
}

function log(db: MockDb, entry: Omit<AuditEntry, "id" | "at">) {
  db.seq += 1;
  db.audit.push({ id: `a-${String(db.seq).padStart(4, "0")}`, at: now(db), ...entry });
}

/**
 * Like the backend's SUPER_ADMIN_EMAILS setting: super admins that exist without an admins row.
 * They are listed first with addedBy "server configuration" and cannot be removed.
 */
const CONFIGURED_SUPER_ADMINS = ["innotech.admin@kiet.edu"];

function configuredAdmins(db: MockDb): AdminUser[] {
  const known = new Set(db.admins.map((a) => a.email.toLowerCase()));
  return CONFIGURED_SUPER_ADMINS.filter((email) => !known.has(email)).map((email) => ({
    email,
    name: email.split("@")[0],
    role: "super_admin",
    department: null,
    addedAt: null,
    addedBy: CONFIGURED_BY_SERVER,
  }));
}

function actor(db: MockDb): AdminUser {
  const email = getMockEmail();
  if (!email) throw new ApiError(401, "You are not signed in.");
  const admin = [...configuredAdmins(db), ...db.admins].find((a) => a.email.toLowerCase() === email.toLowerCase());
  if (!admin) throw new ApiError(403, `${email} is not an InnoTech26 admin.`);
  return admin;
}

function requireSuper(admin: AdminUser, what: string) {
  if (admin.role !== "super_admin") throw new ApiError(403, `Only the super admin can ${what}.`);
}

/** Same scoping as the backend: department admins see one KIET department, outside admins other colleges and schools. */
function inScope(admin: AdminUser, record: { participantType: ParticipantType; department: string | null }) {
  if (admin.role === "super_admin") return true;
  const types = scopedTypes(admin);
  if (types) return types.includes(record.participantType);
  return record.participantType === "kiet" && record.department === admin.department;
}

const canSeeTeam = (admin: AdminUser, team: AdminTeam) => inScope(admin, team);
const canSeeStudent = (admin: AdminUser, student: StudentRecord) => inScope(admin, student);

function checkDepartmentFilter(admin: AdminUser, department: string | undefined) {
  if (admin.role !== "super_admin" && department && department !== admin.department) {
    throw new ApiError(403, isTypeAdmin(admin) ? `You can only view ${scopeName(admin).toLowerCase()}.` : `You can only view ${admin.department} data.`);
  }
}

function findTeam(db: MockDb, admin: AdminUser, id: string) {
  const team = db.teams.find((t) => t.id === id);
  if (!team) throw new ApiError(404, "No team with this ID exists.");
  if (!canSeeTeam(admin, team)) {
    throw new ApiError(403, isTypeAdmin(admin) ? `This team is not one of the ${scopeName(admin).toLowerCase()}.` : `This team belongs to another department. You can only view ${admin.department} teams.`);
  }
  return team;
}

const leaderYear = (team: AdminTeam) => team.members.find((m) => m.role === "leader")?.year ?? null;

function requireReason(reason: string) {
  const trimmed = reason.trim();
  if (trimmed.length < 5) throw new ApiError(422, "Give a reason of at least 5 characters.");
  return trimmed;
}

function paginate<T>(items: T[], page = 1, pageSize = DEFAULT_PAGE_SIZE): Page<T> {
  const size = Math.min(Math.max(1, pageSize), MAX_PAGE_SIZE);
  const current = Math.max(1, page);
  return { items: items.slice((current - 1) * size, current * size), total: items.length, page: current, pageSize: size };
}

function compare(a: string | number | null, b: string | number | null) {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b));
}

// ---------- Teams ----------

function filterTeams(db: MockDb, admin: AdminUser, query: TeamQuery) {
  checkDepartmentFilter(admin, query.department);
  const q = query.q?.trim().toLowerCase();
  const rows = db.teams.filter((team) => {
    if (!canSeeTeam(admin, team)) return false;
    if (query.department && team.department !== query.department) return false;
    if (query.category && team.category !== query.category) return false;
    if (query.status && team.status !== query.status) return false;
    if (query.type && team.participantType !== query.type) return false;
    if (query.route && team.route !== query.route) return false;
    if (query.result && team.result !== query.result) return false;
    if (query.approval === "pending" && !(team.approvalRequired && !team.approvedAt && !team.rejectedAt)) return false;
    if (query.approval === "approved" && !(team.approvalRequired && team.approvedAt)) return false;
    if (query.approval === "rejected" && !(team.approvalRequired && team.rejectedAt)) return false;
    if (query.year && !team.members.some((m) => m.year === query.year)) return false;
    if (query.leaderYear && leaderYear(team) !== query.leaderYear) return false;
    if (q) {
      const haystack = [team.name, team.code, team.institution, ...team.members.flatMap((m) => [m.fullName, m.email])];
      if (!haystack.some((value) => value.toLowerCase().includes(q))) return false;
    }
    return true;
  });
  const key = query.sort ?? "code";
  const value = (team: AdminTeam): string | number | null => {
    switch (key) {
      case "name": return team.name.toLowerCase();
      case "category": return team.category;
      case "department": return team.department ?? team.institution;
      case "status": return team.status;
      case "members": return team.members.length;
      case "submitted_at": return team.submittedAt;
      case "leader_year": return leaderYear(team);
      default: return team.code;
    }
  };
  // Same order as the backend: descending flips the comparison, but empty values always come last.
  const direction = query.order === "desc" ? -1 : 1;
  rows.sort((a, b) => {
    const [va, vb] = [value(a), value(b)];
    if (va === null || vb === null) return va === vb ? direction * a.code.localeCompare(b.code) : va === null ? 1 : -1;
    return direction * (compare(va, vb) || a.code.localeCompare(b.code));
  });
  return rows;
}

function summary(team: AdminTeam): TeamSummary {
  return {
    id: team.id,
    code: team.code,
    name: team.name,
    category: team.category,
    participantType: team.participantType,
    institution: team.institution,
    department: team.department,
    route: team.route,
    status: team.status,
    result: team.result,
    leaderName: team.members.find((m) => m.role === "leader")?.fullName ?? "",
    memberCount: team.members.length,
    projectTitle: team.projectTitle,
    submittedAt: team.submittedAt,
    approvalRequired: team.approvalRequired,
    approvedAt: team.approvedAt,
    rejectedAt: team.rejectedAt,
    leaderYear: leaderYear(team),
    memberYears: [...team.members].sort((a, b) => Number(b.role === "leader") - Number(a.role === "leader") || a.year - b.year).map((m) => m.year),
  };
}

function setStatus(db: MockDb, admin: AdminUser, team: AdminTeam, status: TeamStatus, action: AuditEntry["action"], detail: string) {
  const nominated = db.nominations.some((n) => n.teamIds.includes(team.id));
  team.status = status;
  if (status === "withdrawn" || status === "disqualified") {
    team.invitations = [];
    if (db.publishedAt) {
      // Nominations are locked after publishing; keep them so a restore brings the result back.
      if (team.route === "department" && team.result === "finalist") team.result = "not_selected";
    } else {
      for (const nomination of db.nominations) nomination.teamIds = nomination.teamIds.filter((id) => id !== team.id);
    }
  } else if (db.publishedAt && team.route === "department" && status === "submitted") {
    team.result = nominated ? "finalist" : "not_selected";
  }
  log(db, { actorEmail: admin.email, action, teamId: team.id, teamCode: team.code, department: team.department, detail });
  save(db);
  return clone(team);
}

// ---------- Students ----------

function studentRow(db: MockDb, student: StudentRecord): AdminStudent {
  const { teamId, ...profile } = student;
  const team = teamId ? db.teams.find((t) => t.id === teamId) : undefined;
  return {
    ...profile,
    team: team
      ? {
          id: team.id,
          code: team.code,
          name: team.name,
          status: team.status,
          department: team.department,
          role: team.leaderId === student.userId ? "leader" : "member",
        }
      : null,
  };
}

function filterStudents(db: MockDb, admin: AdminUser, query: StudentQuery) {
  checkDepartmentFilter(admin, query.department);
  const q = query.q?.trim().toLowerCase();
  const rows = db.students.filter((s) => {
    if (!canSeeStudent(admin, s)) return false;
    if (query.department && s.department !== query.department) return false;
    if (query.type && s.participantType !== query.type) return false;
    if (query.year && s.year !== query.year) return false;
    if (query.inTeam === "yes" && !s.teamId) return false;
    if (query.inTeam === "no" && s.teamId) return false;
    const banned = Boolean((s as { bannedAt?: string | null }).bannedAt);
    if (query.banned === "yes" && !banned) return false;
    if (query.banned === "no" && banned) return false;
    if (q && ![s.fullName, s.email, s.rollNumber, s.institution, s.phone].some((v) => v.toLowerCase().includes(q))) return false;
    return true;
  });
  const key = query.sort ?? "name";
  const value = (s: StudentRecord): string | number | null => {
    switch (key) {
      case "email": return s.email;
      case "department": return s.department ?? s.institution;
      case "year": return s.year;
      case "institution": return s.institution;
      case "created_at": return s.createdAt;
      default: return s.fullName.toLowerCase();
    }
  };
  rows.sort((a, b) => compare(value(a), value(b)) || a.userId.localeCompare(b.userId));
  if (query.order === "desc") rows.reverse();
  return rows.map((s) => studentRow(db, s));
}

// ---------- Stats ----------

function counts(teams: AdminTeam[]): StatusCounts {
  return {
    total: teams.length,
    draft: teams.filter((t) => t.status === "draft").length,
    submitted: teams.filter((t) => t.status === "submitted").length,
    withdrawn: teams.filter((t) => t.status === "withdrawn").length,
    disqualified: teams.filter((t) => t.status === "disqualified").length,
    archived: teams.filter((t) => t.status === "archived").length,
  };
}

// ---------- Finalists ----------

function eligibleTeams(db: MockDb, department: string, category: number) {
  return db.teams.filter(
    (t) => t.route === "department" && t.department === department && t.category === category && t.status === "submitted",
  );
}

function nominatedIds(db: MockDb, department: string, category: number) {
  const eligible = new Set(eligibleTeams(db, department, category).map((t) => t.id));
  const entry = db.nominations.find((n) => n.department === department && n.category === category);
  return (entry?.teamIds ?? []).filter((id) => eligible.has(id));
}

const deadlinePassed = (db: MockDb) => db.schedule.deadline !== null && Date.now() > new Date(db.schedule.deadline).getTime();

function board(db: MockDb, department: string, admin: AdminUser): FinalistBoard {
  const updated = db.nominationsUpdated.find((u) => u.department === department);
  return {
    department,
    nominationsDeadline: db.schedule.deadline,
    nominationsLocked: deadlinePassed(db) && admin.role !== "super_admin",
    publishedAt: db.publishedAt,
    updatedAt: updated?.at ?? null,
    updatedBy: updated?.by ?? null,
    categories: categories.map((c) => ({
      category: c.number,
      quota: finalistQuota(department, c.number),
      teams: eligibleTeams(db, department, c.number).map(summary),
      nominated: nominatedIds(db, department, c.number),
    })),
  };
}

function checkBoardAccess(admin: AdminUser, department: string) {
  if (!departments.includes(department)) throw new ApiError(404, `Unknown department "${department}".`);
  if (admin.role === "admin" && admin.department !== department) {
    throw new ApiError(403, `You can only nominate finalists for ${admin.department}.`);
  }
}

/** The planned results date (event document: finalists declared 26 October). */
const RESULTS_PUBLISH_FROM = "2026-10-26T00:00:00+05:30";
const resultsFrom = (db: MockDb) => (db.schedule.resultsFrom === undefined ? RESULTS_PUBLISH_FROM : db.schedule.resultsFrom);
const resultsDue = (db: MockDb) => resultsFrom(db) === null || Date.now() >= new Date(resultsFrom(db)!).getTime();

/** Mirrors server/app/services/admin.py publish_blocker. */
function publishBlocker(db: MockDb): string | null {
  if (!resultsDue(db)) {
    return `Results can be published from ${formatIst(resultsFrom(db))} (the finalists declaration date). Change the results date on the Schedule page only if the event plan has changed.`;
  }
  if (db.schedule.deadline !== null && !deadlinePassed(db)) {
    return `Department admins can nominate finalists until ${formatIst(db.schedule.deadline)}, so results cannot be published yet. Move or clear the nominations deadline on the Schedule page if you really need to publish earlier.`;
  }
  const anyNominated = db.nominations.some((n) => n.teamIds.length > 0);
  return anyNominated ? null : "No finalists have been nominated yet, so there is nothing to publish.";
}

function finalistSummaryOf(db: MockDb): FinalistSummary {
  return {
    publishedAt: db.publishedAt,
    publishedBy: db.publishedBy,
    nominationsDeadline: db.schedule.deadline,
    publishBlocked: db.publishedAt ? null : publishBlocker(db),
    resultsPublishFrom: resultsFrom(db),
    // The demo has no judging, so nothing is prepared for the finale yet.
    unpublishBlocked: null,
    matrix: departments.map((department) => ({
      department,
      categories: categories.map((c) => ({
        category: c.number,
        quota: finalistQuota(department, c.number),
        nominated: nominatedIds(db, department, c.number).length,
        eligible: eligibleTeams(db, department, c.number).length,
      })),
    })),
    directTeams: db.teams.filter((t) => t.route === "finale" && t.status === "submitted").map(summary),
  };
}

// ---------- Admins ----------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ---------- API ----------

function tally<T>(items: T[], key: (item: T) => string) {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(key(item), (counts.get(key(item)) ?? 0) + 1);
  return counts;
}

const istDay = (iso: string) => new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

/** Daily counts in IST from the first record (or registration opening) to today, like the server. */
function timelineOf(students: StudentRecord[], teams: AdminTeam[]): TimelinePoint[] {
  const perDay = {
    students: tally(students, (s) => istDay(s.createdAt)),
    teams: tally(teams, (t) => istDay(t.createdAt)),
    submitted: tally(teams.filter((t) => t.submittedAt), (t) => istDay(t.submittedAt!)),
  };
  const days = [...perDay.students.keys(), ...perDay.teams.keys(), ...perDay.submitted.keys(), istDay(REGISTRATION_OPENS)].sort();
  const today = istDay(new Date().toISOString());
  const last = [days[days.length - 1], today < istDay(REGISTRATION_CLOSES) ? today : istDay(REGISTRATION_CLOSES)].sort()[1];
  const points: TimelinePoint[] = [];
  for (let day = new Date(`${days[0]}T00:00:00Z`); points.length < 120; day.setUTCDate(day.getUTCDate() + 1)) {
    const date = day.toISOString().slice(0, 10);
    if (date > last) break;
    points.push({ date, students: perDay.students.get(date) ?? 0, teams: perDay.teams.get(date) ?? 0, submitted: perDay.submitted.get(date) ?? 0 });
  }
  return points;
}

function topInstitutionsOf(students: StudentRecord[], active: AdminTeam[]) {
  const groups = new Map<string, StudentRecord[]>();
  for (const s of students) {
    if (s.participantType === "kiet") continue;
    const key = `${s.participantType}|${normaliseInstitution(s.institution)}`;
    groups.set(key, [...(groups.get(key) ?? []), s]);
  }
  const teamCounts = tally(active, (t) => `${t.participantType}|${normaliseInstitution(t.institution)}`);
  const mostCommon = (values: string[]) => [...tally(values, (v) => v)].sort((a, b) => b[1] - a[1])[0][0];
  return [...groups]
    .map(([key, members]) => ({
      institution: mostCommon(members.map((m) => m.institution)),
      participantType: members[0].participantType,
      city: mostCommon(members.map((m) => m.city)),
      students: members.length,
      teams: teamCounts.get(key) ?? 0,
    }))
    .sort((a, b) => b.students - a.students || b.teams - a.teams || a.institution.localeCompare(b.institution))
    .slice(0, 10);
}

// ---------- Schedule (mirrors server/app/services/schedule.py) ----------

const DAY_MS = 86_400_000;

function windowState(opens: string, closes: string): RegistrationState {
  const at = Date.now();
  if (at < new Date(opens).getTime()) return "upcoming";
  if (at > new Date(closes).getTime()) return "closed";
  return "open";
}

function scheduleOf(db: MockDb): Schedule {
  const { opens, closes, deadline, customised, updatedBy, updatedAt } = db.schedule;
  return {
    registration: { state: windowState(opens, closes), opens, closes },
    extendedCloses: db.schedule.extendedCloses ?? null,
    nominationsDeadline: deadline,
    nominationsOpen: !deadlinePassed(db),
    resultsPublishFrom: resultsFrom(db),
    resultsDue: resultsDue(db),
    customised,
    updatedBy,
    updatedAt,
    serverTime: new Date().toISOString(),
    planned: {
      registrationOpens: REGISTRATION_OPENS,
      registrationCloses: REGISTRATION_CLOSES,
      registrationExtendedCloses: null,
      nominationsDeadline: NOMINATIONS_DEADLINE,
      resultsPublishFrom: RESULTS_PUBLISH_FROM,
    },
  };
}

function checkWindow(opens: string, closes: string, deadline: string | null) {
  const earliest = new Date("2020-01-01T00:00:00Z").getTime();
  const latest = new Date("2100-01-01T00:00:00Z").getTime();
  for (const [name, value] of [["opening", opens], ["closing", closes], ["nomination deadline", deadline]] as const) {
    if (value === null) continue;
    const time = new Date(value).getTime();
    if (Number.isNaN(time) || time < earliest || time > latest) throw new ApiError(422, `The ${name} date is not a sensible date.`);
  }
  const span = new Date(closes).getTime() - new Date(opens).getTime();
  if (span <= 0) throw new ApiError(422, "Registration must close after it opens.");
  if (span > 366 * DAY_MS) throw new ApiError(422, "Registration can stay open for at most a year.");
}

function writeSchedule(db: MockDb, admin: AdminUser, opens: string, closes: string, deadline: string | null, results?: string | null) {
  checkWindow(opens, closes, deadline);
  if (results) {
    if (deadline && results < deadline) throw new ApiError(422, "Results can only be published after the nominations deadline.");
    if (new Date(results).getTime() < new Date(closes).getTime()) throw new ApiError(422, "Results can only be published after registration closes.");
  }
  const resultsFromValue = results === undefined ? resultsFrom(db) : results;
  db.schedule = { opens, closes, deadline, resultsFrom: resultsFromValue, customised: true, updatedBy: admin.email, updatedAt: new Date().toISOString() };
}

const NOT_IN_DEMO = "Judging works with the real backend only; the demo data has no judges, rooms or scores.";
const CERTIFICATES_LIVE_ONLY = "Certificates work with the real backend only; the demo has no templates or attendance.";

function auditVisible(db: MockDb, admin: AdminUser, entry: AuditEntry) {
  if (admin.role === "super_admin") return true;
  if (isTypeAdmin(admin)) {
    const team = entry.teamId ? db.teams.find((t) => t.id === entry.teamId) : undefined;
    return !!team && inScope(admin, team);
  }
  return entry.department === admin.department;
}

export const mockApi: AdminApi = {
  mode: "mock",

  async me() {
    await delay();
    return clone(actor(load()));
  },

  async stats() {
    await delay();
    const db = load();
    const admin = actor(db);
    const teams = db.teams.filter((t) => canSeeTeam(admin, t));
    const students = db.students.filter((s) => canSeeStudent(admin, s));
    const isSuper = admin.role === "super_admin";
    const seesOutside = isSuper || isOutsideAdmin(admin);
    const types: ParticipantType[] = isSuper ? ["kiet", "college", "school", "startup"] : (scopedTypes(admin) ?? []);
    const active = teams.filter((t) => t.status === "draft" || t.status === "submitted");
    const yearKeys = new Set([
      ...students.map((s) => `${s.participantType}|${s.year}`),
      ...active.flatMap((t) => t.members.map((m) => `${t.participantType}|${m.year}`)),
    ]);
    const stats: Stats = {
      department: admin.role === "admin" ? admin.department : null,
      awaitingApproval: teams.filter((t) => t.approvalRequired && !t.approvedAt && !t.rejectedAt && t.status === "submitted").length,
      students: students.length,
      studentsInTeams: students.filter((s) => s.teamId).length,
      pendingInvitations: teams.reduce((sum, t) => sum + t.invitations.length, 0),
      teams: counts(teams),
      byType: seesOutside
        ? types.map((type) => ({
            type,
            students: students.filter((s) => s.participantType === type).length,
            teams: teams.filter((t) => t.participantType === type).length,
            submitted: teams.filter((t) => t.participantType === type && t.status === "submitted").length,
          }))
        : null,
      byCategory: categories.map((c) => ({ category: c.number, ...counts(teams.filter((t) => t.category === c.number)) })),
      byDepartment: isSuper
        ? departments.map((department) => ({
            department,
            students: students.filter((s) => s.participantType === "kiet" && s.department === department).length,
            ...counts(teams.filter((t) => t.participantType === "kiet" && t.department === department)),
          }))
        : null,
      recentSubmissions: teams
        .filter((t) => t.submittedAt && t.status === "submitted")
        .sort((a, b) => (b.submittedAt ?? "").localeCompare(a.submittedAt ?? ""))
        .slice(0, 8)
        .map(summary),
      resultsPublishedAt: db.publishedAt,
      timeline: timelineOf(students, teams),
      byYear: [...yearKeys]
        .map((key) => {
          const [participantType, yearText] = key.split("|");
          const year = Number(yearText);
          const ofType = active.filter((t) => t.participantType === participantType);
          return {
            participantType: participantType as ParticipantType,
            year,
            students: students.filter((s) => s.participantType === participantType && s.year === year).length,
            teamsLed: ofType.filter((t) => leaderYear(t) === year).length,
            teamsWith: ofType.filter((t) => t.members.some((m) => m.year === year)).length,
          };
        })
        .sort((a, b) => a.participantType.localeCompare(b.participantType) || a.year - b.year),
      teamSizes: [1, 2, 3, 4, 5].map((size) => ({ size, teams: active.filter((t) => t.members.length === size).length })),
      byDomain: [...tally(active, (t) => t.domain)]
        .map(([domain, count]) => ({ domain, teams: count }))
        .sort((a, b) => b.teams - a.teams || a.domain.localeCompare(b.domain)),
      topInstitutions: seesOutside ? topInstitutionsOf(students, active) : null,
      schedule: scheduleOf(db),
    };
    return stats;
  },

  async listTeams(query) {
    await delay();
    const db = load();
    return clone(paginate(filterTeams(db, actor(db), query), query.page, query.pageSize));
  },

  async exportTeams(query) {
    await delay();
    const db = load();
    return clone(filterTeams(db, actor(db), query));
  },

  async getTeam(id) {
    await delay();
    const db = load();
    return clone(findTeam(db, actor(db), id));
  },

  async withdrawTeam(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.status !== "draft" && team.status !== "submitted") {
      throw new ApiError(409, "Only draft or submitted teams can be marked withdrawn.");
    }
    return setStatus(db, admin, team, "withdrawn", "team.withdrawn", `Marked withdrawn. Reason: ${text}`);
  },

  async disqualifyTeam(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "disqualify teams");
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.status !== "draft" && team.status !== "submitted") {
      throw new ApiError(409, "Only draft or submitted teams can be disqualified.");
    }
    return setStatus(db, admin, team, "disqualified", "team.disqualified", `Disqualified. Reason: ${text}`);
  },

  async restoreTeam(id, reason, unbanMembers = false) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "restore teams");
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.status !== "withdrawn" && team.status !== "disqualified") {
      throw new ApiError(409, "Only withdrawn or disqualified teams can be restored.");
    }
    // Members of a withdrawn team may have left to join other teams (same check as the backend).
    const leaderStillIn = team.members.some((m) => m.userId === team.leaderId);
    if (!leaderStillIn || (team.submittedAt && team.members.length < TEAM_MIN_SIZE)) {
      throw new ApiError(409, "Members have left this team since it was withdrawn, so it cannot be restored.");
    }
    const status: TeamStatus = team.submittedAt ? "submitted" : "draft";
    if (unbanMembers) {
      for (const student of db.students) {
        if (student.teamId === team.id) (student as StudentRecord & { bannedAt?: string | null }).bannedAt = null;
      }
    }
    return setStatus(db, admin, team, status, "team.restored", `Restored to ${status}. Reason: ${text}`);
  },

  async editStudent(userId, input) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "edit student profiles");
    const student = db.students.find((s) => s.userId === userId);
    if (!student) throw new ApiError(404, "Student not found.");
    requireReason(input.reason);
    if (input.participantType !== student.participantType && student.teamId) throw new ApiError(409, "They are in a team, so their college or school cannot change.");
    Object.assign(student, { fullName: input.fullName, phone: input.phone, participantType: input.participantType, institution: input.institution, city: input.city, department: input.department, course: input.course, year: input.year, rollNumber: input.rollNumber, club: input.club });
    log(db, { actorEmail: admin.email, action: "student.edited", department: student.department, detail: `${student.email}: profile changed. Reason: ${input.reason}` });
    save(db);
    return clone(studentRow(db, student));
  },

  async editTeam(teamId, input) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "edit teams");
    const team = findTeam(db, admin, teamId);
    requireReason(input.reason);
    if (db.teams.some((t) => t.id !== team.id && t.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new ApiError(409, "Another team already uses this name.");
    Object.assign(team, { name: input.name, category: input.category, domain: input.domain, projectTitle: input.projectTitle, abstract: input.abstract });
    log(db, { actorEmail: admin.email, action: "team.edited", teamId: team.id, teamCode: team.code, department: team.department, detail: `Details changed. Reason: ${input.reason}` });
    save(db);
    return clone(team);
  },

  async addTeamMember(teamId, email, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change team members");
    const team = findTeam(db, admin, teamId);
    requireReason(reason);
    const student = db.students.find((s) => s.email.toLowerCase() === email.trim().toLowerCase());
    if (!student) throw new ApiError(422, `No registered student uses ${email}.`);
    if (student.teamId) throw new ApiError(409, `${email} is already in a team.`);
    if (team.members.length >= (team.participantType === "startup" ? 1 : 5)) throw new ApiError(422, "The team is full.");
    student.teamId = team.id;
    team.members.push({ userId: student.userId, fullName: student.fullName, email: student.email, phone: student.phone, rollNumber: student.rollNumber, institution: student.institution, department: student.department, course: student.course, year: student.year, role: "member", joinedAt: now(db), club: student.club } as AdminTeam["members"][number]);
    log(db, { actorEmail: admin.email, action: "team.member_added", teamId: team.id, teamCode: team.code, department: team.department, detail: `${email} added by an organiser. Reason: ${reason}` });
    save(db);
    return clone(team);
  },

  async removeTeamMember(teamId, userId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change team members");
    const team = findTeam(db, admin, teamId);
    requireReason(reason);
    if (team.leaderId === userId) throw new ApiError(409, "This is the team leader. Make another member the leader first.");
    const member = team.members.find((m) => m.userId === userId);
    if (!member) throw new ApiError(404, "This student is not in the team.");
    team.members = team.members.filter((m) => m.userId !== userId);
    const student = db.students.find((s) => s.userId === userId);
    if (student) student.teamId = null;
    log(db, { actorEmail: admin.email, action: "team.member_removed", teamId: team.id, teamCode: team.code, department: team.department, detail: `${member.email} removed by an organiser. Reason: ${reason}` });
    save(db);
    return clone(team);
  },

  async setTeamLeader(teamId, userId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change team members");
    const team = findTeam(db, admin, teamId);
    requireReason(reason);
    const member = team.members.find((m) => m.userId === userId);
    if (!member) throw new ApiError(404, "This student is not in the team.");
    for (const m of team.members) m.role = m.userId === userId ? "leader" : "member";
    team.leaderId = userId;
    log(db, { actorEmail: admin.email, action: "team.leader_changed", teamId: team.id, teamCode: team.code, department: team.department, detail: `${member.email} is the new leader. Reason: ${reason}` });
    save(db);
    return clone(team);
  },

  async acceptTeams(ids, accepted) {
    await delay();
    const db = load();
    const admin = actor(db);
    if (admin.role === "admin" && admin.department !== "COE") throw new ApiError(403, "Only a super admin or the admin of startups, COE KIET, other colleges or schools can accept teams.");
    const result: AcceptResult = { changed: 0, skipped: [], notFound: 0 };
    for (const id of new Set(ids)) {
      const team = db.teams.find((t) => t.id === id && canSeeTeam(admin, t));
      if (!team) result.notFound += 1;
      else if (!team.approvalRequired) result.skipped.push({ code: team.code, name: team.name, reason: "this team does not need acceptance" });
      else if (team.status !== "submitted") result.skipped.push({ code: team.code, name: team.name, reason: `not a submitted team (${team.status})` });
      else if (accepted && !team.approvedAt) {
        team.approvedAt = new Date().toISOString();
        team.rejectedAt = team.rejectedReason = null;
        log(db, { actorEmail: admin.email, action: "team.approved", teamId: team.id, teamCode: team.code, department: team.department, detail: "Accepted for the Grand Finale" });
        result.changed += 1;
      } else if (!accepted && (team.approvedAt || team.rejectedAt)) {
        const wasRejected = !team.approvedAt;
        team.approvedAt = null;
        team.rejectedAt = team.rejectedReason = null;
        log(db, {
          actorEmail: admin.email,
          action: wasRejected ? "team.rejection_revoked" : "team.approval_revoked",
          teamId: team.id,
          teamCode: team.code,
          department: team.department,
          detail: "Back in the queue",
        });
        result.changed += 1;
      }
    }
    save(db);
    return result;
  },

  async archiveTeams(ids, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "archive teams");
    const text = requireReason(reason);
    const closed = windowState(db.schedule.opens, db.schedule.closes) === "closed";
    const result: ArchiveResult = { archived: 0, skipped: [], notFound: 0 };
    for (const id of new Set(ids)) {
      const team = db.teams.find((t) => t.id === id && canSeeTeam(admin, t));
      if (!team) result.notFound += 1;
      else if (team.status !== "draft") result.skipped.push({ code: team.code, name: team.name, reason: `not a draft (${team.status})` });
      else if (!closed) result.skipped.push({ code: team.code, name: team.name, reason: "registration is still open for this team" });
      else {
        team.status = "archived";
        team.invitations = [];
        log(db, { actorEmail: admin.email, action: "team.archived", teamId: team.id, teamCode: team.code, department: team.department, detail: text });
        result.archived += 1;
      }
    }
    save(db);
    return result;
  },

  async bulkTeams(ids, action, options = {}) {
    await delay();
    const result: BulkResult = { action, changed: 0, skipped: [], notFound: 0 };
    const reason = options.reason ?? "";
    if (action === "reject") {
      const db = load();
      const admin = actor(db);
      if (admin.role === "admin" && admin.department !== "COE") throw new ApiError(403, "Only a super admin or the admin of startups, COE KIET, other colleges or schools can accept teams.");
      const text = requireReason(reason);
      for (const id of new Set(ids)) {
        const team = db.teams.find((t) => t.id === id && canSeeTeam(admin, t));
        if (!team) result.notFound += 1;
        else if (!team.approvalRequired) result.skipped.push({ code: team.code, name: team.name, reason: "this team does not need acceptance" });
        else if (team.status !== "submitted") result.skipped.push({ code: team.code, name: team.name, reason: `not a submitted team (${team.status})` });
        else if (!team.rejectedAt) {
          team.approvedAt = null;
          team.rejectedAt = new Date().toISOString();
          team.rejectedReason = text;
          log(db, { actorEmail: admin.email, action: "team.rejected", teamId: team.id, teamCode: team.code, department: team.department, detail: `Rejected. Reason: ${text}` });
          result.changed += 1;
        }
      }
      save(db);
      return result;
    }
    // Everything else goes through the single-team methods, so the rules stay in one place.
    const merge = (one: { changed: number; skipped: BulkResult["skipped"]; notFound: number }) => {
      result.changed += one.changed;
      result.skipped.push(...one.skipped);
      result.notFound += one.notFound;
    };
    for (const id of new Set(ids)) {
      const team = load().teams.find((t) => t.id === id);
      try {
        if (action === "archive") {
          const one = await mockApi.archiveTeams([id], reason);
          merge({ ...one, changed: one.archived });
        } else if (action === "accept" || action === "unaccept") {
          merge(await mockApi.acceptTeams([id], action === "accept"));
        } else {
          if (action === "withdraw") await mockApi.withdrawTeam(id, reason);
          else if (action === "disqualify") await mockApi.disqualifyTeam(id, reason);
          else if (action === "restore") await mockApi.restoreTeam(id, reason, options.unbanMembers ?? false);
          else await mockApi.submitTeam(id, reason);
          result.changed += 1;
        }
      } catch (error) {
        if (!(error instanceof ApiError) || error.status === 403) throw error;
        if (error.status === 404 || !team) result.notFound += 1;
        else result.skipped.push({ code: team.code, name: team.name, reason: error.message });
      }
    }
    return result;
  },

  async submitTeam(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "submit teams");
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.status !== "draft" && team.status !== "archived") throw new ApiError(409, `Only a draft or archived team can be submitted; this team is ${team.status}.`);
    const [low, high] = team.participantType === "startup" ? [1, 1] : [2, 5];
    if (team.members.length < low || team.members.length > high) throw new ApiError(422, `This team cannot be submitted: a team needs ${low} to ${high} members.`);
    team.invitations = [];
    team.status = "submitted";
    team.submittedAt = now(db);
    log(db, { actorEmail: admin.email, action: "team.submitted", teamId: team.id, teamCode: team.code, department: team.department, detail: `Submitted by an organiser. Reason: ${text}` });
    save(db);
    return clone(team);
  },

  async reopenTeam(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "reopen teams");
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.status !== "submitted") throw new ApiError(409, "Only a submitted team can be reopened.");
    if (windowState(db.schedule.opens, db.schedule.closes) !== "open") throw new ApiError(409, "Registration is closed. Reopen it on the Schedule page first.");
    if (db.publishedAt && team.route === "department") throw new ApiError(409, "Department results have been published, so KIET teams can no longer be reopened.");
    team.status = "draft";
    team.submittedAt = null;
    team.result = "pending";
    for (const nomination of db.nominations) nomination.teamIds = nomination.teamIds.filter((teamId) => teamId !== team.id);
    log(db, { actorEmail: admin.email, action: "team.reopened", teamId: team.id, teamCode: team.code, department: team.department, detail: `Sent back to draft. Reason: ${text}` });
    save(db);
    return clone(team);
  },

  async approveTeam(id) {
    await delay();
    const db = load();
    const admin = actor(db);
    if (admin.role === "admin" && admin.department !== "COE") throw new ApiError(403, "Only a super admin or the admin of startups, COE KIET, other colleges or schools can accept teams.");
    const team = findTeam(db, admin, id);
    if (!team.approvalRequired) throw new ApiError(409, "This team does not need approval.");
    if (team.status !== "submitted") throw new ApiError(409, "Only a submitted entry can be accepted.");
    if (team.approvedAt) throw new ApiError(409, "This entry has already been accepted.");
    team.approvedAt = new Date().toISOString();
    team.rejectedAt = team.rejectedReason = null;
    log(db, { actorEmail: admin.email, action: "team.approved", teamId: team.id, teamCode: team.code, department: team.department, detail: "Accepted for the Grand Finale" });
    save(db);
    return clone(team);
  },

  async revokeApproval(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (!team.approvalRequired || !team.approvedAt) throw new ApiError(409, "This entry has not been accepted.");
    team.approvedAt = null;
    log(db, { actorEmail: admin.email, action: "team.approval_revoked", teamId: team.id, teamCode: team.code, department: team.department, detail: `Acceptance withdrawn. Reason: ${text}` });
    save(db);
    return clone(team);
  },

  async dissolveTeam(id, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "dissolve teams");
    const team = findTeam(db, admin, id);
    const text = requireReason(reason);
    if (team.result === "finalist") throw new ApiError(409, "This team is a published finalist, so it cannot be dissolved.");
    for (const student of db.students) if (student.teamId === team.id) student.teamId = null;
    for (const nomination of db.nominations) nomination.teamIds = nomination.teamIds.filter((teamId) => teamId !== team.id);
    db.teams = db.teams.filter((t) => t.id !== team.id);
    log(db, { actorEmail: admin.email, action: "team.dissolved", teamId: team.id, teamCode: team.code, department: team.department, detail: `${team.name} dissolved. Reason: ${text}` });
    save(db);
  },

  async listStudents(query) {
    await delay();
    const db = load();
    return clone(paginate(filterStudents(db, actor(db), query), query.page, query.pageSize));
  },

  async exportStudents(query) {
    await delay();
    const db = load();
    return clone(filterStudents(db, actor(db), query));
  },

  async getSchedule() {
    await delay();
    const db = load();
    actor(db);
    return clone(scheduleOf(db));
  },

  async saveSchedule(input: ScheduleInput) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change the schedule");
    writeSchedule(db, admin, input.registrationOpens, input.registrationCloses, input.nominationsDeadline, input.resultsPublishFrom);
    if (input.registrationExtendedCloses !== undefined) {
      if (input.registrationExtendedCloses && new Date(input.registrationExtendedCloses) < new Date(input.registrationCloses)) {
        throw new ApiError(422, "The later deadline cannot be earlier than the KIET departments' closing date.");
      }
      db.schedule.extendedCloses = input.registrationExtendedCloses;
    }
    log(db, { actorEmail: admin.email, action: "schedule.updated", department: null, detail: `Registration ${input.registrationOpens} to ${input.registrationCloses}` });
    save(db);
    return clone(scheduleOf(db));
  },

  async openRegistrationNow(registrationCloses) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change the schedule");
    if (windowState(db.schedule.opens, db.schedule.closes) === "open") throw new ApiError(409, "Registration is already open.");
    const closes = registrationCloses ?? db.schedule.closes;
    const opens = new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
    if (new Date(closes).getTime() <= Date.now()) {
      throw new ApiError(422, "The closing date has passed. Choose a new closing date to open registration again.");
    }
    writeSchedule(db, admin, opens, closes, db.schedule.deadline);
    log(db, { actorEmail: admin.email, action: "schedule.opened", department: null, detail: `Registration opened by an organiser; closes ${closes}` });
    save(db);
    return clone(scheduleOf(db));
  },

  async closeRegistrationNow() {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "change the schedule");
    if (windowState(db.schedule.opens, db.schedule.closes) === "closed") throw new ApiError(409, "Registration is already closed.");
    const closes = new Date(Math.floor(Date.now() / 1000) * 1000 - 1000).toISOString();
    const opens = new Date(Math.min(new Date(db.schedule.opens).getTime(), new Date(closes).getTime() - 1000)).toISOString();
    writeSchedule(db, admin, opens, closes, db.schedule.deadline);
    log(db, { actorEmail: admin.email, action: "schedule.closed", department: null, detail: "Registration closed by an organiser" });
    save(db);
    return clone(scheduleOf(db));
  },

  async getFinalists(department) {
    await delay();
    const db = load();
    const admin = actor(db);
    checkBoardAccess(admin, department);
    return clone(board(db, department, admin));
  },

  async saveFinalists(department, nominations: NominationInput) {
    await delay();
    const db = load();
    const admin = actor(db);
    checkBoardAccess(admin, department);
    if (db.publishedAt) throw new ApiError(409, "Results have been published. Nominations are locked.");
    if (deadlinePassed(db) && admin.role !== "super_admin") {
      throw new ApiError(403, `The nomination deadline passed on ${formatIst(db.schedule.deadline)}. Ask a super admin to change the nominations.`);
    }
    for (const { category, teamIds } of nominations) {
      if (!categories.some((c) => c.number === category)) throw new ApiError(422, `Unknown category ${category}.`);
      const unique = [...new Set(teamIds)];
      const quota = finalistQuota(department, category);
      if (unique.length > quota) {
        throw new ApiError(422, `Category ${category} allows at most ${quota} finalist team${quota === 1 ? "" : "s"} from ${department}.`);
      }
      const eligible = new Set(eligibleTeams(db, department, category).map((t) => t.id));
      const invalid = unique.find((id) => !eligible.has(id));
      if (invalid) {
        const code = db.teams.find((t) => t.id === invalid)?.code ?? invalid;
        throw new ApiError(422, `${code} is not a submitted ${department} team in Category ${category}.`);
      }
    }
    const changes: string[] = [];
    for (const { category, teamIds } of nominations) {
      const unique = [...new Set(teamIds)];
      const before = nominatedIds(db, department, category);
      const entry = db.nominations.find((n) => n.department === department && n.category === category);
      if (entry) entry.teamIds = unique;
      else db.nominations.push({ department, category, teamIds: unique });
      if (before.join() !== unique.join()) {
        const codes = unique.map((id) => db.teams.find((t) => t.id === id)?.code ?? id);
        changes.push(`Category ${category}: ${codes.length ? codes.join(", ") : "none"}`);
      }
    }
    if (changes.length > 0) {
      log(db, { actorEmail: admin.email, action: "finalists.updated", department, detail: `${department} nominations updated. ${changes.join("; ")}.` });
      const at = db.audit[db.audit.length - 1].at;
      db.nominationsUpdated = db.nominationsUpdated.filter((u) => u.department !== department);
      db.nominationsUpdated.push({ department, at, by: admin.email });
    }
    save(db);
    return clone(board(db, department, admin));
  },

  async finalistSummary() {
    await delay();
    const db = load();
    requireSuper(actor(db), "view the finalist summary");
    return clone(finalistSummaryOf(db));
  },

  async publishResults(): Promise<PublishResult> {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "publish results");
    if (db.publishedAt) throw new ApiError(409, "Results have already been published.");
    const blocked = publishBlocker(db);
    if (blocked) throw new ApiError(409, blocked);
    let finalists = 0;
    let notSelected = 0;
    for (const team of db.teams) {
      if (team.route !== "department" || team.status !== "submitted" || !team.department) continue;
      const selected = nominatedIds(db, team.department, team.category).includes(team.id);
      team.result = selected ? "finalist" : "not_selected";
      if (selected) finalists += 1;
      else notSelected += 1;
    }
    log(db, {
      actorEmail: admin.email,
      action: "results.published",
      department: null,
      detail: `Department round results published: ${finalists} finalist teams, ${notSelected} not selected.`,
    });
    db.publishedAt = db.audit[db.audit.length - 1].at;
    db.publishedBy = admin.email;
    save(db);
    return { publishedAt: db.publishedAt, finalists, notSelected };
  },

  async listAdmins() {
    await delay();
    const db = load();
    requireSuper(actor(db), "manage admins");
    return clone([...configuredAdmins(db), ...db.admins]);
  },

  async addAdmin(input: AdminInput) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "manage admins");
    const email = input.email.trim().toLowerCase();
    const name = input.name.trim();
    if (!EMAIL_PATTERN.test(email)) throw new ApiError(422, "Enter a valid email address.");
    if (name.length < 2) throw new ApiError(422, "Enter the admin's name.");
    if (!["admin", "super_admin", "outside_admin", "college_admin", "school_admin", "startup_admin"].includes(input.role)) throw new ApiError(422, "Choose a role.");
    if (input.role === "admin" && (!input.department || !departments.includes(input.department))) {
      throw new ApiError(422, "Choose the department this admin manages.");
    }
    if ([...configuredAdmins(db), ...db.admins].some((a) => a.email.toLowerCase() === email)) {
      throw new ApiError(409, `${email} is already an admin.`);
    }
    const created: AdminUser = {
      email,
      name,
      role: input.role,
      department: input.role === "admin" ? input.department : null,
      addedAt: now(db),
      addedBy: admin.email,
    };
    db.admins.push(created);
    log(db, {
      actorEmail: admin.email,
      action: "admin.added",
      department: created.department,
      detail: `Added ${name} (${email}) as ${created.role === "super_admin" ? "super admin" : isTypeAdmin(created) ? `admin for ${scopeName(created).toLowerCase()}` : `admin for ${created.department}`}.`,
    });
    save(db);
    return clone(created);
  },

  async removeAdmin(email) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "manage admins");
    if (email.toLowerCase() === admin.email.toLowerCase()) throw new ApiError(409, "You cannot remove your own admin access.");
    if (configuredAdmins(db).some((a) => a.email === email.toLowerCase())) {
      throw new ApiError(409, "This super admin is set in the server configuration and cannot be removed here.");
    }
    const target = db.admins.find((a) => a.email.toLowerCase() === email.toLowerCase());
    if (!target) throw new ApiError(404, "No admin with this email exists.");
    if (target.role === "super_admin" && !db.admins.some((a) => a !== target && a.role === "super_admin")) {
      throw new ApiError(409, "At least one super admin must remain.");
    }
    db.admins = db.admins.filter((a) => a !== target);
    log(db, { actorEmail: admin.email, action: "admin.removed", department: target.department, detail: `Removed ${target.name} (${target.email}).` });
    save(db);
  },

  async audit(query = {}) {
    await delay();
    const db = load();
    const admin = actor(db);
    if (query.teamId) findTeam(db, admin, query.teamId);
    const rows = db.audit
      .filter((entry) => {
        if (query.teamId && entry.teamId !== query.teamId) return false;
        return auditVisible(db, admin, entry);
      })
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id))
      .slice(0, Math.min(query.limit ?? 50, 200));
    return clone(rows);
  },

  async activity(query) {
    await delay();
    const db = load();
    const admin = actor(db);
    checkDepartmentFilter(admin, query.department);
    const q = query.q?.trim().toLowerCase();
    const rows = db.audit
      .filter((entry) => {
        if (!auditVisible(db, admin, entry)) return false;
        if (query.kind && !entry.action.startsWith(`${query.kind}.`)) return false;
        if (query.department && entry.department !== query.department) return false;
        if (q && ![entry.actorEmail, entry.teamCode ?? "", entry.detail].some((v) => v.toLowerCase().includes(q))) return false;
        return true;
      })
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
    return clone(paginate(rows, query.page, query.pageSize));
  },

  async createTeam(input: AdminTeamInput) {
    await delay();
    const db = load();
    const admin = actor(db);
    const emails = [input.leaderEmail, ...input.memberEmails].map((e) => e.trim().toLowerCase()).filter(Boolean);
    if (new Set(emails).size !== emails.length) throw new ApiError(422, "A student is listed more than once.");
    if (emails.length > 5) throw new ApiError(422, "A team can have at most 5 members.");
    if (input.submit && emails.length < TEAM_MIN_SIZE) throw new ApiError(422, "A team needs 2 to 5 members to be submitted.");
    const people = emails.map((email) => {
      const found = db.students.find((s) => s.email.toLowerCase() === email);
      if (!found) throw new ApiError(422, `No registered student uses ${email}. They must sign in and complete their profile first.`);
      if (found.teamId) throw new ApiError(409, `${email} is already in a team.`);
      return found;
    });
    const [leader] = people;
    if (!canSeeStudent(admin, leader)) throw new ApiError(403, "You can only create teams led by students in your scope.");
    for (const p of people.slice(1)) {
      const same = p.participantType === leader.participantType && (leader.participantType === "kiet" || normaliseInstitution(p.institution) === normaliseInstitution(leader.institution));
      if (!same) throw new ApiError(422, `${p.email} is not from the same college or school as the leader.`);
    }
    if (db.teams.some((t) => t.name.trim().toLowerCase() === input.name.trim().toLowerCase())) throw new ApiError(409, "Another team already uses this name.");
    const at = now(db);
    const number = db.teams.length + 1;
    const id = `team-${String(number).padStart(3, "0")}-${db.seq + 1}`;
    const team: AdminTeam = {
      id,
      code: `IT26-${String(number).padStart(4, "0")}`,
      joinCode: "DEMO-CODE",
      name: input.name.trim(),
      category: input.category,
      domain: input.domain,
      projectTitle: input.projectTitle,
      abstract: input.abstract,
      participantType: leader.participantType,
      institution: leader.institution,
      department: leader.department,
      route: routeFor(leader.participantType, leader.department),
      // An entry an organiser creates is accepted at once.
      approvalRequired: needsApproval(leader.participantType, leader.department),
      approvedAt: needsApproval(leader.participantType, leader.department) ? at : null,
      rejectedAt: null,
      rejectedReason: null,
      leaderId: leader.userId,
      members: people.map((p, index) => ({
        userId: p.userId,
        fullName: p.fullName,
        email: p.email,
        department: p.department,
        course: p.course,
        year: p.year,
        role: index === 0 ? "leader" : "member",
        joinedAt: at,
        phone: p.phone,
        rollNumber: p.rollNumber,
        institution: p.institution,
      })),
      invitations: [],
      status: input.submit ? "submitted" : "draft",
      result: "pending",
      createdAt: at,
      submittedAt: input.submit ? at : null,
    };
    db.teams.push(team);
    for (const p of people) p.teamId = id;
    log(db, { actorEmail: admin.email, action: "team.created", teamId: id, teamCode: team.code, department: team.department, detail: `Created by an organiser with ${emails.length} members: ${emails.join(", ")}` });
    save(db);
    return clone(team);
  },

  async unpublishResults(reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "withdraw published results");
    const text = requireReason(reason);
    if (!db.publishedAt) throw new ApiError(409, "Results are not published.");
    let reverted = 0;
    for (const team of db.teams) {
      if (team.route === "department" && team.result !== "pending") {
        team.result = "pending";
        reverted += 1;
      }
    }
    db.publishedAt = null;
    db.publishedBy = null;
    log(db, { actorEmail: admin.email, action: "results.unpublished", department: null, detail: `${reverted} team results back to pending. Reason: ${text}` });
    save(db);
  },

  async createStudent(input) {
    await delay();
    const db = load();
    const admin = actor(db);
    const email = input.email.trim().toLowerCase();
    if (db.students.some((s) => s.email.toLowerCase() === email)) throw new ApiError(409, "This student is already registered.");
    const student: StudentRecord = {
      userId: `u-new-${db.seq + 1}`,
      email,
      fullName: input.fullName,
      phone: input.phone,
      participantType: input.participantType,
      club: input.club,
      institution: input.participantType === "kiet" ? "KIET Deemed to be University" : input.institution,
      city: input.participantType === "kiet" ? "Ghaziabad" : input.city,
      department: input.department,
      course: input.participantType === "school" ? "School" : input.course,
      year: input.year,
      rollNumber: input.rollNumber,
      createdAt: now(db),
      teamId: null,
    };
    if (!canSeeStudent(admin, student)) throw new ApiError(403, "You can only register students in your scope.");
    db.students.push(student);
    log(db, { actorEmail: admin.email, action: "student.created", department: student.department, detail: `${email} (${input.fullName}), registered by an organiser` });
    save(db);
    return clone(studentRow(db, student));
  },

  async banStudent(userId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "ban students");
    const student = db.students.find((s) => s.userId === userId);
    if (!student) throw new ApiError(404, "Student not found.");
    const record = student as StudentRecord & { bannedAt?: string | null; bannedReason?: string | null; bannedBy?: string | null };
    record.bannedAt = now(db);
    record.bannedReason = requireReason(reason);
    record.bannedBy = admin.email;
    log(db, { actorEmail: admin.email, action: "student.banned", department: student.department, detail: `${student.email}: ${reason}` });
    save(db);
    return clone(studentRow(db, student));
  },

  async deleteStudent(userId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "delete student profiles");
    const student = db.students.find((s) => s.userId === userId);
    if (!student) throw new ApiError(404, "Student not found.");
    const text = requireReason(reason);
    let note = "";
    const team = db.teams.find((t) => t.id === student.teamId);
    if (team) {
      const mates = team.members.filter((m) => m.userId !== userId);
      if (team.leaderId === userId && mates.length === 0) {
        if (team.result === "finalist") throw new ApiError(409, "This student's team is a published finalist, so it cannot be deleted.");
        db.teams = db.teams.filter((t) => t.id !== team.id);
        note = ` Their team ${team.code} was deleted too.`;
      } else {
        if (team.leaderId === userId) {
          const heir = mates[Math.floor(Math.random() * mates.length)];
          team.leaderId = heir.userId;
          note = ` ${heir.email} is now leader of team ${team.code}.`;
        }
        team.members = mates;
      }
    }
    db.students = db.students.filter((s) => s.userId !== userId);
    log(db, { actorEmail: admin.email, action: "student.deleted", department: student.department, detail: `${student.email}: profile deleted. Reason: ${text}.${note}` });
    save(db);
    return `${student.fullName}'s profile is deleted.${note}`;
  },

  async unbanStudent(userId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "lift bans");
    const student = db.students.find((s) => s.userId === userId) as (StudentRecord & { bannedAt?: string | null }) | undefined;
    if (!student) throw new ApiError(404, "Student not found.");
    student.bannedAt = null;
    log(db, { actorEmail: admin.email, action: "student.unbanned", department: student.department, detail: `${student.email}: ${requireReason(reason)}` });
    save(db);
    return clone(studentRow(db, student));
  },

  async banTeam(teamId, reason) {
    await delay();
    const db = load();
    const admin = actor(db);
    requireSuper(admin, "ban teams");
    const team = findTeam(db, admin, teamId);
    return setStatus(db, admin, team, "disqualified", "team.disqualified", `Banned: ${requireReason(reason)}`);
  },

  saveQuotas: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  judging: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  readiness: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  saveTimetable: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  extendRooms: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setPanelBuffer: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setJudgePresent: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  unlockJudge: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  lockMarks: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  declareAward: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  removeAward: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  publishAwards: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  openJudging: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  lockJudging: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  rankings: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  attendance: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setTents: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  createPanel: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  updatePanel: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  deletePanel: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setPanelTeams: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setPanelJurors: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  listJurors: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  addJuror: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  removeJuror: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  editScore: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  scanPass: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  markPresent: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  unmarkPresent: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  judgeView: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  saveScore: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  judgeAttendance: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  judgeSetStudentPresence: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  setStudentPresence: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  listCertificateTemplates: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  getCertificateTemplate: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  uploadCertificateTemplate: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  saveCertificateFields: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  publishCertificate: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  withdrawCertificate: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  certificatePreview: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  certificateSample: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  listCertificateFonts: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  uploadCertificateFont: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  deleteCertificateFont: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  judgeCertificates: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),
  downloadJudgeCertificate: () => Promise.reject(new ApiError(501, CERTIFICATES_LIVE_ONLY)),

  leaderboard: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  rollCall: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  rollCallAll: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
  markStudents: () => Promise.reject(new ApiError(501, NOT_IN_DEMO)),
};
