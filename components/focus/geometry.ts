import type { TimerMode } from "@/lib/types";

/**
 * The room's numbers — everything in Focus Mode that is arithmetic and nothing
 * else: where the moon's light comes from, the terminator its lit fraction
 * implies, where the satellite sits on its orbit, and the table the completion
 * burst is placed from.
 *
 * Kept apart from the components on purpose. A change to the *shape* of the
 * room cannot reach the store, the timer or the DOM from here, and
 * `scripts/verify-visuals.mjs` checks these numbers against the shipped build's
 * own pixels — including a gibbous session, where the terminator must bow the
 * other way.
 */

/**
 * Where the moon's light comes from, in percent of its own box. Its surface
 * gradient and the axis its terminator is turned on are both derived from this
 * one point, so the light never disagrees with itself.
 *
 * **The left, a little below the middle.** A session opens as a crescent on the
 * moon's left limb and the light grows across the disc toward the right, so the
 * moon fills from the left — the reverse of a real waxing moon, and the way this
 * one was asked to read. `MOON_NIGHT_AXIS` and the phase strip's terminator both
 * come off this point, so moving it turns the instrument *and* the four small
 * moons together (`.freebuff/design-probe.mjs` measures which limb is lit).
 *
 * This point has been walked along that axis rather than guessed at, and the
 * walk is the reason the numbers look arbitrary:
 *
 * - `{ x: 34, y: 76 }` — the lower left — put a half moon's terminator at
 *   **31.6° from the horizontal**: a shallow diagonal that read as a lens
 *   leaning in a corner rather than as a moon's edge.
 * - `{ x: 21, y: 60 }` — **71°**, and at that angle the four small moons read
 *   as upright slabs rather than as moons.
 * - `{ x: 25, y: 71 }` — **50°**, painted on a ladder of five angles through the
 *   component itself (`.freebuff/moon-samples.mjs`), and the first angle the
 *   small moons were asked for by name.
 *
 * The ask (2026-10-17, second pass) was *between* the last two — off 50°, not
 * back to 71° — and the middle came out at `{ x: 23, y: 65.5 }`: the night axis
 * 29.0° above the horizontal, the terminator **61.0°** from it.
 *
 * That was a step too far the other way: at 61° the four small moons read as
 * upright again (2026-10-18). The ask was *a little less*, between 61° and the
 * 50° before it — so the light steps back down the same axis, to
 * `{ x: 24, y: 68 }`: the night axis 34.7° above the horizontal, the terminator
 * **55.3°** from it, the midpoint of the last two by angle (55.5°) taken to the
 * whole percent. The sheet paints 61, 55 and 50 side by side through the
 * component itself, and `phase-probe.mjs` measures the shipped angle back off
 * the DOM.
 */
export const MOON_LIGHT = { x: 24, y: 68 } as const;

/**
 * The unit vector from the light, through the disc: the axis the terminator's
 * ellipse is turned on, and the direction its waist is measured along. Away from
 * the source, so it points up and to the right and the last of the light to go
 * is the lower-left limb — the one the highlight sits on.
 */
export const MOON_NIGHT_AXIS = (() => {
  const dx = MOON_LIGHT.x / 100 - 0.5;
  const dy = MOON_LIGHT.y / 100 - 0.5;
  const length = Math.hypot(dx, dy);
  return { x: -dx / length, y: -dy / length };
})();

/**
 * The colour the disc's own fill and its night side share, so the seam between
 * them can never be seen — the night side is the unlit moon, not a shadow drawn
 * on top of one.
 *
 * It is the `--moon-dark` token (app/globals.css) rather than a literal here,
 * which is also what lets the sample sheet paint a value through the real
 * component instead of hand-drawing a copy of it
 * (`.freebuff/moon-samples.mjs`) — and the token is where the *value* lives, with
 * the measurement behind it. What matters here is that the disc's fill and the
 * night side cut against a lifted grey: the moon is a body in shadow, and the
 * seam between its lit and unlit halves still cannot be seen.
 */
export const MOON_DARK = "var(--moon-dark)";

/**
 * The same body, a step lighter and a step greyer, for the phase strip's 14px
 * glyphs.
 *
 * Two sizes of one judgement, answered separately off the sample sheet: beside a
 * 300px disc a lifted grey competes with the clock and the dial's black was
 * called *much better*, but in a glyph the size of a fingerprint's whorl the
 * dark crescent has almost no area to read as a body with, and the same value
 * left it indistinguishable from the row's sky. `--moon-glyph` is that step —
 * 28 luma against the dial's 21, and hue-less where the dial is a blue-black —
 * so the strip and the dial part company on the value while sharing the geometry
 * (`phaseGeometry` reads `MOON_NIGHT_AXIS`, so the two are still the same moon
 * lit from the same side).
 */
export const MOON_GLYPH = "var(--moon-glyph)";

/**
 * The dark end of the cycle: no visible lit shape at all. The disc's own dark
 * body and the limb above it keep the moon from reading as a hole in the room.
 */
export const MOON_MIN_LIT = 0;

/*
 * The moon's *surface*: one photographic albedo disc, lit by the room's own
 * terminator rather than painted from gradients.
 *
 * The image is NASA's CGI Moon Kit colour map, reprojected orthographically to
 * a 1024px disc by `scripts/prepare-moon-texture.mjs` (`npm run prepare:moon`).
 * It is that map and not a full-moon photograph because the map is **base
 * colour before lighting** — a photograph carries the Sun's own shadows and
 * limb falloff, which would sit under this app's moving terminator as a second,
 * contradictory light. See `docs/moon.md` for the projection and the licence.
 *
 * The terminator is unchanged: it is still `phaseGeometry`'s exact great-circle
 * ellipse, so the surface swap buys texture, not a new shape. What the numbers
 * below do is make a photographic albedo (mean 165 luma, p05 123, p95 210) sit
 * inside a room whose sky is 8 and whose clock is white.
 */
export const MOON_TEXTURE_URL = "/moon/moon-disc.webp";

/**
 * How much of the albedo's own brightness the lit face keeps.
 *
 * 165 luma is a *photograph in daylight*; at full moon the disc has to stay
 * dimmer than the reading inside it or the clock loses its figure on the
 * surface. 0.62 puts the mean near 102 and the brightest maria near 130 — a
 * moon that is visibly a photograph, still clearly a body in space rather than
 * a lamp, and with the white readout legible above it (the scrim below buys
 * the rest). The same value is applied to the night side at a fraction.
 */
export const MOON_LIT_BRIGHTNESS = 0.62;

/**
 * A small contrast lift, because a linear dim keeps the maria but flattens the
 * difference between them and the highlands; 1.08 is the step that survives the
 * 0.62 dim without painting the surface as a high-contrast map.
 */
export const MOON_LIT_CONTRAST = 1.08;

/**
 * The night side is the same surface at 5% — *earthshine*, not a hole and not a
 * second flat fill.
 *
 * The number is set by the room's own darkness rather than by taste: the disc
 * sits on `--moon-dark` (21 luma, the token the strip and the old body shared),
 * and the night face must stay under 30 or it stops reading as shadow. At the
 * albedo's mean, 5% lands the body near 29 and its brightest maria near 30 — a
 * silhouette with the faintest texture in it, which is what an earthlit moon
 * actually is at this distance.
 */
export const MOON_NIGHT_OPACITY = 0.05;

/** Desaturating the night keeps it from reading as a colour rather than shadow. */
export const MOON_NIGHT_SATURATION = 0.55;

/**
 * The scrim under the clock: a soft, centred darkening so the white reading
 * keeps its contrast at the brightest phase.
 *
 * It is a *paint*, not a second moon: 0.55 at the centre falling to nothing by
 * 46% of the disc, which is where the readout's box ends and the maria begin to
 * read again. Without it the full face's highlands sit at 130 luma and the
 * clock's own 4.5:1 floor is not met at the phone's smaller type.
 */
export const MOON_SCRIM_OPACITY = 0.55;

/**
 * How much of the sphere's own falloff is laid over the photograph: a radial
 * shade from the light, so the limb turns away instead of ending as a cut-out
 * poster of a moon. 0.55 is the fraction the old gradient contributed at the
 * far edge; the photograph now supplies the detail, this supplies the volume.
 */
export const MOON_LIMB_SHADE = 0.55;

/** The phase glyph's disc, in its own 24-unit canvas. */
export const PHASE_RADIUS = 10;

/**
 * The terminator a real moon has, for a given lit fraction: the numbers the
 * phase glyph is drawn from.
 */
export interface PhaseGeometry {
  /**
   * The terminator's waist, in canvas units — how far past the centre (a phase
   * past half) or short of it (a crescent) the light reaches. Zero is a half
   * moon, whose terminator is the diameter itself.
   */
  waist: number;
  /** Which side of the waist the light is on: past half, the ellipse is lit. */
  pastHalf: boolean;
  /** The night axis' angle in the glyph's canvas, in degrees. */
  angle: number;
}

/**
 * The phase glyph is a moon, so its terminator is a moon's: a *great circle* on
 * the sphere, which in projection is an ellipse that always passes through both
 * poles of the disc, its waist `|2k − 1|` of the radius.
 *
 * It used to be a bite out of a second disc of the disc's own size — the
 * construction the mark itself is built from — and that construction cannot draw
 * a phase: with equal radii the two circles cross `acos(d/2r)` from the axis, so
 * the unlit region's horns stop short of the poles. At three quarters it spanned
 * **101°** of the rim instead of 180° and sat in the disc's corner with the far
 * limb still lit: a lens, where the waxing gibbous — the phase the cycle shows —
 * is the one shape that makes the difference unmissable. The instrument used to
 * be the same construction for paint-budget reasons, and had the same bug after
 * half; both sizes now draw this terminator. The instrument clips its light
 * layer with it (quantised to a thousandth, so the disc repaints about once a
 * second rather than on all ~7500 ticks), and the strip, four static rasters,
 * draws it directly.
 *
 * The glyph is drawn in `components/focus/moon.tsx` as the half-plane the light
 * occupies — cut by the diameter through the centre, which is exactly where a
 * half moon's terminator lies — with this ellipse either left lit (past half) or
 * cut out of it (a crescent).
 */
export function phaseGeometry(lit: number): PhaseGeometry {
  const k = Math.min(1, Math.max(0, lit));
  return {
    waist: Math.abs(2 * k - 1) * PHASE_RADIUS,
    pastHalf: k >= 0.5,
    angle: (Math.atan2(MOON_NIGHT_AXIS.y, MOON_NIGHT_AXIS.x) * 180) / Math.PI,
  };
}

/** Air between the progress ring and the orbit arc that circles it. */
export const ORBIT_GAP = 26;

/**
 * How far the moon's glow reaches past its own limb, in px — the halo's inset
 * measured from the moon's, so the bloom is the same fraction of the disc at
 * every size the room is given.
 */
export const HALO_AIR = 14;

/** How much of the orbit the satellite's trail covers — a little under a third. */
export const ORBIT_TRAIL = 0.3;

/** Radial burst directions for the completion celebration. */
export const CELEBRATION_SPARKS = Array.from({ length: 14 }, (_, i) => {
  const angle = (i / 14) * Math.PI * 2;
  const distance = 92 + (i % 3) * 32;
  return {
    id: i,
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    delay: (i % 5) * 0.045,
  };
});

export interface MoonGeometry {
  /** The disc's inset inside the instrument box, in px. */
  inset: number;
  /** The disc's own diameter, in px — the ring less its inset on both sides. */
  disc: number;
  /** The clock's type size, in px: a fifth of the disc it is read inside. */
  clockPx: number;
  /** Lit fraction of the disc; `0` at the dark end of the cycle. */
  lit: number;
}

/**
 * How far the moon is through its own cycle. Focus fills the disc; a break is
 * the same cycle run backwards, from the full face the session left to the dark
 * end. Reading the break's progress as `1 - progress` makes both hand-offs
 * continuous: focus `1` and break `0` are both full, and break `1` and the next
 * focus `0` are both dark.
 */
export function moonPhaseProgress(mode: TimerMode, progress: number): number {
  return mode === "focus" ? progress : 1 - progress;
}

/**
 * The moon's own progress, from the same `progress` the arc is drawn from: the
 * lit fraction of its disc. A paused clock has a progress that does not move, so
 * the moon freezes with it.
 */
export function moonGeometry(ringSize: number, progress: number): MoonGeometry {
  /*
   * The disc's inset, and with it the size of the reading inside it.
   *
   * 10% a side. It has been at both ends of this before: 13% left the moon
   * reading as a small object parked in the middle of a ring rather than as the
   * instrument the ring is drawn around, and 8.5% swung the other way — at 83% of
   * the dial the graduation ring had **18px** of air at the desktop size and
   * **4px** on a phone, so the moon's glow and sixty ticks crowded each other and
   * the instrument read busy rather than large. At 80% of the dial the ticks keep
   * 25px above them on the desktop and 10px on a phone — the moon is still the
   * largest thing in the instrument, and the ring around it is still a ring
   * (`.freebuff/asym-probe.mjs` reads the ratio back at four viewports).
   */
  const inset = Math.round(ringSize * 0.1);
  const disc = ringSize - inset * 2;
  /*
   * The clock was 0.235 of the *ring* (and 42px at the panel size), which is
   * over a quarter of the disc's own diameter — a number wider than the moon it
   * sits in. Scaling it from the disc instead, at a fifth of its diameter, is
   * what keeps the reading *inside* the moon rather than filling it.
   */
  const clockPx = Math.round(disc * 0.2);
  /*
   * A thousandth of the disc. `progress` changes five times a second, and the
   * terminator's path is a style: quantising it means the disc repaints about
   * once a second instead of 7500 times in a session, and a 0.1% step is a
   * third of a pixel on the largest moon the room draws.
   */
  const lit = Math.round((MOON_MIN_LIT + (1 - MOON_MIN_LIT) * progress) * 1000) / 1000;
  return { inset, disc, clockPx, lit };
}

export interface OrbitGeometry {
  /** Side of the orbit's box, in px — the ring plus its air on both sides. */
  size: number;
  radius: number;
  circumference: number;
  /** Length of the trail the satellite drags behind it. */
  trail: number;
  satelliteX: number;
  satelliteY: number;
}

export function orbitGeometry(ringSize: number): OrbitGeometry {
  const size = ringSize + ORBIT_GAP * 2;
  const radius = size / 2 - 1;
  const circumference = 2 * Math.PI * radius;
  const trail = circumference * ORBIT_TRAIL;
  const angle = Math.PI * 2 * ORBIT_TRAIL;
  return {
    size,
    radius,
    circumference,
    trail,
    satelliteX: size / 2 + radius * Math.cos(angle),
    satelliteY: size / 2 + radius * Math.sin(angle),
  };
}
