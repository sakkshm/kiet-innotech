"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight, LoaderCircle, LockKeyhole } from "lucide-react";
import { demoAdmins } from "@/lib/api/demo-admins";
import { errorMessage } from "@/lib/api";
import { useAuth } from "@/lib/auth/AuthProvider";
import { GOOGLE_CLIENT_ID } from "@/lib/auth/google";
import { API_MODE, DEV_SIGN_IN } from "@/lib/auth/session";
import { googleSignIn, safeNext } from "@/lib/auth/sign-in";
import { event, timeline } from "@/lib/content";
import { Loading, Notice } from "@/components/ui/Notice";
import { Brand, KietLogo } from "@/components/layout/Brand";
import { NotAuthorised } from "@/components/layout/NotAuthorised";
import { GoogleButton } from "./GoogleButton";

const demoAccounts = [
  ...demoAdmins.map((admin) => ({
    email: admin.email,
    name: admin.name,
    scope: admin.role === "super_admin" ? "Super admin · all departments, colleges and schools" : `Department admin · ${admin.department}`,
  })),
  { email: "rohan.verma42@gmail.com", name: "Rohan Verma", scope: "Not an admin · shows the access denied screen" },
];

export function LoginView() {
  const { state, refresh, signInAsDemo, signOut } = useAuth();
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  useEffect(() => {
    if (state.status === "signed_in") router.replace(next);
  }, [state.status, next, router]);

  if (state.status === "unauthorised") {
    return (
      <NotAuthorised
        email={state.email}
        message={state.message}
        onSignOut={() => {
          setPending(null);
          signOut();
        }}
      />
    );
  }

  /** Google returned an ID token: exchange it for our session, then /admin/me decides where to go. */
  async function google(credential: string) {
    setError(null);
    setPending("google");
    try {
      await googleSignIn(credential);
      setPending(null);
      refresh();
    } catch (err) {
      // e.g. 403 "not an organiser" from the server.
      setError(errorMessage(err));
      setPending(null);
    }
  }

  const finale = timeline[timeline.length - 1];
  const busy = state.status === "loading" || state.status === "signed_in" || pending === "google";

  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
      <section className="bg-grid relative flex flex-col justify-between gap-10 bg-navy-950 px-6 py-8 text-white sm:px-10 lg:py-12">
        <Brand subtitle="Organiser panel" />
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-brand-300">Organisers only</p>
          <h1 className="mt-3 font-display text-3xl font-bold leading-tight sm:text-4xl">
            Registrations, teams and finalists for {event.name}
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-white/70">
            Department admins see their own department&apos;s teams and students and nominate its finalists. The super
            admin sees every department, other colleges and schools, and publishes results.
          </p>
        </div>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-white/10 text-sm">
          <div className="bg-navy-950/80 px-4 py-3">
            <dt className="text-white/50">Registration</dt>
            <dd className="mt-0.5 font-semibold">3 – 15 Oct 2026</dd>
          </div>
          <div className="bg-navy-950/80 px-4 py-3">
            <dt className="text-white/50">{finale.title}</dt>
            <dd className="mt-0.5 font-semibold">{finale.dateLabel}</dd>
          </div>
        </dl>
      </section>

      <section className="flex items-center justify-center bg-white px-4 py-10 sm:px-10">
        <div className="w-full max-w-md">
          <KietLogo className="h-10 w-auto" />
          <h2 className="mt-8 font-display text-2xl font-bold text-navy-900">Sign in to the admin panel</h2>
          <p className="mt-2 text-sm text-muted">
            Use the Google account your coordinator registered as an admin. Student accounts cannot sign in here.
          </p>

          {state.status === "loading" && pending === null ? (
            <Loading label="Checking your session" />
          ) : (
            <div className="mt-7 space-y-6">
              {error && <Notice tone="error">{error}</Notice>}
              {state.status === "error" && <Notice tone="error">{state.message}</Notice>}
              {state.status === "signed_out" && state.reason === "expired" && !error && (
                <Notice tone="info">Your session has ended. Sign in again to continue.</Notice>
              )}

              {API_MODE === "live" && !DEV_SIGN_IN ? (
                GOOGLE_CLIENT_ID ? (
                  <div className="space-y-3">
                    <GoogleButton onCredential={google} busy={busy} />
                    {pending === "google" && <Loading label="Signing you in" />}
                  </div>
                ) : (
                  <Notice tone="warning">Google sign-in is not configured. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.</Notice>
                )
              ) : (
                <div>
                  <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-600">
                    <LockKeyhole aria-hidden="true" className="size-3.5" />
                    Development sign-in
                  </div>
                  <p className="mt-1.5 text-sm text-muted">
                    {DEV_SIGN_IN ? (
                      "Signs in through the local backend's development tokens instead of Google."
                    ) : (
                      <>
                        Mock mode (<code className="text-xs">NEXT_PUBLIC_API_MODE=mock</code>). Live builds sign in with Google.
                      </>
                    )}
                  </p>
                  <ul className="mt-4 divide-y divide-line border-y border-line">
                    {demoAccounts.map((account) => (
                      <li key={account.email}>
                        <button
                          type="button"
                          disabled={busy}
                          aria-busy={pending === account.email || undefined}
                          onClick={() => {
                            setPending(account.email);
                            signInAsDemo(account.email, account.name);
                          }}
                          className="group flex w-full items-center gap-3 px-1 py-3 text-left transition hover:bg-surface disabled:cursor-wait disabled:opacity-60"
                        >
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-semibold text-navy-900">{account.name}</span>
                            <span className="block truncate text-xs text-muted">{account.email}</span>
                            <span className="mt-0.5 block text-xs font-medium text-brand-700">{account.scope}</span>
                          </span>
                          {pending === account.email && busy ? (
                            <LoaderCircle aria-hidden="true" className="size-4 shrink-0 animate-spin text-brand-500" />
                          ) : (
                            <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted transition group-hover:translate-x-0.5 group-hover:text-accent-500" />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                  <div className={`mt-4 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted ${DEV_SIGN_IN ? "hidden" : ""}`}>
                    <button
                      type="button"
                      onClick={() => {
                        if (process.env.NEXT_PUBLIC_API_MODE !== "mock") return;
                        import("@/lib/api/mock").then((mock) => {
                          mock.resetMockData();
                          setResetDone(true);
                        });
                      }}
                      className="font-semibold text-navy-800 underline underline-offset-2 hover:text-accent-600"
                    >
                      Reset demo data
                    </button>
                    {resetDone && <span role="status">Demo data restored to the original seed.</span>}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
