"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { AdminTeam } from "@/lib/admin-types";
import { categories, domains } from "@/lib/content";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

/** A super admin edits a team's details, whatever its status. The server checks the category and name rules again. */
export function EditTeamDialog({ team, onClose, onSaved }: { team: AdminTeam; onClose: () => void; onSaved: (team: AdminTeam) => void }) {
  const [name, setName] = useState(team.name);
  const [category, setCategory] = useState(team.category);
  const [domain, setDomain] = useState(team.domain);
  const [projectTitle, setProjectTitle] = useState(team.projectTitle);
  const [abstract, setAbstract] = useState(team.abstract);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function save() {
    const missing = [
      name.trim().length < 3 && "a team name (3 to 40 characters)",
      projectTitle.trim().length < 5 && "a project title (at least 5 characters)",
      abstract.trim().length < 100 && "an abstract (at least 100 characters)",
      reason.trim().length < 5 && "a reason (at least 5 characters)",
    ].filter(Boolean);
    if (missing.length) return setError(`Enter ${missing.join(", ")}.`);
    setPending(true);
    setError(null);
    try {
      onSaved(await api.editTeam(team.id, { name: name.trim(), category, domain, projectTitle: projectTitle.trim(), abstract: abstract.trim(), reason: reason.trim() }));
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Edit ${team.name}`}
      description={`Changes the details of ${team.code}, even though it is ${team.status === "submitted" ? "submitted and locked" : team.status}. Members are changed in the Members section below.`}
      onClose={onClose}
      busy={pending}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            Save changes
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Team name" htmlFor="edit-team-name">
          <Input id="edit-team-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={40} />
        </Field>
        <Field label="Category" htmlFor="edit-team-category">
          <Select id="edit-team-category" value={category} onChange={(e) => setCategory(Number(e.target.value))}>
            {categories.map((c) => (
              <option key={c.number} value={c.number}>{c.number}. {c.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Focus domain" htmlFor="edit-team-domain" className="sm:col-span-2">
          <Select id="edit-team-domain" value={domain} onChange={(e) => setDomain(e.target.value)}>
            {!domains.includes(domain as (typeof domains)[number]) && <option value={domain}>{domain}</option>}
            {domains.map((d) => (
              <option key={d} value={d}>{d}</option>
            ))}
          </Select>
        </Field>
        <Field label="Project title" htmlFor="edit-team-title" className="sm:col-span-2">
          <Input id="edit-team-title" value={projectTitle} onChange={(e) => setProjectTitle(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Abstract" htmlFor="edit-team-abstract" hint={`${abstract.trim().length} / 1500 characters (100 to 1500)`} className="sm:col-span-2">
          <Textarea id="edit-team-abstract" rows={7} value={abstract} onChange={(e) => setAbstract(e.target.value)} maxLength={1500} />
        </Field>
        <Field label="Reason" htmlFor="edit-team-reason" hint="Saved in the audit log with your email." className="sm:col-span-2">
          <Textarea id="edit-team-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Leader asked us to fix the title" />
        </Field>
      </div>
      {error && (
        <div className="mt-4">
          <Notice tone="error">{error}</Notice>
        </div>
      )}
    </Dialog>
  );
}
