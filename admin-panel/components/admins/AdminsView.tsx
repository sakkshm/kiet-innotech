"use client";

import { useState, type FormEvent } from "react";
import { ShieldAlert, UserPlus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import { CONFIGURED_BY_SERVER, type AdminRole, type AdminUser } from "@/lib/admin-types";
import { useAdmin } from "@/lib/auth/AuthProvider";
import { departmentLabel, departments } from "@/lib/content";
import { formatDate, roleLabels } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button, ButtonLink } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { PageHeader, SectionTitle } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { TableFrame, tdClass, Th } from "@/components/ui/Table";

type FormErrors = Partial<Record<"email" | "name" | "department", string>>;

function AddAdminForm({ onAdded }: { onAdded: (admin: AdminUser) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [role, setRole] = useState<AdminRole>("admin");
  const [department, setDepartment] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const next: FormErrors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = "Enter a valid email address.";
    if (name.trim().length < 2) next.name = "Enter the admin's name.";
    if (role === "admin" && !department) next.department = "Choose the department this admin manages.";
    setErrors(next);
    setError(null);
    if (Object.keys(next).length > 0) return;
    setPending(true);
    try {
      const created = await api.addAdmin({ email: email.trim(), name: name.trim(), role, department: role === "admin" ? department : null });
      onAdded(created);
      setEmail("");
      setName("");
      setDepartment("");
      setRole("admin");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  const describe = (field: keyof FormErrors, hint = false) =>
    errors[field] ? `${field}-input-error` : hint ? `${field}-input-hint` : undefined;

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Field label="Email" htmlFor="email-input" error={errors.email} hint="The Google account they will sign in with.">
          <Input
            id="email-input"
            type="email"
            autoComplete="off"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describe("email", true)}
            placeholder="name@kiet.edu"
          />
        </Field>
        <Field label="Name" htmlFor="name-input" error={errors.name}>
          <Input
            id="name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-invalid={errors.name ? true : undefined}
            aria-describedby={describe("name")}
          />
        </Field>
        <Field label="Role" htmlFor="role-input">
          <Select id="role-input" value={role} onChange={(e) => setRole(e.target.value as AdminRole)}>
            <option value="admin">{roleLabels.admin}</option>
            <option value="college_admin">{roleLabels.college_admin} (other colleges only)</option>
            <option value="school_admin">{roleLabels.school_admin} (schools only)</option>
            <option value="outside_admin">{roleLabels.outside_admin} (other colleges and schools)</option>
            <option value="startup_admin">{roleLabels.startup_admin} (startups only)</option>
            <option value="super_admin">{roleLabels.super_admin}</option>
          </Select>
        </Field>
        <Field
          label="Department"
          htmlFor="department-input"
          error={errors.department}
          hint={
            role === "super_admin"
              ? "Super admins see every department."
              : role === "outside_admin"
                ? "Sees only teams and students from other colleges and schools."
                : role === "college_admin"
                  ? "Sees only teams and students from other colleges."
                  : role === "school_admin"
                    ? "Sees only teams and students from schools."
                    : role === "startup_admin"
                      ? "Sees only startups."
                      : "Required for department admins. Choose COE KIET / Technical Club KIET for the technical clubs' admin."
          }
        >
          <Select
            id="department-input"
            value={role === "admin" ? department : ""}
            onChange={(e) => setDepartment(e.target.value)}
            disabled={role !== "admin"}
            required={role === "admin"}
            aria-invalid={errors.department ? true : undefined}
            aria-describedby={describe("department", true)}
          >
            <option value="">{role === "super_admin" ? "All departments" : role !== "admin" ? "No department" : "Choose a department"}</option>
            {departments.map((d) => (
              <option key={d} value={d}>{departmentLabel(d)}</option>
            ))}
          </Select>
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          {!pending && <UserPlus aria-hidden="true" className="size-4" />}
          Add admin
        </Button>
      </div>
    </form>
  );
}

export function AdminsView() {
  const me = useAdmin();
  const isSuper = me.role === "super_admin";
  const admins = useQuery(isSuper ? "admins" : null, () => api.listAdmins());
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!isSuper) {
    return (
      <div className="space-y-6">
        <PageHeader title="Admins" />
        <section aria-labelledby="admins-denied" className="max-w-xl border-l-4 border-red-500 bg-white py-4 pl-4 pr-4">
          <p className="flex items-center gap-2 text-red-700">
            <ShieldAlert aria-hidden="true" className="size-5" />
            <span id="admins-denied" className="font-display text-lg font-bold">Not authorised</span>
          </p>
          <p className="mt-1 text-sm text-muted">
            Only the super admin can view and manage admins.
          </p>
          <ButtonLink href="/" size="sm" className="mt-4">
            Back to overview
          </ButtonLink>
        </section>
      </div>
    );
  }

  const list = admins.data ?? [];
  const sorted = [...list].sort((a, b) =>
    a.role === b.role ? (a.department ?? "").localeCompare(b.department ?? "") || a.name.localeCompare(b.name) : a.role === "super_admin" ? -1 : 1,
  );

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Super admin"
        title="Admins"
        description="Department admins see only their department's teams and students and nominate its finalists. Outside teams admins look after teams from other colleges and schools. Super admins see everything and publish results. Judges are appointed on the Judging page."
      />

      {message && <Notice tone="success">{message}</Notice>}

      <section aria-labelledby="admin-list">
        <SectionTitle id="admin-list" title={`Current admins${admins.data ? ` (${list.length})` : ""}`} />
        {admins.error && <Notice tone="error">{admins.error}</Notice>}
        {!admins.data && !admins.error && <Loading label="Loading admins" />}
        {admins.data && (
          <TableFrame label="Admins" minWidth="min-w-[720px]">
            <thead>
              <tr>
                <Th>Name</Th>
                <Th>Email</Th>
                <Th>Role</Th>
                <Th>Department</Th>
                <Th>Added</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((admin) => {
                const self = admin.email.toLowerCase() === me.email.toLowerCase();
                const configured = admin.addedBy === CONFIGURED_BY_SERVER;
                return (
                  <tr key={admin.email}>
                    <td className={`${tdClass} whitespace-nowrap font-semibold text-navy-900`}>
                      {admin.name} {self && <span className="text-xs font-normal text-muted">(you)</span>}
                    </td>
                    <td className={`${tdClass} break-all`}>{admin.email}</td>
                    <td className={tdClass}>
                      <Pill tone={admin.role === "super_admin" ? "navy" : admin.role === "outside_admin" || admin.role === "college_admin" || admin.role === "school_admin" ? "orange" : admin.role === "startup_admin" ? "violet" : "cyan"}>{roleLabels[admin.role]}</Pill>
                    </td>
                    <td className={tdClass}>{admin.department ? departmentLabel(admin.department) : <span className="text-muted">{admin.role === "outside_admin" ? "Other colleges & schools" : admin.role === "startup_admin" ? "Startups" : "All"}</span>}</td>
                    <td className={`${tdClass} whitespace-nowrap text-muted`}>{configured ? "Server configuration" : formatDate(admin.addedAt)}</td>
                    <td className={`${tdClass} text-right`}>
                      {self ? (
                        <span className="text-xs text-muted">Cannot remove yourself</span>
                      ) : configured ? (
                        <span className="text-xs text-muted" title="Set in the backend's SUPER_ADMIN_EMAILS">Change on the server</span>
                      ) : (
                        <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setRemoving(admin)}>
                          Remove<span className="sr-only"> {admin.name}</span>
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableFrame>
        )}
      </section>

      <section aria-labelledby="add-admin">
        <SectionTitle id="add-admin" title="Add an admin" meta="They sign in with Google using this email" />
        <AddAdminForm
          onAdded={(admin) => {
            setMessage(
              `${admin.name} (${admin.email}) can now sign in as ${
                admin.role === "super_admin" ? "a super admin" : admin.role === "outside_admin" ? "the admin for other colleges and schools" : admin.role === "startup_admin" ? "the startups admin" : `the ${admin.department} admin`
              }.`,
            );
            admins.reload();
          }}
        />
      </section>

      {removing && (
        <ConfirmDialog
          title="Remove admin?"
          description={
            <>
              <strong className="text-navy-900">{removing.name}</strong> ({removing.email}) will lose access to the admin panel immediately.
            </>
          }
          confirmLabel="Remove admin"
          tone="danger"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeAdmin(removing.email);
            setMessage(`${removing.name} was removed.`);
            setRemoving(null);
            admins.reload();
          }}
        />
      )}
    </div>
  );
}
