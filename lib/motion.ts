import type { Transition, Variants } from "framer-motion";

/**
 * MoonFlow motion system — one language for the whole app.
 * Every animation resolves on one of these curves, springs or durations,
 * so nothing feels like it was tuned in isolation.
 */

/** Signature curves. `expo` for arrivals, `soft` for departures. */
export const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];
export const EASE_SOFT: [number, number, number, number] = [0.22, 1, 0.36, 1];
export const EASE_IN_OUT: [number, number, number, number] = [0.65, 0, 0.35, 1];

/** Durations, in seconds. */
export const DURATION = {
  instant: 0.12,
  quick: 0.2,
  base: 0.32,
  slow: 0.6,
  cinematic: 1.2,
} as const;

/** Springs, from snappy feedback to slow material settling. */
export const SPRING = {
  pop: { type: "spring", stiffness: 620, damping: 30 },
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
  gentle: { type: "spring", stiffness: 260, damping: 26 },
  molasses: { type: "spring", stiffness: 120, damping: 22 },
} as const satisfies Record<string, Transition>;

/** A row / card arriving in a list. */
export const listItem: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: SPRING.snappy },
  exit: { opacity: 0, x: -14, transition: { duration: DURATION.quick, ease: EASE_SOFT } },
};

/** Container that staggers its children in. */
export const listContainer: Variants = {
  show: { transition: { staggerChildren: 0.045, delayChildren: 0.04 } },
};

/** Generic rise-in used by stats, panels and dialog content. */
export const riseIn: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_SOFT } },
  exit: { opacity: 0, y: -8, transition: { duration: DURATION.quick } },
};

/**
 * Focus Mode — one camera move, in layers.
 *
 * The shell darkens the room, the lens pushes the atmosphere in from the far
 * end of a shot, and the stage lifts the session into place while its items
 * cascade behind two shutters that close and lift again. Exit runs the same
 * move in reverse, and much faster: arriving should feel cinematic, leaving
 * should feel immediate.
 *
 * Only transform and opacity are animated on the big layers — the one filter
 * in the move lives on the ring itself (`components/focus-mode.tsx`), where it
 * is small enough to stay compositor-friendly.
 */
export const focusShell: Variants = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: 0.26, ease: EASE_SOFT } },
  exit: { opacity: 0, transition: { duration: 0.4, ease: EASE_SOFT, delay: 0.04 } },
};

/**
 * The room, split in two on purpose.
 *
 * `focusAurora` carries the cloud and only ever *translates* — a scaling layer
 * forces the browser to re-raster a 130–150px blur on every frame, which
 * measured as ~45% of the entry's dropped frames. `focusLens` carries the cheap
 * drifting specks and settles them in behind it.
 */
export const focusAurora: Variants = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 1.4, ease: EASE_SOFT } },
  exit: { opacity: 0, transition: { duration: 0.3, ease: EASE_SOFT } },
};

/**
 * The speck layer's settle — a translate, never a scale.
 *
 * It used to push in (`scale: 1.05 → 1`), and the specks are what could not
 * take it: they are 1–2.5px wide, so a scaling ancestor resamples each one on
 * every frame of the move. On a phone DPR (2.6–3) that makes whole dots flicker
 * in and out and crawl, which is the shimmer reported from the Android build.
 * A translate and a fade read as the same drift-in and cost no resampling.
 */
export const focusLens: Variants = {
  hidden: { opacity: 0, y: 16 },
  show: { opacity: 1, y: 0, transition: { duration: 1.05, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, y: 12, transition: { duration: 0.36, ease: EASE_SOFT } },
};

/**
 * The session column — rises, then hands its children a cascade.
 *
 * No `scale`: this column contains the progress ring, whose arc carries a
 * drop-shadow filter, and scaling a filtered subtree makes the browser
 * re-rasterise the filter on every frame of the entry.
 */
export const focusStage: Variants = {
  hidden: { opacity: 0, y: 22 },
  show: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.9,
      ease: EASE_OUT_EXPO,
      delay: 0.1,
      delayChildren: 0.3,
      staggerChildren: 0.07,
    },
  },
  exit: {
    opacity: 0,
    y: -12,
    transition: {
      duration: 0.26,
      ease: EASE_SOFT,
      staggerChildren: 0.04,
      staggerDirection: -1,
    },
  },
};

/** A row inside the stage; the stage's stagger spaces the rows out. */
export const focusItem: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { duration: DURATION.slow, ease: EASE_OUT_EXPO } },
  exit: { opacity: 0, y: -10, transition: { duration: 0.16, ease: EASE_SOFT } },
};
