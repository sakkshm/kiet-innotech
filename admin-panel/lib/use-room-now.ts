"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The server's clock, ticking every second: the device's clock plus how far it was off from the server's time when the
 * page was loaded. A phone with a wrong clock then still counts down to the same moment the server enforces.
 */
export function useServerNow(serverTime: string | null | undefined, everyMs = 1000) {
  const skew = useRef(0);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (serverTime) skew.current = new Date(serverTime).getTime() - Date.now();
    const tick = () => setNow(Date.now() + skew.current);
    tick();
    const timer = setInterval(tick, everyMs);
    return () => clearInterval(timer);
  }, [serverTime, everyMs]);
  return now;
}
