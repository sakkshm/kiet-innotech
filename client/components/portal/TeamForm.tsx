"use client";

import { useEffect, useState, type FormEvent } from "react";
import { categories, domains } from "@/lib/content";
import { clearDraft, hasDraft, readDraft, writeDraft } from "@/lib/drafts";
import { categoryEligibility, lengthError, limits } from "@/lib/rules";
import type { ParticipantType, TeamInput } from "@/lib/types";
import { Button, Field, Input, Notice, Pill, Select, Textarea } from "@/components/ui/form";

const OTHER_DOMAIN = "Other / not listed";

type TeamFormProps = {
  initial?: TeamInput;
  participantType: ParticipantType;
  /** Years of everyone already in the team, used to check category eligibility. */
  memberYears: number[];
  submitLabel: string;
  /** Resolves to true once saved, which discards the draft. */
  onSubmit: (input: TeamInput) => Promise<boolean>;
  /** Where unsaved values are kept (sessionStorage), so they survive a trip through /login. See lib/drafts.ts. */
  draftKey: string;
  pending: boolean;
  error: string | null;
  onCancel?: () => void;
};

const empty: TeamInput = { name: "", category: 0, domain: "", projectTitle: "", abstract: "" };

export function TeamForm({ initial = empty, participantType, memberYears, submitLabel, onSubmit, draftKey, pending, error, onCancel }: TeamFormProps) {
  const [values, setValues] = useState<TeamInput>(() => readDraft(draftKey, initial));
  const [restored] = useState(() => hasDraft(draftKey));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof TeamInput, string>>>({});

  // Keep unsaved changes, so an expired session does not lose a long abstract.
  useEffect(() => {
    if (dirty) writeDraft(draftKey, values);
  }, [dirty, draftKey, values]);

  const set = <K extends keyof TeamInput>(key: K, value: TeamInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setDirty(true);
  };

  const cancel = () => {
    clearDraft(draftKey);
    onCancel?.();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found: Partial<Record<keyof TeamInput, string>> = {};
    const nameError = lengthError(startup ? "Entry name" : "Team name", values.name, limits.teamName);
    if (nameError) found.name = nameError;
    if (!values.category) found.category = "Choose a category.";
    if (!values.domain) found.domain = "Choose the domain closest to your project.";
    const titleError = lengthError("Project title", values.projectTitle, limits.projectTitle);
    if (titleError) found.projectTitle = titleError;
    const abstractError = lengthError("Abstract", values.abstract, limits.abstract);
    if (abstractError) found.abstract = abstractError;
    setErrors(found);
    if (Object.keys(found).length > 0) {
      document.querySelector<HTMLElement>("[aria-invalid=true], [data-invalid=true]:not(:disabled)")?.focus();
      return;
    }
    if (await onSubmit(values)) {
      clearDraft(draftKey);
      setDirty(false);
    }
  };

  const abstractLength = values.abstract.trim().length;
  const startup = participantType === "startup";

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {restored && <Notice tone="info">We kept the changes you had not saved yet. Check them and save.</Notice>}

      <Field
        id="name"
        label={startup ? "Entry name" : "Team name"}
        error={errors.name}
        hint={`${limits.teamName.min} to ${limits.teamName.max} characters. Must be unique.${startup ? " Usually your startup's name." : ""}`}
      >
        <Input id="name" value={values.name} invalid={!!errors.name} maxLength={limits.teamName.max} onChange={(e) => set("name", e.target.value)} autoComplete="off" />
      </Field>

      <fieldset aria-describedby={errors.category ? "category-error" : undefined}>
        <legend className="mb-1 text-sm font-semibold text-navy-800">Category</legend>
        <p className="mb-3 text-sm text-muted">{startup ? "Your entry competes in exactly one category." : "A team competes in exactly one category."}</p>
        <ul className="divide-y divide-line overflow-hidden rounded-2xl border border-line bg-white">
          {categories.map((category) => {
            const eligibility = categoryEligibility(category.number, participantType, memberYears);
            const selected = values.category === category.number;
            return (
              <li key={category.number}>
                <label
                  className={`flex gap-4 p-4 transition has-focus-visible:bg-brand-50 ${
                    eligibility.allowed ? "cursor-pointer hover:bg-surface" : "cursor-not-allowed bg-surface/60"
                  } ${selected ? "bg-accent-50/60" : ""}`}
                >
                  <input
                    type="radio"
                    name="category"
                    value={category.number}
                    checked={selected}
                    disabled={!eligibility.allowed}
                    data-invalid={!!errors.category}
                    onChange={() => set("category", category.number)}
                    className="mt-1 h-4 w-4 shrink-0 accent-accent-500"
                  />
                  <span className={`min-w-0 flex-1 ${eligibility.allowed ? "" : "opacity-55"}`}>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-ink">
                        {category.number}. {category.title}
                      </span>
                      <Pill tone={category.isPoster ? "orange" : "charcoal"}>{category.isPoster ? "Poster" : "Project"}</Pill>
                    </span>
                    <span className="mt-1 block text-sm text-muted">{category.summary}</span>
                    {!eligibility.allowed && <span className="mt-1 block text-sm font-medium text-navy-800">{eligibility.reason}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
        {errors.category && (
          <p id="category-error" className="mt-2 text-sm font-medium text-red-700">
            {errors.category}
          </p>
        )}
      </fieldset>

      <Field id="domain" label="Focus domain" error={errors.domain} hint="The domain closest to your idea. Ideas outside these domains are welcome too.">
        <Select id="domain" value={values.domain} invalid={!!errors.domain} onChange={(e) => set("domain", e.target.value)}>
          <option value="">Choose domain</option>
          {[...domains, OTHER_DOMAIN].map((domain) => (
            <option key={domain} value={domain}>
              {domain}
            </option>
          ))}
        </Select>
      </Field>

      <Field id="projectTitle" label="Project title" error={errors.projectTitle}>
        <Input id="projectTitle" value={values.projectTitle} invalid={!!errors.projectTitle} maxLength={limits.projectTitle.max} onChange={(e) => set("projectTitle", e.target.value)} autoComplete="off" />
      </Field>

      <Field
        id="abstract"
        label="Abstract"
        error={errors.abstract}
        hint={
          <span className="flex justify-between gap-4">
            <span>The problem, your solution and who it helps.</span>
            <span className={abstractLength > limits.abstract.max ? "text-red-700" : ""}>
              {abstractLength} / {limits.abstract.max}
            </span>
          </span>
        }
      >
        <Textarea id="abstract" value={values.abstract} invalid={!!errors.abstract} rows={7} onChange={(e) => set("abstract", e.target.value)} />
      </Field>

      {error && <Notice tone="error">{error}</Notice>}

      <div className="flex flex-wrap gap-3">
        <Button type="submit" pending={pending}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button variant="outline" onClick={cancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
