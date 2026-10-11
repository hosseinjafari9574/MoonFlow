"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Flame, Timer } from "lucide-react";

import { currentStreak, getDay, weekActivity } from "@/lib/activity";
import { formatDuration } from "@/lib/format";
import { EASE_OUT_EXPO } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";

export function StatsPanel() {
  const activity = useTodoStore((state) => state.activity);
  const reduceMotion = useReducedMotion();

  const today = getDay(activity);
  const streak = currentStreak(activity);
  const week = useMemo(() => weekActivity(activity), [activity]);
  const peakMinutes = Math.max(25, ...week.map((day) => day.minutes));
  const weekTotal = week.reduce((sum, day) => sum + day.minutes, 0);

  /* A completed task "lands" in the counter. */
  const [landing, setLanding] = useState(false);
  const previousCompleted = useRef(today.completed);

  useEffect(() => {
    if (today.completed > previousCompleted.current && !reduceMotion) {
      previousCompleted.current = today.completed;
      setLanding(true);
      const timeout = window.setTimeout(() => setLanding(false), 900);
      return () => window.clearTimeout(timeout);
    }
    previousCompleted.current = today.completed;
  }, [today.completed, reduceMotion]);

  const stats = [
    {
      key: "completed",
      label: "Completed",
      value: `${today.completed}`,
      note: "tasks today",
      icon: Check,
      accent: "text-ivory",
    },
    {
      key: "focus",
      label: "Focus",
      value: formatDuration(today.focusMinutes),
      note: `${today.pomodoros} session${today.pomodoros === 1 ? "" : "s"}`,
      icon: Timer,
      accent: "text-primary-soft",
    },
    {
      key: "streak",
      label: "Streak",
      value: `${streak}`,
      note: streak === 1 ? "day running" : "days running",
      icon: Flame,
      accent: streak > 0 ? "text-achievement" : "text-foreground",
    },
  ];

  return (
    <section className="panel overflow-hidden" aria-label="Today's stats">
      <div className="flex items-center justify-between px-5 pt-4">
        <h2 className="text-micro font-semibold uppercase text-muted-foreground">
          Today
        </h2>
        <span className="font-mono text-micro text-muted-foreground/80">
          {weekTotal > 0 ? `${formatDuration(weekTotal)} this week` : "a clean slate"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-3 divide-x divide-white/[0.06] px-1 pb-4">
        {stats.map((stat) => (
          <div key={stat.key} className="min-w-0 px-2 sm:px-4">
            <div className="flex items-center gap-1 sm:gap-1.5">
              <stat.icon
                className={cn(
                  "size-3.5 shrink-0 max-[20rem]:hidden",
                  stat.accent,
                )}
                aria-hidden
              />
              {/* "COMPLETED" is the widest label; on phones it needs a smaller
                  step and tighter tracking so the icon can stay beside it. */}
              <span className="truncate text-micro font-semibold uppercase text-muted-foreground max-sm:text-[10px] max-sm:tracking-[0.08em]">
                {stat.label}
              </span>
            </div>
            <div className="relative mt-2">
              <motion.p
                key={`${stat.key}-${stat.value}`}
                initial={reduceMotion ? false : { opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, ease: EASE_OUT_EXPO }}
                className={cn(
                  "font-mono text-[26px] font-medium leading-none tracking-[-0.02em]",
                  stat.accent,
                )}
              >
                {stat.value}
              </motion.p>
              {stat.key === "completed" && (
                <AnimatePresence>
                  {landing && (
                    <motion.span
                      key="landing"
                      aria-hidden
                      initial={{ opacity: 0, y: -16, scale: 0.55 }}
                      animate={{
                        opacity: [0, 1, 1, 0],
                        y: [-16, 0, 0, -8],
                        scale: [0.55, 1.12, 1, 0.9],
                      }}
                      exit={{ opacity: 0 }}
                      transition={{
                        duration: 0.88,
                        times: [0, 0.25, 0.7, 1],
                        ease: EASE_OUT_EXPO,
                      }}
                      className="pointer-events-none absolute -top-1.5 right-2 grid size-5 place-items-center rounded-full bg-ivory text-[#0a0a0b] shadow-[0_8px_20px_-8px_rgba(232,226,214,0.9)]"
                    >
                      <Check className="size-3" strokeWidth={3.5} />
                    </motion.span>
                  )}
                </AnimatePresence>
              )}
            </div>
            <p className="mt-1.5 truncate text-caption text-muted-foreground/85">
              {stat.note}
            </p>
          </div>
        ))}
      </div>

      <div className="px-5 pb-5">
        <div className="hairline" />
        <div className="mt-4 flex items-baseline justify-between">
          <h3 className="text-micro font-semibold uppercase text-muted-foreground">
            Last 7 days
          </h3>
          <span className="font-mono text-micro text-muted-foreground/80">
            focus minutes
          </span>
        </div>
        <div
          className="mt-3.5 flex h-24 items-end gap-2 border-b border-white/[0.06] pb-px"
          role="img"
          aria-label={`Focus minutes over the last seven days: ${week
            .map((day) => `${day.label} ${day.minutes}`)
            .join(", ")}`}
        >
          {week.map((day) => {
            const height = Math.max(5, (day.minutes / peakMinutes) * 100);
            return (
              <div
                key={day.key}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1.5"
                title={`${day.label}: ${day.minutes}m focused, ${day.completed} completed`}
              >
                <motion.span
                  initial={reduceMotion ? false : { height: 0 }}
                  animate={{ height: `${height}%` }}
                  transition={{
                    type: "spring",
                    stiffness: 170,
                    damping: 22,
                    delay: 0.04,
                  }}
                  className={cn(
                    "w-full max-w-[16px] rounded-t-[3px]",
                    day.isToday
                      ? "bg-gradient-to-t from-primary/45 to-primary-soft"
                      : day.minutes > 0
                        ? "bg-gradient-to-t from-primary/15 to-primary/45"
                        : "bg-white/[0.06]",
                  )}
                />
                <span
                  className={cn(
                    "font-mono text-[10px] uppercase",
                    day.isToday
                      ? "text-foreground"
                      : "text-muted-foreground/80",
                  )}
                >
                  {day.label.slice(0, 1)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
