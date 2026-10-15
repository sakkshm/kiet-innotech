import Image from "next/image";
import { Globe, Mail, MapPin, Navigation } from "lucide-react";
import { event, navLinks } from "@/lib/content";

/** `linkBase` is "/" on pages other than the home page, so section links point back to it. */
export function SiteFooter({ linkBase = "" }: { linkBase?: string }) {
  return (
    <footer className="relative overflow-hidden bg-navy-950 text-slate-300">
      <div className="bg-grid absolute inset-0" aria-hidden="true" />

      <div className="relative mx-auto max-w-7xl px-4 pt-14 sm:px-6 lg:px-8">
        <div id="contact" className="flex scroll-mt-24 flex-col gap-5 rounded-3xl bg-white/[0.06] p-6 ring-1 ring-white/15 sm:flex-row sm:items-center sm:justify-between sm:p-8">
          <div className="flex items-start gap-4">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl bg-accent-500 text-white shadow-lg shadow-accent-500/30">
              <Mail size={22} aria-hidden="true" />
            </span>
            <div>
              <h2 className="font-display text-xl font-bold text-white sm:text-2xl">Questions or requests?</h2>
              <p className="mt-1 max-w-xl text-sm leading-relaxed text-slate-300">
                Write to the organising team. Use the email you registered with and mention your team code, so we can help you quickly.
              </p>
            </div>
          </div>
          <a
            href={`mailto:${event.email}`}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-accent-500 px-6 py-3.5 text-base font-bold text-white shadow-lg shadow-accent-500/30 transition hover:bg-accent-600 [overflow-wrap:anywhere] sm:text-lg"
          >
            {event.email}
          </a>
        </div>
      </div>

      <div className="relative mx-auto grid max-w-7xl gap-12 px-4 py-16 sm:px-6 md:grid-cols-2 lg:grid-cols-[1.3fr_1fr_1.4fr] lg:px-8">
        <div>
          <Image
            src="/images/brand/innotech-wordmark-light.png"
            alt="InnoTech26"
            width={529}
            height={144}
            className="h-16 w-auto"
          />
          <p className="mt-5 max-w-sm text-sm leading-relaxed">
            {event.theme}. Organised by the {event.organiser}, KIET Deemed to be University.
          </p>
          <ul className="mt-6 space-y-3 text-sm">
            <li className="flex gap-3">
              <MapPin size={18} className="mt-0.5 shrink-0 text-brand-400" aria-hidden="true" />
              {event.address}
            </li>
            <li className="flex gap-3">
              <Globe size={18} className="shrink-0 text-brand-400" aria-hidden="true" />
              {event.website}
            </li>
          </ul>
        </div>

        <nav aria-label="Footer">
          <h2 className="font-display text-base font-bold text-white">Quick links</h2>
          <ul className="mt-5 grid grid-cols-2 gap-3 text-sm">
            {navLinks.map((link) => (
              <li key={link.href}>
                {/* The footer is the Contact section, so its own link opens an email instead of scrolling nowhere. */}
                <a
                  href={link.href === "#contact" ? `mailto:${event.email}` : `${linkBase}${link.href}`}
                  className="transition-colors hover:text-brand-400"
                >
                  {link.label}
                </a>
              </li>
            ))}
            <li>
              <a href="/startups" className="transition-colors hover:text-brand-400">Startups</a>
            </li>
            <li>
              <a href="/register" className="transition-colors hover:text-brand-400">Register</a>
            </li>
            <li>
              <a href="/login" className="transition-colors hover:text-brand-400">Login</a>
            </li>
          </ul>
        </nav>

        <div className="md:col-span-2 lg:col-span-1">
          <h2 className="font-display text-base font-bold text-white">Find us</h2>
          <div className="relative mt-5 h-52 overflow-hidden rounded-2xl ring-1 ring-white/10">
            <iframe
              src={event.mapEmbedUrl}
              title="KIET campus location on Google Maps"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              className="h-full w-full border-0 grayscale-[30%]"
            />
            <a
              href={event.mapUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full bg-accent-500 px-4 py-2 text-xs font-semibold text-white shadow-lg transition hover:bg-accent-600"
            >
              <Navigation size={14} aria-hidden="true" />
              Directions
            </a>
          </div>
        </div>
      </div>

      <div className="relative border-t border-white/10">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 px-4 py-6 text-center text-xs sm:flex-row sm:px-6 sm:text-left lg:px-8">
          <p>Copyright {new Date().getFullYear()} KIET Deemed to be University. All rights reserved.</p>
          <p>Delhi-NCR, Ghaziabad, Uttar Pradesh</p>
        </div>
      </div>
    </footer>
  );
}
