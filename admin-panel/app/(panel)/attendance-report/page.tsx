import type { Metadata } from "next";
import { Suspense } from "react";
import { AttendanceRollCall } from "@/components/attendance/AttendanceRollCall";
import { Loading } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Student attendance" };

export default function AttendanceReportPage() {
  return (
    <Suspense fallback={<Loading label="Loading student attendance" />}>
      <AttendanceRollCall />
    </Suspense>
  );
}
