import Image from "next/image";
import { ArrowRight } from "lucide-react";
import { about, aboutHighlights, event } from "@/lib/content";
import { Icon } from "@/components/ui/Icon";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { tones } from "./tones";

export function About() {
  const [lead, ...rest] = about.paragraphs;
  return (
    <Section id="about" className="pt-24 sm:pt-32">
      <div className="grid items-center gap-12 lg:grid-cols-2 lg:gap-16">
        <div>
          <SectionHeading eyebrow="About the event" title={about.title} align="left" />
          <Reveal delay={100}>
            {/* One clear sentence first, then the detail, then the facts as cards. */}
            <p className="text-lg font-medium leading-relaxed text-navy-800 sm:text-xl">{lead}</p>
            {rest.map((paragraph) => (
              <p key={paragraph} className="mt-4 text-base leading-relaxed text-muted">
                {paragraph}
              </p>
            ))}

            <ul className="mt-8 grid gap-3 sm:grid-cols-2">
              {aboutHighlights.map((item) => {
                const tone = tones[item.tone];
                return (
                  <li
                    key={item.title}
                    className="group flex gap-3.5 rounded-2xl border border-line bg-white p-4 transition duration-300 hover:-translate-y-0.5 hover:border-transparent hover:shadow-[0_18px_40px_-22px_rgb(41_43_56/0.35)]"
                  >
                    <span className={`flex size-11 shrink-0 items-center justify-center rounded-xl transition duration-300 group-hover:scale-110 group-hover:-rotate-6 ${tone.badge}`}>
                      <Icon name={item.icon} className="size-5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-display text-sm font-bold text-navy-900">{item.title}</span>
                      <span className="mt-0.5 block text-sm leading-snug text-muted">{item.text}</span>
                    </span>
                  </li>
                );
              })}
            </ul>

            <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-3">
              <a href="#timeline" className="group inline-flex items-center gap-2 text-sm font-bold text-brand-700 hover:text-brand-600">
                See how it works
                <ArrowRight size={16} className="transition-transform group-hover:translate-x-1" aria-hidden="true" />
              </a>
              <p className="text-sm text-muted">
                Organised by the <span className="font-semibold text-navy-800">{event.organiser}</span>
              </p>
            </div>
          </Reveal>
        </div>

        {/* Photo collage: last year's fest */}
        <Reveal delay={150} className="relative">
          <div className="grid grid-cols-2 gap-3 sm:gap-4">
            <figure className="relative col-span-2 aspect-[16/10] overflow-hidden rounded-3xl shadow-[0_24px_50px_-28px_rgb(41_43_56/0.45)]">
              <Image
                src="/images/innotech25/crew.webp"
                alt="The InnoTech'25 volunteers and organisers on stage"
                fill
                sizes="(min-width: 1024px) 38vw, 100vw"
                className="object-cover transition-transform duration-700 hover:scale-105"
              />
            </figure>
            <figure className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-[0_20px_40px_-26px_rgb(41_43_56/0.4)]">
              <Image
                src="/images/innotech25/winners.webp"
                alt="A winning team at InnoTech'25 with their prize cheque"
                fill
                sizes="(min-width: 1024px) 19vw, 50vw"
                className="object-cover object-[50%_70%] transition-transform duration-700 hover:scale-105"
              />
            </figure>
            <figure className="relative aspect-[4/3] overflow-hidden rounded-3xl shadow-[0_20px_40px_-26px_rgb(41_43_56/0.4)]">
              <Image
                src="/images/innotech25/innogeeks.webp"
                alt="The Innogeeks team at their stall at InnoTech'25"
                fill
                sizes="(min-width: 1024px) 19vw, 50vw"
                className="object-cover transition-transform duration-700 hover:scale-105"
              />
            </figure>
          </div>
          <div className="absolute -left-3 -top-4 rounded-2xl bg-navy-900 px-5 py-3 text-white shadow-xl sm:-left-5">
            <p className="font-display text-xl font-bold leading-none text-brand-400">InnoTech&apos;25</p>
            <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-slate-300">Last year, 14 Nov 2025</p>
          </div>
        </Reveal>
      </div>
    </Section>
  );
}
