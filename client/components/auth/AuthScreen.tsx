"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, CalendarDays, LoaderCircle, MapPin, RefreshCw, Ticket } from "lucide-react";
import { demoStudents } from "@/lib/api/demo";
import { ApiError } from "@/lib/api/types";
import { renderGoogleButton } from "@/lib/auth/google";
import { apiMode, devSignIn, devSignInEnabled, googleClientId, mockSignIn, sessionEnded, signInWithGoogle, useSession } from "@/lib/auth/session";
import { event, registrationSteps } from "@/lib/content";
import { normalisePath } from "@/lib/paths";
import { longDate } from "@/lib/format";
import { useExtendedNote, useRegistrationDates, useRegistrationState } from "@/lib/registration";
import { useRegistrationSentence } from "@/lib/schedule-content";
import { Button, Field, Input, Notice } from "@/components/ui/form";
import { MailLink } from "@/components/ui/MailLink";

/** Only allow returning to a page on this site, and not to the sign-in pages themselves. */
function safeNext(next: string | null) {
  // Browsers read "/\\host" and "/<tab>/host" as "//host", so backslashes, whitespace and control characters are refused too.
  if (!next || !/^\/(?![/\\])[^\\\s\u0000-\u001f]*$/.test(next)) return "/dashboard";
  // A signed-in student is sent straight on from /login, so returning there would loop.
  const path = normalisePath(next.split(/[?#]/)[0]).toLowerCase();
  if (path === "/login" || path === "/register" || path === "/auth" || path.startsWith("/auth/")) return "/dashboard";
  return next;
}

const facts = [
  { icon: MapPin, label: `Grand Finale ${event.finaleLabel}, KIET` },
  { icon: Ticket, label: "No registration fee" },
];

export function AuthScreen({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const session = useSession();
  const registration = useRegistrationState();
  const { opens, closes } = useRegistrationDates();
  const registrationSentence = useRegistrationSentence();
  const extendedNote = useExtendedNote();
  // Only after a client-side trip from the portal, so this never differs from the prerendered page.
  const [ended] = useState(sessionEnded);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Signed in, now or already: continue to the portal.
  useEffect(() => {
    if (session) router.replace(next);
  }, [session, next, router]);

  const onCredential = useCallback(async (credential: string) => {
    setError(null);
    setSigningIn(true);
    try {
      await signInWithGoogle(credential);
      // The effect above moves on once the session is stored.
    } catch (err) {
      setSigningIn(false);
      setError(err instanceof ApiError ? err.message : "Sign-in did not complete. Please try again.");
    }
  }, []);

  const isRegister = mode === "register";
  const googleAvailable = apiMode === "live" && googleClientId !== "";

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      {/* Brand panel */}
      <aside className="relative isolate overflow-hidden bg-navy-950 px-6 py-8 text-white sm:px-10 lg:py-12">
        <Image src="/images/kiet/campus-walkway.jpg" alt="" fill priority sizes="(min-width: 1024px) 45vw, 100vw" className="-z-20 object-cover" />
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-navy-950 via-navy-950/90 to-navy-900/70" />
        <div className="bg-grid absolute inset-0 -z-10" aria-hidden="true" />
        <div className="absolute -left-24 bottom-0 -z-10 h-72 w-72 rounded-full bg-brand-500/20 blur-3xl" aria-hidden="true" />

        <div className="flex h-full flex-col">
          <Link href="/" className="inline-flex w-fit items-center gap-2 text-sm font-semibold text-slate-300 transition hover:text-white">
            <ArrowLeft size={16} aria-hidden="true" />
            Back to home
          </Link>

          <div className="my-8 lg:my-auto">
            <Image src="/images/brand/innotech-lockup-light.png" alt="InnoTech26" width={529} height={202} priority className="w-full max-w-xs drop-shadow-[0_10px_40px_rgb(232_85_36/0.25)] sm:max-w-sm" />
            <p className="mt-6 max-w-md font-display text-xl font-bold leading-snug sm:text-2xl">
              Building an <span className="text-brand-400">Innovative</span>, <span className="text-brand-400">Secure</span> and{" "}
              <span className="text-brand-400">Sustainable</span> Viksit Bharat @2047
            </p>
            <ul className="mt-8 hidden space-y-3 sm:block">
              {[{ icon: CalendarDays, label: registrationSentence }, ...(extendedNote ? [{ icon: CalendarDays, label: extendedNote }] : []), ...facts].map(({ icon: FactIcon, label }) => (
                <li key={label} className="flex items-center gap-3 text-sm text-slate-300">
                  <FactIcon size={18} className="shrink-0 text-brand-400" aria-hidden="true" />
                  {label}
                </li>
              ))}
            </ul>
          </div>

          <p className="hidden text-xs text-slate-400 lg:block">{event.organiser}, KIET Deemed to be University</p>
        </div>
      </aside>

      {/* Sign-in panel */}
      <main className="flex items-center bg-white px-4 py-10 sm:px-10 lg:py-16">
        <div className="mx-auto w-full max-w-md">
          <p className="mb-3 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-[0.2em] text-accent-500">
            <span className="h-px w-6 bg-current" />
            {isRegister ? "Student registration" : "Student login"}
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight text-ink sm:text-4xl">
            {isRegister ? "Register for InnoTech26" : "Welcome back"}
          </h1>
          <p className="mt-3 text-muted">
            {isRegister
              ? "Every student signs in with Google and fills in a short profile. Your team leader can then add you to a team."
              : "Sign in with the Google account you registered with to see your team and invitations."}
          </p>

          {isRegister && (
            <ol className="mt-8 space-y-4">
              {registrationSteps.map((step, index) => (
                <li key={step.title} className="flex gap-4">
                  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-navy-900 text-xs font-bold text-white">{index + 1}</span>
                  <div>
                    <p className="font-semibold text-ink">{step.title}</p>
                    <p className="text-sm text-muted">{step.text}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}

          <div className="mt-8 space-y-4">
            {ended && !isRegister && (
              <Notice tone="info" title="Your session has ended">
                Please sign in again to continue. Anything you were typing has been kept.
              </Notice>
            )}
            {registration === "upcoming" && isRegister && (
              <Notice tone="info" title={`Registration opens on ${longDate(opens)} and closes on ${longDate(closes)}`}>
                You can sign in now, but profiles and teams can only be created once registration opens.
              </Notice>
            )}
            {registration === "closed" && (
              <Notice tone="warning" title="Registration has closed">
                New registrations are no longer accepted. Registered students can still sign in to see their team.
              </Notice>
            )}

            {googleAvailable ? (
              <GoogleSignIn context={isRegister ? "signup" : "signin"} busy={signingIn} onCredential={onCredential} />
            ) : (
              // Mock mode, or dev sign-in without a Google client ID: a stand-in for Google's button.
              <button
                type="button"
                disabled
                className="flex w-full cursor-not-allowed items-center justify-center gap-3 rounded-full border border-line bg-white px-6 py-3.5 font-semibold text-ink opacity-50 shadow-sm"
              >
                <GoogleMark />
                Continue with Google
              </button>
            )}
            {signingIn && (
              <p className="flex items-center justify-center gap-2 text-sm font-semibold text-navy-800" role="status">
                <LoaderCircle size={16} className="animate-spin text-accent-500" aria-hidden="true" />
                Signing you in...
              </p>
            )}
            {error && <Notice tone="error">{error}</Notice>}

            <p className="rounded-2xl bg-surface p-4 text-sm leading-relaxed text-muted">
              <span className="font-semibold text-ink">KIET students</span> must use their official{" "}
              <span className="font-semibold text-ink">@kiet.edu</span> account. Students from other colleges and schools can use any Google account.
            </p>

            {isRegister && (
              <p className="rounded-2xl bg-accent-50 p-4 text-sm leading-relaxed text-navy-800">
                <span className="font-semibold text-ink">Registering a startup?</span> Sign in with any Google account and slide to{" "}
                <span className="font-semibold text-ink">Startup</span> on the next step.
              </p>
            )}

            <p className="text-sm text-muted">
              {isRegister ? "Already registered? " : "New to InnoTech26? "}
              <Link href={isRegister ? "/login" : "/register"} className="font-semibold text-accent-600 hover:underline">
                {isRegister ? "Log in" : "Register"}
              </Link>
              {" · "}
              <Link href="/guidelines" className="font-semibold text-accent-600 hover:underline">
                Read the guidelines
              </Link>
            </p>
            <p className="text-sm text-muted">
              Trouble signing in? Write to <MailLink className="font-semibold text-accent-600 hover:underline" />
            </p>
          </div>

          {(apiMode === "mock" || devSignInEnabled) && <DevSignIn />}
        </div>
      </main>
    </div>
  );
}

/**
 * Google's own button, rendered by Google Identity Services into a container. Sign-in happens in a popup;
 * `onCredential` receives the ID token. If the script is blocked or the network is down, says so with a retry.
 */
function GoogleSignIn({ context, busy, onCredential }: { context: "signin" | "signup"; busy: boolean; onCredential: (credential: string) => void }) {
  const container = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  const [attempt, setAttempt] = useState(0);

  // Google keeps the first callback it is given, so forward to the latest handler through a ref.
  const handler = useRef(onCredential);
  useEffect(() => {
    handler.current = onCredential;
  }, [onCredential]);

  useEffect(() => {
    const parent = container.current;
    if (!parent) return;
    let cancelled = false;
    renderGoogleButton(parent, { clientId: googleClientId, context, handle: (credential) => handler.current(credential) })
      .then(() => !cancelled && setStatus("ready"))
      .catch(() => !cancelled && setStatus("failed"));
    return () => {
      cancelled = true;
    };
  }, [context, attempt]);

  return (
    <div>
      <div ref={container} aria-busy={busy} className={`flex min-h-11 justify-center ${busy ? "pointer-events-none opacity-50" : ""} ${status === "failed" ? "hidden" : ""}`} />
      {status === "loading" && (
        <p className="-mt-11 flex h-11 items-center justify-center gap-2 rounded-full border border-line text-sm text-muted" role="status">
          <LoaderCircle size={16} className="animate-spin" aria-hidden="true" />
          Loading Google sign-in...
        </p>
      )}
      {status === "failed" && (
        <div className="space-y-3">
          <Notice tone="error" title="Google sign-in could not load">
            Check your internet connection. If you use an ad or content blocker, allow accounts.google.com for this site, then try again.
          </Notice>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setStatus("loading");
              setAttempt((n) => n + 1);
            }}
          >
            <RefreshCw size={15} aria-hidden="true" />
            Try again
          </Button>
        </div>
      )}
    </div>
  );
}

/** Development only: sign in as a demo student instead of going through Google. */
function DevSignIn() {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);

  const signIn = async (student: { email: string; name: string }) => {
    setError(null);
    try {
      if (apiMode === "mock") mockSignIn(student);
      else await devSignIn(student);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed.");
    }
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (name.trim().length < 3) return setError("Enter a full name.");
    void signIn({ email, name });
  };

  return (
    <section aria-labelledby="dev-signin" className="mt-10 rounded-3xl border border-dashed border-accent-500/50 p-5">
      <h2 id="dev-signin" className="font-display text-base font-bold text-ink">
        Development sign-in
      </h2>
      <p className="mt-1 text-sm text-muted">
        {apiMode === "mock"
          ? "Google sign-in is replaced by demo accounts until the backend is connected."
          : "Signs in through the local backend's development tokens instead of Google."}
      </p>
      <ul className="mt-4 divide-y divide-line">
        {demoStudents.map((student) => (
          <li key={student.email}>
            <button
              type="button"
              onClick={() => void signIn(student)}
              className="flex w-full items-center justify-between gap-3 py-2.5 text-left transition hover:text-accent-600"
            >
              <span>
                <span className="block text-sm font-semibold">{student.name}</span>
                <span className="block text-xs text-muted">{student.note}</span>
              </span>
              <span className="shrink-0 text-xs font-semibold text-accent-600">Sign in</span>
            </button>
          </li>
        ))}
      </ul>

      <form onSubmit={onSubmit} noValidate className="mt-4 space-y-3 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink">Or use any email</p>
        <Field id="dev-name" label="Full name">
          <Input id="dev-name" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field id="dev-email" label="Email" error={error}>
          <Input id="dev-email" type="email" value={email} invalid={!!error} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        </Field>
        <Button type="submit" variant="dark" size="sm">
          Sign in
        </Button>
      </form>
    </section>
  );
}

function GoogleMark() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}
