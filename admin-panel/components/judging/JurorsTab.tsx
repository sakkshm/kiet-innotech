"use client";

import { useState, type FormEvent } from "react";
import { UserPlus } from "lucide-react";
import { api, errorMessage } from "@/lib/api";
import type { Juror } from "@/lib/admin-types";
import { departmentLabel, departments } from "@/lib/content";
import { roundLabels } from "@/lib/format";
import { useQuery } from "@/lib/use-query";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/Dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { Field, Input, Select } from "@/components/ui/Field";
import { Loading, Notice } from "@/components/ui/Notice";
import { SectionTitle } from "@/components/ui/PageHeader";
import { Pill } from "@/components/ui/Pill";
import { TableFrame, tdClass, Th } from "@/components/ui/Table";

/** Appointing judges. They sign in to this panel with Google and see only their own rooms. */
export function JurorsTab({ onChange }: { onChange: () => void }) {
  const jurors = useQuery("jurors", () => api.listJurors());
  const [removing, setRemoving] = useState<Juror | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  return (
    <div className="space-y-8">
      {message && <Notice tone="success">{message}</Notice>}
      <section aria-labelledby="add-judge">
        <SectionTitle id="add-judge" title="Appoint a judge" meta="They sign in to this panel with Google using this email" />
        <AddJurorForm
          onAdded={(juror) => {
            setMessage(`${juror.name} can now sign in at this panel and will see the rooms you appoint them to.`);
            jurors.reload();
          }}
        />
      </section>

      <section aria-labelledby="judge-list">
        <SectionTitle id="judge-list" title={`Judges${jurors.data ? ` (${jurors.data.length})` : ""}`} />
        {jurors.error && <Notice tone="error">{jurors.error}</Notice>}
        {!jurors.data && !jurors.error && <Loading label="Loading judges" />}
        {jurors.data && jurors.data.length === 0 && <EmptyState title="No judges yet">Appoint faculty for the department round and external judges for the finale.</EmptyState>}
        {jurors.data && jurors.data.length > 0 && (
          <TableFrame label="Judges" minWidth="min-w-[820px]">
            <thead>
              <tr>
                <Th>Judge</Th>
                <Th>From</Th>
                <Th>Rooms and panels</Th>
                <Th>Scores</Th>
                <Th>
                  <span className="sr-only">Actions</span>
                </Th>
              </tr>
            </thead>
            <tbody>
              {jurors.data.map((j) => (
                <tr key={j.email}>
                  <td className={tdClass}>
                    <span className="font-semibold text-navy-900">{j.name}</span>
                    <span className="block break-all text-xs text-muted">{j.email}{j.phone && ` · ${j.phone}`}</span>
                  </td>
                  <td className={tdClass}>
                    <Pill tone={j.kind === "faculty" ? "navy" : "orange"}>{j.kind === "faculty" ? "KIET faculty" : "External"}</Pill>
                    <span className="mt-0.5 block text-xs text-muted">{j.kind === "faculty" ? j.department : j.organisation}</span>
                  </td>
                  <td className={tdClass}>
                    {j.panels.length === 0 ? (
                      <span className="text-muted">Not on a panel yet</span>
                    ) : (
                      <ul className="space-y-0.5 text-xs">
                        {j.panels.map((p) => (
                          <li key={p.id}>
                            <span className="font-semibold text-navy-900">{p.name}</span> <span className="text-muted">({roundLabels[p.round]}{p.chair ? ", chair" : ""})</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                  <td className={`${tdClass} tabular-nums`}>{j.scores}</td>
                  <td className={`${tdClass} text-right`}>
                    {j.scores > 0 ? (
                      <span className="text-xs text-muted">Has scored teams</span>
                    ) : (
                      <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setRemoving(j)}>
                        Remove<span className="sr-only"> {j.name}</span>
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>

      {removing && (
        <ConfirmDialog
          title="Remove judge?"
          description={
            <>
              <strong className="text-navy-900">{removing.name}</strong> will lose access. Remove them from their rooms first if they are on any.
            </>
          }
          confirmLabel="Remove judge"
          tone="danger"
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await api.removeJuror(removing.email);
            setMessage(`${removing.name} was removed.`);
            setRemoving(null);
            jurors.reload();
            onChange();
          }}
        />
      )}
    </div>
  );
}

function AddJurorForm({ onAdded }: { onAdded: (juror: Juror) => void }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Juror["kind"]>("faculty");
  const [department, setDepartment] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!/^[^\s@]+@kiet\.edu$/i.test(email.trim())) return setError("Judges need a @kiet.edu email: they sign in with their KIET Google account.");
    if (name.trim().length < 2) return setError("Enter the judge's name.");
    if (kind === "faculty" && !department) return setError("Choose the faculty member's department. They will not judge that department's teams.");
    if (kind === "external" && organisation.trim().length < 2) return setError("Enter the organisation an external judge comes from.");
    setPending(true);
    setError(null);
    try {
      const juror = await api.addJuror({
        email: email.trim(),
        name: name.trim(),
        kind,
        department: kind === "faculty" ? department : null,
        organisation: kind === "external" ? organisation.trim() : "",
        phone: phone.trim(),
      });
      onAdded(juror);
      setEmail("");
      setName("");
      setOrganisation("");
      setPhone("");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} noValidate className="space-y-4 rounded-2xl bg-white p-4 ring-1 ring-line sm:p-5">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
        <Field label="Email" htmlFor="juror-email" hint="Their KIET Google account (@kiet.edu).">
          <Input id="juror-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" placeholder="name@kiet.edu" />
        </Field>
        <Field label="Name" htmlFor="juror-name">
          <Input id="juror-name" value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Type" htmlFor="juror-kind">
          <Select id="juror-kind" value={kind} onChange={(e) => setKind(e.target.value as Juror["kind"])}>
            <option value="faculty">KIET faculty (department round)</option>
            <option value="external">Outside expert (finale), with a KIET account</option>
          </Select>
        </Field>
        {kind === "faculty" ? (
          <Field label="Their department" htmlFor="juror-department">
            <Select id="juror-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Organisation" htmlFor="juror-organisation">
            <Input id="juror-organisation" value={organisation} onChange={(e) => setOrganisation(e.target.value)} placeholder="Where they come from" />
          </Field>
        )}
        <Field label="Phone" htmlFor="juror-phone" hint="Optional.">
          <Input id="juror-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Field>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      <div className="flex justify-end">
        <Button type="submit" pending={pending}>
          {!pending && <UserPlus aria-hidden="true" className="size-4" />}
          Appoint judge
        </Button>
      </div>
    </form>
  );
}
