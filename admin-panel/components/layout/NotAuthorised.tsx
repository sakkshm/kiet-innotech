import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { KietLogo } from "./Brand";

/** Shown when the signed-in account is not (or is no longer) on the admin list. `message` is the server's explanation. */
export function NotAuthorised({ email, message, onSignOut }: { email: string | null; message?: string; onSignOut: () => void }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-12">
      <section aria-labelledby="not-authorised-title" className="w-full max-w-md rounded-2xl bg-white p-6 ring-1 ring-line sm:p-8">
        <KietLogo className="h-9 w-auto" />
        <div className="mt-6 flex items-center gap-2 text-red-700">
          <ShieldAlert aria-hidden="true" className="size-5" />
          <p className="text-xs font-semibold uppercase tracking-[0.16em]">Access denied</p>
        </div>
        <h1 id="not-authorised-title" className="mt-2 font-display text-2xl font-bold text-navy-900">
          You are not authorised to use the admin panel
        </h1>
        <p className="mt-3 text-sm text-muted">
          {email ? (
            <>
              <span className="font-semibold break-all text-navy-900">{email}</span> is signed in, but it is not on the InnoTech26 admin list.
            </>
          ) : (
            "Your account is not on the InnoTech26 admin list."
          )}{" "}
          If you are an organiser, ask the super admin to add this email. Students should use the student portal instead.
        </p>
        {message && (
          <p className="mt-3 border-l-4 border-red-500 bg-red-50 px-3 py-2 text-sm text-red-800">{message}</p>
        )}
        <div className="mt-6 flex flex-wrap gap-2">
          <Button onClick={onSignOut}>Sign in with another account</Button>
        </div>
      </section>
    </main>
  );
}
