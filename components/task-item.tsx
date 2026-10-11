"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Flame, Maximize2, Pencil, Timer, Trash2 } from "lucide-react";

import { PRIORITY_META } from "@/lib/constants";
import { formatRelative } from "@/lib/format";
import { EASE_OUT_EXPO, listItem, SPRING } from "@/lib/motion";
import type { Task } from "@/lib/types";
import { cn } from "@/lib/utils";
import { startFocusForTask } from "@/lib/timer-actions";
import {
  deleteTaskWithFeedback,
  toggleTaskWithFeedback,
} from "@/lib/task-actions";
import { useUiStore } from "@/store/use-ui-store";

export function TaskItem({ task }: { task: Task }) {
  const [pulse, setPulse] = useState(false);
  const selected = useUiStore((state) => state.selectedId === task.id);
  const select = useUiStore((state) => state.select);
  const openFocus = useUiStore((state) => state.openFocus);
  const openEdit = useUiStore((state) => state.openEdit);

  const priority = PRIORITY_META[task.priority];

  function handleToggle() {
    const next = toggleTaskWithFeedback(task);
    if (next) {
      setPulse(true);
      window.setTimeout(() => setPulse(false), 760);
    }
  }

  function handleDelete() {
    deleteTaskWithFeedback(task);
  }

  function handleStartTimer() {
    useUiStore.getState().select(task.id);
    startFocusForTask(task.id);
  }

  const actionClass =
    "grid size-8 cursor-pointer place-items-center rounded-lg text-muted-foreground transition-colors duration-200 hover:bg-white/[0.07] hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring";

  return (
    <motion.li
      layout="position"
      variants={listItem}
      transition={SPRING.snappy}
      data-task-id={task.id}
      className="group relative"
      onFocus={() => select(task.id)}
      onClick={() => select(task.id)}
    >
      <motion.div
        layout="position"
        animate={pulse ? { scale: [1, 1.012, 1] } : { scale: 1 }}
        transition={{ duration: 0.4, ease: EASE_OUT_EXPO }}
        className={cn(
          "relative flex items-start gap-3 overflow-hidden rounded-xl py-3 pl-3.5 pr-3 transition-colors duration-300",
          selected ? "bg-white/[0.045]" : "hover:bg-white/[0.022]",
        )}
      >
        {/* Selection rail slides between rows. */}
        <AnimatePresence>
          {selected && (
            <motion.span
              aria-hidden
              layoutId="selection-rail"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={SPRING.snappy}
              className="absolute left-0 top-1/2 h-7 w-[2px] -translate-y-1/2 rounded-full bg-primary shadow-[0_0_14px_rgba(75,98,255,0.8)]"
            />
          )}
        </AnimatePresence>

        {/* Completion light sweep */}
        <AnimatePresence>
          {pulse && task.completed && (
            <motion.span
              key="sheen"
              aria-hidden
              className="pointer-events-none absolute inset-0"
              initial={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.25 } }}
            >
              <motion.span
                className="absolute inset-y-0 w-1/2 bg-gradient-to-r from-transparent via-ivory/10 to-transparent"
                initial={{ x: "-120%" }}
                animate={{ x: "320%" }}
                transition={{ duration: 0.75, ease: EASE_OUT_EXPO }}
              />
            </motion.span>
          )}
        </AnimatePresence>

        <motion.button
          type="button"
          role="checkbox"
          aria-checked={task.completed}
          aria-label={
            task.completed
              ? `Mark “${task.title}” as not completed`
              : `Complete “${task.title}”`
          }
          whileTap={{ scale: 0.88 }}
          onClick={(event) => {
            event.stopPropagation();
            handleToggle();
          }}
          className={cn(
            "relative mt-0.5 grid size-[22px] shrink-0 cursor-pointer place-items-center rounded-full border transition-colors duration-300",
            task.completed
              ? "border-ivory bg-ivory text-[#0a0a0b]"
              : "border-white/25 text-transparent hover:border-ivory/70",
          )}
        >
          {pulse && task.completed && (
            <motion.span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-full border border-ivory"
              initial={{ scale: 1, opacity: 0.85 }}
              animate={{ scale: 2.1, opacity: 0 }}
              transition={{ duration: 0.6, ease: EASE_OUT_EXPO }}
            />
          )}
          <svg viewBox="0 0 24 24" className="size-3.5" aria-hidden>
            <motion.path
              d="M5 12.5 10 17.5 19 7.5"
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={false}
              animate={{ pathLength: task.completed ? 1 : 0 }}
              transition={{ duration: 0.26, ease: EASE_OUT_EXPO }}
            />
          </svg>
        </motion.button>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                select(task.id);
              }}
              className={cn(
                "relative max-w-full truncate text-left text-[14px] font-medium leading-snug transition-colors duration-300",
                task.completed
                  ? "text-muted-foreground/80"
                  : "text-foreground hover:text-primary-soft",
              )}
              title={task.title}
            >
              {task.title}
              {/* Strike sweep — draws itself instead of snapping on. */}
              <motion.span
                aria-hidden
                initial={false}
                animate={{ scaleX: task.completed ? 1 : 0 }}
                transition={{ duration: 0.3, ease: EASE_OUT_EXPO }}
                className="absolute left-0 top-1/2 h-px w-full origin-left bg-ivory/40"
              />
            </button>
            <span
              className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              title={`${priority.label} priority`}
            >
              <span
                className={cn("size-1.5 rounded-full", priority.dot)}
                aria-hidden
              />
              {task.priority}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-caption text-muted-foreground">
            {task.completed && task.completedAt ? (
              <span>Completed {formatRelative(task.completedAt)}</span>
            ) : (
              <span>Added {formatRelative(task.createdAt)}</span>
            )}
            {task.pomodoros > 0 && (
              <span className="flex items-center gap-1 text-achievement">
                <Flame className="size-3" aria-hidden />
                {task.pomodoros} {task.pomodoros === 1 ? "session" : "sessions"}
              </span>
            )}
            {task.tags.map((tag) => (
              <span
                key={tag}
                className="rounded-md bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary-soft"
              >
                #{tag}
              </span>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-300 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
          {!task.completed && (
            <>
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={(event) => {
                  event.stopPropagation();
                  handleStartTimer();
                }}
                className={actionClass}
                aria-label={`Start a focus session for “${task.title}”`}
                title="Start pomodoro"
              >
                <Timer className="size-4" />
              </motion.button>
              <motion.button
                type="button"
                whileTap={{ scale: 0.9 }}
                onClick={(event) => {
                  event.stopPropagation();
                  openFocus(task.id);
                }}
                className={cn(actionClass, "hover:text-primary-soft")}
                aria-label={`Enter focus mode for “${task.title}”`}
                title="Focus mode — F"
              >
                <Maximize2 className="size-4" />
              </motion.button>
            </>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={(event) => {
              event.stopPropagation();
              openEdit(task.id);
            }}
            className={actionClass}
            aria-label={`Edit “${task.title}”`}
            title="Edit"
          >
            <Pencil className="size-4" />
          </motion.button>
          <motion.button
            type="button"
            whileTap={{ scale: 0.9 }}
            onClick={(event) => {
              event.stopPropagation();
              handleDelete();
            }}
            className={cn(
              actionClass,
              "hover:bg-destructive/10 hover:text-destructive",
            )}
            aria-label={`Delete “${task.title}”`}
            title="Delete"
          >
            <Trash2 className="size-4" />
          </motion.button>
        </div>
      </motion.div>
    </motion.li>
  );
}
