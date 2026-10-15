import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarCheck, Gift, Rocket, Trophy, UserRound } from "lucide-react";
import { ImportantDates } from "@/components/landing/ImportantDates";
import { StartupCta } from "@/components/landing/StartupCta";
import { MailLink } from "@/components/ui/MailLink";
import { Reveal } from "@/components/ui/Reveal";

export const metadata: Metadata = {
  title: "Startups | InnoTech26",
  description: "Register your startup as a single entry for InnoTech26 at KIET.",
};

const steps: { title: string; text: ReactNode }[] = [
  { title: "Sign in with Google", text: "Any Google account works, including a @kiet.edu account." },
  { title: "Tell us about your startup", text: "Your startup's name, your name and your mobile number. That is all we ask." },
  { title: "Add your project and submit", text: "Choose a category, describe what you are building and submit before registration closes. The entry is then locked." },
  {
    title: "Get accepted",
    text: (
      <>
        An admin must accept your entry as a legal one before it counts. Contact the coordinator, or write to <MailLink />, to get it accepted.
      </>
    ),
  },
];

const facts: { icon: typeof Rocket; title: string; text: string }[] = [
  { icon: UserRound, title: "One entry, no team", text: "A startup registers as a single entry, so there are no teammates to invite and no team code to share." },
  {
    icon: Trophy,
    title: "Once you are accepted",
    text: "When an admin accepts your entry, the portal tells you where you stand and what happens next, including your stall number.",
  },
  { icon: CalendarCheck, title: "Any of the eight categories", text: "Category 5, Start Small, Scale Big, Sustain Always, suits many startups. Gen Z to Budding Innovators is only for first-year students." },
  { icon: Gift, title: "Free to register", text: "There is no fee. Your entry appears on the event pages under your startup's name." },
];

export default function StartupsPage() {
  return (
    <>
      <header className="relative overflow-hidden bg-navy-950">
        <div className="bg-grid absolute inset-0" aria-hidden="true" />
        <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-accent-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative mx-auto max-w-7xl px-4 py-16 sm:px-6 sm:py-20 lg:px-8">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-brand-300">
            <span className="h-px w-6 bg-current" />
            Startups
          </p>
          <h1 className="max-w-3xl font-display text-4xl font-bold tracking-tight text-white sm:text-5xl">Bring your startup to InnoTech26</h1>
          <p className="mt-4 max-w-2xl text-base text-slate-300 sm:text-lg">
            Register your startup as a single entry. There is no team to build: tell us who you are and add your project.
            Startup registrations are open until 21 October 2026.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <StartupCta className="group inline-flex items-center justify-center gap-2 rounded-full bg-accent-500 px-7 py-3.5 font-semibold text-white shadow-xl shadow-accent-500/30 transition hover:-translate-y-0.5 hover:bg-accent-600" />
            <Link href="/guidelines" className="inline-flex items-center justify-center rounded-full border border-white/20 px-7 py-3.5 font-semibold text-white transition hover:border-white/50 hover:bg-white/5">
              Read the guidelines
            </Link>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-16 px-4 py-14 sm:px-6 lg:px-8 lg:py-20">
        <Block title="How it works">
          <ol className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step.title}>
                <Reveal delay={index * 100} className="h-full">
                  <div className="h-full rounded-3xl bg-white p-6 ring-1 ring-line">
                    <span className="flex h-9 w-9 items-center justify-center rounded-full bg-navy-900 text-sm font-bold text-white">{index + 1}</span>
                    <p className="mt-4 font-display text-lg font-bold text-ink">{step.title}</p>
                    <p className="mt-1.5 text-muted">{step.text}</p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </Block>

        <Block title="Good to know">
          <ul className="grid gap-6 sm:grid-cols-2">
            {facts.map(({ icon: Icon, title, text }, index) => (
              <li key={title}>
                <Reveal delay={index * 80} className="h-full">
                  <div className="flex h-full gap-4 rounded-3xl bg-white p-6 ring-1 ring-line">
                    <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-accent-50 text-accent-500">
                      <Icon size={22} aria-hidden="true" />
                    </span>
                    <div>
                      <p className="font-display text-lg font-bold text-ink">{title}</p>
                      <p className="mt-1 text-muted">{text}</p>
                    </div>
                  </div>
                </Reveal>
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Important dates">
          <ImportantDates exclude={["Department Level", "Finalists Declared", "Registrations Close"]} />
        </Block>

        <section aria-labelledby="startup-cta" className="relative overflow-hidden rounded-3xl bg-navy-900 px-6 py-10 text-center sm:px-10">
          <div className="bg-grid absolute inset-0" aria-hidden="true" />
          <div className="relative">
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent-500 text-white shadow-lg shadow-accent-500/30">
              <Rocket size={22} aria-hidden="true" />
            </span>
            <h2 id="startup-cta" className="mt-4 font-display text-2xl font-bold text-white sm:text-3xl">
              Ready to put your startup on the stage?
            </h2>
            <p className="mx-auto mt-2 max-w-xl text-slate-300">
              It takes a few minutes. Questions? Write to <MailLink className="font-semibold text-white underline underline-offset-2 hover:text-brand-300" />.
            </p>
            <StartupCta className="group mt-6 inline-flex items-center justify-center gap-2 rounded-full bg-accent-500 px-7 py-3.5 font-semibold text-white shadow-xl shadow-accent-500/30 transition hover:-translate-y-0.5 hover:bg-accent-600" />
          </div>
        </section>
      </div>
    </>
  );
}

function Block({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title}>
      <h2 className="mb-6 font-display text-2xl font-bold tracking-tight text-ink sm:text-3xl">{title}</h2>
      {children}
    </section>
  );
}
