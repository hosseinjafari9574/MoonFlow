"use client";

import type { CSSProperties } from "react";
import { AnimatePresence, motion } from "framer-motion";

import { EASE_SOFT, focusAurora, focusLens } from "@/lib/motion";
import type { ToneKey } from "@/lib/tone";
import { cn } from "@/lib/utils";

/**
 * The room — everything in Focus Mode that sits behind the session.
 *
 * Deep space, a starfield, one galactic band, two breathing orbital shells and a
 * vignette; above them the nebula, which only ever translates; above that the
 * twinkling stars and the drifting motes; and last, outside the push-in, the
 * film grain.
 *
 * The raster/motion split is the whole point of the layer order and is measured
 * in docs/motion-budget.md: the sky is painted once per mount and never
 * transformed, the nebula carries `focusAurora` (a translate, never a scale,
 * because a scaling layer re-rasterises its blur every frame), and the specks
 * carry `focusLens` (1–2.5px wide, so a scaling ancestor resamples each one).
 */

/**
 * The bright stars — the only ones that move on their own.
 *
 * Opacity-only, on their own clocks, eight of them. Everything else in the sky
 * is one static raster (`.starfield` in app/globals.css), because a full-screen
 * layer that twinkles is a full-screen layer that repaints.
 */
const TWINKLERS = Array.from({ length: 8 }, (_, i) => ({
  id: i,
  left: 5 + ((i * 61) % 88),
  top: 7 + ((i * 41) % 80),
  size: i % 3 === 0 ? 2.5 : 1.75,
  duration: 5.5 + (i % 5) * 1.6,
  delay: (i % 6) * 1.3,
}));

/** Drifting motes — CSS driven, so the main thread stays free. */
const MOTES = Array.from({ length: 10 }, (_, i) => ({
  id: i,
  left: (i * 67) % 100,
  top: 20 + ((i * 37) % 70),
  size: 1 + (i % 2) * 0.6,
  duration: 15 + (i % 5) * 3.5,
  delay: (i % 7) * 1.9,
  drift: ((i % 5) - 2) * 12,
}));

export function FocusRoom({
  toneRgb,
  isFocus,
  toneKey,
  reduceMotion,
  pageVisible,
}: {
  /** The phase tone's `r, g, b`, for the nebula's own glows. */
  toneRgb: string;
  isFocus: boolean;
  toneKey: ToneKey;
  reduceMotion: boolean;
  /** Ambient/infinite motion stops when the tab is not visible. */
  pageVisible: boolean;
}) {
  return (
    <>
      {/**
       * Atmosphere, in cheap layers — see docs/motion-budget.md.
       *
       * This is the room: deep space, a starfield, one galactic band, two
       * breathing orbital shells and a vignette. Nothing in this layer is
       * ever transformed — it is rastered once per mount and left alone, so
       * the whole sky costs one paint. The moving parts live above it.
       */}
      <div
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        {/* Deep space: cool at the top, falling to near-black at the feet. */}
        <div className="absolute inset-0 bg-[radial-gradient(125%_92%_at_50%_-16%,#0c1022_0%,#070812_46%,#030407_100%)]" />
        {/* The field — one static raster of eight dot layers. */}
        <div className="starfield absolute inset-0" />
        {/* One direction to the sky, masked so it never reads as a stripe. */}
        <div className="galaxy absolute inset-0" />
        {/* Orbital shells. They breathe; they never move the instrument. */}
        <div className="absolute left-1/2 top-1/2 size-[min(760px,120vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.05]" />
        <div className="absolute left-1/2 top-1/2 size-[min(560px,90vw)] -translate-x-1/2 -translate-y-1/2 animate-breathe rounded-full border border-white/[0.04] [animation-delay:-2s]" />
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_44%,transparent_22%,rgba(2,3,6,0.8)_100%)]" />
      </div>

      {/* Above the base, below the stars: the nebula only ever translates. */}
      <motion.div
        variants={focusAurora}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        <AnimatePresence>
          <motion.div
            key={`nebula-${toneKey}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.5, ease: EASE_SOFT }}
            className="absolute inset-0"
          >
            {/*
             * Two soft radial falloffs rather than two 130–150px blurs:
             * visually the same cloud, but a gradient rasterises once and
             * cheaply, where a big gaussian blur dominated the overlay's
             * first paints (measured — see docs/motion-budget.md).
             */}
            <div
              className="drift-a absolute inset-x-0 top-[-22%] mx-auto h-[600px] w-[820px] max-w-[132vw] rounded-full"
              style={{
                background: `radial-gradient(closest-side, rgba(${toneRgb},${
                  isFocus ? 0.26 : 0.1
                }), rgba(${toneRgb},${isFocus ? 0.12 : 0.045}) 45%, transparent 100%)`,
              }}
            />
            <div
              className="drift-b absolute -bottom-[30%] -right-[14%] size-[540px] max-w-[120vw] rounded-full"
              style={{
                background: `radial-gradient(closest-side, rgba(${toneRgb},${
                  isFocus ? 0.2 : 0.075
                }), rgba(${toneRgb},${isFocus ? 0.09 : 0.035}) 50%, transparent 100%)`,
              }}
            />
          </motion.div>
        </AnimatePresence>
      </motion.div>

      {/* The stars — the twinkle and the motes settle in together. */}
      <motion.div
        variants={focusLens}
        className="pointer-events-none absolute inset-0 overflow-hidden"
        aria-hidden
      >
        {pageVisible &&
          TWINKLERS.map((star) => (
            <span
              key={`star-${star.id}`}
              className={cn(
                "absolute rounded-full bg-ivory",
                !reduceMotion && "twinkle",
              )}
              style={
                {
                  left: `${star.left}%`,
                  top: `${star.top}%`,
                  width: star.size,
                  height: star.size,
                  opacity: 0.55,
                  "--twinkle-duration": `${star.duration}s`,
                  "--twinkle-delay": `${star.delay}s`,
                } as CSSProperties
              }
            />
          ))}

        {pageVisible &&
          !reduceMotion &&
          MOTES.map((mote) => (
            <span
              key={`mote-${mote.id}`}
              className={cn(
                "float-up absolute rounded-full",
                isFocus ? "bg-primary-soft/70" : "bg-ivory/55",
              )}
              style={
                {
                  left: `${mote.left}%`,
                  top: `${mote.top}%`,
                  width: mote.size,
                  height: mote.size,
                  "--float-duration": `${mote.duration}s`,
                  "--float-delay": `${mote.delay}s`,
                  "--drift": `${mote.drift}px`,
                } as CSSProperties
              }
            />
          ))}
      </motion.div>

      {/* Film grain last, and outside the push-in so it never re-rasters. */}
      <div
        aria-hidden
        className="grain pointer-events-none absolute inset-0 opacity-[0.045]"
      />
    </>
  );
}
