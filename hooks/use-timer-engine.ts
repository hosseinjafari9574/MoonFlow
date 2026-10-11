"use client";

import { useEffect } from "react";

import { APP_NAME, TIMER_PRESETS, TICK_INTERVAL_MS } from "@/lib/constants";
import { formatClock } from "@/lib/format";
import { primeAudio } from "@/lib/sound";
import { useTimerStore } from "@/store/use-timer-store";

const BASE_TITLE = `${APP_NAME} — todos, focus & flow`;

/**
 * Keeps the timer honest: a single interval drives the countdown, the
 * browser tab title and lazy audio initialisation.
 */
export function useTimerEngine() {
  useEffect(() => {
    let lastTitle = "";

    const applyTitle = () => {
      const state = useTimerStore.getState();
      const modeLabel =
        TIMER_PRESETS[state.preset].modeLabels[state.mode].label;
      const title = state.running
        ? `${formatClock(state.remainingMs)} · ${modeLabel} — ${APP_NAME}`
        : BASE_TITLE;
      if (title !== lastTitle) {
        lastTitle = title;
        document.title = title;
      }
    };

    const tick = () => {
      useTimerStore.getState().tick();
      applyTitle();
    };

    tick();
    const interval = window.setInterval(tick, TICK_INTERVAL_MS);
    const unsubscribe = useTimerStore.subscribe(applyTitle);

    const onVisibility = () => {
      if (!document.hidden) tick();
    };
    document.addEventListener("visibilitychange", onVisibility);

    const onGesture = () => primeAudio();
    window.addEventListener("pointerdown", onGesture, { once: true });
    window.addEventListener("keydown", onGesture, { once: true });

    return () => {
      window.clearInterval(interval);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pointerdown", onGesture);
      window.removeEventListener("keydown", onGesture);
      document.title = BASE_TITLE;
    };
  }, []);
}
