/**
 * Tiny WebAudio chime engine — no audio assets, everything is synthesised.
 * The context is created lazily on the first user gesture so autoplay
 * policies are respected.
 */

export type SoundName = "complete" | "session-end" | "break-end" | "soft";

let context: AudioContext | null = null;

function get_context(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor =
    window.AudioContext ??
    (window as (Window & { webkitAudioContext?: typeof AudioContext }))
      .webkitAudioContext;
  if (!Ctor) return null;
  if (!context) context = new Ctor();
  if (context.state === "suspended") void context.resume();
  return context;
}

interface ToneOptions {
  frequency: number;
  at?: number;
  duration?: number;
  gain?: number;
  type?: OscillatorState["type"];
  detune?: number;
}

type OscillatorState = OscillatorNode;

function tone(ctx: AudioContext, options: ToneOptions) {
  const {
    frequency,
    at = 0,
    duration = 0.45,
    gain = 0.16,
    type = "sine",
    detune = 0,
  } = options;
  const start = ctx.currentTime + at;

  const oscillator = ctx.createOscillator();
  const amp = ctx.createGain();
  oscillator.type = type;
  oscillator.frequency.value = frequency;
  oscillator.detune.value = detune;

  amp.gain.setValueAtTime(0.0001, start);
  amp.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  amp.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(amp).connect(ctx.destination);
  oscillator.start(start);
  oscillator.stop(start + duration + 0.05);
}

const PRESETS: Record<SoundName, ToneOptions[]> = {
  // Gentle rising arpeggio when a task is completed.
  complete: [
    { frequency: 659.25, duration: 0.4, gain: 0.12 },
    { frequency: 830.61, at: 0.09, duration: 0.4, gain: 0.11 },
    { frequency: 987.77, at: 0.18, duration: 0.6, gain: 0.1 },
  ],
  // Warm bell for the end of a focus session.
  "session-end": [
    { frequency: 880, duration: 1.1, gain: 0.14 },
    { frequency: 1320, at: 0.02, duration: 0.9, gain: 0.06, detune: 6 },
    { frequency: 440, duration: 1.2, gain: 0.07 },
  ],
  // Two soft ascending notes when a break is over.
  "break-end": [
    { frequency: 587.33, duration: 0.35, gain: 0.12 },
    { frequency: 880, at: 0.16, duration: 0.7, gain: 0.12 },
  ],
  // Subtle tick used for focus start / mode switches.
  soft: [{ frequency: 523.25, duration: 0.22, gain: 0.08, type: "triangle" }],
};

export function playSound(name: SoundName) {
  const ctx = get_context();
  if (!ctx) return;
  for (const options of PRESETS[name]) tone(ctx, options);
}

/** Warm the audio context up after the first gesture (avoids a delayed first sound). */
export function primeAudio() {
  get_context();
}
