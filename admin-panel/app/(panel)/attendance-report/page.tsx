import type { Metadata } from "next";
import { Suspense } from "react";
import { AttendanceReportView } from "@/components/attendance/AttendanceReportView";
import { Loading } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Attendance report" };

export default function AttendanceReportPage() {
  return (
    <Suspense fallback={<Loading label="Loading the attendance report" />}>
      <AttendanceReportView />
    </Suspense>
  );
}
