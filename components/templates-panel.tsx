"use client";

import { motion } from "framer-motion";
import { Layers, Pencil, Plus, Trash2 } from "lucide-react";

import { listContainer, listItem } from "@/lib/motion";
import {
  addTemplateToList,
  deleteTemplateWithUndo,
} from "@/lib/template-actions";
import { useTemplateStore } from "@/store/use-template-store";
import { useUiStore } from "@/store/use-ui-store";
import { Button } from "@/components/ui/button";

/**
 * Routines — saved groups of tasks, applied in one click.
 *
 * Deliberately a panel and nothing more: a header, one row per routine, and an
 * empty state that explains the idea. The row itself is the action (click it
 * and the group lands in the list above), so applying a routine never costs
 * more than the click it takes to read it.
 */
export function TemplatesPanel() {
  const templates = useTemplateStore((state) => state.templates);
  const openTemplateEditor = useUiStore((state) => state.openTemplateEditor);

  return (
    <section className="panel overflow-hidden" aria-label="Routines">
      <div className="flex items-center justify-between gap-3 border-b border-hairline px-5 py-3">
        <div className="flex items-baseline gap-2">
          <h2 className="text-micro font-semibold uppercase text-muted-foreground">
            Routines
          </h2>
          {templates.length > 0 && (
            <span className="font-mono text-[10px] text-muted-foreground/70">
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
        <div className="grid place-items-center gap-3 px-6 py-7 text-center">
          <p className="max-w-[24rem] text-caption leading-relaxed text-muted-foreground">
            Save the tasks you repeat — a morning routine, a weekly review — and
            add the whole group in one click.
          </p>
          <Button
            size="sm"
            variant="secondary"
            className="gap-2"
            onClick={() => openTemplateEditor(null)}
          >
            <Plus className="size-3.5" />
            New routine
          </Button>
        </div>
      ) : (
        <div className="max-h-72 overflow-y-auto px-1.5 py-1.5">
          <motion.ul
            variants={listContainer}
            initial="hidden"
            animate="show"
            className="grid gap-0.5"
          >
            {templates.map((template) => {
              const count = template.titles.length;
              return (
                <motion.li
                  key={template.id}
                  variants={listItem}
                  className="group/routine flex items-center gap-1 rounded-xl pr-1 transition-colors duration-200 hover:bg-white/[0.035]"
                >
                  <button
                    type="button"
                    onClick={() => addTemplateToList(template)}
                    aria-label={`Add ${template.name} to your list`}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 rounded-xl px-2 py-2 text-left"
                  >
                    <span
                      aria-hidden
                      className="grid size-7 shrink-0 place-items-center rounded-lg bg-white/[0.05] text-muted-foreground transition-colors duration-200 group-hover/routine:bg-primary/12 group-hover/routine:text-primary-soft"
                    >
                      <Layers className="size-3.5" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-body font-medium tracking-[-0.005em] text-foreground">
                        {template.name}
                      </span>
                      <span className="block font-mono text-[10px] uppercase text-muted-foreground/75">
                        {count} {count === 1 ? "task" : "tasks"}
                      </span>
                    </span>
                    <Plus
                      aria-hidden
                      className="size-3.5 shrink-0 text-primary-soft opacity-0 transition-opacity duration-200 group-hover/routine:opacity-80"
                    />
                  </button>

                  <div className="flex shrink-0 items-center gap-0.5 opacity-60 transition-opacity duration-200 group-hover/routine:opacity-100 focus-within:opacity-100">
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
