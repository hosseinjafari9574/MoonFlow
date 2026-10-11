"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether the tab is visible. Ambient/infinite motion is paused when
 * it is not — nothing should burn cycles for an unseen window.
 */
export function usePageVisible(): boolean {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  return visible;
}
