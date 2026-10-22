# The moon's surface

The dial's moon is not painted. It is a **photograph of the Moon's albedo**,
reprojected into the disc the room draws, and then lit by the room's own
terminator. This file is the record of where that image comes from, how it is
projected, and what the four numbers around it were chosen against.

- Component: [`components/focus/moon.tsx`](../components/focus/moon.tsx) — `MoonBody`
- Numbers: [`components/focus/geometry.ts`](../components/focus/geometry.ts) — `MOON_TEXTURE_URL` and the five surface constants
- Asset: [`public/moon/moon-disc.webp`](../public/moon/moon-disc.webp) — 1024×1024, 158 KB
- Build step: [`scripts/prepare-moon-texture.mjs`](../scripts/prepare-moon-texture.mjs) — `npm run prepare:moon`
- Checks: `npm run verify:visuals`, the `moon/*` and `desktop/*` measurements

## Why base colour, not a photograph of the full moon

A photograph of a full moon carries the Sun's own lighting: the shadows in every
crater, and the limb falloff of a sphere lit from one side. Drawing this room's
terminator over it would put a second, contradictory light on the same disc — a
crescent whose lit limb still shows the full moon's own shadows. NASA's CGI Moon
Kit publishes the **base-colour map** instead: the albedo before lighting, which
is exactly the surface a renderer is supposed to light itself. That is the file
this asset is built from.

It is also why the night side can be the *same photograph* at 5% rather than a
second flat fill: one surface at two exposures is what an earthlit moon looks
like, and it keeps the seam between day and night from being a shape pasted onto
a hole.

## The source

| | |
| --- | --- |
| File | `lroc_color_2k.jpg` (NASA SVS, CGI Moon Kit, 2025 revision) |
| URL | <https://svs.gsfc.nasa.gov/vis/a000000/a004700/a004720/lroc_color_2k.jpg> |
| Size | 2048×1024, equirectangular (full 360° longitude × 180° latitude) |
| SHA-256 | `f7130a1822681fa7512d7dcfd40db8c10b9ba4f06777910348698260ed7a2170` |
| Licence | NASA imagery — public domain, no attribution required (credited here anyway) |

The digest is pinned in the prep script. A replaced map fails the build step
loudly instead of quietly changing the moon; review the new map, then update the
pinned hash. That is how the previous revision was caught: its bottom **96 rows
were pure black**, and since those rows are the map's south pole, the projection
painted them as a black cap across the bottom of the disc — the shape was right
and only the photograph was missing. The current revision has surface to the
pole, and `moon/texture-caps` samples the committed disc at both of its poles so
a letterboxed map cannot come back through a routine rebuild.

The source is cached at `.freebuff/moon-source.jpg` (ignored). The **output** is
committed, so a checkout builds without the download and without Chrome.

## The projection

The room needs a disc — a sphere seen from here — not an equirectangular map, so
the script does the projection itself, in a headless browser, because the browser
is the only image decoder this project has without adding a dependency.

For every output pixel, and for a 4×4 grid of subsamples inside it:

1. Map the subsample to the unit disc, `u, v ∈ [−1, 1]`, and skip it if
   `u² + v² > 1`.
2. Invert the orthographic projection: `z = √(1 − u² − v²)` is the component
   toward the viewer, `lat = asin(−v)`, `lon = atan2(u, z)`. The **near side**
   faces out, and the map's central meridian (`lon = 0`) is the face the Moon
   keeps toward us.
3. Sample the map bilinearly, wrapping in longitude and clamping in latitude.
4. Average the covered subsamples into the pixel, and use the coverage count as
   the pixel's alpha.

The 4×4 grid is the antialiasing: the limb is where an equirectangular map is
compressed hardest, and without supersampling the edge is a staircase. Alpha is
partial coverage at the rim and 255 inside it.

Two properties matter and are easy to get wrong:

- **Latitude is negated** (`asin(−v)`): canvas `y` grows downward, latitude grows
  upward. Dropping the sign flips the Moon upside down — it still looks like a
  moon, which is exactly why it needs saying.
- **Longitude comes from `atan2(u, z)`, not from `u` alone.** Using `u` directly
  stretches the map toward the limb instead of compressing it there.

The script prints the surface's luma distribution after projecting, which is what
the treatment below is chosen against:

```
surface mean 165.8 luma · p05 123.6 · p50 167.8 · p95 210.5 · 822056 opaque px
```

165 is a *photograph in daylight*. The room's sky is 8 and its clock is white, so
the disc has to be dimmed before it can be a body in space.

## The five numbers

All five are in `geometry.ts` with the measurement behind them; these are the
readings the shipped build produced (`npm run verify:visuals`, phone at 390×844
and desktop at 1280×900).

| Constant | Value | Measured |
| --- | --- | --- |
| `MOON_LIT_BRIGHTNESS` | 0.62 | lit surface median **97** luma, p95 **133** |
| `MOON_LIT_CONTRAST` | 1.08 | maria stay distinct after the dim without becoming a map |
| `MOON_NIGHT_OPACITY` | 0.05 | night side **25.8** luma (ceiling 30) |
| `MOON_LIMB_SHADE` | 0.55 | night limb falls **9–10** luma from 0.68R to 0.92R |
| `MOON_SCRIM_OPACITY` | 0.55 | clock contrast **7.9:1** at full moon (9.8:1 on desktop) |

- **0.62 brightness** puts the disc under the reading. At full moon the clock sits
  on the brightest surface the room ever shows, and the type is white; anything
  near the albedo's own 165 would turn the face into a lamp.
- **1.08 contrast** is a small lift, because a linear dim flattens the difference
  between maria and highlands. More than this starts painting the photograph as a
  high-contrast map.
- **0.05 night** is the albedo at 5% over `--moon-dark`: earthshine, not a hole and
  not a second flat fill. Under 30 luma is the hard ceiling for the unlit face; at
  0.35 it measures 59.6 and stops reading as shadow (verified as a drift).
- **0.55 limb** is the sphere over the photograph: a radial shade from the light's
  position, so the disc turns away at the far edge instead of ending as a cut-out
  poster of a moon. It rides *inside* the clipped lit layer, so it moves with the
  phase rather than sitting on the whole disc.
- **0.55 scrim** is a soft, centred darkening under the clock, fading out by 46% of
  the disc where the maria begin reading again. It is a paint, not a second moon,
  and it is constant: the phase must not also move the light the type sits on.
  The bar is **7:1** (WCAG AAA), not the 4.5:1 body text would need, because the
  reading is the one thing the room exists to show. Without the scrim the same
  measurement is 5.6:1 — which is why the check is 7 and not 4.5.

## The layers, and why they are split this way

```
[data-part="disc"]          rounded-full, overflow-hidden, --moon-dark
  svg                       the clipPath definition (objectBoundingBox)
  [data-part="night"]       the texture at 5%, desaturated
  [data-part="lit"]         clip-path: url(#…)
    [data-part="surface"]   the texture, brightness/contrast filtered
    [data-part="shade"]     highlight + far-limb falloff
  [data-part="scrim"]       the paint under the clock
```

- **The clip is on the wrapper, the filter on its child.** No element carries a
  `filter` and a `clip-path` at once. `clip-path: url()` on a filtered layer is
  the pairing Safari has drawn wrongly before; keeping them on separate elements
  makes the question moot rather than needing a fallback.
- **The clip is still the exact terminator.** `litPath` is unchanged; it is the
  great-circle ellipse through both poles whose waist is `|2k − 1|` of the radius
  (`phaseGeometry`). The surface swap bought texture, not a new shape.
- **The night layer is under the lit layer**, not a second shape beside it, so the
  two are one surface at two exposures. The disc's own `--moon-dark` background
  keeps it a body even where the texture is transparent at the corners.
- `MoonLimb` is unchanged and still sits above all of this: its hairline, rim light
  and inset falloff are what keep a new moon a moon rather than a hole.
- The `.webp` is warmed by [`lib/moon-texture.ts`](../lib/moon-texture.ts) about a
  second after the card settles, so opening Focus Mode never paints a bare disc
  and then fills it in during the arrival.

## Rebuilding the asset

```bash
npm run prepare:moon                          # 1024px, quality 0.92 — the shipped asset
node scripts/prepare-moon-texture.mjs --size 1536 --quality 0.9
```

It needs a local Chrome or Edge (set `CHROME_PATH` if none is in the usual
places) and network access on the first run. The browser is driven over the
DevTools protocol from the same helper shape as `verify-visuals`, so there is no
image dependency in `package.json` and nothing runs during `next build`.

After regenerating, run `npm run verify:visuals`: `moon/texture-asset` checks the
served file is WebP, square and at least 768px, `moon/texture-caps` checks the
disc's poles carry surface rather than a letterbox band, and
`desktop/surface-texture` checks the pixels still carry terrain rather than a
smooth fill.

## What the checks measure

`npm run verify:visuals` reads the layer structure by `data-part`, not by child
index, and then:

- **the treatment**: the texture URL, the brightness/contrast filter, the night
  opacity, the limb shade, the scrim's centre alpha, and that the shade is inside
  the clipped layer;
- **the asset**: fetched by the page, checking status, MIME type, size,
  dimensions and that both poles are surface (a black south cap is what made the
  first build's moon end in a straight line);
- **the surface**: median and p95 of the lit face, the local luma variation
  (`textureRms` — a photograph is not smooth at the pixel scale; a gradient is),
  and the night limb's falloff;
- **the reading**: type versus the scrimmed surface under it, as a WCAG contrast
  ratio, at full moon on the phone and four-fifths lit at the desktop's largest
  disc.

Deliberate drifts, run against this build: the night opacity at 0.35 fails three
`night-side-dark` checks; a flat gradient instead of the texture fails
`desktop/surface-texture` (0.54 against a 1.0 floor, where the photograph reads
1.25); removing the scrim fails both `clock-contrast` checks (5.6:1 and 6.2:1
against the 7:1 bar); and rebuilding the disc from a map whose south 96 rows are
black — the asset this project shipped first, to the byte — fails
`moon/texture-caps` alone, south cap 0.1 luma against the 40 floor while the
north cap stays at 207 and the other 99 measurements hold. That last one is the
useful shape of the check: the fault was invisible to every geometric measure,
because the shape was right and only the photograph was missing. Each drift was
restored and the green run repeated.

## Credit

The surface is NASA's **CGI Moon Kit** (NASA Scientific Visualization Studio,
using Lunar Reconnaissance Orbiter data), released as public domain NASA
imagery. It is reprojected unmodified — the only operations are the projection,
the alpha coverage, the dim and the shading described above.
