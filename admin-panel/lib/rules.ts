/**
 * InnoTech26 registration rules, kept in one place so the pages and the mock API agree.
 * The FastAPI backend must enforce the same rules; the frontend only uses them to guide students.
 */
import { categories, clubDepartment, departments } from "./content";
import type { ParticipantType, Profile, ProfileInput, RegistrationState, RegistrationWindow, Team } from "./types";

export type { RegistrationState };

export const KIET_EMAIL_DOMAIN = "kiet.edu";
export const KIET_INSTITUTION = "KIET Deemed to be University";

export const TEAM_MIN_SIZE = 2;
export const TEAM_MAX_SIZE = 5;

/** A startup registers as a single entry; every other team has 2 to 5 members (server: rules.team_size_limits). */
export function teamSizeLimits(type: ParticipantType): [number, number] {
  return type === "startup" ? [1, 1] : [TEAM_MIN_SIZE, TEAM_MAX_SIZE];
}

export const STARTUP_COURSE = "Startup";
export const CLUB_NAME_LENGTH = { min: 2, max: 80 };

// Overridable at build time (deploy.sh passes REGISTRATION_OPENS/CLOSES) so the public pages agree with the server's window.
export const REGISTRATION_OPENS = process.env.NEXT_PUBLIC_REGISTRATION_OPENS || "2026-10-03T00:00:00+05:30";
export const REGISTRATION_CLOSES = process.env.NEXT_PUBLIC_REGISTRATION_CLOSES || "2026-10-15T23:59:59+05:30";
/** Department admins' finalist nominations are due by then (the event document: 24 October, 6:00 PM). */
export const NOMINATIONS_DEADLINE = "2026-10-24T18:00:00+05:30";

/** Departments allowed two finalist teams in Categories 1 to 4. CSE(CS) is deliberately not included. */
export const DOUBLE_QUOTA_DEPARTMENTS = ["CSE", "CS", "CSE(AI)", "CSE(AIML)"];

export const participantTypeLabels: Record<ParticipantType, string> = {
  kiet: "KIET student",
  college: "Other college student",
  school: "School student",
  startup: "Startup",
};

export const kietCourses = ["B.Tech", "M.Tech", "MCA", "MBA", "B.Pharm", "M.Pharm", "Diploma", "Other"];
export const collegeCourses = ["B.Tech / B.E.", "M.Tech", "BCA", "MCA", "B.Sc", "M.Sc", "BBA", "MBA", "B.Pharm", "Diploma", "Other"];
export const collegeYears = [1, 2, 3, 4];
export const schoolClasses = [6, 7, 8, 9, 10, 11, 12];

export function isKietEmail(email: string) {
  return email.trim().toLowerCase().endsWith(`@${KIET_EMAIL_DOMAIN}`);
}

/** A @kiet.edu account registers as KIET and any other account as another college or a school; anyone can be a startup. */
export function allowedParticipantTypes(email: string): ParticipantType[] {
  return isKietEmail(email) ? ["kiet", "startup"] : ["college", "school", "startup"];
}

/** The student types (everything except a startup), in the order they are offered. */
export const studentTypes: ParticipantType[] = ["kiet", "college", "school"];

/** Startups and COE KIET teams skip the department round and are judged directly at the Grand Finale. */
export type DirectFinaleKind = "startup" | "coe";

export function directFinaleKind(type: ParticipantType, department: string | null): DirectFinaleKind | null {
  if (type === "startup") return "startup";
  return type === "kiet" && department === clubDepartment ? "coe" : null;
}

/** The route a new team takes (server: rules.route_for). */
export function routeFor(type: ParticipantType, department: string | null): "department" | "finale" {
  return type === "kiet" && department !== clubDepartment ? "department" : "finale";
}

export function yearLabel(year: number, type: ParticipantType = "kiet") {
  if (type === "startup") return "Startup";
  if (type === "school") return `Class ${year}`;
  const suffix = year === 1 ? "st" : year === 2 ? "nd" : year === 3 ? "rd" : "th";
  return `${year}${suffix} year`;
}

// ---------- Registration window ----------

/**
 * The registration window by the browser's clock. The portal uses the server's answer from GET /me instead
 * once it has loaded; this is for the public pages and the mock API.
 */
export function registrationState(now = new Date()): RegistrationState {
  if (process.env.NEXT_PUBLIC_FORCE_REGISTRATION_OPEN === "true") return "open";
  if (now < new Date(REGISTRATION_OPENS)) return "upcoming";
  if (now > new Date(REGISTRATION_CLOSES)) return "closed";
  return "open";
}

/** The window in the shape GET /me returns it, computed from the local rules (used by the mock). */
export function registrationWindow(now = new Date()): RegistrationWindow {
  return { state: registrationState(now), opens: REGISTRATION_OPENS, closes: REGISTRATION_CLOSES };
}

// ---------- Institutions ----------

/** Common short forms students type, so "ABES Engg. College" and "ABES Engineering College" compare equal. Mirrors server/app/rules.py. */
const INSTITUTION_ABBREVIATIONS = new Map<string, string>(Object.entries({
  engg: "engineering",
  engr: "engineering",
  eng: "engineering",
  coll: "college",
  clg: "college",
  univ: "university",
  uni: "university",
  inst: "institute",
  instt: "institute",
  tech: "technology",
  mgmt: "management",
  sr: "senior",
  sec: "secondary",
  sch: "school",
  vidyalay: "vidyalaya",
  and: "",
  of: "",
  the: "",
}));

/** Normalises a college or school name so "K.I.E.T. Group" and "kiet group" compare equal. Empty if nothing comparable. */
export function normaliseInstitution(name: string) {
  // Dots and apostrophes join letters ("K.I.E.T." is "kiet"); anything else separates words.
  const words = name.toLowerCase().replace(/[.'’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ");
  return words
    .map((word) => INSTITUTION_ABBREVIATIONS.get(word) ?? word)
    .filter(Boolean)
    .join(" ")
    .slice(0, 200);
}

type InstitutionOf = Pick<Profile, "participantType" | "institution"> & { city?: string };

/**
 * Teams must share this. Schools often share a name across cities (e.g. Delhi Public School), so the city counts
 * too when both sides know it (a Team from the API has no city; the server then decides).
 */
export function sameInstitution(a: InstitutionOf, b: InstitutionOf) {
  if (a.participantType !== b.participantType) return false;
  if (a.participantType === "kiet") return true;
  if (normaliseInstitution(a.institution) !== normaliseInstitution(b.institution)) return false;
  if (a.participantType !== "school" || a.city === undefined || b.city === undefined) return true;
  return normaliseInstitution(a.city) === normaliseInstitution(b.city);
}

// ---------- Categories ----------

export type Eligibility = { allowed: true } | { allowed: false; reason: string };

/**
 * Whether a team can compete in a category.
 * `years` holds the year of every current member (leader included).
 */
export function categoryEligibility(categoryNumber: number, type: ParticipantType, years: number[]): Eligibility {
  const category = categories.find((c) => c.number === categoryNumber);
  if (!category) return { allowed: false, reason: "Unknown category." };
  if (category.firstYearOnly && years.some((year) => year !== 1)) {
    return { allowed: false, reason: "Only teams where every member is a first-year student can enter this category." };
  }
  return { allowed: true };
}

// ---------- Team checks ----------

export function openSlots(team: Pick<Team, "members" | "invitations"> & { participantType?: ParticipantType }) {
  const max = team.participantType ? teamSizeLimits(team.participantType)[1] : TEAM_MAX_SIZE;
  return max - team.members.length - team.invitations.length;
}

/** Returns why `invitee` cannot be invited to `team`, or null if they can. */
export function inviteError(team: Team, invitee: Profile | null, inviteeHasTeam: boolean): string | null {
  if (team.status !== "draft") return "This team has been submitted and can no longer be changed.";
  if (team.participantType === "startup") return "A startup registers as a single entry, so it has no teammates.";
  if (openSlots(team) <= 0) return `A team can have at most ${TEAM_MAX_SIZE} members, including pending invitations.`;
  if (!invitee) return "No registered student uses this email. Ask them to sign in and complete their profile first.";
  if (team.members.some((m) => m.userId === invitee.userId)) return "This student is already in your team.";
  if (team.invitations.some((i) => i.email === invitee.email)) return "This student has already been invited.";
  if (inviteeHasTeam) return "This student is already part of another team.";
  if (!sameInstitution(team, invitee)) return "All members must be from the same college or school as the team leader.";
  const eligibility = categoryEligibility(team.category, team.participantType, [
    ...team.members.map((m) => m.year),
    invitee.year,
  ]);
  if (!eligibility.allowed) return eligibility.reason;
  return null;
}

export type Check = { label: string; ok: boolean };

/** The checklist shown before a team is submitted. All must pass. `registration` is the current window state. */
export function submissionChecks(team: Team, registration: RegistrationState | null): Check[] {
  const size = team.members.length;
  const eligibility = categoryEligibility(team.category, team.participantType, team.members.map((m) => m.year));
  if (team.participantType === "startup") {
    // One entry, no teammates and no invitations: only the category, the project and the window matter.
    return [
      { label: "The chosen category suits your entry", ok: eligibility.allowed },
      { label: "Project title and abstract are filled in", ok: team.projectTitle.trim().length > 0 && team.abstract.trim().length > 0 },
      { label: "Registration is open", ok: registration === "open" },
    ];
  }
  return [
    { label: `${TEAM_MIN_SIZE} to ${TEAM_MAX_SIZE} members have joined`, ok: size >= TEAM_MIN_SIZE && size <= TEAM_MAX_SIZE },
    { label: "No invitations are still pending", ok: team.invitations.length === 0 },
    { label: "Every member is eligible for the chosen category", ok: eligibility.allowed },
    { label: "Project title and abstract are filled in", ok: team.projectTitle.trim().length > 0 && team.abstract.trim().length > 0 },
    { label: "Registration is open", ok: registration === "open" },
  ];
}

/** Number of finalist teams a KIET department can nominate in a category. */
export function finalistQuota(department: string, categoryNumber: number) {
  return DOUBLE_QUOTA_DEPARTMENTS.includes(department) && categoryNumber <= 4 ? 2 : 1;
}

// ---------- Field validation ----------

export const limits = {
  teamName: { min: 3, max: 40 },
  projectTitle: { min: 5, max: 120 },
  abstract: { min: 100, max: 1500 },
};

/** Longest values the server accepts for profile fields. */
export const profileMaxLength = {
  fullName: 120,
  phone: 20,
  institution: 200,
  city: 100,
  rollNumber: 40,
};

/** Digits only, without a leading +91 or 0 country/trunk prefix. */
export function normalisePhone(phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 12 && digits.startsWith("91")) return digits.slice(2);
  if (digits.length === 11 && digits.startsWith("0")) return digits.slice(1);
  return digits;
}

export function validatePhone(phone: string) {
  return /^[6-9]\d{9}$/.test(normalisePhone(phone)) ? null : "Enter a 10-digit Indian mobile number.";
}

export function lengthError(label: string, value: string, { min, max }: { min: number; max: number }) {
  const length = value.trim().length;
  if (length === 0) return `${label} is required.`;
  if (length < min) return `${label} must be at least ${min} characters.`;
  if (length > max) return `${label} must be at most ${max} characters.`;
  return null;
}

/** Field errors for a profile, keyed by field. Empty when the profile is valid. */
export function profileErrors(input: ProfileInput, email: string): Partial<Record<keyof ProfileInput, string>> {
  const errors: Partial<Record<keyof ProfileInput, string>> = {};
  if (input.fullName.trim().length < 3) errors.fullName = "Enter your full name.";
  else if (input.fullName.trim().length > profileMaxLength.fullName) errors.fullName = `Full name must be at most ${profileMaxLength.fullName} characters.`;
  const phoneError = validatePhone(input.phone);
  if (phoneError) errors.phone = phoneError;
  if (!allowedParticipantTypes(email).includes(input.participantType)) {
    errors.participantType = isKietEmail(email)
      ? "Accounts with a @kiet.edu email register as KIET students."
      : "KIET students must sign in with their official @kiet.edu email.";
  }

  if (input.participantType === "startup") {
    const name = input.institution.trim().replace(/\s+/g, " ");
    if (name.length < 2) errors.institution = "Enter the name of your startup.";
    else if (name.length > profileMaxLength.institution) errors.institution = `The name must be at most ${profileMaxLength.institution} characters.`;
    return errors;
  }
  if (input.participantType === "kiet") {
    if (!input.department || !departments.includes(input.department)) errors.department = "Choose your department.";
    if (input.department === clubDepartment) {
      const club = (input.club ?? "").trim().replace(/\s+/g, " ");
      if (club.length < CLUB_NAME_LENGTH.min || club.length > CLUB_NAME_LENGTH.max) errors.club = "Enter the name of your technical club.";
    }
    if (!kietCourses.includes(input.course)) errors.course = "Choose your course.";
    if (!collegeYears.includes(input.year)) errors.year = "Choose your year of study.";
    // Any format (MCA and MBA numbers differ from B.Tech ones); still required.
    if (!input.rollNumber.trim()) errors.rollNumber = "Enter your university roll number.";
  } else {
    const label = input.participantType === "school" ? "school" : "college";
    if (input.institution.trim().length < 3) errors.institution = `Enter the full name of your ${label}.`;
    else if (input.institution.trim().length > profileMaxLength.institution) errors.institution = `The name must be at most ${profileMaxLength.institution} characters.`;
    if (input.city.trim().length < 2) errors.city = "Enter the city.";
    else if (input.city.trim().length > profileMaxLength.city) errors.city = `The city must be at most ${profileMaxLength.city} characters.`;
    if (input.participantType === "college") {
      if (!collegeCourses.includes(input.course)) errors.course = "Choose your course.";
      if (!collegeYears.includes(input.year)) errors.year = "Choose your year of study.";
      if (input.rollNumber.trim().length < 3) errors.rollNumber = "Enter your college enrolment or roll number.";
    } else if (!schoolClasses.includes(input.year)) {
      errors.year = "Choose your class.";
    }
  }
  if (!errors.rollNumber && input.rollNumber.trim().length > profileMaxLength.rollNumber) {
    errors.rollNumber = `This number must be at most ${profileMaxLength.rollNumber} characters.`;
  }
  return errors;
}

// ---------- Team join codes ----------

/** No 0/O or 1/I, so codes read out loud or copied by hand stay unambiguous. */
export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** "k7pq 3xm9" -> "K7PQ-3XM9"; null if it cannot be a join code. */
export function normaliseJoinCode(code: string) {
  const chars = code.replace(/[\s-]/g, "").toUpperCase();
  if (chars.length !== 8 || [...chars].some((c) => !JOIN_CODE_ALPHABET.includes(c))) return null;
  return `${chars.slice(0, 4)}-${chars.slice(4)}`;
}
