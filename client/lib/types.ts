/**
 * Data shapes shared by the student portal and the API layer.
 * These mirror the JSON the FastAPI backend returns (snake_case is converted in lib/api/live.ts).
 */

export type ParticipantType = "kiet" | "college" | "school" | "startup";

export type Profile = {
  userId: string;
  email: string;
  fullName: string;
  phone: string;
  participantType: ParticipantType;
  /** College or school name ("KIET Deemed to be University" for KIET students, the startup's name for a startup). */
  institution: string;
  city: string;
  /** KIET department, e.g. "CSE(AIML)". Null for other colleges and schools. */
  department: string | null;
  /** Course for college students ("B.Tech"), "School" for school students. */
  course: string;
  /** Year of study (1 to 5) for college students, class (6 to 12) for school students. */
  year: number;
  /** University roll number for KIET, enrolment number for other colleges, optional for schools. */
  rollNumber: string;
  /** COE KIET / technical-club students: the club's name. Empty for everyone else. */
  club: string;
  createdAt: string;
};

export type ProfileInput = Omit<Profile, "userId" | "email" | "createdAt">;

export type TeamStatus = "draft" | "submitted" | "withdrawn" | "disqualified" | "archived";

/** KIET teams go through the department round; other colleges and schools go straight to the finale. */
export type TeamRoute = "department" | "finale";

export type TeamResult = "pending" | "finalist" | "not_selected";

export type TeamMember = {
  userId: string;
  fullName: string;
  email: string;
  department: string | null;
  course: string;
  year: number;
  role: "leader" | "member";
  joinedAt: string;
  club?: string;
};

export type InvitationStatus = "pending" | "accepted" | "declined" | "cancelled";

export type Invitation = {
  id: string;
  teamId: string;
  teamCode: string;
  teamName: string;
  category: number;
  leaderName: string;
  email: string;
  status: InvitationStatus;
  createdAt: string;
};

export type Team = {
  id: string;
  /** Human-friendly reference, e.g. "IT26-0042". */
  code: string;
  /** Private code the leader shares so students can join without an invitation, e.g. "K7PQ-3XM9". */
  joinCode: string;
  name: string;
  category: number;
  domain: string;
  projectTitle: string;
  abstract: string;
  participantType: ParticipantType;
  institution: string;
  /** The leader's department for KIET teams. Null for other colleges and schools. */
  department: string | null;
  route: TeamRoute;
  leaderId: string;
  members: TeamMember[];
  /** Pending invitations only. */
  invitations: Invitation[];
  status: TeamStatus;
  result: TeamResult;
  createdAt: string;
  submittedAt: string | null;
  /** Startups and COE KIET teams: true until an admin has accepted the entry for the Grand Finale. */
  approvalRequired: boolean;
  approvedAt: string | null;
};

export type TeamInput = Pick<Team, "name" | "category" | "domain" | "projectTitle" | "abstract">;

export type RegistrationState = "upcoming" | "open" | "closed";

/** The registration window as the server sees it. The server is the authority; the browser's clock is not. */
export type RegistrationWindow = {
  state: RegistrationState;
  opens: string;
  closes: string;
  /** True when `closes` is the later deadline of other colleges and schools rather than the general one. */
  extended?: boolean;
};

/** The signed-in person, before or after they complete their profile. */
export type Me = {
  email: string;
  name: string;
  profile: Profile | null;
  registration: RegistrationWindow;
};

/** Where a student goes in one round, and whether they have been marked present there. */
export type PassRound = {
  round: "department" | "final";
  teamCode: string;
  teamName: string;
  building: string | null;
  room: string | null;
  location: string | null;
  slotStart: string | null;
  slotEnd: string | null;
  /** Before a room is allotted: when the team's department is judged, from the timetable. */
  plannedStart: string | null;
  plannedEnd: string | null;
  tent: string | null;
  presentAt: string | null;
};

/**
 * The event pass. `seed` turns into a QR code that changes every `periodSeconds` (lib/pass.ts); it is null until the
 * student is in a submitted team that takes part in a round. A new seed is needed each day (IST).
 */
export type EventPass = {
  seed: string | null;
  day: string | null;
  periodSeconds: number;
  serverTime: string;
  userId: string;
  rounds: PassRound[];
};

/** One announced (or awaited) result for the student's team. */
export type ResultCard = {
  round: "department" | "final";
  status: "awaiting" | "finalist" | "not_selected" | "winner" | "participated" | "qualified" | "disqualified";
  title: string;
  message: string;
  place: number | null;
  amount: number | null;
};
