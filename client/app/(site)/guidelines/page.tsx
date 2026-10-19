import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowRight } from "lucide-react";
import { ImportantDates } from "@/components/landing/ImportantDates";
import {
  categories,
  departmentPrizes,
  institutePrizes,
  participantTracks,
  prizeHeadline,
  prizePools,
  registrationSteps,
  teamRules,
} from "@/lib/content";
import { formatINR } from "@/lib/format";
import { TEAM_MAX_SIZE, TEAM_MIN_SIZE } from "@/lib/rules";

export const metadata: Metadata = {
  title: "Guidelines | InnoTech26",
  description: "Eligibility, team rules, categories, prizes and dates for InnoTech26 at KIET.",
};

const contents = [
  { id: "eligibility", label: "Who can participate" },
  { id: "registration", label: "How to register" },
  { id: "team-rules", label: "Team rules" },
  { id: "categories", label: "Categories" },
  { id: "prizes", label: "Prizes" },
  { id: "dates", label: "Important dates" },
];

const eligibilityRows: { label: string; values: [string, string, string] }[] = [
  { label: "Sign in with", values: ["Official @kiet.edu Google account", "Any Google account", "Any Google account"] },
  { label: "Categories", values: ["Any one of the eight", "Any one of the eight", "Any one of the eight"] },
  { label: "Team", values: [`${TEAM_MIN_SIZE} to ${TEAM_MAX_SIZE} KIET students, any branch`, `${TEAM_MIN_SIZE} to ${TEAM_MAX_SIZE} students of the same college`, `${TEAM_MIN_SIZE} to ${TEAM_MAX_SIZE} students of the same school`] },
  { label: "Route", values: ["Department round, then Grand Finale", "Accepted by the organisers, then the Grand Finale", "Accepted by the organisers, then the Grand Finale"] },
  { label: "Competes for", values: ["Department and institute prizes", "Institute level prizes", "Best School Project/Poster"] },
];

export default function GuidelinesPage() {
  return (
    <>
      <header className="relative overflow-hidden bg-navy-950">
        <div className="bg-grid absolute inset-0" aria-hidden="true" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-brand-300">
            <span className="h-px w-6 bg-current" />
            Guidelines
          </p>
          <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">Rules and guidelines for InnoTech26</h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            Everything you need before you register: who can take part, how teams work, the eight categories and what you can win.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/register"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-accent-500 px-7 py-3.5 font-semibold text-white shadow-xl shadow-accent-500/30 transition hover:-translate-y-0.5 hover:bg-accent-600"
            >
              Register now
              <ArrowRight size={18} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
            <Link href="/#faq" className="inline-flex items-center justify-center rounded-full border border-white/20 px-7 py-3.5 font-semibold text-white transition hover:border-white/50 hover:bg-white/5">
              Read the FAQ
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-14 sm:px-6 lg:grid-cols-[15rem_1fr] lg:gap-16 lg:px-8 lg:py-20">
        <nav aria-label="Contents" className="lg:sticky lg:top-28 lg:self-start">
          <p className="text-xs font-bold uppercase tracking-[0.2em] text-muted">Contents</p>
          <ol className="mt-4 grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
            {contents.map((item, index) => (
              <li key={item.id}>
                <a href={`#${item.id}`} className="flex gap-3 rounded-xl px-3 py-2 text-sm font-semibold text-navy-800 transition hover:bg-surface hover:text-accent-500">
                  <span className="w-5 text-muted">{index + 1}.</span>
                  {item.label}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="min-w-0 space-y-16">
          <Block id="eligibility" title="Who can participate">
            <p>
              InnoTech26 is open to students of KIET, students of other colleges and school students. KIET teams compete at the department
              level first; teams from other colleges and schools are accepted by the organisers, who then allot them stalls at the Grand Finale on 30 October 2026.
            </p>
            <div className="mt-6 overflow-x-auto rounded-2xl ring-1 ring-line">
              <table className="w-full min-w-[40rem] border-collapse text-left text-sm">
                <thead className="bg-navy-900 text-white">
                  <tr>
                    <th scope="col" className="p-4 font-semibold">
                      <span className="sr-only">Rule</span>
                    </th>
                    {participantTracks.map((track) => (
                      <th key={track.title} scope="col" className="p-4 font-display font-bold">
                        {track.title}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {eligibilityRows.map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="p-4 font-semibold text-muted">
                        {row.label}
                      </th>
                      {row.values.map((value, index) => (
                        <td key={index} className="p-4 text-navy-800">
                          {value}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Block>

          <Block id="registration" title="How to register">
            <p>Every student registers on their own first. The team leader then builds the team from their account.</p>
            <ol className="mt-6 space-y-5">
              {registrationSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">{index + 1}</span>
                  <div>
                    <p className="font-display font-bold text-ink">{step.title}</p>
                    <p className="text-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Block>

          <Block id="team-rules" title="Team rules">
            <ol className="space-y-4">
              {teamRules.map((rule, index) => (
                <li key={rule} className="flex gap-4 text-navy-800">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent-50 text-xs font-bold text-accent-600">{index + 1}</span>
                  {rule}
                </li>
              ))}
            </ol>
          </Block>

          <Block id="categories" title="The eight categories">
            <p>Each team registers for exactly one category. Sub-topics are guidelines, and new ideas are always welcome.</p>
            <div className="mt-6 divide-y divide-line rounded-2xl bg-white ring-1 ring-line">
              {categories.map((category) => (
                <section key={category.number} className="grid gap-4 p-5 sm:grid-cols-[3.5rem_1fr] sm:p-6">
                  <span className="font-display text-4xl font-bold leading-none text-navy-900/15">{String(category.number).padStart(2, "0")}</span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-display text-lg font-bold text-ink">{category.title}</h3>
                      <Tag tone={category.isPoster ? "accent" : "brand"}>{category.isPoster ? "Poster" : "Project"}</Tag>
                      {category.firstYearOnly && <Tag tone="navy">First year only</Tag>}
                    </div>
                    <p className="mt-1 text-muted">{category.summary}</p>
                    <ul className="mt-3 flex flex-wrap gap-2">
                      {category.topics.map((topic) => (
                        <li key={topic} className="rounded-lg bg-surface px-2.5 py-1 text-xs font-medium text-navy-800">
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </div>
                </section>
              ))}
            </div>
          </Block>

          <Block id="prizes" title="Prizes">
            <p>
              Cash prizes worth {prizeHeadline.cash} from a prize pool of {prizeHeadline.pool}. Winners also receive trophies and certificates, and
              every participant receives an e-certificate.
            </p>
            <div className="mt-6 overflow-x-auto rounded-2xl ring-1 ring-line">
              <table className="w-full min-w-[30rem] border-collapse text-left text-sm">
                <thead className="bg-navy-900 text-white">
                  <tr>
                    <th scope="col" className="p-4 font-display font-bold">
                      Institute level{" "}
                      <span className="font-sans text-xs font-semibold text-slate-300">
                        (₹{formatINR(prizePools.institute)} pool, per category)
                      </span>
                    </th>
                    <th scope="col" className="p-4 text-right font-semibold">1st</th>
                    <th scope="col" className="p-4 text-right font-semibold">2nd</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line bg-white">
                  {institutePrizes.map((prize) => (
                    <tr key={prize.title}>
                      <th scope="row" className="p-4 font-normal">
                        <span className="block font-semibold text-ink">{prize.title}</span>
                        <span className="text-muted">{prize.categories}</span>
                      </th>
                      <td className="p-4 text-right font-display text-base font-bold text-accent-600">₹{formatINR(prize.first)}</td>
                      <td className="p-4 text-right font-display text-base font-bold text-ink">₹{formatINR(prize.second)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <h3 className="mt-8 font-display text-lg font-bold text-ink">
              Department level, 1st position{" "}
              <span className="text-sm font-semibold text-muted">
                (₹{formatINR(prizePools.department)} prize pool)
              </span>
            </h3>
            <ul className="mt-3 divide-y divide-line">
              {departmentPrizes.map((prize) => (
                <li key={prize.categories} className="flex justify-between gap-4 py-3">
                  <span className="text-navy-800">{prize.categories}</span>
                  <span className="font-display font-bold text-ink">₹{formatINR(prize.first)}</span>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-sm text-muted">Awarded in each of the 17 departments. No reimbursement is given for project materials.</p>
          </Block>

          <Block id="dates" title="Important dates">
            <ImportantDates />
          </Block>
        </div>
      </div>
    </>
  );
}

function Block({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-28">
      <h2 id={`${id}-title`} className="mb-4 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">
        {title}
      </h2>
      <div className="leading-relaxed text-muted">{children}</div>
    </section>
  );
}

const tagTones = {
  brand: "bg-brand-50 text-brand-700",
  accent: "bg-accent-50 text-accent-600",
  navy: "bg-navy-900 text-white",
};

function Tag({ tone, children }: { tone: keyof typeof tagTones; children: ReactNode }) {
  return <span className={`rounded-full px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide ${tagTones[tone]}`}>{children}</span>;
}
