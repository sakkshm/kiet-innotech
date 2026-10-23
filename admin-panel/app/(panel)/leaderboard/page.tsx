import type { Metadata } from "next";
import { Suspense } from "react";
import { LeaderboardView } from "@/components/leaderboard/LeaderboardView";
import { Loading } from "@/components/ui/Notice";

export const metadata: Metadata = { title: "Leaderboard" };

export default function LeaderboardPage() {
  return (
    <Suspense fallback={<Loading label="Loading the leaderboard" />}>
      <LeaderboardView />
    </Suspense>
  );
}
