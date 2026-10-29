import { useEffect, useState } from "react";

export const SLOW_PORTAL_MESSAGE = "Just wait, JUET's server is responding really slow.";

export function useSlowRequest(pending: boolean) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (!pending) return;
    const timer = setTimeout(() => setSlow(true), 8_000);
    return () => clearTimeout(timer);
  }, [pending]);
  return pending && slow;
}
