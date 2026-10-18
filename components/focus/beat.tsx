"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

import { CELEBRATION_SPARKS } from "@/components/focus/geometry";
import { formatDuration } from "@/lib/format";
import { modeMeta } from "@/lib/constants";
import { EASE_OUT_EXPO, EASE_SOFT, SPRING } from "@/lib/motion";
import type { Tone } from "@/lib/tone";
import type { TimerPresetId } from "@/lib/types";
import type { PhaseEvent } from "@/store/use-timer-store";
import { cn } from "@/lib/utils";

/**
 * The phase hand-off — presentational only. The clock does *not* keep running:
 * `completeSession` arms the next phase and leaves it for the user to start, so
 * this beat announces what just happened and gets out of the way.
 *
 * The event itself belongs to the store (`PhaseEvent`); this module only decides
 * what a cycle ending, a session ending and a break ending each look and say.
 */
export function PhaseHandoff({
  beat,
  tone,
  isFocus,
  preset,
  todayFocusMinutes,
}: {
  /** Null unless the hand-off is on screen. */
  beat: PhaseEvent | null;
  tone: Tone;
  isFocus: boolean;
  preset: TimerPresetId;
  todayFocusMinutes: number;
}) {
  return (
    <AnimatePresence>
      {beat && (
        <motion.div
          key={beat.id}
          className="pointer-events-none absolute inset-0 z-40 grid place-items-center"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.42, ease: EASE_SOFT } }}
          aria-hidden
        >
          <motion.span
            className="absolute inset-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.55, ease: EASE_SOFT }}
            style={{
              background:
                "radial-gradient(ellipse at 50% 50%, rgba(5,5,7,0) 22%, rgba(5,5,7,0.78) 100%)",
            }}
          />
          <motion.span
            className="absolute size-40 rounded-full border"
            style={{
              borderColor:
                beat.kind === "cycle"
                  ? "rgba(233,184,114,0.6)"
                  : `rgba(${tone.rgb},0.55)`,
            }}
            initial={{ scale: 0.3, opacity: 0.85 }}
            animate={{ scale: 4.2, opacity: 0 }}
            transition={{ duration: 1.3, ease: "easeOut" }}
          />
          {CELEBRATION_SPARKS.slice(0, 10).map((spark) => (
            <motion.span
              key={spark.id}
              className={cn(
                "absolute size-1.5 rounded-full",
                beat.kind === "cycle" ? "bg-achievement" : "bg-ivory",
              )}
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{ x: spark.x, y: spark.y, opacity: 0, scale: 0.4 }}
              transition={{
                duration: 1,
                delay: 0.06 + spark.delay,
                ease: "easeOut",
              }}
            />
          ))}

          <div className="relative grid place-items-center px-6 text-center">
            <motion.span
              className="grid size-14 place-items-center rounded-full"
              style={{
                background: beat.kind === "cycle" ? "#e9b872" : tone.solid,
                color:
                  beat.kind === "cycle"
                    ? "#1b1408"
                    : isFocus
                      ? "#ffffff"
                      : "#0a0a0b",
                boxShadow: `0 20px 60px -20px rgba(${
                  beat.kind === "cycle" ? "233,184,114" : tone.rgb
                },0.95)`,
              }}
              initial={{ scale: 0.4, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={SPRING.pop}
            >
              <Check className="size-6" strokeWidth={3} />
            </motion.span>
            <motion.p
              className="mt-5 text-xl font-semibold tracking-[-0.01em] text-white"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.07, duration: 0.45, ease: EASE_OUT_EXPO }}
            >
              {beat.kind === "cycle"
                ? "Cycle complete"
                : beat.from === "focus"
                  ? "Session complete"
                  : "Break's over"}
            </motion.p>
            <motion.p
              className="mt-1.5 font-mono text-caption text-white/50"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.14, duration: 0.45, ease: EASE_OUT_EXPO }}
            >
              {beat.kind === "cycle"
                ? `${formatDuration(todayFocusMinutes)} focused today`
                : beat.from === "focus"
                  ? `${modeMeta(preset, beat.to).label} ready`
                  : "Back to it"}
            </motion.p>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
