"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, Layers, Pencil, Plus, Trash2 } from "lucide-react";

import { EASE_OUT_EXPO, listContainer, listItem, SPRING } from "@/lib/motion";
import {
  addTemplateToList,
  deleteTemplateWithUndo,
} from "@/lib/template-actions";
import type { TaskTemplate } from "@/lib/types";
import { useTemplateStore } from "@/store/use-template-store";
import { useUiStore } from "@/store/use-ui-store";
import { Button } from "@/components/ui/button";

/** How many titles a row previews before it trails off. */
const PREVIEW_TITLES = 3;

/** How long a row holds its "added" state. Matches the toast's own beat. */
const ADDED_MS = 900;

/**
 * Line-art motif for the empty state — it draws itself in, the same way the
 * list's own empty state does. A saved card with three lines in it: the feature
 * in one picture, no caption needed.
 */
function EmptyArt() {
  return (
    <svg viewBox="0 0 60 48" className="size-14" fill="none" aria-hidden>
      {/* The card behind, a third of a step down: a *group*, not a single row. */}
      <motion.rect
        x="12"
        y="10"
        width="40"
        height="32"
        rx="4"
        stroke="rgba(244,241,234,0.14)"
        strokeWidth="1.4"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      />
      <motion.rect
        x="8"
        y="6"
        width="44"
        height="32"
        rx="4"
        stroke="rgba(244,241,234,0.28)"
        strokeWidth="1.4"
        initial={{ pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.7, delay: 0.08, ease: EASE_OUT_EXPO }}
      />
      {[
        { y: 16, width: 30, delay: 0.2 },
        { y: 23, width: 24, delay: 0.28 },
        { y: 30, width: 18, delay: 0.36 },
      ].map((line) => (
        <motion.line
          key={line.y}
          x1="15"
          y1={line.y}
          x2={15 + line.width}
          y2={line.y}
          stroke="rgba(244,241,234,0.22)"
          strokeWidth="1.4"
          strokeLinecap="round"
          initial={{ pathLength: 0, opacity: 0 }}
          animate={{ pathLength: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: line.delay, ease: EASE_OUT_EXPO }}
        />
      ))}
    </svg>
  );
}

/**
 * Routines — saved groups of tasks, applied in one click.
 *
 * Deliberately a panel and nothing more: a header, one row per routine, and an
 * empty state that explains the idea. The row itself is the action (click it
 * and the group lands in the list above), so applying a routine never costs
 * more than the click it takes to read it.
 *
 * A row therefore has to answer "which routine is this?" without being opened:
 * the name, how many tasks it carries, and the first few titles themselves.
 */
export function TemplatesPanel() {
  const templates = useTemplateStore((state) => state.templates);
  const openTemplateEditor = useUiStore((state) => state.openTemplateEditor);

  /* The routine that just landed in the list, for as long as its row says so. */
  const [added, setAdded] = useState<string | null>(null);

  function apply(template: TaskTemplate) {
    if (addTemplateToList(template) === 0) return;
    setAdded(template.id);
    window.setTimeout(
      () => setAdded((current) => (current === template.id ? null : current)),
      ADDED_MS,
    );
  }

  return (
    <section className="panel overflow-hidden" aria-label="Routines">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-3.5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-micro font-semibold uppercase text-muted-foreground">
            Routines
          </h2>
          {templates.length > 0 && (
            <span className="rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/80">
              {templates.length}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => openTemplateEditor(null)}
          className="h-7 gap-1.5 px-2 text-caption"
        >
          <Plus className="size-3.5" />
          New
        </Button>
      </div>

      {templates.length === 0 ? (
        <div className="grid place-items-center px-6 py-10 text-center">
          <EmptyArt />
          <p className="mt-5 text-[15px] font-medium tracking-[-0.01em] text-foreground">
            No routines yet
          </p>
          <p className="mt-1.5 max-w-xs text-caption leading-relaxed text-muted-foreground">
            A routine is a group of tasks you reach for together — a morning
            start, a weekly review. Save one and it lands in your list in a
            single click.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="mt-6 gap-2"
            onClick={() => openTemplateEditor(null)}
          >
            <Plus className="size-3.5" />
            New routine
          </Button>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto overscroll-y-contain px-1.5 py-1.5">
          <motion.ul
            variants={listContainer}
            initial="hidden"
            animate="show"
            className="grid min-w-0 gap-0.5"
          >
            {templates.map((template) => {
              const count = template.titles.length;
              const preview = template.titles.slice(0, PREVIEW_TITLES).join(" · ");
              const justAdded = added === template.id;
              return (
                <motion.li
                  key={template.id}
                  variants={listItem}
                  className="group/routine relative flex min-w-0 items-center gap-1 rounded-xl pr-1 transition-colors duration-200 hover:bg-white/[0.035]"
                >
                  {/* The row's own confirmation: one quiet wash, once. */}
                  <AnimatePresence>
                    {justAdded && (
                      <motion.span
                        key="wash"
                        aria-hidden
                        initial={{ opacity: 0.6 }}
                        animate={{ opacity: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: ADDED_MS / 1000, ease: EASE_OUT_EXPO }}
                        className="pointer-events-none absolute inset-0 rounded-xl bg-primary/[0.07]"
                      />
                    )}
                  </AnimatePresence>

                  <button
                    type="button"
                    onClick={() => apply(template)}
                    aria-label={`Add ${template.name} to your list — ${count} ${
                      count === 1 ? "task" : "tasks"
                    }`}
                    className="relative flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left"
                  >
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted-foreground transition-colors duration-200 group-hover/routine:bg-primary/12 group-hover/routine:text-primary-soft"
                    >
                      <Layers className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="min-w-0 truncate text-body font-medium tracking-[-0.005em] text-foreground">
                          {template.name}
                        </span>
                        <span className="shrink-0 rounded-md bg-white/[0.05] px-1.5 py-0.5 font-mono text-[10px] leading-none text-muted-foreground/80">
                          {count}
                        </span>
                      </span>
                      <span
                        title={template.titles.join(" · ")}
                        className="mt-0.5 block truncate text-caption text-muted-foreground/80"
                      >
                        {preview}
                        {count > PREVIEW_TITLES ? " …" : ""}
                      </span>
                    </span>
                    {/* Always faintly there — on a phone there is no hover to
                       reveal what the row does. */}
                    <span
                      aria-hidden
                      className="relative grid size-4 shrink-0 place-items-center"
                    >
                      <Plus
                        className={
                          justAdded
                            ? "size-3.5 text-primary-soft opacity-0"
                            : "size-3.5 text-primary-soft opacity-60 transition-opacity duration-200 group-hover/routine:opacity-100"
                        }
                      />
                      <AnimatePresence>
                        {justAdded && (
                          <motion.span
                            key="check"
                            initial={{ scale: 0.4, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            exit={{ scale: 0.8, opacity: 0 }}
                            transition={SPRING.pop}
                            className="absolute inset-0 grid place-items-center text-primary-soft"
                          >
                            <Check className="size-3.5" strokeWidth={3} />
                          </motion.span>
                        )}
                      </AnimatePresence>
                    </span>
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 transition-opacity duration-200 lg:opacity-0 lg:group-focus-within/routine:opacity-100 lg:group-hover/routine:opacity-100">
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Edit ${template.name}`}
                      onClick={() => openTemplateEditor(template.id)}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`Delete ${template.name}`}
                      className="hover:text-destructive"
                      onClick={() => deleteTemplateWithUndo(template)}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                </motion.li>
              );
            })}
          </motion.ul>
        </div>
      )}
    </section>
  );
}
