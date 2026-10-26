"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState, type ReactNode } from "react";
import { Activity, Award, CalendarClock, ClipboardCheck, GraduationCap, Inbox, LayoutDashboard, LogOut, Menu, QrCode, Scale, ShieldCheck, Trophy, UserCheck, Users, X, type LucideIcon } from "lucide-react";
import { clubDepartment } from "@/lib/content";
import type { AdminUser } from "@/lib/admin-types";
import { useAuth } from "@/lib/auth/AuthProvider";
import { API_MODE } from "@/lib/auth/session";
import { Button } from "@/components/ui/Button";
import { Loading, Notice } from "@/components/ui/Notice";
import { Brand, KietLogo } from "./Brand";
import { attendanceEnabled } from "@/lib/features";
import { NotAuthorised } from "./NotAuthorised";

type Role = AdminUser["role"];
type NavItem = { href: string; label: string; Icon: LucideIcon; roles: Role[] };

const ORGANISERS: Role[] = ["super_admin", "admin", "outside_admin", "college_admin", "school_admin", "startup_admin"];

/** Sections of the sidebar. Items show only for the listed roles; "My judging" also for organisers who judge. */
const nav: { title: string; items: NavItem[] }[] = [
  {
    title: "Dashboard",
    items: [
      { href: "/", label: "Overview", Icon: LayoutDashboard, roles: ORGANISERS },
      { href: "/submissions", label: "Submissions", Icon: Inbox, roles: ORGANISERS },
      { href: "/activity", label: "Activity", Icon: Activity, roles: ORGANISERS },
    ],
  },
  {
    title: "Participants",
    items: [
      { href: "/teams", label: "Teams", Icon: Users, roles: ORGANISERS },
      { href: "/students", label: "Students", Icon: GraduationCap, roles: ORGANISERS },
    ],
  },
  {
    title: "Event",
    items: [
      { href: "/finalists", label: "Finalists", Icon: Trophy, roles: ["super_admin", "admin"] },
      { href: "/judging", label: "Judging", Icon: Scale, roles: ORGANISERS },
      { href: "/attendance-report", label: "Attendance report", Icon: UserCheck, roles: ["super_admin", "admin"] },
      { href: "/attendance", label: "Attendance", Icon: QrCode, roles: ORGANISERS },
      { href: "/judge", label: "My judging", Icon: ClipboardCheck, roles: ["judge"] },
      { href: "/certificates", label: "Certificates", Icon: Award, roles: ["super_admin"] },
      { href: "/schedule", label: "Schedule", Icon: CalendarClock, roles: ["super_admin"] },
    ],
  },
  {
    title: "Access",
    items: [{ href: "/admins", label: "Admins", Icon: ShieldCheck, roles: ["super_admin"] }],
  },
];

function visible(item: NavItem, admin: AdminUser) {
  // Attendance by event pass is switched off for now.
  if (item.href === "/attendance" && !attendanceEnabled) return false;
  // COE KIET has no department round, so its admin has no attendance to report.
  if (item.href === "/attendance-report" && admin.role === "admin" && admin.department === clubDepartment) return false;
  // COE KIET teams go straight to the Grand Finale, so their admin has no finalists to nominate.
  if (item.href === "/finalists" && admin.role === "admin" && admin.department === clubDepartment) return false;
  return item.roles.includes(admin.role) || (item.href === "/judge" && admin.judge === true);
}

function isActive(pathname: string, href: string) {
  // The static export uses trailing slashes ("/teams/"), so compare without them.
  const path = pathname.replace(/\/+$/, "") || "/";
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

function scopeLabel(admin: AdminUser) {
  switch (admin.role) {
    case "super_admin":
      return "Super admin · all participants";
    case "outside_admin":
      return "Admin · other colleges & schools";
    case "college_admin":
      return "Admin · other colleges";
    case "school_admin":
      return "Admin · schools";
    case "startup_admin":
      return "Admin · startups";
    case "judge":
      return "Judge";
    default:
      return `Admin · ${admin.department}`;
  }
}

function NavLinks({ admin, onNavigate }: { admin: AdminUser; onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="grid gap-5">
      {nav.map((section) => {
        const items = section.items.filter((item) => visible(item, admin));
        if (items.length === 0) return null;
        return (
          <div key={section.title}>
            <p className="px-4 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-white/40">{section.title}</p>
            <ul className="grid gap-0.5">
              {items.map(({ href, label, Icon }) => {
                const active = isActive(pathname, href);
                return (
                  <li key={href}>
                    <Link
                      href={href}
                      onClick={onNavigate}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-3 rounded-full px-4 py-2 text-sm font-semibold transition ${
                        active ? "bg-white text-navy-900" : "text-white/70 hover:bg-white/10 hover:text-white"
                      }`}
                    >
                      <Icon aria-hidden="true" className={`size-4 ${active ? "text-accent-500" : ""}`} />
                      {label}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

function Account({ admin, onSignOut }: { admin: AdminUser; onSignOut: () => void }) {
  return (
    <div className="border-t border-white/10 pt-4">
      <p className="truncate text-sm font-semibold text-white">{admin.name}</p>
      <p className="truncate text-xs text-white/55">{admin.email}</p>
      <p className="mt-2 text-[11px] font-semibold uppercase tracking-wider text-brand-300">{scopeLabel(admin)}</p>
      {API_MODE === "mock" && (
        <p className="mt-1 text-[11px] text-white/45">Mock data · changes stay in this browser</p>
      )}
      <button
        type="button"
        onClick={onSignOut}
        className="mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold text-white/75 ring-1 ring-inset ring-white/15 transition hover:bg-white/10 hover:text-white"
      >
        <LogOut aria-hidden="true" className="size-3.5" />
        Sign out
      </button>
    </div>
  );
}

function Frame({ admin, onSignOut, children }: { admin: AdminUser; onSignOut: () => void; children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="min-h-screen">
      <a href="#main" className="sr-only z-50 rounded-full bg-white px-4 py-2 text-sm font-semibold text-navy-900 focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>

      {/* Sidebar, large screens. It never moves with the page; only its link list scrolls, on short screens. */}
      <aside className="bg-grid fixed inset-y-0 left-0 z-30 hidden h-dvh w-64 flex-col bg-navy-950 py-5 lg:flex">
        <div className="shrink-0 px-4">
          <div className="rounded-2xl bg-white px-3 py-2.5">
            <KietLogo className="h-8 w-auto" />
          </div>
          <div className="mt-5 px-2">
            <Brand />
          </div>
        </div>
        <nav aria-label="Admin" className="sidebar-scroll mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-4">
          <NavLinks admin={admin} />
        </nav>
        <div className="shrink-0 px-4">
          <Account admin={admin} onSignOut={onSignOut} />
        </div>
      </aside>

      {/* Top bar and slide-down menu, below lg */}
      <header className="sticky top-0 z-30 bg-navy-950 lg:hidden">
        <div className="flex h-14 items-center justify-between gap-3 px-4">
          <Link href="/" onClick={closeMenu} aria-label="InnoTech26 admin overview">
            <Brand />
          </Link>
          <button
            type="button"
            onClick={() => setMenuOpen((open) => !open)}
            aria-expanded={menuOpen}
            aria-controls="panel-menu"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            className="inline-flex size-10 items-center justify-center rounded-full text-white transition hover:bg-white/10"
          >
            {menuOpen ? <X aria-hidden="true" className="size-5" /> : <Menu aria-hidden="true" className="size-5" />}
          </button>
        </div>
        <div
          id="panel-menu"
          hidden={!menuOpen}
          className="max-h-[calc(100vh-3.5rem)] overflow-y-auto border-t border-white/10 px-4 pb-5 pt-3"
        >
          <nav aria-label="Admin">
            <NavLinks admin={admin} onNavigate={closeMenu} />
          </nav>
          <div className="mt-4">
            <Account admin={admin} onSignOut={onSignOut} />
          </div>
        </div>
      </header>

      <main id="main" className="min-w-0 lg:pl-64">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-10 lg:py-9">{children}</div>
      </main>
    </div>
  );
}

/** Auth guard for every page in the (panel) route group, plus the navigation around them. */
export function PanelShell({ children }: { children: ReactNode }) {
  const { state, signOut, refresh } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  // Judges who are not organisers have one page.
  const judgeElsewhere = state.status === "signed_in" && state.admin.role === "judge" && !isActive(pathname, "/judge");
  useEffect(() => {
    if (judgeElsewhere) router.replace("/judge");
  }, [judgeElsewhere, router]);

  const signedOutReason = state.status === "signed_out" ? (state.reason ?? null) : undefined;
  useEffect(() => {
    if (signedOutReason === undefined) return;
    const next = `${window.location.pathname}${window.location.search}`;
    // After choosing "Sign out" there is nothing to come back to.
    router.replace(next === "/" || signedOutReason === "signed_out" ? "/login" : `/login?next=${encodeURIComponent(next)}`);
  }, [signedOutReason, router]);

  if (state.status === "signed_in" && !judgeElsewhere) {
    return (
      <Frame admin={state.admin} onSignOut={signOut}>
        {children}
      </Frame>
    );
  }

  if (state.status === "unauthorised") return <NotAuthorised email={state.email} message={state.message} onSignOut={signOut} />;

  if (state.status === "error") {
    return (
      <div className="mx-auto max-w-lg px-4 py-20">
        <Notice tone="error" title="Could not load your admin account" action={<Button size="sm" variant="secondary" onClick={refresh}>Try again</Button>}>
          {state.message}
        </Notice>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Loading label={state.status === "signed_out" ? "Redirecting to sign-in" : "Checking your session"} />
    </div>
  );
}
