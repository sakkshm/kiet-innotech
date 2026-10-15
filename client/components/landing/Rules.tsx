import { ListChecks } from "lucide-react";
import { registrationSteps, teamRules } from "@/lib/content";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";

export function Rules() {
  return (
    <Section id="rules" className="bg-surface">
      <SectionHeading
        eyebrow="Registration and rules"
        title="How to register your team"
        description="Every student registers first. The team leader then builds the team from their own account."
      />

      {/* Registration steps */}
      <ol className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {registrationSteps.map((step, index) => (
          <Reveal as="li" key={step.title} delay={index * 100}>
            <div className="relative h-full rounded-3xl bg-white p-6 ring-1 ring-line">
              <span className="font-display text-sm font-bold text-accent-600">Step {index + 1}</span>
              <h3 className="mt-2 font-display text-lg font-bold text-ink">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted">{step.text}</p>
            </div>
          </Reveal>
        ))}
      </ol>

      <Reveal className="mt-12 rounded-3xl bg-white p-6 ring-1 ring-line sm:p-8">
        <h3 className="flex items-center gap-2 font-display text-xl font-bold text-ink">
          <ListChecks size={22} className="text-brand-500" aria-hidden="true" />
          Rules for a team
        </h3>
        <ul className="mt-6 grid gap-x-10 gap-y-4 lg:grid-cols-2">
          {teamRules.map((rule, index) => (
            <li key={rule} className="flex gap-4 text-sm leading-relaxed text-navy-800 sm:text-base">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">
                {index + 1}
              </span>
              {rule}
            </li>
          ))}
        </ul>
      </Reveal>
    </Section>
  );
}
