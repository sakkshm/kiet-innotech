"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { AdminStudent, AdminUser } from "@/lib/admin-types";
import { clubDepartment, departmentLabel, departments } from "@/lib/content";
import { collegeCourses, collegeYears, isKietEmail, kietCourses, schoolClasses, yearLabel } from "@/lib/rules";
import { isOutsideAdmin, scopeName } from "@/lib/scope";
import type { ParticipantType } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Registers a student for them, e.g. at the help desk, whether or not registration is open. The student then signs in
 * with Google using this email and finds their profile ready. The server checks every field again.
 */
export function AddStudentDialog({ admin, onClose, onCreated }: { admin: AdminUser; onClose: () => void; onCreated: (student: AdminStudent) => void }) {
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [chosenType, setChosenType] = useState<ParticipantType>(admin.role === "school_admin" ? "school" : "college");
  const [institution, setInstitution] = useState("");
  const [city, setCity] = useState("");
  const [department, setDepartment] = useState(admin.role === "admin" ? (admin.department ?? "") : "");
  const [course, setCourse] = useState("");
  const [year, setYear] = useState(0);
  const [rollNumber, setRollNumber] = useState("");
  const [club, setClub] = useState("");
  // Super admins and startup admins can register a startup; everyone else registers students.
  const canRegisterStartup = admin.role === "super_admin" || admin.role === "startup_admin";
  const [mode, setMode] = useState<"student" | "startup">(admin.role === "startup_admin" ? "startup" : "student");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  // A @kiet.edu email is always a KIET student; any other email is another college or a school.
  const startup = mode === "startup";
  const kiet = !startup && isKietEmail(email.trim());
  const type: ParticipantType = startup ? "startup" : kiet ? "kiet" : chosenType;
  const courses = type === "kiet" ? kietCourses : collegeCourses;
  const years = type === "school" ? schoolClasses : collegeYears;
  const scopeProblem =
    email.trim() && admin.role === "admin" && !kiet
      ? `As the ${admin.department} admin you can register KIET students only (a @kiet.edu email).`
      : email.trim() && isOutsideAdmin(admin) && kiet
        ? `You register students from ${scopeName(admin).toLowerCase()}; KIET students use their @kiet.edu email.`
        : null;

  async function save() {
    const missing = startup
      ? [
          !EMAIL.test(email.trim()) && "a valid email",
          institution.trim().length < 2 && "the startup name",
          fullName.trim().length < 3 && "the contact person's name",
          phone.replace(/\D/g, "").length < 10 && "a 10-digit phone number",
        ].filter(Boolean)
      : [
          !EMAIL.test(email.trim()) && "a valid email",
          fullName.trim().length < 3 && "the full name",
          phone.replace(/\D/g, "").length < 10 && "a 10-digit phone number",
          type === "kiet" && !department && "the department",
          type === "kiet" && department === clubDepartment && club.trim().length < 2 && "the technical club",
          type !== "kiet" && institution.trim().length < 3 && `the ${type === "school" ? "school" : "college"} name`,
          type !== "kiet" && city.trim().length < 2 && "the city",
          type !== "school" && !course && "the course",
          !years.includes(year) && (type === "school" ? "the class" : "the year"),
          type === "kiet" && !rollNumber.trim() && "the university roll number",
          type === "college" && rollNumber.trim().length < 3 && "the enrolment or roll number",
        ].filter(Boolean);
    if (scopeProblem) return setError(scopeProblem);
    if (missing.length) return setError(`Enter ${missing.join(", ")}.`);
    setPending(true);
    setError(null);
    try {
      const student = await api.createStudent({
        email: email.trim(),
        fullName: fullName.trim(),
        phone: phone.trim(),
        participantType: type,
        institution: type === "kiet" ? "" : institution.trim(),
        city: type === "kiet" || startup ? "" : city.trim(),
        department: type === "kiet" ? department : null,
        course: type === "school" || startup ? "" : course,
        year: startup ? 0 : year,
        rollNumber: startup ? "" : rollNumber.trim(),
        club: type === "kiet" && department === clubDepartment ? club.trim() : "",
      });
      onCreated(student);
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={startup ? "Add a startup" : "Add a student"}
      description={`Registers the ${startup ? "startup" : "student"} whether or not registration is open. They sign in with Google using this email and find their profile ready.`}
      onClose={onClose}
      busy={pending}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={pending}>
            Cancel
          </Button>
          <Button onClick={save} pending={pending}>
            {startup ? "Add startup" : "Add student"}
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {canRegisterStartup && (
          <Field label="Register as" htmlFor="new-mode" className="sm:col-span-2">
            <Select
              id="new-mode"
              value={mode}
              disabled={admin.role === "startup_admin"}
              onChange={(e) => {
                setMode(e.target.value as "student" | "startup");
                setError(null);
              }}
            >
              <option value="student">Student (KIET, other college or school)</option>
              <option value="startup">Startup</option>
            </Select>
          </Field>
        )}
        <Field label="Email" htmlFor="new-email" hint={kiet ? "A @kiet.edu email: registered as a KIET student." : "Their Google account email."} className="sm:col-span-2">
          <Input id="new-email" type="email" autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
        </Field>
        {startup && (
          <Field label="Startup name" htmlFor="new-startup" className="sm:col-span-2">
            <Input id="new-startup" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} />
          </Field>
        )}
        <Field label={startup ? "Contact person" : "Full name"} htmlFor="new-name">
          <Input id="new-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Phone" htmlFor="new-phone">
          <Input id="new-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </Field>

        {startup ? null : kiet ? (
          <Field label="Department" htmlFor="new-department">
            <Select id="new-department" value={department} onChange={(e) => setDepartment(e.target.value)} disabled={admin.role === "admin"}>
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Participant type" htmlFor="new-type">
            <Select
              id="new-type"
              value={chosenType}
              onChange={(e) => {
                setChosenType(e.target.value as ParticipantType);
                setYear(0);
                setCourse("");
              }}
            >
              {admin.role !== "school_admin" && <option value="college">Other college</option>}
              {admin.role !== "college_admin" && <option value="school">School</option>}
            </Select>
          </Field>
        )}
        {kiet && department === clubDepartment && (
          <Field label="Technical club" htmlFor="new-club">
            <Input id="new-club" value={club} onChange={(e) => setClub(e.target.value)} maxLength={80} placeholder="e.g. Robotics Club" />
          </Field>
        )}
        {type !== "school" && !startup && (
          <Field label="Course" htmlFor="new-course">
            <Select id="new-course" value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">Choose a course</option>
              {courses.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        )}
        {type !== "kiet" && !startup && (
          <>
            <Field label={type === "school" ? "School" : "College"} htmlFor="new-institution">
              <Input id="new-institution" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} />
            </Field>
            <Field label="City" htmlFor="new-city">
              <Input id="new-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
            </Field>
          </>
        )}
        {!startup && (
          <>
            <Field label={type === "school" ? "Class" : "Year of study"} htmlFor="new-year">
              <Select id="new-year" value={year || ""} onChange={(e) => setYear(Number(e.target.value))}>
                <option value="">Choose</option>
                {years.map((y) => (
                  <option key={y} value={y}>{yearLabel(y, type)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={type === "kiet" ? "University roll number" : type === "college" ? "Enrolment or roll number" : "Roll number (optional)"}
              htmlFor="new-roll"
            >
              <Input id="new-roll" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} maxLength={40} />
            </Field>
          </>
        )}
      </div>
      {(scopeProblem || error) && (
        <div className="mt-4">
          <Notice tone="error">{scopeProblem ?? error}</Notice>
        </div>
      )}
    </Dialog>
  );
}
