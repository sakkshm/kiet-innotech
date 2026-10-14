/**
 * Live admin API client for the FastAPI backend.
 *
 * Base URL: NEXT_PUBLIC_API_URL (no trailing slash). All routes below are relative to it.
 *
 * Sign-in (lib/auth/sign-in.ts; no bearer token, same error format)
 *   POST   /auth/google   body { credential: <Google ID token from Google Identity Services>, app: "admin" }
 *   POST   /dev/token     body { email, name, app: "admin" }   (local development backend only)
 *          → { token, expires_at (ISO 8601), email (lowercased), name }
 *          401 bad credential, 403 not an organiser. Admin tokens last 12 hours; there is no refresh.
 *
 * Conventions
 * - Every admin request sends `Authorization: Bearer <session token>` from the sign-in response.
 *   Admin endpoints reject student portal tokens. 401 (missing or expired token) signs the panel
 *   out and returns to /login; 403 from /admin/me shows the "not authorised" screen.
 * - Requests time out after 20 seconds.
 * - Request and response bodies use snake_case keys; this client converts them to and from camelCase.
 *   Query parameter names are snake_case too. Enum values (statuses, sort keys) are sent as-is.
 * - Errors are non-2xx responses with `{ "detail": "Human readable message" }`; `detail` is always a
 *   string, including for 422 (the client still copes with FastAPI's list form just in case).
 *   401 = missing or expired token, 403 = not an admin / outside the admin's scope / super admin only,
 *   404 = not found, 409 = state conflict (e.g. already withdrawn, results already published),
 *   422 = invalid input.
 * - Role scoping, enforced by the backend: role "admin" sees only KIET teams whose `department`
 *   equals the admin's department, KIET students whose own `department` equals it, audit entries
 *   whose `department` equals it, and only that department's finalist board. Passing any other
 *   `department` returns 403, as does opening another department's team by ID.
 *   Role "super_admin" sees everything (all departments, other colleges and schools).
 * - Paged responses: `{ items, total, page, page_size }`. `page` starts at 1; `page_size` defaults
 *   to 25, max 100.
 *
 * Endpoints (request → response; shapes are the types in lib/admin-types.ts and lib/types.ts)
 *
 *   GET    /admin/me
 *          → AdminUser { email, name, role: "super_admin" | "admin", department | null, added_at, added_by }
 *          403 if the signed-in email is not an admin.
 *
 *   GET    /admin/stats
 *          → Stats (scoped to the caller). `by_type` and `by_department` are null for department admins.
 *
 *   GET    /admin/teams?department=&category=&status=&type=&route=&q=&sort=&order=&page=&page_size=
 *          department: KIET department name (e.g. "CSE(AI)"); category: 1-8;
 *          status: draft | submitted | withdrawn | disqualified; type: kiet | college | school;
 *          route: department | finale; q (at most 100 characters, else 422): case-insensitive match
 *          on team name, team code, institution, member names and member emails;
 *          sort: code | name | category | department | status | members | submitted_at (default code);
 *          order: asc | desc (default asc).
 *          → Page<AdminTeam> (members include phone, roll_number, institution; invitations = pending only)
 *
 *   GET    /admin/teams/export?(same filters as /admin/teams, no page/page_size)
 *          → AdminTeam[]  every matching team, used for CSV export.
 *
 *   GET    /admin/teams/{id}
 *          → AdminTeam. 404 unknown, 403 outside the caller's department.
 *
 *   POST   /admin/teams/{id}/withdraw     body { reason }   (admin in scope, super_admin)
 *          Allowed from draft | submitted. Sets status "withdrawn", cancels pending invitations,
 *          removes the team from finalist nominations, writes an audit entry. → AdminTeam
 *
 *   POST   /admin/teams/{id}/disqualify   body { reason }   (super_admin only)
 *          Allowed from draft | submitted. Sets status "disqualified", same side effects. → AdminTeam
 *
 *   POST   /admin/teams/{id}/restore      body { reason }   (super_admin only)
 *          Allowed from withdrawn | disqualified. Status becomes "submitted" if submitted_at is set,
 *          otherwise "draft". 409 if members have left since (leader gone, or a submitted team
 *          below 2 members). → AdminTeam
 *          `reason` is required (at least 5 characters) on all three actions.
 *
 *   GET    /admin/students?department=&type=&year=&in_team=&q=&sort=&order=&page=&page_size=
 *          in_team: yes | no; q (at most 100 characters) matches name, email, roll number, institution, phone;
 *          sort: name | email | department | year | institution | created_at (default name).
 *          → Page<AdminStudent> (Profile + team { id, code, name, status, department, role } | null)
 *
 *   GET    /admin/students/export?(same filters, no paging)
 *          → AdminStudent[]
 *
 *   GET    /admin/schedule
 *          → Schedule { registration: { state, opens, closes }, nominations_deadline | null, nominations_open, customised,
 *            updated_by, updated_at, server_time, planned: { registration_opens, registration_closes, nominations_deadline } }
 *          Every admin can read it.
 *
 *   PUT    /admin/schedule        (super_admin only)
 *          body { registration_opens, registration_closes, nominations_deadline | null }, each ISO 8601 WITH an offset.
 *          422 if closes <= opens, a window over a year, a date outside 2020-2100, or a date without an offset.
 *          Applies on the very next request of every student; audited ("schedule.updated"). → Schedule
 *
 *   POST   /admin/schedule/open-now     (super_admin only)    body {} or { registration_closes }
 *          Opens registration now. 409 if already open; 422 if the (old or given) closing date is not in the future,
 *          in which case send a new registration_closes. → Schedule
 *
 *   POST   /admin/schedule/close-now    (super_admin only)
 *          Closes registration now; submitted teams are untouched. 409 if already closed. → Schedule
 *
 *   GET    /admin/finalists?department=
 *          → FinalistBoard { department, published_at, updated_at, updated_by,
 *            categories: [{ category, quota, teams: TeamSummary[], nominated: team_id[] }] }
 *          One entry per category 1-8. `teams` = submitted, route "department" teams of that
 *          department and category. `quota` = finalistQuota(department, category).
 *          403 for another department (department admin), 404 unknown department.
 *
 *   PUT    /admin/finalists/{department}
 *          body { nominations: [{ category, team_ids: string[] }] }  (categories not listed are unchanged)
 *          422 if a category exceeds its quota or a team is not an eligible submitted team of that
 *          department and category; 409 once results are published. → FinalistBoard
 *
 *   GET    /admin/finalists/summary        (super_admin only)
 *          → FinalistSummary { published_at, published_by,
 *            matrix: [{ department, categories: [{ category, quota, nominated, eligible }] }],
 *            direct_teams: TeamSummary[] }  (submitted other-college and school teams)
 *
 *   POST   /admin/results/publish          (super_admin only, once)   body { confirm: "PUBLISH" }
 *          422 without the phrase; 409 before the nominations deadline or when nobody is nominated (the reason is
 *          also in GET /admin/finalists/summary as publish_blocked)
 *          Every submitted route "department" team becomes result "finalist" if nominated, else
 *          "not_selected". Finale-route teams are unchanged. Locks nominations. 409 if already published.
 *          → PublishResult { published_at, finalists, not_selected }
 *
 *   GET    /admin/admins                    (super_admin only) → AdminUser[]
 *          Super admins set in the server configuration come first, with added_by
 *          "server configuration" and added_at null. They cannot be removed here (409).
 *   POST   /admin/admins                    (super_admin only)
 *          body { email, name, role, department }  department required (a KIET department) when
 *          role = "admin", must be null for "super_admin". 409 if the email is already an admin.
 *          → AdminUser
 *   DELETE /admin/admins/{email}            (super_admin only) → 204. 409 when removing yourself.
 *
 *   POST   /admin/teams     body { name, category, domain, project_title, abstract, leader_email, member_emails[], submit }
 *          Creates a team for registered students whatever the registration window says. Same team rules as students
 *          (same institution, category eligibility, 1-5 members or 2-5 to submit, unique name); the leader must be in the
 *          caller's scope. → AdminTeam (201)
 *
 *   POST   /admin/teams/{id}/reopen    (super_admin) body { reason } → AdminTeam (draft). 409 unless submitted and registration is
 *          open, once KIET results are published, or when the team is allotted to a room/panel, scored or has a tent.
 *   POST   /admin/teams/{id}/dissolve  (super_admin) body { reason } → 204. Deletes the team and frees its members; 409 for a
 *          published finalist or a team in judging.
 *   POST   /admin/students    body ProfileInput + { email } → AdminStudent (201). Scoped like the student list.
 *   POST   /admin/students/{user_id}/ban | /unban   (super_admin) body { reason } → AdminStudent
 *   POST   /admin/students/{user_id}/delete   (super_admin) body { reason } → { message }
 *   POST   /admin/teams/{id}/ban   (super_admin) body { reason, ban_members } → AdminTeam (disqualified)
 *
 *   POST   /admin/results/unpublish   (super_admin) body { confirm: "UNPUBLISH", reason } → 204
 *          409 when not published, or once the finale is being prepared (tents or finale panels for finalists, final
 *          judging open or scored).
 *
 *   GET    /admin/activity?kind=&department=&q=&page=&page_size=  → Page<AuditEntry>, newest first, scoped like teams.
 *
 *   Judging (super admins: everything; department admins: their own department's rooms and judges; outside admins
 *   read the finale)
 *   GET    /admin/judging/{round}                 → Judging        round: department | final
 *   GET|PUT /admin/judging/timetable  (PUT: super admin) body { slots: [{ department, slot_start, slot_end }], grace_minutes,
 *          move_rooms } → Timetable. A department room has two judges (one from its department, one from another), a judge
 *          sits in one room per round, and judges submit marks only from the slot's start to its end + grace_minutes.
 *   POST   /admin/judging/{round}/open | /lock    → RoundState     409 with the reason when it cannot open (super admin)
 *   GET    /admin/judging/{round}/rankings?department=   → Rankings
 *   GET    /admin/judging/{round}/attendance?panel_id=&department=   → AttendanceSheet (a room, a department, or the finale)
 *   PUT    /admin/judging/final/tents   body { tents: [{ team_id, tent | null }] } → Judging
 *   POST   /admin/panels   body { round, department, building, name, location, slot_start, slot_end } → Panel
 *          A department room needs a building and a slot; 409 when the same room is booked at an overlapping time.
 *   PATCH  /admin/panels/{id}   body { building, name, location, slot_start, slot_end } → Panel;  DELETE /admin/panels/{id} → 204
 *   PUT    /admin/panels/{id}/teams    body { team_ids }  → Panel
 *   PUT    /admin/panels/{id}/jurors   body { jurors: [{ email, chair }] } → Panel
 *   PUT    /admin/panels/{id}/teams/{team}/scores/{juror_email}  (super admin) body { marks, remarks, reason } → Score
 *   GET    /admin/jurors → Juror[];  POST /admin/jurors body JurorInput → Juror;  DELETE /admin/jurors/{email} → 204
 *   PUT    /admin/finalists/quotas  (super admin) body { quotas: [{ department, category, quota }] } → FinalistSummary
 *   POST   /admin/attendance/scan   body { code, round, panel_id? } → ScanResult  (organisers; judges for their rooms)
 *   POST   /admin/attendance/mark | /unmark   body { user_id, round, note } → ScanResult | 204
 *   GET    /judge  → JudgeView (the signed-in judge's panels);  PUT /judge/panels/{panel}/teams/{team}/score
 *          body { marks: number[9], remarks } → Score. 423 while the round is locked; 409 once submitted (final).
 *   GET    /judge/panels/{panel}/attendance → AttendanceSheet
 *
 *   GET    /admin/audit?team_id=&limit=
 *          → AuditEntry[] newest first (limit default 50, max 200). Scoped like teams; team_id of a
 *          team outside the caller's scope → 403.
 *          AuditEntry { id, at, actor_email, action, team_id, team_code, department, detail }
 *          id is a string. action: team.created | team.submitted | team.withdrawn | team.disqualified |
 *                  team.restored | finalists.updated | results.published | admin.added | admin.removed,
 *          plus student-portal actions: team.updated | team.deleted | member.joined | member.left |
 *                  member.removed | invitation.sent | invitation.cancelled | invitation.declined.
 *          Unknown future actions render with their raw action string.
 */
import type {
  AdminInput,
  AttendanceSheet,
  JudgeView,
  Judging,
  Juror,
  Panel,
  Rankings,
  ScanResult,
  Timetable,
  RoundState,
  Score,
  AdminStudent,
  AdminTeam,
  AdminUser,
  AuditEntry,
  FinalistBoard,
  FinalistSummary,
  Page,
  PublishResult,
  Schedule,
  ScheduleInput,
  Stats,
  StudentQuery,
  TeamQuery,
} from "../admin-types";
import { getSession } from "../auth/session";
import { ApiError, type AdminApi } from "./contract";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "").replace(/\/$/, "");
const TIMEOUT_MS = 20_000;
const SESSION_ENDED = "Your session has ended. Please sign in again.";

const toSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
const toCamel = (key: string) => key.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase());

function convertKeys(value: unknown, convert: (key: string) => string): unknown {
  if (Array.isArray(value)) return value.map((item) => convertKeys(item, convert));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [convert(key), convertKeys(item, convert)]),
    );
  }
  return value;
}

function queryString(query: object) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(toSnake(key), String(value));
  }
  const text = params.toString();
  return text ? `?${text}` : "";
}

/**
 * One request to the backend, with a timeout. Bodies are sent and returned as-is (snake_case);
 * non-2xx responses become an ApiError carrying the server's `detail`.
 */
export async function send(method: string, path: string, { body, token }: { body?: unknown; token?: string } = {}): Promise<unknown> {
  if (!API_URL) throw new ApiError(0, "NEXT_PUBLIC_API_URL is not set.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let response: Response;
    let data: unknown;
    try {
      response = await fetch(`${API_URL}${path}`, {
        method,
        headers: {
          Accept: "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      data = response.status === 204 ? undefined : await response.json().catch(() => null);
    } catch {
      throw new ApiError(
        0,
        controller.signal.aborted
          ? "The server took too long to respond. Please try again."
          : "Could not reach the server. Check your connection and try again.",
      );
    }
    if (!response.ok) {
      const detail = (data as { detail?: unknown } | null)?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail) && typeof detail[0]?.msg === "string"
            ? detail[0].msg
            : `Request failed (${response.status}).`;
      throw new ApiError(response.status, message);
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

export type AuthFailure = { status: 401 | 403; message: string };

let authFailureHandler: ((failure: AuthFailure) => void) | null = null;

/** AuthProvider registers here to sign out on 401 and show "not authorised" on 403 from /admin/me. */
export function setAuthFailureHandler(handler: ((failure: AuthFailure) => void) | null) {
  authFailureHandler = handler;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const session = getSession();
  if (!session) {
    authFailureHandler?.({ status: 401, message: SESSION_ENDED });
    throw new ApiError(401, SESSION_ENDED);
  }
  try {
    const data = await send(method, path, { body: body === undefined ? undefined : convertKeys(body, toSnake), token: session.token });
    return convertKeys(data, toCamel) as T;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) authFailureHandler?.({ status: 401, message: error.message });
    if (error instanceof ApiError && error.status === 403 && path === "/admin/me") authFailureHandler?.({ status: 403, message: error.message });
    throw error;
  }
}

const id = (value: string) => encodeURIComponent(value);

/** Export endpoints return every matching row, so paging parameters are dropped. */
function withoutPaging<Q extends { page?: number; pageSize?: number }>(query: Q) {
  const rest = { ...query };
  delete rest.page;
  delete rest.pageSize;
  return rest;
}

export const liveApi: AdminApi = {
  mode: "live",
  me: () => request<AdminUser>("GET", "/admin/me"),
  stats: () => request<Stats>("GET", "/admin/stats"),

  listTeams: (query: TeamQuery) => request<Page<AdminTeam>>("GET", `/admin/teams${queryString(query)}`),
  exportTeams: (query: TeamQuery) => request<AdminTeam[]>("GET", `/admin/teams/export${queryString(withoutPaging(query))}`),
  getTeam: (teamId) => request<AdminTeam>("GET", `/admin/teams/${id(teamId)}`),
  createTeam: (input) => request<AdminTeam>("POST", "/admin/teams", input),
  withdrawTeam: (teamId, reason) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/withdraw`, { reason }),
  disqualifyTeam: (teamId, reason) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/disqualify`, { reason }),
  restoreTeam: (teamId, reason, unbanMembers = false) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/restore`, { reason, unbanMembers }),
  reopenTeam: (teamId, reason) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/reopen`, { reason }),
  dissolveTeam: (teamId, reason) => request<void>("POST", `/admin/teams/${id(teamId)}/dissolve`, { reason }),
  approveTeam: (teamId) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/approve`),
  revokeApproval: (teamId, reason) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/approval/revoke`, { reason }),

  listStudents: (query: StudentQuery) => request<Page<AdminStudent>>("GET", `/admin/students${queryString(query)}`),
  exportStudents: (query: StudentQuery) =>
    request<AdminStudent[]>("GET", `/admin/students/export${queryString(withoutPaging(query))}`),
  createStudent: (input) => request<AdminStudent>("POST", "/admin/students", input),
  banStudent: (userId, reason) => request<AdminStudent>("POST", `/admin/students/${id(userId)}/ban`, { reason }),
  unbanStudent: (userId, reason) => request<AdminStudent>("POST", `/admin/students/${id(userId)}/unban`, { reason }),
  deleteStudent: async (userId, reason) => (await request<{ message: string }>("POST", `/admin/students/${id(userId)}/delete`, { reason })).message,
  banTeam: (teamId, reason, banMembers) => request<AdminTeam>("POST", `/admin/teams/${id(teamId)}/ban`, { reason, banMembers }),

  getSchedule: () => request<Schedule>("GET", "/admin/schedule"),
  saveSchedule: (input: ScheduleInput) => request<Schedule>("PUT", "/admin/schedule", input),
  openRegistrationNow: (registrationCloses) =>
    request<Schedule>("POST", "/admin/schedule/open-now", registrationCloses ? { registrationCloses } : {}),
  closeRegistrationNow: () => request<Schedule>("POST", "/admin/schedule/close-now"),

  getFinalists: (department) => request<FinalistBoard>("GET", `/admin/finalists${queryString({ department })}`),
  saveFinalists: (department, nominations) =>
    request<FinalistBoard>("PUT", `/admin/finalists/${id(department)}`, { nominations }),
  finalistSummary: () => request<FinalistSummary>("GET", "/admin/finalists/summary"),
  // The server insists on the typed phrase too, so a stray request cannot publish.
  publishResults: () => request<PublishResult>("POST", "/admin/results/publish", { confirm: "PUBLISH" }),
  unpublishResults: (reason) => request<void>("POST", "/admin/results/unpublish", { confirm: "UNPUBLISH", reason }),
  saveQuotas: (quotas) => request<FinalistSummary>("PUT", "/admin/finalists/quotas", { quotas }),

  listAdmins: () => request<AdminUser[]>("GET", "/admin/admins"),
  addAdmin: (input: AdminInput) => request<AdminUser>("POST", "/admin/admins", input),
  removeAdmin: (email) => request<void>("DELETE", `/admin/admins/${id(email)}`),

  audit: (query = {}) => request<AuditEntry[]>("GET", `/admin/audit${queryString(query)}`),
  activity: (query) => request<Page<AuditEntry>>("GET", `/admin/activity${queryString(query)}`),

  judging: (round) => request<Judging>("GET", `/admin/judging/${round}`),
  saveTimetable: (slots, graceMinutes, moveRooms) => request<Timetable>("PUT", "/admin/judging/timetable", { slots, graceMinutes, moveRooms }),
  declareAward: (round, teamId, place) => request<void>("POST", `/admin/judging/${round}/awards`, { teamId, place }),
  removeAward: (round, teamId) => request<void>("DELETE", `/admin/judging/${round}/awards/${id(teamId)}`),
  publishAwards: (round, publish) => request<void>("POST", `/admin/judging/${round}/awards/${publish ? "publish" : "withdraw"}`),
  openJudging: (round) => request<RoundState>("POST", `/admin/judging/${round}/open`),
  lockJudging: (round) => request<RoundState>("POST", `/admin/judging/${round}/lock`),
  rankings: (round, department) => request<Rankings>("GET", `/admin/judging/${round}/rankings${queryString({ department })}`),
  attendance: (round, scope = {}) => request<AttendanceSheet>("GET", `/admin/judging/${round}/attendance${queryString(scope)}`),
  setTents: (tents) => request<Judging>("PUT", "/admin/judging/final/tents", { tents }),
  createPanel: (input) => request<Panel>("POST", "/admin/panels", input),
  updatePanel: (panelId, input) => request<Panel>("PATCH", `/admin/panels/${id(panelId)}`, input),
  deletePanel: (panelId) => request<void>("DELETE", `/admin/panels/${id(panelId)}`),
  setPanelTeams: (panelId, teamIds) => request<Panel>("PUT", `/admin/panels/${id(panelId)}/teams`, { teamIds }),
  setPanelJurors: (panelId, jurors) => request<Panel>("PUT", `/admin/panels/${id(panelId)}/jurors`, { jurors }),
  listJurors: () => request<Juror[]>("GET", "/admin/jurors"),
  addJuror: (input) => request<Juror>("POST", "/admin/jurors", input),
  removeJuror: (email) => request<void>("DELETE", `/admin/jurors/${id(email)}`),
  editScore: (panelId, teamId, jurorEmail, marks, remarks, reason) =>
    request<Score>("PUT", `/admin/panels/${id(panelId)}/teams/${id(teamId)}/scores/${id(jurorEmail)}`, { marks, remarks, reason }),

  scanPass: (code, round, panelId) => request<ScanResult>("POST", "/admin/attendance/scan", { code, round, panelId: panelId ?? null }),
  markPresent: (userId, round, note) => request<ScanResult>("POST", "/admin/attendance/mark", { userId, round, note }),
  unmarkPresent: (userId, round, note) => request<void>("POST", "/admin/attendance/unmark", { userId, round, note }),

  judgeView: () => request<JudgeView>("GET", "/judge"),
  saveScore: (panelId, teamId, marks, remarks) =>
    request<Score>("PUT", `/judge/panels/${id(panelId)}/teams/${id(teamId)}/score`, { marks, remarks }),
  judgeAttendance: (panelId) => request<AttendanceSheet>("GET", `/judge/panels/${id(panelId)}/attendance`),
};
