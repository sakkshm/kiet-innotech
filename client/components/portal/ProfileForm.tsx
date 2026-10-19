"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { GraduationCap, School, University } from "lucide-react";
import { clubDepartment, departmentLabel, departments } from "@/lib/content";
import { clearDraft, hasDraft, readDraft, writeDraft } from "@/lib/drafts";
import { accountName } from "@/lib/format";
import { clearStartupIntent, hasStartupIntent } from "@/lib/startup";
import {
  KIET_INSTITUTION,
  allowedParticipantTypes,
  collegeCourses,
  collegeYears,
  kietCourses,
  participantTypeLabels,
  profileErrors,
  profileMaxLength,
  schoolClasses,
  yearLabel,
} from "@/lib/rules";
import type { ParticipantType, Profile, ProfileInput } from "@/lib/types";
import { Button, Field, Input, Notice, Select } from "@/components/ui/form";
import { AudienceSwitch, type Audience } from "./AudienceSwitch";
import { ClubDialog } from "./ClubDialog";

const typeIcons = { kiet: University, college: GraduationCap, school: School };
const typeNotes: Partial<Record<ParticipantType, string>> = {
  kiet: "Department round, then the Grand Finale",
  college: "Accepted by the organisers, then the Grand Finale",
  school: "Accepted by the organisers, then the Grand Finale",
};



type ProfileFormProps = {
  email: string;
  defaultName: string;
  profile: Profile | null;
  /** In a team, the college or school, department and year can no longer change. */
  lockInstitution?: boolean;
  submitLabel: string;
  /** Resolves to true once saved, which discards the draft. */
  onSubmit: (input: ProfileInput) => Promise<boolean>;
  /** Where unsaved values are kept (sessionStorage), so they survive a trip through /login. See lib/drafts.ts. */
  draftKey: string;
  pending: boolean;
  error: string | null;
  onCancel?: () => void;
};

function initialValues(email: string, defaultName: string, profile: Profile | null): ProfileInput {
  if (profile) {
    const { fullName, phone, participantType, institution, city, department, course, year, rollNumber, club } = profile;
    return { fullName, phone, participantType, institution, city, department, course, year, rollNumber, club: club ?? "" };
  }
  // Set by the Startups page, so the form opens on the Startup side for someone who came to register one.
  const participantType = hasStartupIntent() ? "startup" : allowedParticipantTypes(email)[0];
  return {
    fullName: accountName(defaultName, email),
    phone: "",
    participantType,
    institution: participantType === "kiet" ? KIET_INSTITUTION : "",
    city: "",
    department: null,
    course: "",
    year: 0,
    rollNumber: "",
    club: "",
  };
}

export function ProfileForm({ email, defaultName, profile, lockInstitution = false, submitLabel, onSubmit, draftKey, pending, error, onCancel }: ProfileFormProps) {
  const [values, setValues] = useState<ProfileInput>(() => {
    const initial = initialValues(email, defaultName, profile);
    const draft = readDraft(draftKey, initial);
    // Fields locked while in a team always come from the saved profile, whatever the draft says.
    return lockInstitution ? { ...draft, participantType: initial.participantType, institution: initial.institution, department: initial.department, year: initial.year } : draft;
  });
  const [restored] = useState(() => hasDraft(draftKey));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof ProfileInput, string>>>({});
  const [confirmed, setConfirmed] = useState(profile !== null);
  const [confirmError, setConfirmError] = useState(false);
  const [clubOpen, setClubOpen] = useState(false);
  // What was filled in on the Student side, so sliding to Startup and back loses nothing.
  const studentSnapshot = useRef<ProfileInput | null>(null);

  // Keep unsaved changes, so an expired session does not lose them.
  useEffect(() => {
    if (dirty) writeDraft(draftKey, values);
  }, [dirty, draftKey, values]);

  const types = allowedParticipantTypes(email);
  const type = values.participantType;
  const set = <K extends keyof ProfileInput>(key: K, value: ProfileInput[K]) => {
    setValues((v) => ({ ...v, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
    setDirty(true);
  };

  const chooseType = (next: ParticipantType) => {
    setValues((v) => ({ ...v, participantType: next, course: "", year: 0, institution: next === "kiet" ? KIET_INSTITUTION : "", department: null, club: "" }));
    setErrors({});
    setDirty(true);
  };

  const audience: Audience = type === "startup" ? "startup" : "student";
  const chooseAudience = (next: Audience) => {
    if (next === audience) return;
    if (next === "startup") {
      studentSnapshot.current = values;
      setValues((v) => ({ ...v, participantType: "startup", institution: "", city: "", department: null, course: "", year: 0, rollNumber: "", club: "" }));
    } else {
      const studentType = types.find((t) => t !== "startup") ?? "college";
      const saved = studentSnapshot.current;
      setValues((v) =>
        saved && saved.participantType !== "startup"
          ? { ...saved, fullName: v.fullName, phone: v.phone }
          : { ...v, participantType: studentType, institution: studentType === "kiet" ? KIET_INSTITUTION : "", city: "", department: null, course: "", year: 0, rollNumber: "", club: "" },
      );
    }
    setErrors({});
    setDirty(true);
  };

  // Picking COE KIET / Technical Club KIET asks for the club's name straight away.
  const chooseDepartment = (department: string) => {
    set("department", department || null);
    if (department === clubDepartment) setClubOpen(true);
    else set("club", "");
  };

  const cancel = () => {
    clearDraft(draftKey);
    onCancel?.();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const found = profileErrors(values, email);
    setErrors(found);
    setConfirmError(!confirmed);
    if (Object.keys(found).length > 0 || !confirmed) {
      document.querySelector<HTMLElement>("[aria-invalid=true]")?.focus();
      return;
    }
    if (await onSubmit(values)) {
      clearDraft(draftKey);
      clearStartupIntent();
      setDirty(false);
    }
  };

  const institutionLabel = type === "school" ? "School name" : "College name";

  return (
    <form onSubmit={submit} noValidate className="space-y-8">
      {restored && <Notice tone="info">We kept the changes you had not saved yet. Check them and save.</Notice>}

      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-navy-800">Register as</legend>
        <AudienceSwitch value={audience} onChange={chooseAudience} disabled={lockInstitution} />
        <p className="mt-3 text-sm text-muted">
          {lockInstitution
            ? "Locked while you are in a team."
            : audience === "startup"
              ? "One entry for your startup. No team to build: add your project after this and submit it."
              : "Students of KIET, other colleges and schools register here and form a team of 2 to 5."}
        </p>
      </fieldset>

      {audience === "student" && (
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-navy-800">I am a</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {(["kiet", "college", "school"] as const).map((option) => {
            const Icon = typeIcons[option];
            const allowed = types.includes(option) && !(lockInstitution && option !== type);
            const selected = type === option;
            return (
              <label
                key={option}
                className={`relative flex cursor-pointer gap-3 rounded-2xl border p-4 transition has-focus-visible:ring-4 has-focus-visible:ring-brand-500/30 ${
                  selected ? "border-accent-500 bg-accent-50/60" : "border-line bg-white hover:border-navy-800/30"
                } ${allowed ? "" : "cursor-not-allowed opacity-45"}`}
              >
                <input
                  type="radio"
                  name="participantType"
                  value={option}
                  checked={selected}
                  disabled={!allowed}
                  onChange={() => chooseType(option)}
                  className="sr-only"
                />
                <Icon size={22} className={selected ? "text-accent-500" : "text-muted"} aria-hidden="true" />
                <span>
                  <span className="block text-sm font-semibold text-ink">{participantTypeLabels[option]}</span>
                  <span className="mt-0.5 block text-xs text-muted">{typeNotes[option]}</span>
                </span>
              </label>
            );
          })}
        </div>
        <p className="mt-3 text-sm text-muted">
          {types.includes("kiet")
            ? "You signed in with a @kiet.edu account, so you are registering as a KIET student."
            : "KIET students must sign in with their @kiet.edu account. This account can register for another college or a school."}
        </p>
        {errors.participantType && <p className="mt-2 text-sm font-medium text-red-700">{errors.participantType}</p>}
      </fieldset>
      )}

      <div className="grid gap-6 sm:grid-cols-2">
        {type === "startup" && (
          <Field id="institution" label="Startup name" error={errors.institution} className="sm:col-span-2" hint={lockInstitution ? "Locked while you are in a team." : "How your startup should appear on the event pages and certificates."}>
            <Input id="institution" value={values.institution} invalid={!!errors.institution} maxLength={profileMaxLength.institution} disabled={lockInstitution} onChange={(e) => set("institution", e.target.value)} autoComplete="organization" />
          </Field>
        )}
        <Field id="fullName" label={type === "startup" ? "Your name" : "Full name"} error={errors.fullName} hint={type === "startup" ? "The person we contact about this entry." : "As it should appear on your certificate."}>
          <Input id="fullName" value={values.fullName} invalid={!!errors.fullName} maxLength={profileMaxLength.fullName} onChange={(e) => set("fullName", e.target.value)} autoComplete="name" />
        </Field>
        <Field id="email" label="Email" hint="From your Google account.">
          <Input id="email" value={email} disabled />
        </Field>
        <Field id="phone" label="Mobile number" error={errors.phone} hint="10 digits. Used only for event updates.">
          <Input id="phone" type="tel" inputMode="numeric" value={values.phone} invalid={!!errors.phone} maxLength={profileMaxLength.phone} onChange={(e) => set("phone", e.target.value)} autoComplete="tel-national" placeholder="98XXXXXXXX" />
        </Field>

        {type === "startup" ? null : type === "kiet" ? (
          <>
            <Field id="department" label="Department" error={errors.department} hint={lockInstitution ? "Locked while you are in a team." : undefined}>
              <Select id="department" value={values.department ?? ""} invalid={!!errors.department} disabled={lockInstitution} onChange={(e) => chooseDepartment(e.target.value)}>
                <option value="">Choose department</option>
                {departments.map((d) => (
                  <option key={d} value={d}>
                    {departmentLabel(d)}
                  </option>
                ))}
              </Select>
            </Field>
            {values.department === clubDepartment && (
              <Field id="club" label="Technical club" error={errors.club} hint="The club you are part of in COE KIET.">
                <Input id="club" value={values.club} invalid={!!errors.club} maxLength={80} autoComplete="off" onChange={(e) => set("club", e.target.value)} placeholder="e.g. Robotics Club" />
              </Field>
            )}
            <Field id="course" label="Course" error={errors.course}>
              <Select id="course" value={values.course} invalid={!!errors.course} onChange={(e) => set("course", e.target.value)}>
                <option value="">Choose course</option>
                {kietCourses.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </Field>
            <YearField values={values} error={errors.year} locked={lockInstitution} onChange={(year) => set("year", year)} />
            <Field id="rollNumber" label="University roll number" error={errors.rollNumber} hint="As on your ID card.">
              <Input id="rollNumber" value={values.rollNumber} invalid={!!errors.rollNumber} maxLength={profileMaxLength.rollNumber} onChange={(e) => set("rollNumber", e.target.value)} placeholder="e.g. 2300290100012" />
            </Field>
          </>
        ) : (
          <>
            <Field id="institution" label={institutionLabel} error={errors.institution} className="sm:col-span-2" hint={lockInstitution ? "Locked while you are in a team." : "Write the full official name. Your teammates must enter the same name."}>
              <Input id="institution" value={values.institution} invalid={!!errors.institution} maxLength={profileMaxLength.institution} disabled={lockInstitution} onChange={(e) => set("institution", e.target.value)} autoComplete="organization" />
            </Field>
            <Field id="city" label="City" error={errors.city}>
              <Input id="city" value={values.city} invalid={!!errors.city} maxLength={profileMaxLength.city} onChange={(e) => set("city", e.target.value)} autoComplete="address-level2" />
            </Field>
            {type === "college" && (
              <Field id="course" label="Course" error={errors.course}>
                <Select id="course" value={values.course} invalid={!!errors.course} onChange={(e) => set("course", e.target.value)}>
                  <option value="">Choose course</option>
                  {collegeCourses.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </Field>
            )}
            <YearField values={values} error={errors.year} locked={lockInstitution} onChange={(year) => set("year", year)} />
            {type === "college" ? (
              <Field id="rollNumber" label="Enrolment or roll number" error={errors.rollNumber}>
                <Input id="rollNumber" value={values.rollNumber} invalid={!!errors.rollNumber} maxLength={profileMaxLength.rollNumber} onChange={(e) => set("rollNumber", e.target.value)} />
              </Field>
            ) : (
              <Field id="rollNumber" label="School admission number" optional>
                <Input id="rollNumber" value={values.rollNumber} maxLength={profileMaxLength.rollNumber} onChange={(e) => set("rollNumber", e.target.value)} />
              </Field>
            )}
          </>
        )}
      </div>

      {!profile && (
        <label className="flex gap-3 text-sm text-navy-800">
          <input
            type="checkbox"
            checked={confirmed}
            aria-invalid={confirmError}
            onChange={(e) => {
              setConfirmed(e.target.checked);
              setConfirmError(false);
            }}
            className="mt-0.5 h-4 w-4 shrink-0 accent-accent-500"
          />
          <span>
            I confirm these details are correct and I have read the{" "}
            <a href="/guidelines" target="_blank" className="font-semibold text-accent-600 hover:underline">
              InnoTech26 guidelines
            </a>
            .{confirmError && <span className="mt-1 block font-medium text-red-700">Please confirm to continue.</span>}
          </span>
        </label>
      )}

      {error && <Notice tone="error">{error}</Notice>}

      <ClubDialog
        open={clubOpen}
        initial={values.club}
        onClose={() => setClubOpen(false)}
        onSave={(club) => {
          set("club", club);
          setClubOpen(false);
        }}
      />

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

function YearField({ values, error, locked, onChange }: { values: ProfileInput; error?: string; locked: boolean; onChange: (year: number) => void }) {
  const school = values.participantType === "school";
  const options = school ? schoolClasses : collegeYears;
  return (
    <Field id="year" label={school ? "Class" : "Year of study"} error={error} hint={locked ? "Locked while you are in a team." : undefined}>
      <Select id="year" value={values.year || ""} invalid={!!error} disabled={locked} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="">{school ? "Choose class" : "Choose year"}</option>
        {options.map((year) => (
          <option key={year} value={year}>
            {yearLabel(year, values.participantType)}
          </option>
        ))}
      </Select>
    </Field>
  );
}
