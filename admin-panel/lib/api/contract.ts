import type { AcceptResult, MarkStudentsResult, RollCall, RollCallQuery, BulkAction, BulkResult, ActivityQuery, AdminInput, TeamPresence, AdminStudent, AdminStudentInput, AdminTeam, AdminTeamInput, AdminUser, ArchiveResult, AttendanceSheet, AuditEntry, FinalistBoard, FinalistSummary, JudgeView, Judging, JudgingRound, Juror, JurorInput, LockResult, NominationInput, Page, Panel, PanelInput, PanelPlace, PublishResult, QuotaCell, Rankings, Readiness, RoundState, ScanResult, Schedule, ScheduleInput, Score, Stats, StudentEditInput, StudentQuery, TeamEditInput, TeamQuery, Timetable } from "../admin-types";

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
  /** Super admin: submits a draft team for its students, whether or not registration is open (late entries). */
  submitTeam(id: string, reason: string): Promise<AdminTeam>;
  /** Super admin: archives draft teams whose registration has closed; the rest are skipped and listed. */
  archiveTeams(ids: string[], reason: string): Promise<ArchiveResult>;
  /**
   * Startups, COE KIET, other colleges and schools: accepts the teams (true) so they can be allotted stalls, or puts them
   * back in the queue (false). Teams that cannot change are skipped and listed.
   */
  acceptTeams(ids: string[], accepted: boolean): Promise<AcceptResult>;
  /**
   * One action for many teams: withdraw, disqualify, restore, archive, submit, accept, back to the queue (unaccept) or reject.
   * Every team changes on its own; those that cannot are skipped and listed with the reason. A reason is needed for all but
   * accept and unaccept; the students see it for a rejection.
   */
  bulkTeams(ids: string[], action: BulkAction, options?: { reason?: string; unbanMembers?: boolean }): Promise<BulkResult>;
  /** Super admin: deletes a team and frees its members. The history stays in the audit log. */
  dissolveTeam(id: string, reason: string): Promise<void>;
  /** Accepts a submitted startup, COE KIET, other-college or school team for the Grand Finale. */
  approveTeam(id: string): Promise<AdminTeam>;
  /** Takes that acceptance back. */
  revokeApproval(id: string, reason: string): Promise<AdminTeam>;

  listStudents(query: StudentQuery): Promise<Page<AdminStudent>>;
  exportStudents(query: StudentQuery): Promise<AdminStudent[]>;
  /** Registers a student for them (help desk), whether or not registration is open. */
  createStudent(input: AdminStudentInput): Promise<AdminStudent>;
  /** Super admin: corrects a student's profile (not their sign-in email). */
  editStudent(userId: string, input: StudentEditInput): Promise<AdminStudent>;
  /** Super admin: edits a team's name, category, domain, project title and abstract. */
  editTeam(teamId: string, input: TeamEditInput): Promise<AdminTeam>;
  /** Super admin: adds a registered student to a team by email. */
  addTeamMember(teamId: string, email: string, reason: string): Promise<AdminTeam>;
  /** Super admin: takes a member out of a team (not its leader). */
  removeTeamMember(teamId: string, userId: string, reason: string): Promise<AdminTeam>;
  /** Super admin: makes another member the team leader. */
  setTeamLeader(teamId: string, userId: string, reason: string): Promise<AdminTeam>;
  /** Super admin: the student can no longer use the portal or be put in a team. */
  banStudent(userId: string, reason: string): Promise<AdminStudent>;
  unbanStudent(userId: string, reason: string): Promise<AdminStudent>;
  /** Super admin: deletes the student's profile. A leader hands over to a random team mate; a lone leader's team is deleted too. Returns a message. */
  deleteStudent(userId: string, reason: string): Promise<string>;
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
  /** Every department's progress setting up its rooms, ranked (super admins and department admins). */
  readiness(): Promise<Readiness>;
  /** The department round timetable; only a super admin can change it. `moveRooms` moves rooms still at a department's old time. */
  saveTimetable(slots: { department: string; slotStart: string | null; slotEnd: string | null }[], moveRooms: boolean): Promise<Timetable>;
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
  /** Sets a department room's buffer: the extra minutes after its slot in which its judges can still submit marks (0 to 60). */
  setPanelBuffer(id: string, bufferMinutes: number): Promise<Panel>;
  deletePanel(id: string): Promise<void>;
  setPanelTeams(id: string, teamIds: string[]): Promise<Panel>;
  setPanelJurors(id: string, jurors: { email: string }[]): Promise<Panel>;
  /** Marks a judge present in their room, or takes the mark back. Super admins, and a department's admin for their own rooms. */
  setJudgePresent(panelId: string, jurorEmail: string, present: boolean): Promise<Panel>;
  listJurors(): Promise<Juror[]>;
  addJuror(input: JurorInput): Promise<Juror>;
  removeJuror(email: string): Promise<void>;
  /**
   * Changes (or enters) a judge's marks, and keeps the reason in the activity log. A super admin at any time, without
   * a reason; the department's own admin during the room's slot and buffer, with a clear reason.
   */
  editScore(panelId: string, teamId: string, jurorEmail: string, marks: number[], remarks: string, reason: string): Promise<Score>;
  /** Lets a judge change their marks again after locking them. A super admin, or the department's admin during the slot and buffer. */
  unlockJudge(panelId: string, jurorEmail: string, reason: string): Promise<Panel>;

  /** Marks the student behind a scanned event pass present. Organisers, and judges for their own rooms. */
  /** An admin marks a student of a department round team present or absent, at any time (super admins; a department's admin for their own). */
  setStudentPresence(teamId: string, userId: string, present: boolean): Promise<TeamPresence>;
  /** The department round's students by department and year, present or absent. Super admins: all departments; a department's admin: their own. */
  rollCall(query: RollCallQuery): Promise<RollCall>;
  /** Everything the filters match (no paging), for the PDF, Excel and CSV downloads. */
  rollCallAll(query: RollCallQuery): Promise<RollCall>;
  /** Marks students present or absent in one go. Marks are only added or changed, never deleted. */
  markStudents(userIds: string[], present: boolean): Promise<MarkStudentsResult>;
  scanPass(code: string, round: JudgingRound, panelId?: string): Promise<ScanResult>;
  markPresent(userId: string, round: JudgingRound, note: string): Promise<ScanResult>;
  unmarkPresent(userId: string, round: JudgingRound, note: string): Promise<void>;

  /** A judge's own panels and scores. */
  judgeView(): Promise<JudgeView>;
  /**
   * Saves a judge's marks for a team. Saved marks can be changed (with a clear `editReason`) until the judge locks
   * them or the room's time runs out.
   */
  saveScore(panelId: string, teamId: string, marks: number[], remarks: string, editReason?: string): Promise<Score>;
  /** Locks all the judge's saved marks in a room. */
  lockMarks(panelId: string): Promise<LockResult>;
  /** A judge's own room: its teams and who is present. */
  judgeAttendance(panelId: string): Promise<AttendanceSheet>;
  /** A judge of the room marks a student of one of its teams present or absent, during the room's time. */
  judgeSetStudentPresence(panelId: string, teamId: string, userId: string, present: boolean): Promise<TeamPresence>;
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
