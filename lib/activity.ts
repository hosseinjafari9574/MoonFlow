import type { ActivityMap, DayActivity, Task } from "@/lib/types";
import { dayKey, dayKeyFromOffset } from "@/lib/format";

export type TaskFilter = "all" | "active" | "done";

export const EMPTY_DAY: DayActivity = { completed: 0, pomodoros: 0, focusMinutes: 0 };

export function getDay(activity: ActivityMap, key = dayKey()): DayActivity {
  return activity[key] ?? EMPTY_DAY;
}

function isMeaningful(day: DayActivity | undefined): boolean {
  if (!day) return false;
  return day.completed > 0 || day.pomodoros > 0 || day.focusMinutes > 0;
}

/**
 * Consecutive days with meaningful activity, counting back from today.
 * Today may still be empty without breaking the streak.
 */
export function currentStreak(activity: ActivityMap): number {
  let streak = 0;
  let offset = isMeaningful(getDay(activity, dayKey())) ? 0 : -1;
  while (offset > -365) {
    const day = activity[dayKeyFromOffset(offset)];
    if (!isMeaningful(day)) break;
    streak += 1;
    offset -= 1;
  }
  return streak;
}

/** Active tasks first (newest on top), completed tasks last (most recent first). */
export function sortTasks(tasks: Task[]): Task[] {
  const active = tasks.filter((t) => !t.completed);
  const done = tasks
    .filter((t) => t.completed)
    .sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0));
  active.sort((a, b) => b.createdAt - a.createdAt);
  return [...active, ...done];
}

export function allTags(tasks: Task[]): string[] {
  const set = new Set<string>();
  for (const task of tasks) for (const tag of task.tags) set.add(tag);
  return [...set].sort((a, b) => a.localeCompare(b));
}

/** Sort + apply the active filter and optional tag filter. */
export function filterTasks(
  tasks: Task[],
  filter: TaskFilter = "all",
  tagFilter: string | null = null,
): Task[] {
  return sortTasks(tasks).filter((task) => {
    if (filter === "active" && task.completed) return false;
    if (filter === "done" && !task.completed) return false;
    if (tagFilter && !task.tags.includes(tagFilter)) return false;
    return true;
  });
}

export function weekActivity(activity: ActivityMap): { key: string; label: string; minutes: number; completed: number; isToday: boolean }[] {
  const today = dayKey();
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const out = [];
  for (let offset = -6; offset <= 0; offset += 1) {
    const key = dayKeyFromOffset(offset);
    const day = activity[key] ?? EMPTY_DAY;
    const date = new Date();
    date.setDate(date.getDate() + offset);
    out.push({
      key,
      label: names[date.getDay()] ?? "",
      minutes: day.focusMinutes,
      completed: day.completed,
      isToday: key === today,
    });
  }
  return out;
}
