"use client";

import { useMemo } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { CheckCheck } from "lucide-react";

import { allTags, filterTasks } from "@/lib/activity";
import { EASE_OUT_EXPO, listContainer, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore, type TaskFilter } from "@/store/use-ui-store";
import { Button } from "@/components/ui/button";
import { TaskItem } from "@/components/task-item";

const FILTERS: { value: TaskFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "done", label: "Done" },
];

/** Line-art motif for the empty state — it draws itself in. */
function EmptyArt({ tone }: { tone: "idle" | "done" }) {
  const rows = [
    { y: 11, width: 30, delay: 0.08 },
    { y: 24, width: 22, delay: 0.16 },
    { y: 37, width: 15, delay: 0.24 },
  ];
  return (
    <svg viewBox="0 0 60 48" className="size-14" fill="none" aria-hidden>
      {rows.map((row, index) => (
        <g key={row.y}>
          <motion.circle
            cx="9"
            cy={row.y}
            r="4"
            stroke={index === 0 && tone === "done" ? "#e8e2d6" : "rgba(244,241,234,0.28)"}
            strokeWidth="1.4"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ duration: 0.7, delay: row.delay, ease: EASE_OUT_EXPO }}
          />
          <motion.line
            x1="20"
            y1={row.y}
            x2={20 + row.width}
            y2={row.y}
            stroke="rgba(244,241,234,0.22)"
            strokeWidth="1.4"
            strokeLinecap="round"
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{
              duration: 0.6,
              delay: row.delay + 0.08,
              ease: EASE_OUT_EXPO,
            }}
          />
        </g>
      ))}
    </svg>
  );
}

export function TaskList() {
  const tasks = useTodoStore((state) => state.tasks);
  const filter = useUiStore((state) => state.filter);
  const tagFilter = useUiStore((state) => state.tagFilter);
  const setFilter = useUiStore((state) => state.setFilter);
  const setTagFilter = useUiStore((state) => state.setTagFilter);
  const focusComposer = useUiStore((state) => state.focusComposer);
  const clearCompleted = useTodoStore((state) => state.clearCompleted);

  const tags = useMemo(() => allTags(tasks), [tasks]);
  const counts = useMemo(
    () => ({
      all: tasks.length,
      active: tasks.filter((task) => !task.completed).length,
      done: tasks.filter((task) => task.completed).length,
    }),
    [tasks],
  );

  const visible = useMemo(
    () => filterTasks(tasks, filter, tagFilter),
    [tasks, filter, tagFilter],
  );

  const hasAnyTask = tasks.length > 0;

  return (
    <section className="panel overflow-hidden" aria-label="Tasks">
      <div className="flex flex-wrap items-center gap-2 border-b border-hairline px-4 py-3">
        <div
          role="group"
          aria-label="Filter tasks"
          className="inset flex items-center gap-0.5 rounded-xl p-0.5"
        >
          {FILTERS.map((option) => {
            const active = filter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                aria-pressed={active}
                onClick={() => setFilter(option.value)}
                className={cn(
                  "relative cursor-pointer rounded-[10px] px-3 py-2 text-caption font-semibold transition-colors duration-200",
                  active
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {active && (
                  <motion.span
                    layoutId="filter-pill"
                    aria-hidden
                    className="absolute inset-0 rounded-[10px] bg-white/[0.07] shadow-[inset_0_0_0_1px_rgba(244,241,234,0.08)]"
                    transition={SPRING.snappy}
                  />
                )}
                <span className="relative">{option.label}</span>
                <span
                  className={cn(
                    "relative ml-1.5 font-mono text-[10px]",
                    active ? "text-muted-foreground" : "text-muted-foreground/70",
                  )}
                >
                  {counts[option.value]}
                </span>
              </button>
            );
          })}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 max-sm:order-last max-sm:w-full max-sm:pt-1">
            <span
              aria-hidden
              className="mx-1 h-4 w-px bg-hairline max-sm:hidden"
            />
            {tags.map((tag) => {
              const active = tagFilter === tag;
              return (
                <button
                  key={tag}
                  onClick={() => setTagFilter(active ? null : tag)}
                  aria-pressed={active}
                  className={cn(
                    "cursor-pointer rounded-md px-2 py-1 font-mono text-[11px] transition-colors duration-200",
                    active
                      ? "bg-primary/15 text-primary-soft shadow-[inset_0_0_0_1px_rgba(75,98,255,0.3)]"
                      : "text-muted-foreground hover:bg-white/[0.05] hover:text-foreground",
                  )}
                >
                  #{tag}
                </button>
              );
            })}
          </div>
        )}

        {counts.done > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearCompleted}
            className="ml-auto h-7 gap-1.5 px-2 font-mono text-[11px]"
          >
            <CheckCheck className="size-3.5" />
            clear
          </Button>
        )}
      </div>

      <div className="px-1 py-1.5">
        <AnimatePresence mode="popLayout">
          {visible.length > 0 ? (
            <motion.ul
              key={`${filter}-${tagFilter ?? "none"}`}
              variants={listContainer}
              initial="hidden"
              animate="show"
              exit="exit"
              className="divide-y divide-white/[0.05]"
            >
              {visible.map((task) => (
                <TaskItem key={task.id} task={task} />
              ))}
            </motion.ul>
          ) : (
            <motion.div
              key={`empty-${filter}-${tagFilter ?? "none"}`}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.28, ease: EASE_OUT_EXPO }}
              className="grid place-items-center px-6 py-14 text-center"
            >
              <EmptyArt tone={!hasAnyTask ? "idle" : "done"} />
              <p className="mt-5 text-[15px] font-medium tracking-[-0.01em] text-foreground">
                {!hasAnyTask
                  ? "Your list is a blank canvas"
                  : tagFilter
                    ? `Nothing tagged #${tagFilter}`
                    : filter === "done"
                      ? "Nothing completed yet"
                      : "You're all caught up"}
              </p>
              <p className="mt-1.5 max-w-xs text-caption leading-relaxed text-muted-foreground">
                {!hasAnyTask
                  ? "Capture the first thing on your mind — press N anytime to add a task."
                  : tagFilter
                    ? "Try another tag, or clear the filter to see everything."
                    : filter === "done"
                      ? "Finish something and it will land here."
                      : "Enjoy the quiet, or add something new when it arrives."}
              </p>
              {!hasAnyTask && (
                <Button
                  size="sm"
                  variant="secondary"
                  className="mt-6 gap-2"
                  onClick={focusComposer}
                >
                  Add your first task
                  <span className="kbd">N</span>
                </Button>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
