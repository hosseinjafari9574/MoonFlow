/**
 * Persisted-state normalisation.
 *
 * `localStorage` is the only place MoonFlow keeps user data, which makes it the
 * one place where a shape we no longer recognise can quietly destroy it.
 * zustand's persist middleware only consults `migrate` when the stored payload
 * carries a *numeric* version that differs from the current one: a payload
 * written before versioning existed (no `version` field) is merged verbatim,
 * and a version mismatch with no `migrate` at all is discarded outright.
 *
 * Both paths funnel through the normalisers below, which turn whatever the
 * browser hands back into state the app can actually run on — repairing what
 * is repairable and dropping only entries that carry no information
 * (a task with no title, a day key that isn't a day key).
 */

import { TIMER_PRESETS } from "@/lib/constants";
import { uid } from "@/lib/format";
import type {
  ActivityMap,
  Priority,
  Settings,
  Task,
  TimerMode,
  TimerPresetId,
} from "@/lib/types";

export interface PersistedTodos {
  tasks: Task[];
  activity: ActivityMap;
  settings: Settings;
}

export interface PersistedTimer {
  preset: TimerPresetId;
  mode: TimerMode;
  running: boolean;
  endsAt: number | null;
  remainingMs: number;
  sessions: number;
  flushedMs: number;
  taskId: string | null;
}

export const DEFAULT_SETTINGS: Settings = { soundEnabled: true };

const PRIORITIES: readonly Priority[] = ["low", "medium", "high"];
const TIMER_MODES: readonly TimerMode[] = ["focus", "short", "long"];
const PRESET_IDS: readonly TimerPresetId[] = ["classic", "deep"];

/** Ceiling for day counters — anything larger is corruption, not a streak. */
const MAX_COUNT = 1_000_000;
const MAX_TAG_LENGTH = 40;
const MAX_TAGS_PER_TASK = 24;
const DAY_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isOneOf<T extends string>(
  value: unknown,
  options: readonly T[],
): value is T {
  return typeof value === "string" && (options as readonly string[]).includes(value);
}

/** Trimmed non-empty string, or `null` when there is nothing usable. */
function asString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function asFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Non-negative integer, clamped to a sane ceiling. */
function asCount(value: unknown, fallback = 0): number {
  const n = asFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(MAX_COUNT, Math.max(0, Math.floor(n)));
}

/** Epoch milliseconds — no ceiling, but never negative or fractional. */
function asEpoch(value: unknown, fallback: number): number {
  const n = asFiniteNumber(value);
  if (n === null || n <= 0) return fallback;
  return Math.floor(n);
}

/** Timestamp duration forced into `[0, max]`. */
function asClampedMs(value: unknown, max: number, fallback: number): number {
  const n = asFiniteNumber(value);
  if (n === null) return fallback;
  return Math.min(max, Math.max(0, Math.round(n)));
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const tags = new Set<string>();
  for (const raw of value) {
    const tag = asString(raw);
    if (!tag) continue;
    tags.add(tag.length > MAX_TAG_LENGTH ? tag.slice(0, MAX_TAG_LENGTH) : tag);
    if (tags.size >= MAX_TAGS_PER_TASK) break;
  }
  return [...tags];
}

/**
 * Repair a single task. A task survives as long as it still has a title: a
 * missing id is regenerated (nothing durable references a task id), and a
 * missing `createdAt` falls back to the entry's position in the stored array
 * so the user's ordering is preserved rather than collapsed.
 */
export function normalizeTask(
  value: unknown,
  fallbackCreatedAt = Date.now(),
): Task | null {
  if (!isRecord(value)) return null;
  const title = asString(value.title);
  if (!title) return null;
  const completedAt = asFiniteNumber(value.completedAt);
  return {
    id: asString(value.id) ?? uid(),
    title,
    completed: asBoolean(value.completed, false),
    priority: isOneOf(value.priority, PRIORITIES) ? value.priority : "medium",
    tags: normalizeTags(value.tags),
    createdAt: asEpoch(value.createdAt, fallbackCreatedAt),
    completedAt: completedAt !== null && completedAt > 0 ? completedAt : null,
    pomodoros: asCount(value.pomodoros),
    focusMinutes: asCount(value.focusMinutes),
  };
}

export function normalizeActivity(value: unknown): ActivityMap {
  if (!isRecord(value)) return {};
  const activity: ActivityMap = {};
  for (const [key, day] of Object.entries(value)) {
    if (!DAY_KEY_PATTERN.test(key) || !isRecord(day)) continue;
    activity[key] = {
      completed: asCount(day.completed),
      pomodoros: asCount(day.pomodoros),
      focusMinutes: asCount(day.focusMinutes),
    };
  }
  return activity;
}

export function normalizeSettings(value: unknown): Settings {
  return {
    soundEnabled: asBoolean(
      isRecord(value) ? value.soundEnabled : undefined,
      DEFAULT_SETTINGS.soundEnabled,
    ),
  };
}

export function normalizeTodos(value: unknown): PersistedTodos {
  const record = isRecord(value) ? value : {};
  const raw = Array.isArray(record.tasks) ? record.tasks : [];
  const now = Date.now();
  const tasks: Task[] = [];
  const seen = new Set<string>();
  raw.forEach((entry, index) => {
    // Newest first in storage, so count backwards when a stamp is missing.
    const task = normalizeTask(entry, now - index * 1_000);
    // A duplicated id would make one row drive another, so keep the first.
    if (!task || seen.has(task.id)) return;
    seen.add(task.id);
    tasks.push(task);
  });
  return {
    tasks,
    activity: normalizeActivity(record.activity),
    settings: normalizeSettings(record.settings),
  };
}

export function normalizeTimer(value: unknown): PersistedTimer {
  const record = isRecord(value) ? value : {};
  const preset: TimerPresetId = isOneOf(record.preset, PRESET_IDS)
    ? record.preset
    : "classic";
  const mode: TimerMode = isOneOf(record.mode, TIMER_MODES)
    ? record.mode
    : "focus";
  const presetConfig = TIMER_PRESETS[preset];
  const duration = presetConfig.durations[mode];
  const remainingMs = asClampedMs(record.remainingMs, duration, duration);
  // A running clock with no end stamp can never advance, so read it as paused.
  const endsAt = asFiniteNumber(record.endsAt);
  const running = asBoolean(record.running, false) && endsAt !== null;
  // Nor can more focus time be banked than has actually elapsed this session.
  const elapsed = Math.max(0, duration - remainingMs);
  return {
    preset,
    mode,
    running,
    endsAt: running ? endsAt : null,
    remainingMs,
    sessions: Math.min(asCount(record.sessions), presetConfig.longBreakAfter),
    flushedMs: Math.min(asClampedMs(record.flushedMs, elapsed, 0), elapsed),
    taskId: asString(record.taskId),
  };
}
