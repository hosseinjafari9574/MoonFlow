"use client";

import { motion } from "framer-motion";

import { Celebration } from "@/components/focus/celebration";
import { HALO_AIR, moonGeometry } from "@/components/focus/geometry";
import { MoonBody, MoonLimb } from "@/components/focus/moon";
import { SatelliteOrbit } from "@/components/focus/orbit";
import { ProgressRing } from "@/components/progress-ring";
import { EASE_OUT_EXPO } from "@/lib/motion";
import type { Tone, ToneKey } from "@/lib/tone";
import type { TimerMode } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * The instrument: a satellite orbit around a moon, with the progress ring as the
 * dial, and the session's own reading inside it.
 *
 * It arrives behind the veils with opacity and a short rise — no filter and no
 * scale, because the ring's arc is drop-shadowed and animating either one
 * re-rasterises it on every frame of the entry (docs/motion-budget.md).
 *
 * `will-change` is normally left to Framer, but this box keeps moving long after
 * the arrival: the arc, the comet head and the graduation ticks retick every
 * 200ms for the whole session. With no layer of its own those repaints
 * invalidated the stage layer (measured: 93 repaints of 1863×870 in one arrival);
 * promoting just this box halved the arrival's dropped frames in a paired A/B
 * (20 → 8). The halo is deliberately the *first* child: it is the box the visual
 * check samples for the breath, and it must stay a radial-gradient that only
 * ever changes opacity.
 */
export function FocusInstrument({
  progress,
  ringSize,
  isFocus,
  tone,
  toneKey,
  running,
  reduceMotion,
  minutes,
  mode,
  fresh,
  clockMinutes,
  clockSeconds,
  celebrating,
}: {
  progress: number;
  ringSize: number;
  isFocus: boolean;
  tone: Tone;
  toneKey: ToneKey;
  running: boolean;
  reduceMotion: boolean;
  /** Graduations on the dial: one per minute of the phase. */
  minutes: number;
  mode: TimerMode;
  /** A clock that has never run is *ready*, not paused. */
  fresh: boolean;
  clockMinutes: string;
  clockSeconds: string;
  celebrating: boolean;
}) {
  const moon = moonGeometry(ringSize, progress);
  /*
   * How much the moon's atmosphere brightens as the session fills up.
   *
   * Quantised to 5% steps on purpose: this is a *style*, so a new value is a
   * repaint, and `progress` changes on every 200ms tick — twenty-one steps over
   * a whole session is invisible but saves ~750 repaints of a full-ring layer.
   */
  const haloGlow = 0.85 + (Math.round(progress * 20) / 20) * 0.3;

  return (
    <motion.div
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.9, delay: 0.3, ease: EASE_OUT_EXPO }}
      className="relative flex-none will-change-transform"
    >
      {/*
       * The moonlight: a halo that breathes while the timer runs and brightens
       * with progress. Both of those are load-bearing:
       *
       * 1. The breath is brightness only. It used to scale (1 → 1.035), which
       *    left a forever-moving transform on a full-ring layer and resampled
       *    its gradient every frame, over a ring whose arc, comet head and
       *    graduations repaint every 200ms.
       * 2. Its animated targets are *constants*. They used to be built from
       *    `progress`, and a Framer target that changes restarts the animation —
       *    so on every 200ms tick the breath started over and never got anywhere
       *    (measured in the phone viewport: opacity 0.500 → 0.504 across 4.5s).
       *    Progress moves into this element's own gradient instead — a style: a
       *    paint, never a restart.
       */}
      <motion.div
        aria-hidden
        /*
         * 14px outside the moon, not a flat `inset-4`: a fixed 16px was 5% of the
         * disc on the desktop and 8.6% of it on a phone, so the same bloom that
         * read as air around a big moon washed over the graduation ring on a small
         * one. Tied to the moon's own inset it is the same fraction of the disc at
         * every size.
         */
        className="pointer-events-none absolute rounded-full"
        style={{
          inset: Math.max(0, moon.inset - HALO_AIR),
          background: `radial-gradient(circle, rgba(${tone.rgb},${
            (isFocus ? 0.28 : 0.18) * haloGlow
          }), rgba(${tone.rgb},${
            (isFocus ? 0.12 : 0.08) * haloGlow
          }) 42%, transparent 74%)`,
        }}
        animate={
          running && !reduceMotion
            ? { opacity: [0.45, 0.95] }
            : { opacity: 0.4 + progress * 0.3 }
        }
        transition={
          running && !reduceMotion
            ? {
                duration: 3.4,
                repeat: Infinity,
                repeatType: "mirror",
                ease: "easeInOut",
              }
            : { duration: 0.6 }
        }
      />

      {/*
       * The moon, at the centre of its own dial — the composition the app's mark
       * is built from (docs/mark.md), at full size, and the second reading of the
       * same number the arc carries: its lit *fraction* is the session's elapsed
       * fraction, so it waxes from a hairline crescent to a full face across the
       * session.
       */}
      <MoonBody
        inset={moon.inset}
        wash={moon.wash}
        nightX={moon.nightX}
        nightY={moon.nightY}
        reduceMotion={reduceMotion}
      />

      <MoonLimb inset={moon.inset} />

      <SatelliteOrbit tone={tone} toneKey={toneKey} ringSize={ringSize} />

      {/* One-shot shockwave whenever the session phase changes */}
      <motion.span
        key={`shock-${toneKey}`}
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-full border"
        style={{ borderColor: `rgba(${tone.rgb},0.45)` }}
        initial={{ scale: 0.78, opacity: 0.6 }}
        animate={{ scale: 1.32, opacity: 0 }}
        transition={{ duration: 1.2, ease: "easeOut" }}
      />

      {/*
       * The dial, drawn with the app's own ring. The arc is a little thinner
       * than the card's: at this size the same weight reads as a gauge rather
       * than as an instrument, and the room's subject is the moon, not the
       * number.
       */}
      <ProgressRing
        progress={progress}
        size={ringSize}
        strokeWidth={ringSize < 220 ? 4 : isFocus ? 5.5 : 5}
        tone={toneKey}
        ticks={{ total: minutes, majorEvery: 5 }}
      >
        <div className="grid place-items-center gap-1.5">
          <span className="text-micro font-semibold uppercase tracking-[0.2em] text-ivory/70">
            {/* A clock that has never run is *ready*, not paused. */}
            {running ? "Remaining" : fresh ? "Ready" : "Paused"}
          </span>
          <motion.span
            key={mode}
            role="timer"
            initial={{ opacity: 0, y: 8, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ duration: 0.32, ease: EASE_OUT_EXPO }}
            /*
             * Sized from the *disc* it is read inside, a fifth of the moon's own
             * diameter, rather than from the ring (see `moonGeometry`). At a
             * panel-sized instrument that is 34px where it used to be 42 — the
             * number was wider than the moon it sat in.
             */
            style={{ fontSize: `${moon.clockPx}px` }}
            className={cn(
              "font-mono font-normal leading-none tracking-[-0.045em] tabular-nums",
              isFocus
                ? "[text-shadow:0_0_56px_rgba(75,98,255,0.4)]"
                : "[text-shadow:0_0_56px_rgba(232,226,214,0.3)]",
            )}
          >
            <span className="text-white">{clockMinutes}</span>
            {/* The seconds are the detail, not the readout. */}
            <span className="text-white/30">:{clockSeconds}</span>
          </motion.span>
        </div>
      </ProgressRing>

      <Celebration show={celebrating} />
    </motion.div>
  );
}
