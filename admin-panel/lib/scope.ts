/**
 * What an organiser's role lets them see. Mirrors the server (services/admin.py): super admins see everything,
 * department admins one KIET department (COE KIET is one), outside admins other colleges and schools, college admins
 * other colleges only, school admins schools only, startup admins only startups.
 */
import type { AdminRole, AdminUser } from "./admin-types";
import type { ParticipantType } from "./types";

const ROLE_TYPES: Partial<Record<AdminRole, ParticipantType[]>> = {
  outside_admin: ["college", "school"],
  college_admin: ["college"],
  school_admin: ["school"],
  startup_admin: ["startup"],
};

const ROLE_SCOPE_NAMES: Partial<Record<AdminRole, string>> = {
  outside_admin: "Other colleges and schools",
  college_admin: "Other colleges",
  school_admin: "Schools",
  startup_admin: "Startups",
};

/** Outside, college, school and startup admins are limited to certain participant types rather than to a department. */
export function isTypeAdmin(admin: Pick<AdminUser, "role">) {
  return scopedTypes(admin) !== null;
}

/** Admins for other colleges and/or schools. */
export function isOutsideAdmin(admin: Pick<AdminUser, "role">) {
  return admin.role === "outside_admin" || admin.role === "college_admin" || admin.role === "school_admin";
}

/** The participant types a type-limited admin sees; null for super and department admins. */
export function scopedTypes(admin: Pick<AdminUser, "role">): ParticipantType[] | null {
  return admin.role === "judge" ? null : (ROLE_TYPES[admin.role] ?? null);
}

/** The short name of what the admin manages, for page eyebrows. */
export function scopeName(admin: Pick<AdminUser, "role" | "department">) {
  if (admin.role === "super_admin") return "All departments, colleges, schools and startups";
  const typed = admin.role === "judge" ? undefined : ROLE_SCOPE_NAMES[admin.role];
  return typed ?? `${admin.department} department`;
}
