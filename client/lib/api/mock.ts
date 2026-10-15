/**
 * In-browser stand-in for the FastAPI backend, used only when NEXT_PUBLIC_API_MODE=mock (development).
 * Data lives in localStorage and every rule from lib/rules.ts is enforced here, the way the server will.
 */
import { getSession } from "../auth/session";
import {
  KIET_INSTITUTION,
  REGISTRATION_CLOSES,
  REGISTRATION_OPENS,
  STARTUP_COURSE,
  TEAM_MAX_SIZE,
  categoryEligibility,
  directFinaleKind,
  JOIN_CODE_ALPHABET,
  inviteError,
  lengthError,
  limits,
  normaliseJoinCode,
  normalisePhone,
  profileErrors,
  registrationState,
  registrationWindow,
  routeFor,
  sameInstitution,
  submissionChecks,
  teamSizeLimits,
} from "../rules";
import { clubDepartment } from "../content";
import { longDate } from "../format";
import type { Invitation, Profile, ProfileInput, Team, TeamInput, TeamMember } from "../types";
import { ApiError, type StudentApi } from "./types";

const DB_KEY = "innotech-mock-db";
const LATENCY_MS = 250;
/** Invitations one team may send in 24 hours, as on the server. */
const INVITATIONS_PER_DAY = 20;

type Membership = { userId: string; role: TeamMember["role"]; joinedAt: string };
type StoredTeam = Omit<Team, "members" | "invitations"> & { memberships: Membership[] };
type Db = { version: 1; seq: number; profiles: Profile[]; teams: StoredTeam[]; invitations: Invitation[] };

/** The leader's profile: like the server, a team's college or school (and a school's city) is its leader's. */
const leaderProfile = (db: Db, team: StoredTeam) => db.profiles.find((p) => p.userId === team.leaderId)!;

const seededAt = "2026-10-03T10:00:00+05:30";

function kiet(email: string, fullName: string, department: string, year: number, rollNumber: string): Profile {
  return {
    userId: userIdFor(email),
    email,
    fullName,
    phone: "98" + [...email].reduce((sum, c) => (sum * 31 + c.charCodeAt(0)) % 1e8, 7).toString().padStart(8, "0"),
    participantType: "kiet",
    institution: KIET_INSTITUTION,
    city: "Ghaziabad",
    department,
    course: "B.Tech",
    year,
    rollNumber,
    club: "",
    createdAt: seededAt,
  };
}

function seed(): Db {
  const profiles: Profile[] = [
    kiet("aarav.sharma@kiet.edu", "Aarav Sharma", "CSE", 3, "2300290100012"),
    kiet("diya.verma@kiet.edu", "Diya Verma", "CSE(AIML)", 3, "2300290120031"),
    kiet("kabir.singh@kiet.edu", "Kabir Singh", "IT", 1, "2500290130007"),
    kiet("ananya.rao@kiet.edu", "Ananya Rao", "EC", 1, "2500290310044"),
    kiet("arjun.nair@kiet.edu", "Arjun Nair", "IT", 2, "2400290130021"),
    kiet("tanvi.arora@kiet.edu", "Tanvi Arora", "IT", 2, "2400290130058"),
    {
      ...kiet("rohan.mehta@gmail.com", "Rohan Mehta", "", 2, "ABES24CS118"),
      participantType: "college",
      institution: "ABES Engineering College",
      department: null,
      course: "B.Tech / B.E.",
    },
    {
      ...kiet("sneha.kapoor@gmail.com", "Sneha Kapoor", "", 2, "ABES24CS141"),
      participantType: "college",
      institution: "ABES Engineering College",
      department: null,
      course: "B.Tech / B.E.",
    },
    {
      ...kiet("ishaan.jain@gmail.com", "Ishaan Jain", "", 11, ""),
      phone: "9811203344",
      participantType: "school",
      institution: "Delhi Public School, Ghaziabad",
      department: null,
      course: "School",
    },
  ];

  // An existing team, so "already part of another team" can be tried.
  const team: StoredTeam = {
    id: "t_seed_1",
    code: "IT26-0001",
    joinCode: "CB26-XK7P",
    name: "Circuit Breakers",
    category: 3,
    domain: "IoT, Robotics & Automation",
    projectTitle: "Smart irrigation controller for small farms",
    abstract:
      "A low-cost soil moisture and weather aware irrigation controller that cuts water use for small farms, built on an ESP32 with a solar power supply and SMS alerts for farmers without smartphones.",
    participantType: "kiet",
    institution: KIET_INSTITUTION,
    department: "IT",
    route: "department",
    leaderId: userIdFor("arjun.nair@kiet.edu"),
    memberships: [
      { userId: userIdFor("arjun.nair@kiet.edu"), role: "leader", joinedAt: seededAt },
      { userId: userIdFor("tanvi.arora@kiet.edu"), role: "member", joinedAt: seededAt },
    ],
    status: "draft",
    result: "pending",
    createdAt: seededAt,
    submittedAt: null,
    approvalRequired: false,
    approvedAt: null,
  };

  return { version: 1, seq: 1, profiles, teams: [team], invitations: [] };
}

function userIdFor(email: string) {
  return "u_" + email.toLowerCase().replace(/[^a-z0-9]+/g, "_");
}

function load(): Db {
  try {
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Db;
      // Demo data saved before team codes existed.
      db.teams.forEach((t) => (t.joinCode ??= newJoinCode()));
      return db;
    }
  } catch {
    // Fall through to a fresh seed.
  }
  const db = seed();
  save(db);
  return db;
}

function save(db: Db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

function newJoinCode() {
  const chars = Array.from(crypto.getRandomValues(new Uint8Array(8)), (n) => JOIN_CODE_ALPHABET[n % JOIN_CODE_ALPHABET.length]).join("");
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}

const sleep = () => new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
const now = () => new Date().toISOString();
const id = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 10)}`;

// ---------- Helpers that read the database ----------

function currentUser() {
  const session = getSession();
  if (!session) throw new ApiError("Please sign in again.", 401);
  return session;
}

function requireProfile(db: Db) {
  const { email } = currentUser();
  const profile = db.profiles.find((p) => p.email === email);
  if (!profile) throw new ApiError("Complete your profile first.", 403);
  return profile;
}

function requireOpen() {
  const state = registrationState();
  if (state === "upcoming") throw new ApiError(`Registration opens on ${longDate(REGISTRATION_OPENS)}.`, 403);
  if (state === "closed") throw new ApiError(`Registration closed on ${longDate(REGISTRATION_CLOSES)}. Teams can no longer be changed.`, 403);
}

function teamOf(db: Db, userId: string) {
  return db.teams.find((t) => t.memberships.some((m) => m.userId === userId)) ?? null;
}

function toTeam(db: Db, stored: StoredTeam): Team {
  const { memberships, ...rest } = stored;
  const members = memberships.map((m): TeamMember => {
    const p = db.profiles.find((profile) => profile.userId === m.userId)!;
    return {
      userId: p.userId,
      fullName: p.fullName,
      email: p.email,
      department: p.department,
      course: p.course,
      year: p.year,
      role: m.role,
      joinedAt: m.joinedAt,
    };
  });
  const invitations = db.invitations.filter((i) => i.teamId === stored.id && i.status === "pending");
  return structuredClone({ ...rest, members, invitations });
}

function requireLedTeam(db: Db, teamId: string) {
  const profile = requireProfile(db);
  const team = db.teams.find((t) => t.id === teamId);
  if (!team || !team.memberships.some((m) => m.userId === profile.userId)) throw new ApiError("Team not found.", 404);
  if (team.leaderId !== profile.userId) throw new ApiError("Only the team leader can do this.", 403);
  return { profile, team };
}

const lockedMessages: Record<Exclude<StoredTeam["status"], "draft">, string> = {
  submitted: "This team has been submitted and is locked.",
  withdrawn: "This team has been withdrawn. You can leave it and then join or create another team.",
  disqualified: "This team has been disqualified. If you have questions, write to innotech@kiet.edu.",
  archived: "This team was not submitted before registration closed, so it has been archived.",
};

function requireDraft(team: StoredTeam) {
  if (team.status !== "draft") throw new ApiError(lockedMessages[team.status], 409);
}

/** One team per student: pending invitations to other teams are declined once they join or create one. */
function declinePendingInvitations(db: Db, email: string) {
  db.invitations.forEach((i) => {
    if (i.email === email && i.status === "pending") i.status = "declined";
  });
}

function validateTeamInput(input: TeamInput) {
  const error =
    lengthError("Team name", input.name, limits.teamName) ??
    lengthError("Project title", input.projectTitle, limits.projectTitle) ??
    lengthError("Abstract", input.abstract, limits.abstract) ??
    (input.domain.trim() ? null : "Choose a domain.");
  if (error) throw new ApiError(error, 422);
}

/** "Code  Crafters " and "code crafters" are the same name, as on the server. */
const nameKey = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

function nameTaken(db: Db, name: string, exceptId?: string) {
  const key = nameKey(name);
  return db.teams.some((t) => t.id !== exceptId && nameKey(t.name) === key);
}

// ---------- The API ----------

export const mockApi: StudentApi = {
  async getMe() {
    await sleep();
    const session = currentUser();
    const profile = load().profiles.find((p) => p.email === session.email) ?? null;
    return { email: session.email, name: session.name, profile: profile && structuredClone(profile), registration: registrationWindow() };
  },

  async saveProfile(input: ProfileInput) {
    await sleep();
    const db = load();
    const { email } = currentUser();
    const existing = db.profiles.find((p) => p.email === email);
    if (!existing) requireOpen();

    const errors = profileErrors(input, email);
    const first = Object.values(errors)[0];
    if (first) throw new ApiError(first, 422);

    const startup = input.participantType === "startup";
    const normalised: ProfileInput = {
      ...input,
      fullName: input.fullName.trim(),
      phone: normalisePhone(input.phone),
      institution: input.participantType === "kiet" ? KIET_INSTITUTION : input.institution.trim().replace(/\s+/g, " "),
      city: input.participantType === "kiet" ? "Ghaziabad" : startup ? "" : input.city.trim(),
      department: input.participantType === "kiet" ? input.department : null,
      course: startup ? STARTUP_COURSE : input.participantType === "school" ? "School" : input.course,
      year: startup ? 0 : input.year,
      rollNumber: startup ? "" : input.rollNumber.trim(),
      club: input.participantType === "kiet" && input.department === clubDepartment ? input.club.trim().replace(/\s+/g, " ") : "",
    };

    if (existing && teamOf(db, existing.userId)) {
      const locked =
        existing.participantType !== normalised.participantType ||
        !sameInstitution(existing, normalised) ||
        existing.department !== normalised.department ||
        existing.year !== normalised.year;
      if (locked) {
        throw new ApiError("You are in a team, so your college or school, department and year can no longer be changed.", 409);
      }
    }

    const rollTaken =
      normalised.participantType === "kiet" &&
      db.profiles.some((p) => p.email !== email && p.participantType === "kiet" && p.rollNumber === normalised.rollNumber);
    if (rollTaken) throw new ApiError("This roll number is already registered. If it is yours, write to innotech@kiet.edu.", 409);

    const profile: Profile = existing
      ? { ...existing, ...normalised }
      : { ...normalised, userId: userIdFor(email), email, createdAt: now() };
    db.profiles = [...db.profiles.filter((p) => p.email !== email), profile];
    save(db);
    return structuredClone(profile);
  },

  async getMyTeam() {
    await sleep();
    const db = load();
    const profile = requireProfile(db);
    const team = teamOf(db, profile.userId);
    return team ? toTeam(db, team) : null;
  },

  async createTeam(input) {
    await sleep();
    requireOpen();
    const db = load();
    const leader = requireProfile(db);
    if (teamOf(db, leader.userId)) throw new ApiError("You are already part of a team.", 409);
    validateTeamInput(input);
    if (nameTaken(db, input.name)) throw new ApiError("Another team already uses this name.", 409);
    const eligibility = categoryEligibility(input.category, leader.participantType, [leader.year]);
    if (!eligibility.allowed) throw new ApiError(eligibility.reason, 422);

    db.seq += 1;
    const team: StoredTeam = {
      id: id("t"),
      code: `IT26-${String(db.seq).padStart(4, "0")}`,
      joinCode: newJoinCode(),
      name: input.name.trim(),
      category: input.category,
      domain: input.domain,
      projectTitle: input.projectTitle.trim(),
      abstract: input.abstract.trim(),
      participantType: leader.participantType,
      institution: leader.institution,
      department: leader.department,
      route: routeFor(leader.participantType, leader.department),
      leaderId: leader.userId,
      memberships: [{ userId: leader.userId, role: "leader", joinedAt: now() }],
      status: "draft",
      result: "pending",
      createdAt: now(),
      submittedAt: null,
      approvalRequired: directFinaleKind(leader.participantType, leader.department) !== null,
      approvedAt: null,
    };
    db.teams.push(team);
    declinePendingInvitations(db, leader.email);
    save(db);
    return toTeam(db, team);
  },

  async updateTeam(teamId, input) {
    await sleep();
    requireOpen();
    const db = load();
    const { team } = requireLedTeam(db, teamId);
    requireDraft(team);
    validateTeamInput(input);
    if (nameTaken(db, input.name, team.id)) throw new ApiError("Another team already uses this name.", 409);
    const years = toTeam(db, team).members.map((m) => m.year);
    const eligibility = categoryEligibility(input.category, team.participantType, years);
    if (!eligibility.allowed) throw new ApiError(eligibility.reason, 422);

    Object.assign(team, {
      name: input.name.trim(),
      category: input.category,
      domain: input.domain,
      projectTitle: input.projectTitle.trim(),
      abstract: input.abstract.trim(),
    });
    save(db);
    return toTeam(db, team);
  },

  async deleteTeam(teamId) {
    await sleep();
    requireOpen();
    const db = load();
    const { team } = requireLedTeam(db, teamId);
    requireDraft(team);
    db.invitations.forEach((i) => {
      if (i.teamId === team.id && i.status === "pending") i.status = "cancelled";
    });
    db.teams = db.teams.filter((t) => t.id !== team.id);
    save(db);
  },

  async submitTeam(teamId) {
    await sleep();
    requireOpen();
    const db = load();
    const { team } = requireLedTeam(db, teamId);
    requireDraft(team);
    const failed = submissionChecks(toTeam(db, team), registrationState()).find((check) => !check.ok);
    if (failed) throw new ApiError(`Cannot submit yet: ${failed.label.toLowerCase()}.`, 422);
    team.status = "submitted";
    team.submittedAt = now();
    save(db);
    return toTeam(db, team);
  },

  async leaveTeam(teamId) {
    await sleep();
    requireOpen();
    const db = load();
    const profile = requireProfile(db);
    const team = db.teams.find((t) => t.id === teamId);
    if (!team || !team.memberships.some((m) => m.userId === profile.userId)) throw new ApiError("Team not found.", 404);
    // Anyone may leave a withdrawn team, so they can join another one.
    if (team.status !== "withdrawn") {
      if (team.leaderId === profile.userId) throw new ApiError("The leader cannot leave. Delete the team instead.", 409);
      requireDraft(team);
    }
    team.memberships = team.memberships.filter((m) => m.userId !== profile.userId);
    save(db);
  },

  async removeMember(teamId, userId) {
    await sleep();
    requireOpen();
    const db = load();
    const { team, profile } = requireLedTeam(db, teamId);
    requireDraft(team);
    if (userId === profile.userId) throw new ApiError("You cannot remove yourself. Delete the team instead.", 409);
    if (!team.memberships.some((m) => m.userId === userId)) throw new ApiError("This student is not in your team.", 404);
    team.memberships = team.memberships.filter((m) => m.userId !== userId);
    save(db);
    return toTeam(db, team);
  },

  async joinTeam(code) {
    await sleep();
    requireOpen();
    const db = load();
    const profile = requireProfile(db);
    const joinCode = normaliseJoinCode(code);
    if (!joinCode) throw new ApiError("Enter the 8-character team code your leader shared, e.g. K7PQ-3XM9.", 422);
    const team = db.teams.find((t) => t.joinCode === joinCode);
    if (!team) throw new ApiError("No team uses this code. Check it with your team leader.", 404);
    const current = teamOf(db, profile.userId);
    if (current) throw new ApiError(current.id === team.id ? "You are already in this team." : "You are already part of a team.", 409);
    if (team.status !== "draft") throw new ApiError("This team is no longer accepting members.", 409);

    const ownInvitation = db.invitations.find((i) => i.teamId === team.id && i.email === profile.email && i.status === "pending");
    const pending = db.invitations.filter((i) => i.teamId === team.id && i.status === "pending").length;
    // Pending invitations hold places in the team, except the one this student is using now.
    if (team.participantType === "startup") throw new ApiError("This startup entry cannot take members.", 409);
    if (team.memberships.length + pending - (ownInvitation ? 1 : 0) >= TEAM_MAX_SIZE) throw new ApiError("This team is already full.", 409);
    if (!sameInstitution(leaderProfile(db, team), profile)) {
      throw new ApiError("This team is from another college or school. All members must be from the same college or school.", 422);
    }
    const eligibility = categoryEligibility(team.category, team.participantType, [...toTeam(db, team).members.map((m) => m.year), profile.year]);
    if (!eligibility.allowed) throw new ApiError(eligibility.reason, 422);

    team.memberships.push({ userId: profile.userId, role: "member", joinedAt: now() });
    if (ownInvitation) ownInvitation.status = "accepted";
    declinePendingInvitations(db, profile.email);
    save(db);
    return toTeam(db, team);
  },

  async resetJoinCode(teamId) {
    await sleep();
    requireOpen();
    const db = load();
    const { team } = requireLedTeam(db, teamId);
    requireDraft(team);
    team.joinCode = newJoinCode();
    save(db);
    return toTeam(db, team);
  },

  async inviteMember(teamId, email) {
    await sleep();
    requireOpen();
    const db = load();
    const { team, profile } = requireLedTeam(db, teamId);
    const dayAgo = Date.now() - 86_400_000;
    const sentToday = db.invitations.filter((i) => i.teamId === team.id && Date.parse(i.createdAt) > dayAgo).length;
    if (sentToday >= INVITATIONS_PER_DAY) throw new ApiError("Your team has sent too many invitations today. Please try again tomorrow.", 429);
    const target = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(target)) throw new ApiError("Enter a valid email address.", 422);
    if (target === profile.email) throw new ApiError("You are already in this team.", 409);
    const invitee = db.profiles.find((p) => p.email === target) ?? null;
    const error = inviteError(toTeam(db, team), invitee, invitee ? teamOf(db, invitee.userId) !== null : false);
    if (error) throw new ApiError(error, 422);

    db.invitations.push({
      id: id("inv"),
      teamId: team.id,
      teamCode: team.code,
      teamName: team.name,
      category: team.category,
      leaderName: profile.fullName,
      email: target,
      status: "pending",
      createdAt: now(),
    });
    save(db);
    return toTeam(db, team);
  },

  async cancelInvitation(invitationId) {
    await sleep();
    const db = load();
    const invitation = db.invitations.find((i) => i.id === invitationId);
    if (!invitation) throw new ApiError("Invitation not found.", 404);
    const { team } = requireLedTeam(db, invitation.teamId);
    if (invitation.status !== "pending") throw new ApiError("This invitation has already been answered.", 409);
    invitation.status = "cancelled";
    save(db);
    return toTeam(db, team);
  },

  async getMyInvitations() {
    await sleep();
    const db = load();
    const profile = requireProfile(db);
    // Invitations to teams that were submitted, withdrawn or deleted can no longer be accepted, so they are not listed.
    return db.invitations.flatMap((i) => {
      const team = db.teams.find((t) => t.id === i.teamId);
      if (i.email !== profile.email || i.status !== "pending" || team?.status !== "draft") return [];
      return [structuredClone({ ...i, teamName: team.name, category: team.category })];
    });
  },

  async respondToInvitation(invitationId, accept) {
    await sleep();
    const db = load();
    const profile = requireProfile(db);
    const invitation = db.invitations.find((i) => i.id === invitationId && i.email === profile.email && i.status === "pending");
    if (!invitation) throw new ApiError("This invitation is no longer available.", 404);

    if (!accept) {
      invitation.status = "declined";
      save(db);
      return;
    }

    requireOpen();
    if (teamOf(db, profile.userId)) throw new ApiError("You are already part of a team.", 409);
    const team = db.teams.find((t) => t.id === invitation.teamId);
    if (!team || team.status !== "draft") throw new ApiError("This team is no longer accepting members.", 409);
    if (team.memberships.length >= teamSizeLimits(team.participantType)[1]) throw new ApiError("This team is already full.", 409);
    if (!sameInstitution(leaderProfile(db, team), profile)) throw new ApiError("You are not from the same college or school as this team.", 422);
    const years = [...toTeam(db, team).members.map((m) => m.year), profile.year];
    const eligibility = categoryEligibility(team.category, team.participantType, years);
    if (!eligibility.allowed) throw new ApiError(eligibility.reason, 422);

    team.memberships.push({ userId: profile.userId, role: "member", joinedAt: now() });
    invitation.status = "accepted";
    declinePendingInvitations(db, profile.email);
    save(db);
  },

  async getMyPass() {
    await sleep();
    const db = load();
    const profile = requireProfile(db);
    // The demo has no venue: the pass explains it appears once the team is submitted.
    return { seed: null, day: null, periodSeconds: 60, serverTime: new Date().toISOString(), userId: profile.userId, rounds: [] };
  },

  async getMyResults() {
    await sleep();
    return { cards: [] };
  },
};
