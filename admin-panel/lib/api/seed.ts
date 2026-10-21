/**
 * Deterministic demo dataset for the mock API. The same seed always produces the same students,
 * teams and audit trail, and every team obeys the registration rules in lib/rules.ts.
 */
import type { AdminTeam, AdminTeamMember, AdminUser, AuditEntry } from "../admin-types";
import { categories, departments, domains } from "../content";
import {
  JOIN_CODE_ALPHABET,
  KIET_EMAIL_DOMAIN,
  KIET_INSTITUTION,
  NOMINATIONS_DEADLINE,
  REGISTRATION_CLOSES,
  REGISTRATION_OPENS,
  categoryEligibility,
  needsApproval,
} from "../rules";
import type { Invitation, ParticipantType, Profile, TeamStatus } from "../types";
import { demoAdmins } from "./demo-admins";

export type StudentRecord = Profile & { teamId: string | null };

export type Nomination = {
  department: string;
  category: number;
  teamIds: string[];
};

export type MockDb = {
  version: number;
  students: StudentRecord[];
  teams: AdminTeam[];
  admins: AdminUser[];
  audit: AuditEntry[];
  nominations: Nomination[];
  nominationsUpdated: { department: string; at: string; by: string }[];
  publishedAt: string | null;
  publishedBy: string | null;
  /** The schedule organisers can change (registration window, nominations deadline). */
  schedule: {
    opens: string;
    closes: string;
    deadline: string | null;
    /** Startups and COE KIET register until this. Missing in older saved data: no extension. */
    extendedCloses?: string | null;
    /** Results cannot be published before this. Missing in older saved data: the planned date applies. */
    resultsFrom?: string | null;
    customised: boolean;
    updatedBy: string | null;
    updatedAt: string | null;
  };
  /** Latest timestamp handed out, so new actions always sort after the seeded October data. */
  clock: number;
  seq: number;
};

export const MOCK_DB_VERSION = 3;

// ---------- Seeded PRNG (mulberry32) ----------

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- Source lists ----------

const maleNames = [
  "Aarav", "Vivaan", "Aditya", "Arjun", "Reyansh", "Krishna", "Ishaan", "Shaurya", "Atharv", "Kabir",
  "Rohan", "Aman", "Harsh", "Nikhil", "Rahul", "Siddharth", "Utkarsh", "Yash", "Ankit", "Deepak",
  "Kunal", "Pranav", "Saurabh", "Tushar", "Vaibhav", "Abhishek", "Ayush", "Divyansh", "Gaurav", "Manish",
  "Mohit", "Priyanshu", "Shivam", "Sumit", "Varun", "Anuj", "Lakshya", "Parth", "Dev", "Mayank",
];
const femaleNames = [
  "Ananya", "Diya", "Aadhya", "Saanvi", "Ishita", "Kavya", "Priya", "Riya", "Sneha", "Tanvi",
  "Aditi", "Anjali", "Bhavya", "Khushi", "Muskan", "Nandini", "Pooja", "Shruti", "Simran", "Vanshika",
  "Aarushi", "Avni", "Garima", "Kritika", "Mansi", "Neha", "Palak", "Radhika", "Shreya", "Tanya",
];
const lastNames = [
  "Sharma", "Verma", "Gupta", "Singh", "Agarwal", "Tyagi", "Chauhan", "Yadav", "Mishra", "Pandey",
  "Srivastava", "Jain", "Saxena", "Rastogi", "Tiwari", "Chaudhary", "Rawat", "Bansal", "Goel", "Mittal",
  "Kumar", "Rana", "Dubey", "Tomar", "Bhardwaj", "Garg", "Kaushik", "Malik", "Sethi", "Arora",
];

const colleges = [
  { name: "ABES Engineering College", city: "Ghaziabad", abbr: "ABES" },
  { name: "IMS Engineering College", city: "Ghaziabad", abbr: "IMSEC" },
  { name: "Galgotias University", city: "Greater Noida", abbr: "GU" },
  { name: "Ajay Kumar Garg Engineering College", city: "Ghaziabad", abbr: "AKGEC" },
  { name: "JSS Academy of Technical Education", city: "Noida", abbr: "JSSATE" },
];

const schools = [
  { name: "Delhi Public School, Meerut Road", city: "Ghaziabad" },
  { name: "Kendriya Vidyalaya No. 1, Hindon", city: "Ghaziabad" },
  { name: "St. Thomas School, Indirapuram", city: "Ghaziabad" },
];

const mailDomains = ["gmail.com", "gmail.com", "gmail.com", "outlook.com", "yahoo.co.in", "rediffmail.com"];

const teamWordsA = [
  "Byte", "Code", "Quantum", "Neural", "Green", "Circuit", "Pixel", "Cyber", "Solar", "Data",
  "Logic", "Spark", "Nova", "Vector", "Echo", "Terra", "Aero", "Volt", "Binary", "Orbit",
];
const teamWordsB = [
  "Busters", "Crafters", "Pioneers", "Minds", "Squad", "Coders", "Innovators", "Builders", "Knights",
  "Labs", "Works", "Sentinels", "Makers", "Titans", "Hackers", "Forge",
];

/** Short KIET branch codes used in roll numbers and email handles. */
const deptCodes: Record<string, string> = {
  CSE: "cse", CS: "cs", IT: "it", CSIT: "csit", "CSE(AI)": "cseai", "CSE(AIML)": "aiml", "CSE(DS)": "ds",
  "CSE(CS)": "csecs", EN: "en", EC: "ec", ELCE: "elce", ME: "me", VLSI: "vlsi", AMIA: "amia", MCA: "mca",
  KSOM: "mba", KSOP: "pharm",
};

type Idea = { title: string; problem: string; solution: string };

const ideas: Record<number, Idea[]> = {
  1: [
    { title: "CampusConnect: One App for Student Services", problem: "students juggling separate portals for fees, attendance and hostel requests", solution: "a single progressive web app with role-based dashboards and push alerts" },
    { title: "MedQueue: Smart OPD Token System", problem: "long waiting times in government hospital outpatient departments", solution: "a WhatsApp and web token system that predicts waiting time from live queue data" },
    { title: "KrishiMitra Mandi Price Tracker", problem: "farmers selling produce without knowing prices in nearby mandis", solution: "a lightweight mobile app that aggregates daily mandi prices in Hindi" },
    { title: "BloodLink Donor Finder", problem: "delays in finding matching blood donors during emergencies", solution: "a location-aware donor registry with verified hospital requests" },
  ],
  2: [
    { title: "LexAssist: Legal Aid Chatbot", problem: "citizens struggling to understand basic legal procedures", solution: "a retrieval-augmented assistant grounded in Indian legal documents" },
    { title: "Agentic Invoice Reconciliation", problem: "small businesses spending hours matching invoices with bank statements", solution: "an AI agent that reads invoices, matches payments and flags mismatches" },
    { title: "Crop Disease Advisor", problem: "late detection of crop diseases in small farms", solution: "a vision model on a phone camera paired with an advisory language model" },
    { title: "AI Timetable Planner", problem: "manual timetable clashes across departments", solution: "a constraint solver with a natural-language interface for coordinators" },
  ],
  3: [
    { title: "Smart Irrigation with Soil Sensors", problem: "water wasted by fixed-schedule irrigation", solution: "an IoT controller that waters only when soil moisture drops" },
    { title: "Vision-Based Parking Guidance", problem: "drivers circling campus lots looking for free slots", solution: "camera-based slot detection with a live occupancy board" },
    { title: "Warehouse Line-Follower Robot", problem: "manual movement of small parts in workshops", solution: "a low-cost line-following robot with RFID checkpoints" },
  ],
  4: [
    { title: "Drone-Based Crop Spraying", problem: "uneven pesticide spraying and farmer exposure to chemicals", solution: "a GPS-guided drone that sprays only the mapped rows" },
    { title: "Retrofit EV Kit for E-Rickshaws", problem: "short battery life of lead-acid e-rickshaws", solution: "a lithium retrofit kit with a smart battery management system" },
    { title: "Low-Cost Pulse Oximeter Band", problem: "limited access to continuous vitals monitoring in rural clinics", solution: "a wearable band that streams SpO2 readings to a nurse dashboard" },
  ],
  5: [
    { title: "ThriftLoop: Campus Resale Marketplace", problem: "unused books and equipment going to waste every semester", solution: "a verified student-to-student resale platform with commission revenue" },
    { title: "Millet Snacks Start-up", problem: "low demand for nutritious millets among young consumers", solution: "a ready-to-eat millet snack brand with a subscription model" },
    { title: "Local Artisan Storefront", problem: "artisans lacking an online sales channel", solution: "a managed storefront that handles listings, payments and delivery" },
  ],
  6: [
    { title: "Smart Dustbin That Sorts Waste", problem: "mixed waste making recycling difficult", solution: "a sensor-based dustbin that separates dry and wet waste" },
    { title: "Automatic Street Light Controller", problem: "street lights left on during the day", solution: "an LDR and motion sensor controller that saves power" },
    { title: "Accident Alert Helmet", problem: "delayed help after two-wheeler accidents", solution: "a helmet with a crash sensor that sends the rider's location to contacts" },
  ],
  7: [
    { title: "Rainwater Harvesting for Every Home", problem: "falling groundwater levels in urban areas", solution: "a poster and model of a low-cost rooftop harvesting design" },
    { title: "Green Campus of 2047", problem: "high energy use in campus buildings", solution: "a model of a net-zero campus with solar roofs and green corridors" },
    { title: "Civic Sense Starts With Me", problem: "littering and traffic rule violations in cities", solution: "a poster campaign that links small habits to measurable civic impact" },
  ],
  8: [
    { title: "PhishGuard Browser Extension", problem: "students falling for phishing emails and fake job offers", solution: "a browser extension that scores links with a lightweight classifier" },
    { title: "UPI Fraud Pattern Detector", problem: "rising UPI fraud through social engineering", solution: "an explainable model that flags suspicious transaction patterns" },
    { title: "Post-Quantum Secure Messaging", problem: "today's encrypted chats being harvested for future decryption", solution: "a messaging prototype using lattice-based key exchange" },
  ],
};

/** Domains that fit each category, as indexes into content.domains. */
const categoryDomains: Record<number, number[]> = {
  1: [0, 7, 10, 12],
  2: [0, 1, 2],
  3: [3, 6, 8],
  4: [5, 6, 7, 3],
  5: [12, 10],
  6: [3, 5, 11],
  7: [5, 6, 11, 10],
  8: [2, 4, 9],
};

const withdrawReasons = [
  "A member has left the institute.",
  "Team leader requested withdrawal due to internship commitments.",
  "Two members withdrew; the team is below the minimum size.",
];

// ---------- Demo admins ----------

const otherAdmins: AdminUser[] = [
  { email: "csecs.coordinator@kiet.edu", name: "Rakesh Yadav", role: "admin", department: "CSE(CS)" },
  { email: "aiml.coordinator@kiet.edu", name: "Pooja Mishra", role: "admin", department: "CSE(AIML)" },
];

// ---------- Generator ----------

type TeamPlan = {
  type: ParticipantType;
  department: string | null;
  institution: { name: string; city: string; abbr?: string };
  category: number;
  status: TeamStatus;
  size: number;
};

const BASE_TIME = Date.parse("2026-10-03T09:00:00+05:30");
const LAST_TIME = Date.parse("2026-10-12T22:00:00+05:30");
const MINUTE = 60_000;

export function createSeed(): MockDb {
  const rand = mulberry32(20261030);
  const int = (min: number, max: number) => min + Math.floor(rand() * (max - min + 1));
  const pick = <T,>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
  const joinCode = () => {
    const chars = Array.from({ length: 8 }, () => pick([...JOIN_CODE_ALPHABET])).join("");
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  };
  const chance = (p: number) => rand() < p;

  const students: StudentRecord[] = [];
  const teams: AdminTeam[] = [];
  const audit: AuditEntry[] = [];
  const usedEmails = new Set<string>();
  const usedTeamNames = new Set<string>();
  let studentSeq = 0;
  let auditSeq = 0;

  const iso = (ms: number) => new Date(ms).toISOString();
  const addAudit = (entry: Omit<AuditEntry, "id">) => {
    auditSeq += 1;
    audit.push({ id: `a-${String(auditSeq).padStart(4, "0")}`, ...entry });
  };

  function kietCourse(department: string) {
    if (department === "MCA") return "MCA";
    if (department === "KSOM") return "MBA";
    if (department === "KSOP") return "B.Pharm";
    return "B.Tech";
  }

  function maxYear(type: ParticipantType, department: string | null) {
    if (type === "school") return 12;
    if (department === "MCA" || department === "KSOM") return 2;
    return 4;
  }

  function makeStudent(
    type: ParticipantType,
    institution: { name: string; city: string; abbr?: string },
    department: string | null,
    year: number,
    createdAt: number,
  ): StudentRecord {
    studentSeq += 1;
    const female = chance(0.45);
    const first = pick(female ? femaleNames : maleNames);
    const last = pick(lastNames);
    const fullName = `${first} ${last}`;
    const admissionYear = 26 - year; // 1st year in 2026 joined in 2026, and so on
    let email: string;
    let rollNumber: string;
    if (type === "kiet") {
      const code = deptCodes[department ?? "CSE"];
      do {
        email = `${first.toLowerCase()}.${admissionYear}${admissionYear + 4}${code}${int(1000, 1999)}@${KIET_EMAIL_DOMAIN}`;
      } while (usedEmails.has(email));
      rollNumber = `${2000 + admissionYear}0290${String(departments.indexOf(department ?? "CSE") + 10).padStart(3, "0")}${String(int(1, 199)).padStart(3, "0")}`;
    } else {
      do {
        email = `${first.toLowerCase()}${pick([".", "", "_"])}${last.toLowerCase()}${int(1, 99)}@${pick(mailDomains)}`;
      } while (usedEmails.has(email));
      rollNumber =
        type === "college"
          ? `${institution.abbr}/${2000 + admissionYear}/${int(1000, 9999)}`
          : chance(0.5)
            ? `${int(1000, 9999)}`
            : "";
    }
    usedEmails.add(email);
    const student: StudentRecord = {
      userId: `u-${String(studentSeq).padStart(4, "0")}`,
      email,
      fullName,
      phone: `${pick(["6", "7", "8", "9"])}${String(int(0, 999_999_999)).padStart(9, "0")}`,
      participantType: type,
      club: "",
      institution: institution.name,
      city: institution.city,
      department: type === "kiet" ? department : null,
      course:
        type === "kiet"
          ? kietCourse(department ?? "CSE")
          : type === "school"
            ? "School"
            : chance(0.8)
              ? "B.Tech / B.E."
              : pick(["BCA", "MCA", "B.Sc"]),
      year,
      rollNumber,
      createdAt: iso(createdAt),
      teamId: null,
    };
    students.push(student);
    return student;
  }

  function teamName() {
    let name: string;
    do {
      name = `${pick(teamWordsA)} ${pick(teamWordsB)}`;
    } while (usedTeamNames.has(name));
    usedTeamNames.add(name);
    return name;
  }

  function memberYear(plan: TeamPlan, baseYear: number, department: string | null) {
    if (plan.category === 6) return 1;
    if (plan.type === "school") return Math.min(12, Math.max(9, baseYear + int(-1, 1)));
    const top = maxYear(plan.type, department);
    return Math.min(top, Math.max(1, baseYear + (chance(0.3) ? int(-1, 1) : 0)));
  }

  // ---- Team plans ----
  const kiet = { name: KIET_INSTITUTION, city: "Ghaziabad" };
  const plans: TeamPlan[] = [];
  const kietPlan = (department: string, category: number, status: TeamStatus): TeamPlan => ({
    type: "kiet",
    department,
    institution: kiet,
    category,
    status,
    size: chance(0.15) ? 5 : int(2, 4),
  });

  // Anchors so the finalist quotas have something to choose from in the demo.
  const anchors: [string, number, TeamStatus][] = [
    ["CSE", 1, "submitted"], ["CSE", 1, "submitted"], ["CSE", 1, "submitted"],
    ["CSE", 2, "submitted"], ["CSE", 2, "submitted"], ["CSE", 3, "submitted"],
    ["CSE", 6, "submitted"], ["CSE", 5, "draft"], ["CSE", 8, "withdrawn"],
    ["CSE(CS)", 1, "submitted"], ["CSE(CS)", 1, "submitted"], ["CSE(CS)", 8, "submitted"], ["CSE(CS)", 8, "submitted"],
    ["IT", 1, "submitted"], ["IT", 1, "submitted"], ["IT", 2, "submitted"], ["IT", 4, "submitted"],
    ["IT", 7, "draft"], ["IT", 8, "submitted"],
    ["EC", 3, "disqualified"],
  ];
  for (const [department, category, status] of anchors) plans.push(kietPlan(department, category, status));

  // Every department gets at least two more teams.
  const randomStatus = (): TeamStatus => {
    const r = rand();
    return r < 0.64 ? "submitted" : r < 0.9 ? "draft" : "withdrawn";
  };
  for (const department of departments) {
    const count = ["CSE", "IT", "CSE(CS)"].includes(department) ? 1 : int(2, 3);
    for (let i = 0; i < count; i += 1) plans.push(kietPlan(department, int(1, 8), randomStatus()));
  }

  for (let i = 0; i < 11; i += 1) {
    plans.push({
      type: "college",
      department: null,
      institution: colleges[i % colleges.length],
      category: int(1, 8),
      status: randomStatus(),
      size: int(2, 5),
    });
  }
  for (let i = 0; i < 7; i += 1) {
    plans.push({
      type: "school",
      department: null,
      institution: schools[i % schools.length],
      category: chance(0.5) ? 5 : 7,
      status: i === 0 ? "draft" : randomStatus(),
      size: int(2, 4),
    });
  }

  // ---- Build teams ----
  const draftTeams: AdminTeam[] = [];
  plans.forEach((plan, index) => {
    const createdAt = BASE_TIME + int(0, 6 * 24 * 60) * MINUTE;
    const size = plan.status === "draft" ? Math.min(plan.size, 4) : plan.size;
    const baseYear = plan.type === "school" ? int(9, 12) : int(1, maxYear(plan.type, plan.department));
    const teamId = `team-${String(index + 1).padStart(3, "0")}`;

    const members: AdminTeamMember[] = [];
    for (let m = 0; m < size; m += 1) {
      // KIET teams may mix branches; the team still belongs to the leader's department.
      const mixed = plan.type === "kiet" && m > 0 && chance(0.45);
      const department = plan.type === "kiet" ? (mixed ? pick(departments) : plan.department) : null;
      const year = memberYear(plan, baseYear, department);
      const student = makeStudent(plan.type, plan.institution, department, year, createdAt - int(30, 600) * MINUTE);
      student.teamId = teamId;
      members.push({
        userId: student.userId,
        fullName: student.fullName,
        email: student.email,
        department: student.department,
        course: student.course,
        year: student.year,
        role: m === 0 ? "leader" : "member",
        joinedAt: iso(createdAt + m * int(20, 400) * MINUTE),
        phone: student.phone,
        rollNumber: student.rollNumber,
        institution: student.institution,
      });
    }

    const eligible = categoryEligibility(plan.category, plan.type, members.map((m) => m.year));
    if (!eligible.allowed) throw new Error(`Seed produced an ineligible team: ${eligible.reason}`);

    const idea = pick(ideas[plan.category]);
    const lastJoin = Math.max(...members.map((m) => Date.parse(m.joinedAt)));
    const submittedAt =
      plan.status === "draft" ? null : Math.min(LAST_TIME, lastJoin + int(60, 3 * 24 * 60) * MINUTE);

    const team: AdminTeam = {
      id: teamId,
      code: "",
      joinCode: joinCode(),
      name: teamName(),
      category: plan.category,
      domain: domains[pick(categoryDomains[plan.category])],
      projectTitle: idea.title,
      abstract: `${idea.title} addresses ${idea.problem}. The team is building ${idea.solution}, and will demonstrate a working version with measurable results at InnoTech26.`,
      participantType: plan.type,
      institution: plan.institution.name,
      department: plan.department,
      route: plan.type === "kiet" ? "department" : "finale",
      // Startups, COE KIET, other colleges and schools wait in the queue until an admin accepts them.
      approvalRequired: needsApproval(plan.type, plan.department),
      approvedAt: null,
      rejectedAt: null,
      rejectedReason: null,
      leaderId: members[0].userId,
      members,
      invitations: [],
      status: plan.status,
      result: "pending",
      createdAt: iso(createdAt),
      submittedAt: submittedAt === null ? null : iso(submittedAt),
    };
    teams.push(team);
    if (plan.status === "draft") draftTeams.push(team);
  });

  // Team codes follow creation order, like the backend's sequence would.
  teams
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .forEach((team, i) => {
      team.code = `IT26-${String(i + 1).padStart(4, "0")}`;
    });

  // A few drafts have pending invitations to registered students who have not joined yet.
  draftTeams.slice(0, 5).forEach((team, i) => {
    if (team.members.length >= 5) return;
    const leader = team.members[0];
    const leaderProfile = students.find((s) => s.userId === leader.userId)!;
    const year = team.category === 6 ? 1 : leader.year;
    const invitee = makeStudent(
      team.participantType,
      { name: leaderProfile.institution, city: leaderProfile.city, abbr: leaderProfile.rollNumber.split("/")[0] },
      team.department,
      year,
      Date.parse(team.createdAt) + 30 * MINUTE,
    );
    const invitation: Invitation = {
      id: `inv-${String(i + 1).padStart(3, "0")}`,
      teamId: team.id,
      teamCode: team.code,
      teamName: team.name,
      category: team.category,
      leaderName: leader.fullName,
      email: invitee.email,
      status: "pending",
      createdAt: iso(Date.parse(team.createdAt) + int(60, 600) * MINUTE),
    };
    team.invitations.push(invitation);
  });

  // Registered students who have not joined any team yet.
  for (let i = 0; i < 16; i += 1) {
    const r = rand();
    const type: ParticipantType = r < 0.75 ? "kiet" : r < 0.92 ? "college" : "school";
    const department = type === "kiet" ? pick(departments) : null;
    const institution = type === "kiet" ? kiet : type === "college" ? pick(colleges) : pick(schools);
    const year = type === "school" ? int(9, 12) : int(1, maxYear(type, department));
    makeStudent(type, institution, department, year, BASE_TIME + int(0, 8 * 24 * 60) * MINUTE);
  }

  // ---- Audit trail ----
  const admins = [...demoAdmins, ...otherAdmins].map((admin) => ({
    ...admin,
    addedAt: "2026-09-20T10:00:00.000Z",
    addedBy: admin.role === "super_admin" ? null : "superadmin@kiet.edu",
  }));
  for (const admin of admins.filter((a) => a.role === "admin")) {
    addAudit({
      at: admin.addedAt,
      actorEmail: "superadmin@kiet.edu",
      action: "admin.added",
      department: admin.department,
      detail: `Added ${admin.name} (${admin.email}) as admin for ${admin.department}.`,
    });
  }

  let clock = LAST_TIME;
  for (const team of teams) {
    const leader = team.members[0];
    const base = { teamId: team.id, teamCode: team.code, department: team.department };
    addAudit({ ...base, at: team.createdAt, actorEmail: leader.email, action: "team.created", detail: `Team "${team.name}" created in Category ${team.category}.` });
    if (team.submittedAt) {
      addAudit({ ...base, at: team.submittedAt, actorEmail: leader.email, action: "team.submitted", detail: `Submitted with ${team.members.length} members.` });
    }
    if (team.status === "withdrawn" || team.status === "disqualified") {
      const at = Date.parse(team.submittedAt ?? team.createdAt) + int(120, 1440) * MINUTE;
      clock = Math.max(clock, at);
      const departmentAdmin = admins.find((a) => a.department === team.department);
      if (team.status === "withdrawn") {
        addAudit({ ...base, at: iso(at), actorEmail: departmentAdmin?.email ?? "superadmin@kiet.edu", action: "team.withdrawn", detail: `Marked withdrawn. Reason: ${pick(withdrawReasons)}` });
      } else {
        addAudit({ ...base, at: iso(at), actorEmail: "superadmin@kiet.edu", action: "team.disqualified", detail: "Disqualified. Reason: The same project was submitted by another team." });
      }
    }
  }
  audit.sort((a, b) => a.at.localeCompare(b.at));

  return {
    version: MOCK_DB_VERSION,
    students,
    teams,
    admins,
    audit,
    nominations: [],
    nominationsUpdated: [],
    publishedAt: null,
    publishedBy: null,
    schedule: { opens: REGISTRATION_OPENS, closes: REGISTRATION_CLOSES, deadline: NOMINATIONS_DEADLINE, customised: false, updatedBy: null, updatedAt: null },
    clock,
    seq: auditSeq,
  };
}

/** Category numbers in display order, for tables. */
export const categoryNumbers = categories.map((c) => c.number);
