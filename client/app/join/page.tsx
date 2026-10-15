"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";
import { LoaderCircle } from "lucide-react";
import { getSession } from "@/lib/auth/session";
import { savePendingJoinCode } from "@/lib/invite";
import { normaliseJoinCode } from "@/lib/rules";
import { buttonStyles } from "@/components/ui/form";

/**
 * Where a shared invite link lands: /join/?code=K7PQ-3XM9. Remembers the code, then sends the student to their
 * team page (signing in and completing the profile on the way if needed), where the join form is filled in.
 */
export default function JoinPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface px-4">
      <Suspense fallback={<Opening />}>
        <OpenInvite />
      </Suspense>
    </main>
  );
}

function OpenInvite() {
  const router = useRouter();
  const code = normaliseJoinCode(useSearchParams().get("code") ?? "");

  useEffect(() => {
    if (!code) return;
    savePendingJoinCode(code);
    router.replace(getSession() ? "/team/" : `/register/?next=${encodeURIComponent("/team/")}`);
  }, [code, router]);

  if (code) return <Opening />;
  return (
    <div className="max-w-md rounded-3xl bg-white p-8 text-center shadow-[0_20px_50px_-20px_rgb(41_43_56/0.25)] ring-1 ring-line">
      <h1 className="font-display text-2xl font-bold text-ink">This invite link is incomplete</h1>
      <p className="mt-3 text-muted">
        Ask your team leader to send it again, or sign in and enter the 8-character team code they shared, e.g. K7PQ-3XM9.
      </p>
      <Link href="/team/" className={`${buttonStyles("primary")} mt-6`}>
        Go to my team page
      </Link>
    </div>
  );
}

function Opening() {
  return (
    <p className="flex items-center gap-3 text-muted" role="status">
      <LoaderCircle size={20} className="animate-spin" aria-hidden="true" />
      Opening your team invite…
    </p>
  );
}
