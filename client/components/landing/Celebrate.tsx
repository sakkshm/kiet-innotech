"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

/** Colours of the confetti: the logo's orange and charcoal, with gold, a light orange and a soft grey. */
const COLORS = ["#e85524", "#292b38", "#fbbf24", "#f7a07a", "#a3a6b8"];

// Fixed, not random, so server and browser render the same thing: 18 pieces fanned out around the trophy.
const PIECES = Array.from({ length: 18 }, (_, i) => {
  const angle = (i / 18) * Math.PI * 2 + (i % 2 ? 0.12 : -0.08);
  const reach = 130 + (i % 3) * 30;
  return {
    dx: Math.round(Math.cos(angle) * reach),
    // Pieces fly up and out, then drift down a little: gravity.
    dy: Math.round(Math.sin(angle) * reach + 34),
    rotate: (i % 2 ? 1 : -1) * (160 + i * 23),
    color: COLORS[i % COLORS.length],
    round: i % 3 === 0,
    delay: (i % 6) * 35,
  };
});

const SPARKLES = [
  { left: "-6%", top: "8%", delay: "0s", size: 14 },
  { left: "98%", top: "2%", delay: "0.9s", size: 18 },
  { left: "104%", top: "62%", delay: "1.8s", size: 12 },
  { left: "-10%", top: "70%", delay: "1.3s", size: 16 },
  { left: "50%", top: "-12%", delay: "2.3s", size: 12 },
];

/**
 * A quiet celebration around its child (the finale's trophy): a warm glow, a few sparkles that twinkle, and one burst of
 * confetti when it first scrolls into view. Touching or hovering it throws the confetti again.
 * All of it stops for visitors who prefer reduced motion (see globals.css).
 */
export function Celebrate({
  children,
  scale = 1,
  glow = true,
  className = "relative isolate inline-flex",
  style,
}: {
  children: ReactNode;
  scale?: number;
  /** A warm glow behind the child; turn off when the child already sits in one. */
  glow?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const ref = useRef<HTMLDivElement>(null);
  // 0 = not yet, then 1, 2, ... for each burst; the number is the piece key so the animation restarts.
  const [burst, setBurst] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setBurst((n) => n || 1);
          observer.disconnect();
        }
      },
      { threshold: 0.6 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      className={className}
      style={{ ...style, "--s": scale } as React.CSSProperties}
      onPointerEnter={() => setBurst((n) => (n ? n + 1 : 0))}
    >
      {glow && (
        <span className="animate-glow pointer-events-none absolute -z-10 inset-[-18%] rounded-full bg-[radial-gradient(circle,rgb(251_191_36/0.45),rgb(232_85_36/0.16)_55%,transparent_72%)]" aria-hidden="true" />
      )}
      {children}
      <span className="pointer-events-none absolute inset-0" aria-hidden="true">
        {SPARKLES.map((sparkle, i) => (
          <svg
            key={i}
            viewBox="0 0 24 24"
            className="animate-twinkle absolute text-amber-400"
            style={{ left: sparkle.left, top: sparkle.top, width: sparkle.size * scale, height: sparkle.size * scale, animationDelay: sparkle.delay }}
            fill="currentColor"
          >
            <path d="M12 0c.9 6.2 5.8 11.1 12 12-6.2.9-11.1 5.8-12 12-.9-6.2-5.8-11.1-12-12C6.2 11.1 11.1 6.2 12 0Z" />
          </svg>
        ))}
        {burst > 0 &&
          PIECES.map((piece, i) => (
            <span
              key={`${burst}-${i}`}
              className="animate-confetti absolute left-1/2 top-1/2 block"
              style={
                {
                  "--dx": `${piece.dx * scale}px`,
                  "--dy": `${piece.dy * scale}px`,
                  "--rot": `${piece.rotate}deg`,
                  width: (piece.round ? 9 : 8) * scale,
                  height: (piece.round ? 9 : 14) * scale,
                  borderRadius: piece.round ? "9999px" : 2,
                  background: piece.color,
                  animationDelay: `${piece.delay}ms`,
                } as React.CSSProperties
              }
            />
          ))}
      </span>
    </div>
  );
}
