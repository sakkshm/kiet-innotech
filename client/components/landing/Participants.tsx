import Link from "next/link";
import { ArrowRight, ChevronRight, GraduationCap, Rocket, School, University } from "lucide-react";
import { participantTracks } from "@/lib/content";
import { Reveal } from "@/components/ui/Reveal";
import { Slider } from "@/components/ui/Slider";
import { Section, SectionHeading } from "@/components/ui/Section";

const trackIcons = [University, GraduationCap, School];

export function Participants() {
  return (
    <Section id="participate" className="relative overflow-hidden bg-navy-900">
      <div className="bg-grid absolute inset-0" aria-hidden="true" />
      <div className="absolute -right-32 -top-32 h-96 w-96 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />

      <div className="relative">
        <SectionHeading
          tone="dark"
          eyebrow="Who can participate"
          title="Three ways to join InnoTech26"
          description="KIET teams compete at department level first. Teams from other colleges and schools are accepted by the organisers, then allotted stalls at the Grand Finale."
        />

        <Slider
          label="Ways to participate"
          tone="dark"
          gridClassName="md:gap-6 lg:grid-cols-3"
          slides={participantTracks.map((track, index) => {
            const TrackIcon = trackIcons[index];
            return {
              key: track.title,
              className: "flex",
              content: (
                <Reveal delay={index * 120} className="flex w-full">
                  <div className="flex h-full w-full flex-col rounded-3xl border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition duration-300 hover:border-brand-400/50 hover:bg-white/[0.07]">
                  <div className="flex items-center gap-4">
                    <span className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-500/15 text-brand-300">
                      <TrackIcon size={24} aria-hidden="true" />
                    </span>
                    <div>
                      <h3 className="font-display text-xl font-bold text-white">{track.title}</h3>
                      <p className="text-sm text-slate-400">{track.audience}</p>
                    </div>
                  </div>

                  {/* Journey */}
                  <ol className="my-6 flex flex-wrap items-center gap-2" aria-label={`${track.title} journey`}>
                    {track.steps.map((step, stepIndex) => (
                      <li key={step} className="flex items-center gap-2">
                        <span
                          className={`rounded-full px-3 py-1 text-xs font-semibold ${
                            stepIndex === track.steps.length - 1
                              ? "bg-accent-500 text-white"
                              : "bg-white/10 text-slate-200"
                          }`}
                        >
                          {step}
                        </span>
                        {stepIndex < track.steps.length - 1 && (
                          <ChevronRight size={14} className="text-slate-500" aria-hidden="true" />
                        )}
                      </li>
                    ))}
                  </ol>

                  <ul className="space-y-3 border-t border-white/10 pt-6">
                    {track.points.map((point) => (
                      <li key={point} className="flex gap-3 text-sm text-slate-300">
                        <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-brand-400" aria-hidden="true" />
                        {point}
                      </li>
                    ))}
                  </ul>
                </div>
                </Reveal>
              ),
            };
          })}
        />

        <Reveal delay={200} className="mt-10">
          <div className="flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-sm sm:flex-row sm:items-center sm:justify-between sm:p-7">
            <div className="flex items-start gap-4">
              <span className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-accent-500 text-white shadow-lg shadow-accent-500/30">
                <Rocket size={22} aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display text-xl font-bold text-white">Building a startup?</h3>
                <p className="mt-1 text-sm text-slate-300">Register it as a single entry, with no team to build.</p>
              </div>
            </div>
            <Link
              href="/startups"
              className="group inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-navy-900 transition hover:bg-brand-50"
            >
              See how startups register
              <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
            </Link>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
