"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown, Plus } from "lucide-react";

import { PRIORITY_META } from "@/lib/constants";
import { EASE_SOFT } from "@/lib/motion";
import type { Priority } from "@/lib/types";
import { cn } from "@/lib/utils";
import { useTodoStore } from "@/store/use-todo-store";
import { useUiStore } from "@/store/use-ui-store";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const PRIORITIES: Priority[] = ["low", "medium", "high"];

function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
        .map((tag) => tag.slice(0, 24)),
    ),
  ].slice(0, 4);
}

export function TaskComposer() {
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [tags, setTags] = useState("");
  const [showOptions, setShowOptions] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);
  const composerNonce = useUiStore((state) => state.composerNonce);
  const addTask = useTodoStore((state) => state.addTask);

  useEffect(() => {
    if (composerNonce > 0) {
      inputRef.current?.focus();
      inputRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [composerNonce]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) {
      inputRef.current?.focus();
      return;
    }
    addTask({ title: trimmed, priority, tags: parseTags(tags) });
    setTitle("");
    setTags("");
    inputRef.current?.focus();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="panel group p-4 transition-shadow duration-300 focus-within:shadow-[0_0_0_1px_rgba(75,98,255,0.32),0_1px_1px_rgba(0,0,0,0.55),0_34px_64px_-48px_rgba(0,0,0,1)]"
      aria-label="New task"
    >
      {/* Accent hairline that wakes up when the field has focus. */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-6 top-0 h-px bg-gradient-to-r from-transparent via-primary/70 to-transparent opacity-0 transition-opacity duration-500 group-focus-within:opacity-100"
      />

      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="grid size-8 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted-foreground transition-colors duration-300 group-focus-within:bg-primary/12 group-focus-within:text-primary-soft"
        >
          <Plus className="size-4" />
        </span>
        <input
          ref={inputRef}
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What would you like to do?"
          aria-label="Task title"
          maxLength={160}
          className="min-w-0 flex-1 bg-transparent py-2 text-[15px] tracking-[-0.005em] text-foreground outline-none placeholder:text-muted-foreground/70"
        />
        <button
          type="button"
          onClick={() => setShowOptions((open) => !open)}
          aria-expanded={showOptions}
          aria-label="Toggle task options"
          className={cn(
            "hidden cursor-pointer rounded-lg p-2 text-muted-foreground transition-colors hover:bg-surface hover:text-foreground sm:grid",
            showOptions && "bg-surface text-foreground",
          )}
        >
          <ChevronDown
            className={cn(
              "size-4 transition-transform duration-300 ease-out",
              showOptions && "rotate-180",
            )}
          />
        </button>
        <Button type="submit" size="sm" className="h-9 px-4">
          Add
        </Button>
      </div>

      <AnimatePresence initial={false}>
        {showOptions && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE_SOFT }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-hairline pt-3">
              <div
                role="group"
                aria-label="Priority"
                className="flex items-center gap-1"
              >
                {PRIORITIES.map((value) => {
                  const meta = PRIORITY_META[value];
                  const active = priority === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setPriority(value)}
                      aria-pressed={active}
                      className={cn(
                        "flex h-9 cursor-pointer items-center gap-1.5 rounded-lg border px-2.5 text-caption font-semibold transition-all duration-200",
                        active
                          ? "border-white/15 bg-white/[0.06] text-foreground"
                          : "border-transparent text-muted-foreground hover:bg-surface hover:text-foreground",
                      )}
                    >
                      <span
                        className={cn("size-1.5 rounded-full", meta.dot)}
                        aria-hidden
                      />
                      {meta.label}
                    </button>
                  );
                })}
              </div>
              <Input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                placeholder="Tags, comma separated"
                aria-label="Tags"
                className="h-9 w-full min-w-[12rem] flex-1 text-caption"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </form>
  );
}
