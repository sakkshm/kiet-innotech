import type { AdminStudent, AdminTeam, Stats, StatusCounts, TimelinePoint } from "./admin-types";
import { asText, csvFilename, downloadCsv, toCsv } from "./csv";
import { downloadWorkbook, sheet, type ExcelColumn } from "./excel";
import { categoryTitle, formatCsvDateTime, resultLabels, routeLabels, statusLabels, typeShortLabels } from "./format";
import { yearLabel } from "./rules";

/**
 * One row per member, with the team's fields repeated on each row. A team with no members (its
 * leader deleted their account, say) still gets one row, with the member columns blank.
 * Times are in IST.
 */
export function teamsCsv(teams: AdminTeam[]) {
  const header = [
    "Team code", "Team name", "Category", "Category title", "Domain", "Project title",
    "Participant type", "Institution", "Team department", "Route", "Status", "Result",
    "Team created (IST)", "Submitted at (IST)", "Approval", "Member count", "Member role", "Member name", "Member email",
    "Member phone", "Roll number", "Member department", "Technical club", "Course", "Year / class", "Joined at (IST)",
  ];
  const rows = teams.flatMap((team) => {
    const teamCells = [
      team.code, team.name, team.category, categoryTitle(team.category), team.domain, team.projectTitle,
      typeShortLabels[team.participantType], team.institution, team.department ?? "", routeLabels[team.route],
      statusLabels[team.status], resultLabels[team.result], formatCsvDateTime(team.createdAt), formatCsvDateTime(team.submittedAt),
      team.approvalRequired ? (team.approvedAt ? "Accepted" : "Awaiting approval") : "Not needed",
      team.members.length,
    ];
    if (team.members.length === 0) return [[...teamCells, "", "", "", "", "", "", "", "", "", ""]];
    return team.members.map((m) => [
      ...teamCells,
      m.role === "leader" ? "Leader" : "Member", m.fullName, m.email, asText(m.phone),
      asText(m.rollNumber), m.department ?? "", m.club ?? "", m.course, yearLabel(m.year, team.participantType), formatCsvDateTime(m.joinedAt),
    ]);
  });
  return toCsv(header, rows);
}

export function studentsCsv(students: AdminStudent[]) {
  const header = [
    "Name", "Email", "Phone", "Participant type", "Institution", "City", "Department", "Technical club", "Course",
    "Year / class", "Roll number", "Team code", "Team name", "Team role", "Team status", "Registered at (IST)", "Access",
  ];
  const rows = students.map((s) => [
    s.fullName, s.email, asText(s.phone), typeShortLabels[s.participantType], s.institution, s.city, s.department ?? "",
    s.club ?? "", s.course, yearLabel(s.year, s.participantType), asText(s.rollNumber), s.team?.code ?? "", s.team?.name ?? "",
    s.team ? (s.team.role === "leader" ? "Leader" : "Member") : "", s.team ? statusLabels[s.team.status] : "",
    formatCsvDateTime(s.createdAt), s.bannedAt ? "Banned" : "Active",
  ]);
  return toCsv(header, rows);
}

export function downloadTeams(teams: AdminTeam[]) {
  downloadCsv(csvFilename("teams"), teamsCsv(teams));
}

export function downloadStudents(students: AdminStudent[]) {
  downloadCsv(csvFilename("students"), studentsCsv(students));
}

// ---------- Excel ----------

const leaderOf = (team: AdminTeam) => team.members.find((m) => m.role === "leader");

/** e.g. "3rd year (leader), 2nd year, 1st year". */
function yearsOf(team: AdminTeam) {
  return [...team.members]
    .sort((a, b) => Number(b.role === "leader") - Number(a.role === "leader") || a.year - b.year)
    .map((m) => `${yearLabel(m.year, team.participantType)}${m.role === "leader" ? " (leader)" : ""}`)
    .join(", ");
}

/** Two sheets: one row per team (with the leader's contact details), and one row per member. */
export async function downloadTeamsExcel(teams: AdminTeam[]) {
  const teamSheet = sheet<AdminTeam>(
    "Teams",
    [
      { header: "Team code", width: 11, value: (t) => t.code, text: true },
      { header: "Team name", width: 26, value: (t) => t.name },
      { header: "Category", width: 9, value: (t) => t.category },
      { header: "Category title", width: 34, value: (t) => categoryTitle(t.category) },
      { header: "Domain", width: 34, value: (t) => t.domain },
      { header: "Project title", width: 36, value: (t) => t.projectTitle },
      { header: "Participant type", width: 15, value: (t) => typeShortLabels[t.participantType] },
      { header: "Institution", width: 32, value: (t) => t.institution },
      { header: "Department", width: 12, value: (t) => t.department ?? "" },
      { header: "Route", width: 18, value: (t) => routeLabels[t.route] },
      { header: "Status", width: 12, value: (t) => statusLabels[t.status] },
      { header: "Result", width: 13, value: (t) => resultLabels[t.result] },
      { header: "Approval", width: 18, value: (t) => (t.approvalRequired ? (t.approvedAt ? "Accepted" : "Awaiting approval") : "Not needed") },
      { header: "Members", width: 9, value: (t) => t.members.length },
      { header: "Pending invitations", width: 10, value: (t) => t.invitations.length },
      { header: "Leader", width: 22, value: (t) => leaderOf(t)?.fullName ?? "" },
      { header: "Leader email", width: 30, value: (t) => leaderOf(t)?.email ?? "" },
      { header: "Leader phone", width: 13, value: (t) => leaderOf(t)?.phone ?? "", text: true },
      { header: "Leader's year", width: 12, value: (t) => (leaderOf(t) ? yearLabel(leaderOf(t)!.year, t.participantType) : "") },
      { header: "Members' years", width: 30, value: (t) => yearsOf(t) },
      { header: "Members (names)", width: 50, value: (t) => t.members.map((m) => m.fullName).join(", ") },
      { header: "Created (IST)", width: 20, value: (t) => formatCsvDateTime(t.createdAt) },
      { header: "Submitted (IST)", width: 20, value: (t) => formatCsvDateTime(t.submittedAt) },
      { header: "Abstract", width: 70, value: (t) => t.abstract },
    ],
    teams,
  );
  type MemberRow = { team: AdminTeam; member: AdminTeam["members"][number] };
  const members = teams.flatMap((team) => team.members.map((member) => ({ team, member })));
  const memberSheet = sheet<MemberRow>(
    "Members",
    [
      { header: "Team code", width: 11, value: (r) => r.team.code, text: true },
      { header: "Team name", width: 26, value: (r) => r.team.name },
      { header: "Category", width: 9, value: (r) => r.team.category },
      { header: "Status", width: 12, value: (r) => statusLabels[r.team.status] },
      { header: "Role", width: 9, value: (r) => (r.member.role === "leader" ? "Leader" : "Member") },
      { header: "Name", width: 24, value: (r) => r.member.fullName },
      { header: "Email", width: 30, value: (r) => r.member.email },
      { header: "Phone", width: 13, value: (r) => r.member.phone, text: true },
      { header: "Roll number", width: 17, value: (r) => r.member.rollNumber, text: true },
      { header: "Institution", width: 32, value: (r) => r.team.institution },
      { header: "Department", width: 12, value: (r) => r.member.department ?? "" },
      { header: "Technical club", width: 20, value: (r) => r.member.club ?? "" },
      { header: "Course", width: 14, value: (r) => r.member.course },
      { header: "Year / class", width: 12, value: (r) => yearLabel(r.member.year, r.team.participantType) },
      { header: "Joined (IST)", width: 20, value: (r) => formatCsvDateTime(r.member.joinedAt) },
    ],
    members,
  );
  await downloadWorkbook("teams", [teamSheet, memberSheet]);
}

export async function downloadStudentsExcel(students: AdminStudent[]) {
  await downloadWorkbook("students", [
    sheet<AdminStudent>(
      "Students",
      [
        { header: "Name", width: 24, value: (s) => s.fullName },
        { header: "Email", width: 30, value: (s) => s.email },
        { header: "Phone", width: 13, value: (s) => s.phone, text: true },
        { header: "Participant type", width: 15, value: (s) => typeShortLabels[s.participantType] },
        { header: "Institution", width: 32, value: (s) => s.institution },
        { header: "City", width: 14, value: (s) => s.city },
        { header: "Department", width: 12, value: (s) => s.department ?? "" },
        { header: "Technical club", width: 20, value: (s) => s.club ?? "" },
        { header: "Course", width: 14, value: (s) => s.course },
        { header: "Year / class", width: 12, value: (s) => yearLabel(s.year, s.participantType) },
        { header: "Roll number", width: 17, value: (s) => s.rollNumber, text: true },
        { header: "Team code", width: 11, value: (s) => s.team?.code ?? "", text: true },
        { header: "Team name", width: 26, value: (s) => s.team?.name ?? "" },
        { header: "Team role", width: 10, value: (s) => (s.team ? (s.team.role === "leader" ? "Leader" : "Member") : "") },
        { header: "Team status", width: 12, value: (s) => (s.team ? statusLabels[s.team.status] : "Not in a team") },
        { header: "Registered (IST)", width: 20, value: (s) => formatCsvDateTime(s.createdAt) },
        { header: "Access", width: 10, value: (s) => (s.bannedAt ? "Banned" : "Active") },
        { header: "Ban reason", width: 30, value: (s) => s.bannedReason ?? "" },
      ],
      students,
    ),
  ]);
}

/** The Overview's numbers as a report: one sheet per breakdown. */
export async function downloadOverviewExcel(stats: Stats) {
  type Pair = [string, number | string];
  const summary: Pair[] = [
    ["Scope", stats.department ? `${stats.department} department` : "All departments, colleges, schools and startups"],
    ["Students registered", stats.students],
    ["Students in a team", stats.studentsInTeams],
    ["Teams", stats.teams.total],
    ["Submitted", stats.teams.submitted],
    ["Drafts", stats.teams.draft],
    ["Withdrawn", stats.teams.withdrawn],
    ["Disqualified", stats.teams.disqualified],
    ["Pending invitations", stats.pendingInvitations],
    ["Report generated (IST)", formatCsvDateTime(new Date().toISOString())],
  ];
  const statusColumns = <T extends StatusCounts>(): ExcelColumn<T>[] => [
    { header: "Submitted", width: 11, value: (r) => r.submitted },
    { header: "Draft", width: 9, value: (r) => r.draft },
    { header: "Withdrawn", width: 11, value: (r) => r.withdrawn },
    { header: "Disqualified", width: 12, value: (r) => r.disqualified },
    { header: "Total teams", width: 11, value: (r) => r.total },
  ];
  const sheets = [
    sheet<Pair>("Summary", [{ header: "Measure", width: 26, value: (r) => r[0] }, { header: "Value", width: 40, value: (r) => r[1] }], summary),
    sheet("Daily registrations", [
      { header: "Date", width: 12, value: (r: TimelinePoint) => r.date, text: true },
      { header: "Students registered", width: 19, value: (r: TimelinePoint) => r.students },
      { header: "Teams created", width: 14, value: (r: TimelinePoint) => r.teams },
      { header: "Teams submitted", width: 16, value: (r: TimelinePoint) => r.submitted },
    ], stats.timeline),
    sheet("By category", [
      { header: "Category", width: 9, value: (r: Stats["byCategory"][number]) => r.category },
      { header: "Title", width: 36, value: (r: Stats["byCategory"][number]) => categoryTitle(r.category) },
      ...statusColumns<Stats["byCategory"][number]>(),
    ], stats.byCategory),
    ...(stats.byDepartment
      ? [sheet("By department", [
          { header: "Department", width: 12, value: (r: NonNullable<Stats["byDepartment"]>[number]) => r.department },
          { header: "Students", width: 10, value: (r: NonNullable<Stats["byDepartment"]>[number]) => r.students },
          ...statusColumns<NonNullable<Stats["byDepartment"]>[number]>(),
        ], stats.byDepartment)]
      : []),
    ...(stats.byType
      ? [sheet("By participant type", [
          { header: "Participant type", width: 16, value: (r: NonNullable<Stats["byType"]>[number]) => typeShortLabels[r.type] },
          { header: "Students", width: 10, value: (r: NonNullable<Stats["byType"]>[number]) => r.students },
          { header: "Teams", width: 9, value: (r: NonNullable<Stats["byType"]>[number]) => r.teams },
          { header: "Submitted", width: 11, value: (r: NonNullable<Stats["byType"]>[number]) => r.submitted },
        ], stats.byType)]
      : []),
    sheet("By year of study", [
      { header: "Participant type", width: 16, value: (r: Stats["byYear"][number]) => typeShortLabels[r.participantType] },
      { header: "Year / class", width: 12, value: (r: Stats["byYear"][number]) => yearLabel(r.year, r.participantType) },
      { header: "Students", width: 10, value: (r: Stats["byYear"][number]) => r.students },
      { header: "Active teams led", width: 12, value: (r: Stats["byYear"][number]) => r.teamsLed },
      { header: "Active teams with a member", width: 14, value: (r: Stats["byYear"][number]) => r.teamsWith },
    ], stats.byYear),
    sheet("Team sizes", [
      { header: "Members", width: 9, value: (r: Stats["teamSizes"][number]) => r.size },
      { header: "Active teams", width: 12, value: (r: Stats["teamSizes"][number]) => r.teams },
    ], stats.teamSizes),
    sheet("Domains", [
      { header: "Domain", width: 44, value: (r: Stats["byDomain"][number]) => r.domain },
      { header: "Active teams", width: 12, value: (r: Stats["byDomain"][number]) => r.teams },
    ], stats.byDomain),
    ...(stats.topInstitutions
      ? [sheet("Top colleges and schools", [
          { header: "Institution", width: 40, value: (r: NonNullable<Stats["topInstitutions"]>[number]) => r.institution },
          { header: "Type", width: 14, value: (r: NonNullable<Stats["topInstitutions"]>[number]) => typeShortLabels[r.participantType] },
          { header: "City", width: 16, value: (r: NonNullable<Stats["topInstitutions"]>[number]) => r.city },
          { header: "Students", width: 10, value: (r: NonNullable<Stats["topInstitutions"]>[number]) => r.students },
          { header: "Active teams", width: 12, value: (r: NonNullable<Stats["topInstitutions"]>[number]) => r.teams },
        ], stats.topInstitutions)]
      : []),
  ];
  await downloadWorkbook(stats.department ? `${stats.department.toLowerCase()}-overview` : "overview", sheets);
}
