import type {
  ActivityQuery,
  AdminInput,
  AdminStudentInput,
  AdminTeamInput,
  AttendanceSheet,
  JudgeView,
  Judging,
  JudgingRound,
  Juror,
  JurorInput,
  Panel,
  PanelInput,
  PanelPlace,
  QuotaCell,
  ScanResult,
  Timetable,
  Rankings,
  RoundState,
  Score,
  AdminStudent,
  AdminTeam,
  AdminUser,
  AuditEntry,
  FinalistBoard,
  FinalistSummary,
  NominationInput,
  Page,
  PublishResult,
  Schedule,
  ScheduleInput,
  Stats,
  StudentQuery,
  TeamQuery,
} from "../admin-types";

/** Everything the admin panel needs from the backend. The mock and live implementations both satisfy it. */
export interface AdminApi {
  mode: "mock" | "live";

  /** The signed-in admin. Throws ApiError 403 if the account is not an admin. */
  me(): Promise<AdminUser>;
  stats(): Promise<Stats>;

  listTeams(query: TeamQuery): Promise<Page<AdminTeam>>;
  /** Every team matching the filters (no paging), for CSV export. */
  exportTeams(query: TeamQuery): Promise<AdminTeam[]>;
  getTeam(id: string): Promise<AdminTeam>;
  /** Creates a team for registered students, whether or not registration is open. */
  createTeam(input: AdminTeamInput): Promise<AdminTeam>;
  withdrawTeam(id: string, reason: string): Promise<AdminTeam>;
  disqualifyTeam(id: string, reason: string): Promise<AdminTeam>;
  /** `unbanMembers` also lifts the ban on every banned member (e.g. after the team was banned with its members). */
  restoreTeam(id: string, reason: string, unbanMembers?: boolean): Promise<AdminTeam>;
  /** Super admin: sends a submitted team back to draft (registration must be open; not once judging has started). */
  reopenTeam(id: string, reason: string): Promise<AdminTeam>;
  /** Super admin: deletes a team and frees its members. The history stays in the audit log. */
  dissolveTeam(id: string, reason: string): Promise<void>;
  /** Accepts a submitted startup or COE KIET entry as a legal entry for the Grand Finale. */
  approveTeam(id: string): Promise<AdminTeam>;
  /** Takes that acceptance back. */
  revokeApproval(id: string, reason: string): Promise<AdminTeam>;

  listStudents(query: StudentQuery): Promise<Page<AdminStudent>>;
  exportStudents(query: StudentQuery): Promise<AdminStudent[]>;
  /** Registers a student for them (help desk), whether or not registration is open. */
  createStudent(input: AdminStudentInput): Promise<AdminStudent>;
  /** Super admin: the student can no longer use the portal or be put in a team. */
  banStudent(userId: string, reason: string): Promise<AdminStudent>;
  unbanStudent(userId: string, reason: string): Promise<AdminStudent>;
  /** Super admin: disqualifies the team and, optionally, bans all its members. */
  banTeam(teamId: string, reason: string, banMembers: boolean): Promise<AdminTeam>;

  /** Registration window and nominations deadline. Any admin can read it; only a super admin can change it. */
  getSchedule(): Promise<Schedule>;
  saveSchedule(input: ScheduleInput): Promise<Schedule>;
  /** Opens registration immediately. `registrationCloses` is needed only if the closing date has already passed. */
  openRegistrationNow(registrationCloses?: string): Promise<Schedule>;
  closeRegistrationNow(): Promise<Schedule>;

  getFinalists(department: string): Promise<FinalistBoard>;
  saveFinalists(department: string, nominations: NominationInput): Promise<FinalistBoard>;
  finalistSummary(): Promise<FinalistSummary>;
  publishResults(): Promise<PublishResult>;
  /** Withdraws published results (e.g. published by mistake): every department team's result goes back to pending. */
  unpublishResults(reason: string): Promise<void>;
  /** Super admin: how many teams each department may nominate per category. */
  saveQuotas(quotas: QuotaCell[]): Promise<FinalistSummary>;

  listAdmins(): Promise<AdminUser[]>;
  addAdmin(input: AdminInput): Promise<AdminUser>;
  removeAdmin(email: string): Promise<void>;

  audit(query?: { teamId?: string; limit?: number }): Promise<AuditEntry[]>;
  /** The whole audit log, newest first, a page at a time. */
  activity(query: ActivityQuery): Promise<Page<AuditEntry>>;

  judging(round: JudgingRound): Promise<Judging>;
  /** The department round timetable; only a super admin can change it. `moveRooms` moves rooms still at a department's old time. */
  saveTimetable(
    slots: { department: string; slotStart: string | null; slotEnd: string | null }[],
    graceMinutes: number,
    loginLeadMinutes: number,
    moveRooms: boolean,
  ): Promise<Timetable>;
  /** Gives a fully scored team a prize place (department round: department admins for their department, and super admins). */
  declareAward(round: JudgingRound, teamId: string, place: number): Promise<void>;
  removeAward(round: JudgingRound, teamId: string): Promise<void>;
  /** Super admin: shows (true) or hides the round's winners and prize money to students. */
  publishAwards(round: JudgingRound, publish: boolean): Promise<void>;
  openJudging(round: JudgingRound): Promise<RoundState>;
  lockJudging(round: JudgingRound): Promise<RoundState>;
  rankings(round: JudgingRound, department?: string): Promise<Rankings>;
  /** A room's sheet (panelId), a department's (department round), or every finale team. */
  attendance(round: JudgingRound, scope?: { panelId?: string; department?: string }): Promise<AttendanceSheet>;
  setTents(tents: { teamId: string; tent: string | null }[]): Promise<Judging>;
  createPanel(input: PanelInput): Promise<Panel>;
  updatePanel(id: string, input: PanelPlace): Promise<Panel>;
  deletePanel(id: string): Promise<void>;
  setPanelTeams(id: string, teamIds: string[]): Promise<Panel>;
  setPanelJurors(id: string, jurors: { email: string; chair: boolean }[]): Promise<Panel>;
  listJurors(): Promise<Juror[]>;
  addJuror(input: JurorInput): Promise<Juror>;
  removeJuror(email: string): Promise<void>;
  /** Super admin: changes (or enters) a judge's marks; the reason goes into the activity log. */
  editScore(panelId: string, teamId: string, jurorEmail: string, marks: number[], remarks: string, reason: string): Promise<Score>;

  /** Marks the student behind a scanned event pass present. Organisers, and judges for their own rooms. */
  scanPass(code: string, round: JudgingRound, panelId?: string): Promise<ScanResult>;
  markPresent(userId: string, round: JudgingRound, note: string): Promise<ScanResult>;
  unmarkPresent(userId: string, round: JudgingRound, note: string): Promise<void>;

  /** A judge's own panels and scores. */
  judgeView(): Promise<JudgeView>;
  /** Submits a judge's marks. Final: a second submission is refused (only a super admin can change them). */
  saveScore(panelId: string, teamId: string, marks: number[], remarks: string): Promise<Score>;
  /** A judge's own room: its teams and who is present. */
  judgeAttendance(panelId: string): Promise<AttendanceSheet>;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}

export const DEFAULT_PAGE_SIZE = 25;

/** The backend rejects longer search text with 422. */
export const MAX_SEARCH_LENGTH = 100;
