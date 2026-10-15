import { stats } from "@/lib/content";
import { CountUp } from "@/components/ui/CountUp";
import { Reveal } from "@/components/ui/Reveal";

export function Stats() {
  return (
    <section aria-label="Event in numbers" className="relative z-10 -mt-10 px-4 sm:px-6 lg:px-8">
      {/* gap-px over a line-coloured background draws the dividers between cells */}
      <Reveal className="mx-auto grid max-w-6xl grid-cols-2 gap-px overflow-hidden rounded-3xl border border-line bg-line shadow-[0_20px_60px_-20px_rgb(41_43_56/0.25)] sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            className={`bg-white px-4 py-6 text-center sm:py-8 ${
              index === stats.length - 1 ? "col-span-2 lg:col-span-1" : ""
            }`}
          >
            <div className="font-display text-3xl font-bold text-navy-900 sm:text-4xl">
              <CountUp value={stat.value} prefix={stat.prefix} suffix={stat.suffix} format={stat.format} />
            </div>
            <div className="mt-1 text-xs font-semibold uppercase tracking-widest text-muted sm:text-sm">
              {stat.label}
            </div>
          </div>
        ))}
      </Reveal>
    </section>
  );
}
