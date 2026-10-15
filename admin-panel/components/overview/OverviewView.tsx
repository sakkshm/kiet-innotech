"use client";

import Link from "next/link";
import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Stats, StatusCounts } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { timeline } from "@/lib/content";
import { downloadOverviewExcel } from "@/lib/export";
import { categoryTitle, formatDate, formatDateTime, formatIst, formatNumber, typeShortLabels } from "@/lib/format";
import { yearLabel } from "@/lib/rules";
import { scopeName } from "@/lib/scope";
import { useQuery } from "@/lib/use-query";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { ChartCard, DataTable, Segmented } from "@/components/charts/ChartCard";
import { Columns } from "@/components/charts/Columns";
import { Donut } from "@/components/charts/Donut";
import { Meter } from "@/components/charts/Meter";
import { accent, categorical, statusSeries, typeColors, type Series } from "@/components/charts/palette";
import { StackedBars } from "@/components/charts/StackedBars";
import { TrendChart, type TrendPoint } from "@/components/charts/TrendChart";
import { Button } from "@/components/ui/Button";

function Headline({ stats }: { stats: Stats }) {
  const out = stats.teams.withdrawn + stats.teams.disqualified;
  const items = [
    { label: "Students registered", value: stats.students, note: `${formatNumber(stats.studentsInTeams)} in teams` },
    { label: "Teams", value: stats.teams.total, note: `${formatNumber(stats.pendingInvitations)} pending invitations` },
    { label: "Submitted", value: stats.teams.submitted, note: "Locked and eligible" },
    { label: "Drafts", value: stats.teams.draft, note: "Not yet submitted" },
    { label: "Withdrawn", value: out, note: stats.teams.disqualified ? `incl. ${stats.teams.disqualified} disqualified` : "Out of the event" },
  ];
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-line ring-1 ring-line sm:grid-cols-5">
      {items.map((item, index) => (
        <div key={item.label} className={`bg-white px-4 py-4 sm:px-5 ${index === 0 ? "col-span-2 sm:col-span-1" : ""}`}>
          <dt className="text-[11px] font-semibold uppercase tracking-wider text-muted">{item.label}</dt>
          <dd className="mt-1 font-display text-3xl font-bold tabular-nums text-navy-900">{formatNumber(item.value)}</dd>
          <dd className="mt-0.5 text-xs text-muted">{item.note}</dd>
        </div>
      ))}
    </dl>
  );
}

function WindowStrip({ stats }: { stats: Stats }) {
  const { registration, nominationsDeadline, nominationsOpen } = stats.schedule;
  const state = registration.state;
  const isSuper = useAdmin().role === "super_admin";
  const today = new Date().toISOString().slice(0, 10);
  // The next milestone from the plan, skipping the two registration dates (the live window is shown separately).
  const upcoming = timeline.find((m) => m.end >= today && !/registrations? (open|close)/i.test(m.title));
  const label =
    state === "open"
      ? `Open until ${formatIst(registration.closes)}`
      : state === "upcoming"
        ? `Opens ${formatIst(registration.opens)}`
        : `Closed on ${formatIst(registration.closes)}`;
  return (
    <div className="flex flex-col gap-2 border-y border-line py-3 text-sm sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-6">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-navy-900">Registration</span>
        <Pill tone={state === "open" ? "green" : state === "upcoming" ? "cyan" : "slate"}>
          {state === "open" ? "Open" : state === "upcoming" ? "Upcoming" : "Closed"}
        </Pill>
        <span className="text-muted">{label}</span>
        {isSuper && (
          <Link href="/schedule" className="font-semibold text-brand-700 hover:underline">
            Change
          </Link>
        )}
      </p>
      {nominationsDeadline && (
        <p className="text-muted">
          Nominations {nominationsOpen ? "due" : "were due"} <span className="font-semibold text-navy-900">{formatIst(nominationsDeadline)}</span>
        </p>
      )}
      {upcoming && (
        <p className="text-muted">
          Next: <span className="font-semibold text-navy-900">{upcoming.title}</span> · {upcoming.dateLabel}
        </p>
      )}
      <p className="text-muted">
        Results:{" "}
        {stats.resultsPublishedAt ? (
          <span className="font-semibold text-navy-900">published {formatDateTime(stats.resultsPublishedAt)}</span>
        ) : (
          <span className="font-semibold text-navy-900">not published</span>
        )}
      </p>
    </div>
  );
}

export function OverviewView() {
  const admin = useAdmin();
  const isSuper = admin.role === "super_admin";
  const outside = admin.role === "outside_admin";
  const startupAdmin = admin.role === "startup_admin";
  const stats = useQuery("stats", () => api.stats());
  const data = stats.data;
  const [reporting, setReporting] = useState(false);
  const [reportError, setReportError] = useState<string | null>(null);

  async function downloadReport() {
    if (!data) return;
    setReporting(true);
    setReportError(null);
    try {
      await downloadOverviewExcel(data);
    } catch (err) {
      setReportError(errorMessage(err));
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow={scopeName(admin)}
        title="Overview"
        description={
          isSuper
            ? "Registrations across InnoTech26. Department admins see the same page for their own department."
            : startupAdmin
              ? "Startups that have registered, who go straight to the Grand Finale."
            : outside
              ? "Registrations from other colleges and schools, who go straight to the Grand Finale."
              : `Registrations of ${admin.department} students and teams led by ${admin.department} students.`
        }
        actions={
          <Button variant="secondary" onClick={downloadReport} pending={reporting} disabled={!data}>
            {!reporting && <FileSpreadsheet aria-hidden="true" className="size-4" />}
            Download report
          </Button>
        }
      />

      {reportError && <Notice tone="error">{reportError}</Notice>}
      {stats.error && <Notice tone="error">{stats.error}</Notice>}
      {!data && !stats.error && <Loading label="Loading numbers" />}

      {data && (
        <>
          {data.awaitingApproval > 0 && (
            <Notice tone="warning" title={`${data.awaitingApproval} ${data.awaitingApproval === 1 ? "entry is" : "entries are"} waiting for your approval`}>
              Startup and COE KIET entries qualify for the Grand Finale only once they are accepted.{" "}
              <Link href="/teams?approval=pending" className="font-semibold underline">
                Review them
              </Link>
              .
            </Notice>
          )}
          <WindowStrip stats={data} />
          <section aria-label="Headline numbers">
            <Headline stats={data} />
          </section>
          <Charts stats={data} startupAdmin={startupAdmin} />

        </>
      )}
    </div>
  );
}

type YearMode = "students" | "led" | "with";
const yearNotes: Record<YearMode, string> = { students: "students", led: "active teams led", with: "active teams with a member" };
const yearDescriptions: Record<YearMode, string> = {
  students: "Registered students by year (college) or class (school)",
  led: "Active teams by the leader's year",
  with: "Active teams with at least one member of each year",
};

const trendSeries: Series<"students" | "teams" | "submitted">[] = [
  { key: "students", label: "Students registered", color: categorical[0] },
  { key: "teams", label: "Teams created", color: categorical[1] },
  { key: "submitted", label: "Teams submitted", color: categorical[2] },
];
const single = (label: string): Series<"value">[] => [{ key: "value", label, color: accent }];
const statusTable = (rows: (StatusCounts & { label: string })[]) => (
  <DataTable
    head={["", ...statusSeries.map((s) => s.label), "Total"]}
    rows={rows.map((r) => [r.label, ...statusSeries.map((s) => r[s.key]), r.total])}
  />
);

/** The dashboard: every chart has a table view, and bars, slices and rows link to the matching filtered list. */
function Charts({ stats, startupAdmin }: { stats: Stats; startupAdmin: boolean }) {
  const [trendMode, setTrendMode] = useState<"cumulative" | "daily">("cumulative");
  const [yearMode, setYearMode] = useState<YearMode>("students");
  const running = { students: 0, teams: 0, submitted: 0 };
  const trend: TrendPoint<"students" | "teams" | "submitted">[] = stats.timeline.map((day) => {
    if (trendMode === "daily") return { date: day.date, values: { students: day.students, teams: day.teams, submitted: day.submitted } };
    running.students += day.students;
    running.teams += day.teams;
    running.submitted += day.submitted;
    return { date: day.date, values: { ...running } };
  });

  const statusSlices = statusSeries.map((s) => ({ key: s.key, label: s.label, color: s.color, value: stats.teams[s.key], href: `/teams?status=${s.key}` }));
  const yearValue = (r: Stats["byYear"][number]) => (yearMode === "students" ? r.students : yearMode === "led" ? r.teamsLed : r.teamsWith);
  const collegeYears = [1, 2, 3, 4].map((year) => ({
    key: String(year),
    label: yearLabel(year),
    note: `${yearLabel(year)} · ${yearNotes[yearMode]}`,
    value: stats.byYear.filter((r) => r.participantType !== "school" && r.year === year).reduce((sum, r) => sum + yearValue(r), 0),
  }));
  const schoolYears = stats.byYear.filter((r) => r.participantType === "school");
  const domainRows = stats.byDomain.map((d) => ({ key: d.domain, label: d.domain, values: { value: d.teams } }));

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <ChartCard
          className="lg:col-span-2"
          title="Registrations over time"
          description={trendMode === "cumulative" ? "Running totals by day (IST)" : "New each day (IST)"}
          controls={
            <Segmented
              label="Totals or per day"
              value={trendMode}
              onChange={setTrendMode}
              options={[
                { value: "cumulative", label: "Running total" },
                { value: "daily", label: "Per day" },
              ]}
            />
          }
          table={
            <DataTable
              head={["Date", "Students", "Teams created", "Teams submitted"]}
              rows={stats.timeline.map((d) => [formatDate(`${d.date}T12:00:00+05:30`), d.students, d.teams, d.submitted])}
            />
          }
        >
          <TrendChart height={360} points={trend} series={trendSeries} label={`Registrations over time, ${trendMode === "daily" ? "per day" : "running totals"}`} />
        </ChartCard>

        <ChartCard
          title="Team status"
          description="Click a status to see those teams"
          table={statusTable([{ label: "All teams", ...stats.teams }])}
        >
          <Donut slices={statusSlices} centerLabel="teams" />
          <div className="mt-5 border-t border-line pt-4">
            <Meter label="Students already in a team" value={stats.studentsInTeams} total={stats.students} note={`${formatNumber(stats.pendingInvitations)} invitations pending`} />
          </div>
        </ChartCard>
      </div>

      <ChartCard
        title="Teams per category"
        description="Click a category to open its teams"
        table={statusTable(stats.byCategory.map((r) => ({ ...r, label: `${r.category}. ${categoryTitle(r.category)}` })))}
      >
        <StackedBars
          series={statusSeries}
          labelWidth="17rem"
          rows={stats.byCategory.map((r) => ({
            key: String(r.category),
            label: `${r.category}. ${categoryTitle(r.category)}`,
            href: `/teams?category=${r.category}`,
            values: { submitted: r.submitted, draft: r.draft, withdrawn: r.withdrawn, disqualified: r.disqualified, archived: r.archived },
          }))}
        />
      </ChartCard>

      {stats.byDepartment && (
        <ChartCard
          title="KIET teams by department"
          description="A team belongs to its leader's department. Click a department to open its teams."
          table={
            <DataTable
              head={["Department", "Students", ...statusSeries.map((s) => s.label), "Teams"]}
              rows={stats.byDepartment.map((r) => [r.department, r.students, ...statusSeries.map((s) => r[s.key]), r.total])}
            />
          }
        >
          <StackedBars
            series={statusSeries}
            labelWidth="7rem"
            rows={stats.byDepartment.map((r) => ({
              key: r.department,
              label: r.department,
              hint: `${formatNumber(r.students)} students`,
              href: `/teams?department=${encodeURIComponent(r.department)}`,
              values: { submitted: r.submitted, draft: r.draft, withdrawn: r.withdrawn, disqualified: r.disqualified, archived: r.archived },
            }))}
          />
        </ChartCard>
      )}

      {!startupAdmin && (
      <div className={`grid gap-4 ${stats.byType ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
        {stats.byType && (
          <ChartCard
            title="Students by participant type"
            description="KIET teams take the department round; others go straight to the finale"
            table={<DataTable head={["Type", "Students", "Teams", "Submitted"]} rows={stats.byType.map((r) => [typeShortLabels[r.type], r.students, r.teams, r.submitted])} />}
          >
            <Donut
              centerLabel="students"
              slices={stats.byType.map((r) => ({ key: r.type, label: typeShortLabels[r.type], color: typeColors[r.type], value: r.students, href: `/students?type=${r.type}` }))}
            />
          </ChartCard>
        )}
        <ChartCard
          title="Year of study"
          description={yearDescriptions[yearMode]}
          controls={
            <Segmented
              label="Students or teams by year"
              value={yearMode}
              onChange={setYearMode}
              options={[
                { value: "students", label: "Students" },
                { value: "led", label: "Teams led" },
                { value: "with", label: "Teams with" },
              ]}
            />
          }
          table={
            <DataTable
              head={["Year / class", "Type", "Students", "Active teams led", "Active teams with a member"]}
              rows={stats.byYear.map((r) => [yearLabel(r.year, r.participantType), typeShortLabels[r.participantType], r.students, r.teamsLed, r.teamsWith])}
            />
          }
        >
          <Columns columns={collegeYears} unit={yearNotes[yearMode]} />
          {schoolYears.length > 0 && (
            <p className="mt-3 text-xs text-muted">
              School: {schoolYears.map((r) => `${yearLabel(r.year, "school")}: ${formatNumber(yearValue(r))}`).join(" · ")}
            </p>
          )}
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            <span className="text-muted">Open teams {yearMode === "led" ? "led by" : "with"}:</span>
            {[1, 2, 3, 4].map((year) => (
              <Link
                key={year}
                href={`/teams?${yearMode === "led" ? "leader_year" : "year"}=${year}`}
                className="font-semibold text-brand-700 hover:underline"
              >
                {yearLabel(year)}
              </Link>
            ))}
          </p>
        </ChartCard>
        <ChartCard
          title="Team sizes"
          description="Active teams by number of members; 2 to 5 can submit"
          table={<DataTable head={["Members", "Active teams"]} rows={stats.teamSizes.map((r) => [r.size, r.teams])} />}
        >
          <Columns
            columns={stats.teamSizes.map((r) => ({ key: String(r.size), label: String(r.size), note: `${r.size} ${r.size === 1 ? "member" : "members"}`, value: r.teams }))}
            unit="active teams"
            axisLabel="Members in the team"
          />
        </ChartCard>
      </div>
      )}

      <div className={`grid gap-4 ${stats.topInstitutions ? "xl:grid-cols-2" : ""}`}>
        <ChartCard
          title="Most popular domains"
          description="Active teams by project domain"
          table={<DataTable head={["Domain", "Active teams"]} rows={stats.byDomain.map((r) => [r.domain, r.teams])} />}
        >
          {domainRows.length ? (
            <StackedBars series={single("Active teams")} rows={domainRows} labelWidth="14rem" sortable={false} legend={false} />
          ) : (
            <p className="py-8 text-center text-sm text-muted">No active teams yet.</p>
          )}
        </ChartCard>
        {stats.topInstitutions && (
          <ChartCard
            title="Top colleges and schools"
            description="Outside KIET, by registered students"
            table={
              <DataTable
                head={["Institution", "City", "Students", "Active teams"]}
                rows={stats.topInstitutions.map((r) => [`${r.institution} (${typeShortLabels[r.participantType]})`, r.city, r.students, r.teams])}
              />
            }
          >
            {stats.topInstitutions.length ? (
              <StackedBars
                series={single("Students")}
                labelWidth="14rem"
                sortable={false}
                legend={false}
                rows={stats.topInstitutions.map((r) => ({
                  key: `${r.participantType}-${r.institution}`,
                  label: r.institution,
                  hint: `${typeShortLabels[r.participantType]} · ${r.city} · ${formatNumber(r.teams)} active ${r.teams === 1 ? "team" : "teams"}`,
                  href: `/students?q=${encodeURIComponent(r.institution.slice(0, 100))}`,
                  values: { value: r.students },
                }))}
              />
            ) : (
              <p className="py-8 text-center text-sm text-muted">No students from other colleges or schools yet.</p>
            )}
          </ChartCard>
        )}
      </div>
    </div>
  );
}
