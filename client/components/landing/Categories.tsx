"use client";

import { useState } from "react";
import { categories, type Category } from "@/lib/content";
import { Reveal } from "@/components/ui/Reveal";
import { Section, SectionHeading } from "@/components/ui/Section";
import { Slider } from "@/components/ui/Slider";

const filters: { label: string; match: (category: Category) => boolean }[] = [
  { label: "All", match: () => true },
  { label: "Projects", match: (category) => !category.isPoster },
  { label: "Posters", match: (category) => category.isPoster },
];

export function Categories() {
  const [activeFilter, setActiveFilter] = useState(filters[0].label);
  const { match } = filters.find((filter) => filter.label === activeFilter) ?? filters[0];

  return (
    <Section id="categories" className="bg-surface">
      <SectionHeading
        eyebrow="Eight categories"
        title="Pick the category that fits your idea"
        description="Each team registers for exactly one category. Sub-topics are guidelines, and new ideas are always welcome."
      />

      <div role="group" aria-label="Filter categories" className="mb-6 flex flex-wrap justify-center gap-2 md:mb-10">
        {filters.map((filter) => {
          const isActive = filter.label === activeFilter;
          return (
            <button
              key={filter.label}
              type="button"
              aria-pressed={isActive}
              onClick={() => setActiveFilter(filter.label)}
              className={`rounded-full px-5 py-2 text-sm font-semibold transition ${
                isActive
                  ? "bg-navy-900 text-white shadow-lg shadow-navy-900/20"
                  : "bg-white text-navy-800 ring-1 ring-line hover:ring-navy-800/30"
              }`}
            >
              {filter.label}
            </button>
          );
        })}
      </div>

      {/* Keyed by the filter, so a new filter starts the phone slider at its first card. */}
      <Slider
        key={activeFilter}
        label="Categories"
        gridClassName="md:grid-cols-2 md:gap-5 lg:grid-cols-4"
        slides={categories.filter(match).map((category, index) => ({
          key: String(category.number),
          className: "flex",
          content: (
            <Reveal delay={(index % 4) * 80} className="flex w-full">
              <CategoryCard category={category} />
            </Reveal>
          ),
        }))}
      />
    </Section>
  );
}

function CategoryCard({ category }: { category: Category }) {
  return (
    <article className="group relative flex h-full w-full flex-col overflow-hidden rounded-3xl border border-line bg-white p-6 transition duration-300 hover:-translate-y-1 hover:shadow-[0_24px_48px_-24px_rgb(41_43_56/0.35)]">
      {/* Accent bar that grows on hover */}
      <span
        className={`absolute inset-x-0 top-0 h-1 origin-left scale-x-0 transition-transform duration-500 group-hover:scale-x-100 ${
          category.isPoster ? "bg-accent-500" : "bg-brand-500"
        }`}
        aria-hidden="true"
      />

      <span className="mb-5 block font-display text-5xl font-bold leading-none text-navy-900/10 transition-colors group-hover:text-brand-500/30">
        {String(category.number).padStart(2, "0")}
      </span>

      <p className="text-xs font-bold uppercase tracking-widest text-muted">Category {category.number}</p>
      <h3 className="mt-1 font-display text-xl font-bold leading-snug text-ink">{category.title}</h3>
      <p className="mt-2 text-sm text-muted">{category.summary}</p>

      <ul className="mt-5 space-y-2 border-t border-line pt-5">
        {category.topics.map((topic) => (
          <li key={topic} className="flex gap-2 text-sm text-navy-800">
            <span
              className={`mt-2 h-1.5 w-1.5 shrink-0 rounded-full ${
                category.isPoster ? "bg-accent-500" : "bg-brand-500"
              }`}
              aria-hidden="true"
            />
            {topic}
          </li>
        ))}
      </ul>
    </article>
  );
}
