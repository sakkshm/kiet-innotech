/**
 * Attendance by event pass (the rotating QR code) is switched off for now. Set NEXT_PUBLIC_ATTENDANCE_ENABLED=true at
 * build time, and ATTENDANCE_ENABLED=true on the server, to bring it back. Students still see their room either way.
 */
export const attendanceEnabled = process.env.NEXT_PUBLIC_ATTENDANCE_ENABLED === "true";
