import type { TimerMode } from "@/lib/types";

/**
 * Phase tones. Focus carries the app's single electric accent; breaks drain
 * to a warm ivory haze — no hue at all — so the room visibly changes colour
 * when the work phase changes.
 */
export interface Tone {
  solid: string;
  soft: string;
  from: string;
  to: string;
  /** `r, g, b` for building rgba() glows. */
  rgb: string;
  hot: boolean;
}

export const TONES = {
  focus: {
    solid: "#4b62ff",
    soft: "#8b99ff",
    from: "#8b99ff",
    to: "#3f52e8",
    rgb: "75, 98, 255",
    hot: true,
  },
  break: {
    solid: "#e8e2d6",
    soft: "#f2efe9",
    from: "#f2efe9",
    to: "#c9c1b1",
    rgb: "232, 226, 214",
    hot: false,
  },
} as const satisfies Record<"focus" | "break", Tone>;

export type ToneKey = keyof typeof TONES;

/** Both break flavours share the ivory tone. */
export function toneKeyForMode(mode: TimerMode): ToneKey {
  return mode === "focus" ? "focus" : "break";
}

export function toneForMode(mode: TimerMode): Tone {
  return TONES[toneKeyForMode(mode)];
}
