import Image from "next/image";

const sponsors = [
  { name: "IEEE Student Branch KIET", src: "/images/sponsors/ieee-student-branch-kiet.png", width: 427, height: 200, logo: "h-12 sm:h-[4.5rem]" },
  { name: "ACM", src: "/images/sponsors/acm.png", width: 200, height: 200, logo: "h-12 sm:h-[4.5rem]" },
  { name: "KIET Technology Business Incubator, Ghaziabad", src: "/images/sponsors/kiet-tbi.png", width: 266, height: 240, logo: "h-12 sm:h-[4.5rem]" },
];

/** The hero's closing strip: who technically co-sponsors InnoTech26. The logos are made for white, so each sits on its own white tile. */
export function SponsoredBy({ className = "" }: { className?: string }) {
  return (
    <div className={`animate-fade-up [animation-delay:720ms] ${className}`}>
      <div className="border-t border-white/10 pt-8">
        <p className="flex items-center justify-center gap-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-400 sm:tracking-[0.25em]">
          <span className="hidden h-px w-8 bg-white/20 sm:block sm:w-14" aria-hidden="true" />
          <span className="text-balance text-center">Technically Co-sponsored by</span>
          <span className="hidden h-px w-8 bg-white/20 sm:block sm:w-14" aria-hidden="true" />
        </p>
        <ul className="mt-5 flex flex-wrap items-stretch justify-center gap-3 sm:gap-4">
          {sponsors.map((sponsor) => (
            <li
              key={sponsor.name}
              className="flex h-[4.5rem] items-center justify-center rounded-2xl bg-white px-4 shadow-lg shadow-black/25 ring-1 ring-white/30 transition duration-300 hover:-translate-y-0.5 hover:shadow-xl sm:h-28 sm:px-9"
            >
              <Image src={sponsor.src} alt={sponsor.name} width={sponsor.width} height={sponsor.height} className={`${sponsor.logo} w-auto`} />
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
