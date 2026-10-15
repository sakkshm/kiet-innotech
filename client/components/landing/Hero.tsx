import Image from "next/image";
import type { ReactNode } from "react";
import { CalendarDays, MapPin, Ticket } from "lucide-react";
import { event } from "@/lib/content";
import { Countdown } from "./Countdown";
import { HeroVideo } from "./HeroVideo";
import { RegisterCta, RegistrationRange } from "./RegisterCta";
import { SponsoredBy } from "./SponsoredBy";

const facts = [
  { icon: CalendarDays, label: event.finaleLabel },
  { icon: MapPin, label: "KIET, Ghaziabad" },
  { icon: Ticket, label: "Free registration" },
];

export function Hero() {
  return (
    <section className="relative isolate overflow-hidden bg-navy-950">
      {/* Background film of InnoTech'25. The text side stays dark; the film shows through on the right. */}
      <HeroVideo />
      <div className="absolute inset-0 -z-10 bg-navy-950/80 lg:bg-transparent lg:bg-gradient-to-r lg:from-navy-950 lg:via-navy-950/85 lg:to-navy-950/35" />
      <div className="absolute inset-x-0 bottom-0 -z-10 h-32 bg-gradient-to-t from-navy-950 to-transparent" />
      <div className="bg-grid absolute inset-0 -z-10" />
      <div className="absolute -left-40 top-1/3 -z-10 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" />
      <div className="absolute -right-20 bottom-0 -z-10 h-80 w-80 rounded-full bg-accent-500/20 blur-3xl" />

      <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.25fr_1fr] lg:px-8 lg:pb-28 lg:pt-24">
        <div>
          <p className="mb-6 inline-flex animate-fade-up items-center gap-2 rounded-full border border-white/15 bg-white/5 px-4 py-1.5 text-xs font-semibold uppercase tracking-widest text-brand-300 backdrop-blur-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-accent-500" />
            KIET Deemed to be University
          </p>

          <Image
            src="/images/brand/innotech-lockup-light.png"
            alt=""
            width={529}
            height={202}
            priority
            className="mb-8 w-full max-w-lg animate-fade-up [animation-delay:120ms] drop-shadow-[0_10px_40px_rgb(232_85_36/0.25)]"
          />

          <h1 className="animate-fade-up font-display [animation-delay:240ms] text-2xl font-bold leading-tight text-white sm:text-3xl lg:text-4xl">
            <span className="sr-only">{event.name}: </span>
            Building an <span className="text-brand-400">Innovative</span>,{" "}
            <span className="text-brand-400">Secure</span> and{" "}
            <span className="text-brand-400">Sustainable</span> Viksit Bharat @2047
          </h1>

          <p className="mt-5 max-w-2xl animate-fade-up [animation-delay:360ms] text-base text-slate-300 sm:text-lg">
            Showcase your ideas in Artificial Intelligence, Cyber Security, Start-ups and
            Innovative Projects. Open to KIET students, other colleges and schools.
          </p>

          <div className="mt-8 flex animate-fade-up flex-col gap-3 [animation-delay:480ms] sm:flex-row">
            <RegisterCta
              label="Register Your Team"
              className="group inline-flex items-center justify-center gap-2 rounded-full bg-accent-500 px-7 py-3.5 font-semibold text-white shadow-xl shadow-accent-500/30 transition hover:-translate-y-0.5 hover:bg-accent-600"
            />
            <a
              href="#categories"
              className="inline-flex items-center justify-center rounded-full border border-white/20 px-7 py-3.5 font-semibold text-white transition hover:border-white/50 hover:bg-white/5"
            >
              Explore Categories
            </a>
          </div>

          <ul className="mt-10 flex animate-fade-up flex-wrap [animation-delay:600ms] gap-x-6 gap-y-3">
            {facts.map(({ icon: FactIcon, label }) => (
              <li key={label} className="flex items-center gap-2 text-sm font-medium text-slate-200">
                <FactIcon size={18} className="text-brand-400" aria-hidden="true" />
                {label}
              </li>
            ))}
          </ul>
        </div>

        <div className="animate-float rounded-3xl border border-white/10 bg-navy-900/60 p-6 shadow-2xl backdrop-blur-md sm:p-8">
          <Countdown to={event.finaleDate} endsAt={event.finaleEndDate} />

          <div className="mt-8 space-y-4 border-t border-white/10 pt-6">
            <Milestone label="KIET & startups" value={<RegistrationRange />} />
            <Milestone label="Other colleges & schools" value="until 21 Oct 2026" highlight />
            <Milestone label="Department level" value="22 - 24 Oct 2026" />
            <Milestone label="Grand Finale" value="30 Oct 2026" highlight />
          </div>
        </div>

        <SponsoredBy className="lg:col-span-2" />
      </div>
    </section>
  );
}

function Milestone({ label, value, highlight = false }: { label: string; value: ReactNode; highlight?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="text-slate-400">{label}</span>
      <span className={`font-semibold ${highlight ? "text-brand-400" : "text-white"}`}>{value}</span>
    </div>
  );
}
