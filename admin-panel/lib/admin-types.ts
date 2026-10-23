/**
 * Data shapes used only by the admin panel. Shared shapes (Team, Profile, ...) live in types.ts,
 * which is a verbatim copy of the student portal's file.
 * All of these mirror the backend JSON after snake_case keys are converted to camelCase in lib/api/live.ts.
 */
import type { ParticipantType, Profile, Team, TeamMember, TeamResult, TeamRoute, TeamStatus } from "./types";

/**
 * Organiser roles. A department admin sees one KIET department (COE KIET is one of them); an outside admin other
 * colleges and schools; a college admin other colleges only; a school admin schools only; a startup admin only startups.
 */
export type AdminRole = "super_admin" | "admin" | "outside_admin" | "college_admin" | "school_admin" | "startup_admin";

export type AdminUser = {
  email: string;
  name: string;
  /** "judge": an appointed judge who is not an organiser; they see only their own judging page. */
  role: AdminRole | "judge";
  /** The KIET department a department admin is scoped to (or a faculty judge belongs to). Null otherwise. */
  department: string | null;
  /** True when this account is also an appointed judge. */
  judge?: boolean;
  /** Null for super admins set in the server configuration. */
  addedAt?: string | null;
  /** An admin's email, or CONFIGURED_BY_SERVER. */
  addedBy?: string | null;
};

/** `addedBy` of super admins listed in the backend's configuration. They cannot be removed from the panel. */
export const CONFIGURED_BY_SERVER = "server configuration";

export type AdminInput = { email: string; name: string; role: AdminRole; department: string | null };

export type AuditAction =
  | "team.created"
  | "team.submitted"
  | "team.archived"
  | "team.edited"
  | "team.member_added"
  | "team.member_removed"
  | "student.edited"
  | "team.withdrawn"
  | "team.disqualified"
  | "team.restored"
  | "team.updated"
  | "team.deleted"
  | "member.joined"
  | "member.left"
  | "member.removed"
  | "invitation.sent"
  | "invitation.cancelled"
  | "invitation.declined"
  | "finalists.updated"
  | "results.published"
  | "admin.added"
  | "admin.removed"
  | "team.code_reset"
  | "schedule.updated"
  | "schedule.opened"
  | "schedule.closed"
  | "results.unpublished"
  | "judging.opened"
  | "judging.locked"
  | "judging.judge_added"
  | "judging.judge_removed"
  | "judging.panel_created"
  | "judging.panel_updated"
  | "judging.panel_deleted"
  | "judging.teams_allotted"
  | "judging.judges_assigned"
  | "judging.score_edited"
  | "judging.marks_locked"
  | "judging.marks_unlocked"
  | "judging.buffer_changed"
  | "judging.time_extended"
  | "judging.judge_present"
  | "judging.judge_unmarked"
  | "judging.timetable_updated"
  | "judging.award_declared"
  | "judging.award_removed"
  | "judging.awards_published"
  | "judging.awards_withdrawn"
  | "attendance.marked"
  | "attendance.absent"
  | "attendance.unmarked"
  | "finalists.quotas_updated"
  | "judging.tents_allotted"
  | "judging.scored"
  | "student.created"
  | "student.banned"
  | "student.unbanned"
  | "student.deleted"
  | "team.leader_changed"
  | "team.reopened"
  | "team.dissolved"
  | "team.approved"
  | "team.approval_revoked"
  | "team.rejected"
  | "team.rejection_revoked";

export type ActivityKind = "team" | "member" | "invitation" | "finalists" | "results" | "admin" | "schedule" | "judging" | "attendance" | "student";

export type ActivityQuery = {
  kind?: ActivityKind;
  department?: string;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type AuditEntry = {
  id: string;
  at: string;
  actorEmail: string;
  action: AuditAction;
  teamId?: string | null;
  teamCode?: string | null;
  /** Department the entry belongs to, used to scope the log for department admins. Null = institute-wide. */
  department?: string | null;
  detail: string;
};

/** A team member as admins see it: the student portal's member plus contact and roll details. */
export type AdminTeamMember = TeamMember & {
  phone: string;
  rollNumber: string;
  institution: string;
  /** Banned from the portal by an organiser. */
  banned?: boolean;
};

export type AdminTeam = Omit<Team, "members"> & {
  members: AdminTeamMember[];
};

/** A registered student plus a short reference to their team, if any. */
export type AdminStudent = Profile & {
  /** Department round: marked present or absent by the judges in the team's room. Null when the team has no room. */
  attendance?: "present" | "absent" | "not_marked" | null;
  /** Set when an organiser has banned the student from the portal. */
  bannedAt?: string | null;
  bannedReason?: string | null;
  bannedBy?: string | null;
  team: {
    id: string;
    code: string;
    name: string;
    status: TeamStatus;
    /** The team's department (the leader's), which can differ from the student's in mixed-branch teams. */
    department: string | null;
    role: "leader" | "member";
  } | null;
};

export type Page<T> = {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
};

export type SortOrder = "asc" | "desc";

export type TeamSort = "code" | "name" | "category" | "department" | "status" | "members" | "submitted_at" | "leader_year";

export type TeamQuery = {
  department?: string;
  category?: number;
  status?: TeamStatus;
  type?: ParticipantType;
  route?: TeamRoute;
  /** Startup and COE KIET entries: waiting for an admin to accept them, or already accepted. */
  approval?: "pending" | "approved" | "rejected";
  /** Department round result (finalist, not selected). */
  result?: TeamResult;
  /** Teams with at least one member in this year (college) or class (school). */
  year?: number;
  /** Teams whose leader is in this year or class. */
  leaderYear?: number;
  q?: string;
  sort?: TeamSort;
  order?: SortOrder;
  page?: number;
  pageSize?: number;
};

export type StudentSort = "name" | "email" | "department" | "year" | "institution" | "created_at";

export type StudentQuery = {
  department?: string;
  type?: ParticipantType;
  year?: number;
  /** "yes" = in a team (any status), "no" = not in a team. */
  inTeam?: "yes" | "no";
  /** "yes" = banned students only, "no" = everyone else. */
  banned?: "yes" | "no";
  q?: string;
  sort?: StudentSort;
  order?: SortOrder;
  page?: number;
  pageSize?: number;
};

export type StatusCounts = {
  total: number;
  draft: number;
  submitted: number;
  withdrawn: number;
  disqualified: number;
  archived: number;
};

export type Stats = {
  /** Department the numbers are scoped to; null means institute-wide (super admin). */
  department: string | null;
  /** Submitted startup and COE KIET entries waiting for an admin to accept them. */
  awaitingApproval: number;
  students: number;
  studentsInTeams: number;
  pendingInvitations: number;
  teams: StatusCounts;
  /** Super admin only. */
  byType: { type: ParticipantType; students: number; teams: number; submitted: number }[] | null;
  byCategory: ({ category: number } & StatusCounts)[];
  /** Super admin only. KIET departments. */
  byDepartment: ({ department: string; students: number } & StatusCounts)[] | null;
  recentSubmissions: TeamSummary[];
  resultsPublishedAt: string | null;
  /** One entry per day (IST), oldest first, from registration opening to today. */
  timeline: TimelinePoint[];
  /** Students per year, plus active teams led by that year and active teams with at least one member of it. */
  byYear: { participantType: ParticipantType; year: number; students: number; teamsLed: number; teamsWith: number }[];
  /** Active teams (draft or submitted) by number of members, sizes 1 to 5. */
  teamSizes: { size: number; teams: number }[];
  /** Active teams by project domain, most popular first. */
  byDomain: { domain: string; teams: number }[];
  /** Super admin only: other colleges and schools with the most registered students. */
  topInstitutions: { institution: string; participantType: ParticipantType; city: string; students: number; teams: number }[] | null;
  schedule: Schedule;
};

export type RegistrationState = "upcoming" | "open" | "closed";

/** The registration window as the server enforces it. */
export type RegistrationWindow = {
  state: RegistrationState;
  /** ISO 8601 with an offset. */
  opens: string;
  closes: string;
};

/** The event schedule an organiser can change: registration window and the finalist nominations deadline. */
export type Schedule = {
  registration: RegistrationWindow;
  /** Other colleges and schools can register until this, later than KIET (COE KIET included) and startups. Null = no extension. */
  extendedCloses: string | null;
  nominationsDeadline: string | null;
  /** False once the deadline has passed (department admins are then locked out of nominations). */
  nominationsOpen: boolean;
  /** Results cannot be published before this (finalists are declared on 26 October). Null = no restriction. */
  resultsPublishFrom: string | null;
  resultsDue: boolean;
  /** True once an organiser saved a change; false while the planned dates apply. */
  customised: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
  /** The server's clock, so the page never depends on the browser's. */
  serverTime: string;
  planned: {
    registrationOpens: string;
    registrationCloses: string;
    registrationExtendedCloses: string | null;
    nominationsDeadline: string | null;
    resultsPublishFrom: string | null;
  };
};

export type ScheduleInput = {
  registrationOpens: string;
  registrationCloses: string;
  /** Left out: unchanged; null removes the later deadline for other colleges and schools. */
  registrationExtendedCloses?: string | null;
  nominationsDeadline: string | null;
  /** Left out: unchanged. */
  resultsPublishFrom?: string | null;
};

export type TimelinePoint = {
  /** "2026-10-03" */
  date: string;
  /** Profiles completed that day. */
  students: number;
  /** Teams created that day. */
  teams: number;
  /** Teams submitted that day. */
  submitted: number;
};

/** A compact team row used in stats and finalist lists. */
export type TeamSummary = {
  id: string;
  code: string;
  name: string;
  category: number;
  participantType: ParticipantType;
  institution: string;
  department: string | null;
  route: TeamRoute;
  status: TeamStatus;
  result: TeamResult;
  leaderName: string;
  memberCount: number;
  projectTitle: string;
  /** Startups and COE KIET teams: true until an admin has accepted the entry. */
  approvalRequired: boolean;
  approvedAt: string | null;
  /** Set when the organisers rejected the team: it is not accepted and gets no stall. */
  rejectedAt: string | null;
  submittedAt: string | null;
  leaderYear: number | null;
  /** Every member's year (or class), the leader's first. */
  memberYears: number[];
};

export type FinalistCategory = {
  category: number;
  quota: number;
  /** Submitted department-route teams of this department in this category. */
  teams: TeamSummary[];
  /** IDs of the nominated teams, at most `quota`. */
  nominated: string[];
};

export type FinalistBoard = {
  department: string;
  /** Department admins' nominations are due by then. Null = no deadline. */
  nominationsDeadline: string | null;
  /** True when the deadline has passed and the signed-in admin can no longer change this board (super admins still can). */
  nominationsLocked: boolean;
  /** Set once the super admin publishes results; nominations are then read-only. */
  publishedAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
  categories: FinalistCategory[];
};

export type NominationInput = { category: number; teamIds: string[] }[];

export type FinalistSummary = {
  publishedAt: string | null;
  publishedBy: string | null;
  nominationsDeadline: string | null;
  /** Why results cannot be published right now (null = they can). Decided by the server. */
  publishBlocked: string | null;
  resultsPublishFrom: string | null;
  /** Once published: why the results can no longer be withdrawn (null = a super admin can still withdraw them). */
  unpublishBlocked: string | null;
  matrix: {
    department: string;
    categories: { category: number; quota: number; nominated: number; eligible: number }[];
  }[];
  /** Submitted teams from other colleges and schools, which go straight to the Grand Finale. */
  directTeams: TeamSummary[];
};

export type PublishResult = {
  publishedAt: string;
  finalists: number;
  notSelected: number;
};

/** An organiser creates a team for registered students, whether or not registration is open. */
export type AdminTeamInput = {
  name: string;
  category: number;
  domain: string;
  projectTitle: string;
  abstract: string;
  leaderEmail: string;
  memberEmails: string[];
  submit: boolean;
};

// ---------- Judging ----------

export type JudgingRound = "department" | "final";

export type Juror = {
  email: string;
  name: string;
  kind: "faculty" | "external";
  department: string | null;
  organisation: string;
  phone: string;
  /** Every room and panel the judge sits in, with its time: a judge can be in many, one at a time. */
  panels: { id: string; round: JudgingRound; building: string; name: string; department: string | null; slotStart: string | null; slotEnd: string | null; parentDepartment: boolean }[];
  scores: number;
  addedAt: string | null;
  addedBy: string | null;
};

export type JurorInput = Pick<Juror, "email" | "name" | "kind" | "department" | "organisation" | "phone">;

export type PanelJuror = Pick<Juror, "email" | "name" | "kind" | "department" | "organisation"> & {
  /** A department room's parent department judge: the one from the room's own department. */
  parentDepartment: boolean;
  /** The judge locked all their marks in this room (or its time is over). */
  locked: boolean;
  /** When an organiser marked the judge present in this room, and who. */
  presentAt: string | null;
  presentBy: string | null;
};

/** One judge's submitted marks for a team (super admins only). */
export type PanelScore = {
  jurorEmail: string;
  jurorName: string;
  marks: number[];
  total: number;
  remarks: string;
  updatedAt: string;
  /** The organiser who changed or entered the judge's marks, if any. */
  editedBy: string | null;
  /** How often the saved marks were changed afterwards, and why (the last time). Shown highlighted. */
  editCount: number;
  editReason: string | null;
  locked: boolean;
};

export type PanelTeam = TeamSummary & {
  tent: string | null;
  /** Scores recorded by this panel's judges, and their average total out of 50. */
  scores: number;
  average: number | null;
  /** Each judge's marks: super admins only, null for everyone else. */
  judgeScores: PanelScore[] | null;
  /** Members marked present for this round. */
  present: number;
  /** Department round: each student's attendance, how many are marked absent, and whether all are (the team scores 0). */
  members: PresenceMember[];
  absent: number;
  allAbsent: boolean;
};

/** A judging room (department round, one department's teams, in a building at a time slot) or a Grand Finale panel. */
export type Panel = {
  id: string;
  round: JudgingRound;
  building: string;
  /** The room's name or number (a finale panel's name). */
  name: string;
  /** Optional directions, e.g. "2nd floor, next to the lift". */
  location: string;
  slotStart: string | null;
  slotEnd: string | null;
  department: string | null;
  jurors: PanelJuror[];
  teams: PanelTeam[];
  /** Super admins, and department admins for their own rooms. */
  canEdit: boolean;
  /** Department rooms: judges submit marks from the slot's start until this moment (slot end + the room's buffer). */
  scoringUntil: string | null;
  /** Set when a super admin extended this room's judging time past its slot and buffer. */
  extendedUntil?: string | null;
  /** Extra minutes after the slot in which the room's judges can still submit marks (0 to 60). */
  bufferMinutes: number;
  /** Whether the viewer may change the judges' marks in this room right now (super admins always; the department's own admin during the slot and buffer). */
  canEditMarks: boolean;
};

/** One department's slot in the department round timetable (null: no slot yet). */
export type TimetableSlot = { department: string; slotStart: string | null; slotEnd: string | null };

export type Timetable = {
  slots: TimetableSlot[];
  customised: boolean;
  updatedBy: string | null;
};

export type RoundState = {
  round: JudgingRound;
  open: boolean;
  changedAt: string | null;
  changedBy: string | null;
  /** Why the round cannot be opened now (null = it can, or it is open). */
  openBlocked: string | null;
};

export type Judging = {
  round: RoundState;
  /** Super admins: open and lock rounds, allot stalls, see and change every judge's marks. */
  canManage: boolean;
  /** Can create rooms in this round (department admins: for their own department). */
  canCreate: boolean;
  panels: Panel[];
  unallotted: TeamSummary[];
  /** Final round only: every Grand Finale team and its stall (the field is still called tent). */
  tents: { team: TeamSummary; tent: string | null }[] | null;
  /** Department round: each department's slot. */
  timetable: Timetable | null;
  serverTime: string | null;
};

/** Where and when a room sits. Times are ISO 8601 with an offset. */
export type PanelPlace = { building: string; name: string; location: string; slotStart: string | null; slotEnd: string | null; bufferMinutes: number };

export type PanelInput = PanelPlace & { round: JudgingRound; department: string | null };

/** A student's attendance in the department round: present, absent, or not marked (counted present). */
export type AttendanceState = "present" | "absent" | "not_marked";

export type PresenceMember = {
  userId: string;
  fullName: string;
  role: "leader" | "member";
  state: AttendanceState;
  markedBy: string | null;
  markedAt: string | null;
};

/** A team's students after a change of attendance. When every one is absent the team scores 0. */
export type TeamPresence = { teamId: string; members: PresenceMember[]; allAbsent: boolean };

/** One student of the department round, for the attendance list: no team, just who they are and when they are judged. */
export type RollCallRow = {
  userId: string;
  fullName: string;
  rollNumber: string;
  year: number;
  course: string;
  department: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  /** present and absent are marks. not_marked counts as absent until somebody marks the student present. */
  state: AttendanceState;
  markedBy: string | null;
  markedAt: string | null;
};

export type RollCallSlot = { key: string; start: string | null; end: string | null };

export type RollCall = {
  items: RollCallRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Over the department, year, slot and search filters but not the status, so the counts stay put while you filter by status. */
  students: number;
  present: number;
  absent: number;
  notMarked: number;
  /** Students per year over every filter except the year itself; the slots over every filter except the slot. */
  years: Record<string, number>;
  slots: RollCallSlot[];
};

export type RollCallQuery = {
  department?: string;
  year?: number;
  /** A slot's key from RollCall.slots. */
  slot?: string;
  state?: AttendanceState;
  q?: string;
  page?: number;
  pageSize?: number;
};

export type MarkStudentsResult = {
  changed: number;
  /** Already in the state asked for. */
  unchanged: number;
  skipped: { fullName: string; rollNumber: string; reason: string }[];
  notFound: number;
};

export type AttendanceMember = {
  userId: string;
  fullName: string;
  role: "leader" | "member";
  year: number;
  course: string;
  department: string | null;
  institution: string;
  rollNumber: string;
  phone: string;
  /** Marked present for this round: when, by whom and how. */
  presentAt: string | null;
  markedBy: string | null;
  method: "qr" | "manual" | null;
  /** Present, absent, or not marked. */
  state: AttendanceState;
};

export type AttendanceSheet = {
  round: JudgingRound;
  title: string;
  building: string;
  room: string;
  location: string;
  slotStart: string | null;
  slotEnd: string | null;
  jurors: string[];
  teams: {
    code: string;
    name: string;
    category: number;
    projectTitle: string;
    status: TeamStatus;
    tent: string | null;
    institution: string;
    department: string | null;
    /** The room or panel the team is allotted to. */
    room: string | null;
    members: AttendanceMember[];
  }[];
};

/** What the scanner shows after reading an event pass (or marking a student by hand). */
export type ScanResult = {
  result: "marked" | "already";
  student: {
    userId: string;
    fullName: string;
    rollNumber: string;
    course: string;
    year: number;
    department: string | null;
    institution: string;
    participantType: ParticipantType;
    role: "leader" | "member";
  };
  team: TeamSummary;
  room: string | null;
  markedAt: string;
  markedBy: string;
  method: "qr" | "manual";
  /** Something to check, e.g. the team is allotted to another room. */
  warning: string | null;
};

export type QuotaCell = { department: string; category: number; quota: number };

export type RankedTeam = {
  /** Null until the team has a score. */
  position: number | null;
  team: TeamSummary;
  panel: string | null;
  scores: number;
  judges: number;
  average: number | null;
  innovation: number | null;
  query: number | null;
  /** Level with the team above on total, innovation and query addressing: the department admin or a super admin (the organisers at the finale) decide. */
  tied: boolean;
  /** Every judge of the room has scored the team; only complete teams get a place. */
  complete: boolean;
  /** Every student is absent: the team scores 0 and gets no place. */
  allAbsent: boolean;
  /** A prize place declared by the organisers. */
  award: { place: number; amount: number; declaredBy: string; declaredAt: string } | null;
};

export type Rankings = {
  round: JudgingRound;
  groups: {
    key: string;
    label: string;
    department: string | null;
    category: number | null;
    teams: RankedTeam[];
    /** Places with a cash prize in this group. */
    prizes: { place: number; amount: number }[];
  }[];
  /** Students see the winners only once a super admin publishes them. */
  awardsPublished: boolean;
  canAward: boolean;
  canPublishAwards: boolean;
};

/** One team on the department round's leaderboard. */
export type LeaderboardTeam = {
  position: number | null;
  team: TeamSummary;
  room: string | null;
  average: number | null;
  innovation: number | null;
  query: number | null;
  scores: number;
  judges: number;
  /** Level with the team above on average, innovation and query addressing: the department admin or a super admin decides. */
  tied: boolean;
  complete: boolean;
  allAbsent: boolean;
  /** Placed within the department's finalist places for this problem statement. */
  inLine: boolean;
  nominated: boolean;
  award: { place: number; amount: number; declaredBy: string; declaredAt: string } | null;
};

export type LeaderboardCategory = {
  category: number;
  title: string;
  /** The department's finalist places in this problem statement. */
  quota: number;
  prize: number | null;
  teams: LeaderboardTeam[];
  scored: number;
  /** The last finalist place is level with the next team. */
  tieAtCut: boolean;
};

export type Leaderboard = {
  departments: { department: string; categories: LeaderboardCategory[]; teams: number; scored: number; finalistPlaces: number; nominated: number }[];
  resultsPublished: boolean;
  nominationsDeadline: string | null;
  generatedAt: string;
};

export type Score = {
  marks: number[];
  total: number;
  remarks: string;
  updatedAt: string;
  editedBy: string | null;
  /** The judge locked their marks, or the room's time is over: the judge cannot change them any more. */
  locked: boolean;
  /** How often the judge changed these marks after saving them. */
  editCount: number;
};

/** After a judge locks their marks: how many teams they locked marks for, and how many have none. */
export type LockResult = { locked: number; unscored: number };

export type JudgeTeam = {
  id: string;
  code: string;
  name: string;
  category: number;
  domain: string;
  projectTitle: string;
  abstract: string;
  participantType: ParticipantType;
  institution: string;
  department: string | null;
  status: TeamStatus;
  tent: string | null;
  members: { userId: string; attendance: AttendanceState; fullName: string; role: "leader" | "member"; year: number; course: string; department: string | null }[];
  /** Every student is absent: the team scores 0 and cannot be marked. */
  allAbsent: boolean;
  myScore: Score | null;
};

export type JudgePanel = {
  id: string;
  round: JudgingRound;
  building: string;
  name: string;
  location: string;
  slotStart: string | null;
  slotEnd: string | null;
  department: string | null;
  /** The judge is this department room's parent department judge (from the room's own department). */
  parentDepartment: boolean;
  /** When an organiser marked the judge present in this room. */
  presentAt: string | null;
  /** Scores can be saved only while organisers keep the round open... */
  open: boolean;
  /** ...and, for a department room, between these moments (its slot plus the room's buffer). */
  scoringFrom: string | null;
  scoringUntil: string | null;
  /** Extra minutes after the slot in which marks can still be submitted. */
  bufferMinutes: number;
  /** The judge can mark or change students' attendance now (department round, judging open, during the room's time). */
  canMarkAttendance: boolean;
  /** The judge locked all their marks here, or the room's time is over. */
  locked: boolean;
  teams: JudgeTeam[];
};

export type JudgeView = { email: string; name: string; panels: JudgePanel[]; serverTime: string };

/** An organiser registers a student: the portal's profile fields plus the student's Google email. */
export type AdminStudentInput = {
  email: string;
  fullName: string;
  phone: string;
  participantType: ParticipantType;
  /** COE KIET / technical clubs: the club's name. */
  club: string;
  institution: string;
  city: string;
  department: string | null;
  course: string;
  year: number;
  rollNumber: string;
};

/** The outcome of archiving draft teams: how many were archived, and which were skipped and why. */
export type ArchiveResult = {
  archived: number;
  skipped: { code: string; name: string; reason: string }[];
  notFound: number;
};

/** The outcome of accepting teams for the Grand Finale (or putting them back in the queue): how many changed, and which were skipped and why. */
export type AcceptResult = {
  changed: number;
  skipped: { code: string; name: string; reason: string }[];
  notFound: number;
};

/** One action for many teams at once; each team changes on its own, and those that cannot are skipped with the reason. */
export type BulkAction = "withdraw" | "disqualify" | "restore" | "archive" | "submit" | "accept" | "unaccept" | "reject";

export type BulkResult = {
  action: BulkAction;
  changed: number;
  skipped: { code: string; name: string; reason: string }[];
  notFound: number;
};

/** A super admin corrects a student's profile (the sign-in email stays). */
export type StudentEditInput = Omit<AdminStudentInput, "email"> & { reason: string };

/** A super admin edits a team's details. */
export type TeamEditInput = { name: string; category: number; domain: string; projectTitle: string; abstract: string; reason: string };

/** One department's progress setting up its department-round rooms (counts only). */
export type ReadinessRow = {
  department: string;
  teams: number;
  allotted: number;
  rooms: number;
  /** Rooms with both judges. */
  staffed: number;
  percent: number;
  ready: boolean;
  rank: number;
};

export type Readiness = { rows: ReadinessRow[]; /** The caller's own department, for a department admin. */ mine: string | null };
