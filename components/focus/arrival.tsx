"use client";

import { motion } from "framer-motion";

import { EASE_IN_OUT, EASE_OUT_EXPO } from "@/lib/motion";
import { cn } from "@/lib/utils";

/**
 * The arrival's own overlays: two shutters that close and lift away, and the one
 * pass of light that follows them.
 *
 * Behind the content on purpose, so nothing ever covers the task or the controls,
 * and inside a clipped box so a parked veil never adds scrollable area to the
 * overlay. The sweep carries `key={sweep-${toneKey}}` and so re-mounts on every
 * phase change, which is what makes the same light pass read as the hand-off.
 */

/**
 * One shutter pass: close fast, hold a beat, then lift away. Keyframes are
 * evenly spaced, so the middle pair is the hold.
 */
const VEIL_TRANSITION = {
  duration: 1.15,
  ease: [EASE_OUT_EXPO, EASE_IN_OUT, EASE_OUT_EXPO],
};

export function ArrivalVeils({ reduceMotion }: { reduceMotion: boolean }) {
  /*
   * The veils are decoration around the arrival — the stage's own rise and the
   * room's fade already say the overlay is here — so a user who asked the system
   * for less motion gets none of them. The CSS reduced-motion rule cannot reach
   * a Framer keyframe tween; this is the one place that has to say so itself.
   */
  if (reduceMotion) return null;
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-10 overflow-hidden"
    >
      <motion.span
        className="absolute inset-x-0 top-0 h-[30vh] border-b border-white/[0.06] bg-gradient-to-b from-[#0b0e1d] via-[#080a13]/80 to-transparent"
        initial={{ y: "-102%" }}
        animate={{ y: ["-102%", "0%", "0%", "-102%"] }}
        transition={VEIL_TRANSITION}
      />
      <motion.span
        className="absolute inset-x-0 bottom-0 h-[26vh] border-t border-white/[0.06] bg-gradient-to-t from-[#0b0e1d] via-[#080a13]/80 to-transparent"
        initial={{ y: "102%" }}
        animate={{ y: ["102%", "0%", "0%", "102%"] }}
        transition={VEIL_TRANSITION}
      />
    </div>
  );
}

export function ArrivalSweep({
  toneKey,
  isFocus,
  reduceMotion,
}: {
  toneKey: string;
  isFocus: boolean;
  reduceMotion: boolean;
}) {
  /* Same rule as the veils: a pass of light is the definition of optional. */
  if (reduceMotion) return null;
  return (
    <motion.span
      key={`sweep-${toneKey}`}
      aria-hidden
      className={cn(
        "pointer-events-none absolute inset-y-0 z-[12] w-1/3 bg-gradient-to-r from-transparent to-transparent",
        isFocus ? "via-primary/[0.07]" : "via-ivory/[0.06]",
      )}
      initial={{ x: "-130%" }}
      animate={{ x: "330%" }}
      transition={{ duration: 1.3, delay: 0.24, ease: EASE_OUT_EXPO }}
    />
  );
}
