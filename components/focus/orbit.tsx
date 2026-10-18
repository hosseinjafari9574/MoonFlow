"use client";

import { orbitGeometry, ORBIT_GAP } from "@/components/focus/geometry";
import type { Tone, ToneKey } from "@/lib/tone";

/**
 * One satellite on a slow orbit, its trail fading behind it.
 *
 * The rotation is an HTML transform on a box that holds the SVG
 * (`.orbit-spin` in app/globals.css): rotating *inside* an SVG is a layout
 * change in Blink and lays the document out every frame — the same finding that
 * moved the ring's comet head into a wrapper div (docs/motion-budget.md).
 */
export function SatelliteOrbit({
  tone,
  toneKey,
  ringSize,
}: {
  tone: Tone;
  toneKey: ToneKey;
  /** The dial's size — the orbit derives all of itself from it. */
  ringSize: number;
}) {
  const { size, radius, circumference, trail, satelliteX, satelliteY } =
    orbitGeometry(ringSize);

  return (
    <div
      aria-hidden
      className="orbit-spin pointer-events-none absolute"
      style={{ inset: -ORBIT_GAP }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="absolute inset-0"
      >
        <defs>
          <linearGradient
            id={`orbit-trail-${toneKey}`}
            x1="1"
            y1="0.05"
            x2="0.1"
            y2="0.9"
          >
            <stop offset="0%" stopColor={tone.soft} stopOpacity="0.05" />
            <stop offset="100%" stopColor={tone.soft} stopOpacity="0.32" />
          </linearGradient>
        </defs>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={`url(#orbit-trail-${toneKey})`}
          strokeWidth={1.25}
          strokeLinecap="round"
          strokeDasharray={`${trail} ${circumference - trail}`}
        />
        <circle
          cx={satelliteX}
          cy={satelliteY}
          r={1.9}
          fill={tone.soft}
          opacity={0.8}
        />
      </svg>
    </div>
  );
}
