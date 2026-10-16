"use client";

import { useState } from "react";
import { api, errorMessage } from "@/lib/api";
import type { AdminStudent } from "@/lib/admin-types";
import { clubDepartment, departmentLabel, departments } from "@/lib/content";
import { collegeCourses, collegeYears, kietCourses, schoolClasses, yearLabel } from "@/lib/rules";
import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";
import { Field, Input, Select, Textarea } from "@/components/ui/Field";
import { Notice } from "@/components/ui/Notice";

/**
 * A super admin corrects a student's profile (e.g. a wrong name or phone). The sign-in email does not change. The
 * server checks every rule again, including what a team the student is in depends on.
 */
export function EditStudentDialog({ student, onClose, onSaved }: { student: AdminStudent; onClose: () => void; onSaved: (student: AdminStudent) => void }) {
  const type = student.participantType;
  const startup = type === "startup";
  const kiet = type === "kiet";
  const [fullName, setFullName] = useState(student.fullName);
  const [phone, setPhone] = useState(student.phone);
  const [institution, setInstitution] = useState(student.institution);
  const [city, setCity] = useState(student.city);
  const [department, setDepartment] = useState(student.department ?? "");
  const [course, setCourse] = useState(student.course);
  const [year, setYear] = useState(student.year);
  const [rollNumber, setRollNumber] = useState(student.rollNumber);
  const [club, setClub] = useState(student.club ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const courses = kiet ? kietCourses : collegeCourses;
  const years = type === "school" ? schoolClasses : collegeYears;

  async function save() {
    const missing = [
      fullName.trim().length < 3 && "the full name",
      phone.replace(/\D/g, "").length < 10 && "a 10-digit phone number",
      startup && institution.trim().length < 2 && "the startup name",
      kiet && !department && "the department",
      kiet && department === clubDepartment && club.trim().length < 2 && "the technical club",
      !kiet && !startup && institution.trim().length < 3 && `the ${type === "school" ? "school" : "college"} name`,
      !kiet && !startup && city.trim().length < 2 && "the city",
      !startup && type !== "school" && !course && "the course",
      !startup && !years.includes(year) && (type === "school" ? "the class" : "the year"),
      kiet && !rollNumber.trim() && "the university roll number",
      type === "college" && rollNumber.trim().length < 3 && "the enrolment or roll number",
      reason.trim().length < 5 && "a reason (at least 5 characters)",
    ].filter(Boolean);
    if (missing.length) return setError(`Enter ${missing.join(", ")}.`);
    setPending(true);
    setError(null);
    try {
      onSaved(
        await api.editStudent(student.userId, {
          fullName: fullName.trim(),
          phone: phone.trim(),
          participantType: type,
          institution: kiet ? "" : institution.trim(),
          city: kiet || startup ? "" : city.trim(),
          department: kiet ? department : null,
          course: type === "school" || startup ? "" : course,
          year: startup ? 0 : year,
          rollNumber: startup ? "" : rollNumber.trim(),
          club: kiet && department === clubDepartment ? club.trim() : "",
          reason: reason.trim(),
        }),
      );
    } catch (err) {
      setError(errorMessage(err));
      setPending(false);
    }
  }

  return (
    <Dialog
      title={`Edit ${student.fullName}`}
      description={
        <>
          Corrects the profile of <strong className="text-navy-900">{student.email}</strong>. Their sign-in email does not change.
          {student.team && ` They are in team ${student.team.code}, so some changes (college or school) are refused.`}
        </>
      }
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
        {startup && (
          <Field label="Startup name" htmlFor="edit-startup" className="sm:col-span-2">
            <Input id="edit-startup" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} />
          </Field>
        )}
        <Field label={startup ? "Contact person" : "Full name"} htmlFor="edit-name">
          <Input id="edit-name" value={fullName} onChange={(e) => setFullName(e.target.value)} maxLength={120} />
        </Field>
        <Field label="Phone" htmlFor="edit-phone">
          <Input id="edit-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} />
        </Field>
        {kiet && (
          <Field label="Department" htmlFor="edit-department">
            <Select id="edit-department" value={department} onChange={(e) => setDepartment(e.target.value)}>
              <option value="">Choose a department</option>
              {departments.map((d) => (
                <option key={d} value={d}>{departmentLabel(d)}</option>
              ))}
            </Select>
          </Field>
        )}
        {kiet && department === clubDepartment && (
          <Field label="Technical club" htmlFor="edit-club">
            <Input id="edit-club" value={club} onChange={(e) => setClub(e.target.value)} maxLength={80} />
          </Field>
        )}
        {!startup && type !== "school" && (
          <Field label="Course" htmlFor="edit-course">
            <Select id="edit-course" value={course} onChange={(e) => setCourse(e.target.value)}>
              <option value="">Choose a course</option>
              {courses.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
        )}
        {!kiet && !startup && (
          <>
            <Field label={type === "school" ? "School" : "College"} htmlFor="edit-institution">
              <Input id="edit-institution" value={institution} onChange={(e) => setInstitution(e.target.value)} maxLength={200} />
            </Field>
            <Field label="City" htmlFor="edit-city">
              <Input id="edit-city" value={city} onChange={(e) => setCity(e.target.value)} maxLength={100} />
            </Field>
          </>
        )}
        {!startup && (
          <>
            <Field label={type === "school" ? "Class" : "Year of study"} htmlFor="edit-year">
              <Select id="edit-year" value={year || ""} onChange={(e) => setYear(Number(e.target.value))}>
                <option value="">Choose</option>
                {years.map((y) => (
                  <option key={y} value={y}>{yearLabel(y, type)}</option>
                ))}
              </Select>
            </Field>
            <Field
              label={kiet ? "University roll number" : type === "college" ? "Enrolment or roll number" : "Roll number (optional)"}
              htmlFor="edit-roll"
            >
              <Input id="edit-roll" value={rollNumber} onChange={(e) => setRollNumber(e.target.value)} maxLength={40} />
            </Field>
          </>
        )}
        <Field label="Reason" htmlFor="edit-reason" hint="Saved in the audit log with your email." className="sm:col-span-2">
          <Textarea id="edit-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Wrong phone number, corrected on request" />
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
