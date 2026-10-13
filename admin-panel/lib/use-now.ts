"use client";

import { useEffect, useState } from "react";

/** The current time, refreshed every `everyMs`, for countdowns and "now" badges. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}
