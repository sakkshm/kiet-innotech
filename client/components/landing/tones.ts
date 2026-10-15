import type { Tone } from "@/lib/content";

/**
 * Colour families for the landing diagrams, from the InnoTech'26 logo: its orange ("flame") and charcoal, with gold
 * and a warm stone grey for variety. Full class strings (not built from parts) so Tailwind can find them; `stroke`
 * colours the SVG connector lines and `wash` tints a white card.
 */
export const tones: Record<Tone, { card: string; badge: string; title: string; stroke: string; wash: string }> = {
  flame: { card: "bg-brand-50 border-brand-100", badge: "bg-brand-100 text-brand-600", title: "text-brand-700", stroke: "#f07a48", wash: "from-brand-50" },
  charcoal: { card: "bg-surface border-line", badge: "bg-navy-900/10 text-navy-900", title: "text-navy-900", stroke: "#4a4e61", wash: "from-navy-900/[0.06]" },
  gold: { card: "bg-amber-50 border-amber-100", badge: "bg-amber-100 text-amber-700", title: "text-amber-800", stroke: "#f5a524", wash: "from-amber-50" },
  stone: { card: "bg-stone-50 border-stone-200", badge: "bg-stone-200/70 text-stone-700", title: "text-stone-800", stroke: "#a8a29e", wash: "from-stone-100/80" },
};
