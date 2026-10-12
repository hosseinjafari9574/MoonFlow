import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { TEMPLATE_LIMITS } from "@/lib/constants";
import { uid } from "@/lib/format";
import { normalizeTemplates } from "@/lib/persist";
import type { TaskTemplate, TemplateInput } from "@/lib/types";

interface TemplateState {
  templates: TaskTemplate[];

  /** Save a new routine; `null` when the input carried nothing usable. */
  createTemplate: (input: TemplateInput) => TaskTemplate | null;
  updateTemplate: (id: string, input: TemplateInput) => void;
  deleteTemplate: (id: string) => void;
  /** Put a deleted routine back where it was (undo). */
  restoreTemplate: (template: TaskTemplate, index: number) => void;
}

/**
 * One routine's worth of input, made safe to store. The name has to say
 * something, and a routine with no tasks is a row that adds nothing when it is
 * clicked — so both are refused here, once, rather than at every call site.
 */
function sanitize(input: TemplateInput): TemplateInput | null {
  const name = input.name.trim().slice(0, TEMPLATE_LIMITS.name);
  if (!name) return null;
  const titles = input.titles
    .map((title) => title.trim().slice(0, TEMPLATE_LIMITS.title))
    .filter(Boolean)
    .slice(0, TEMPLATE_LIMITS.tasks);
  if (titles.length === 0) return null;
  return { name, titles };
}

/**
 * Routines: a named group of task titles the user can drop into the list in one
 * action. The editor keeps its draft in component state and only ever hands a
 * finished routine to this store, so nothing half-typed is persisted.
 */
export const useTemplateStore = create<TemplateState>()(
  persist(
    (set) => ({
      templates: [],

      createTemplate: (input) => {
        const clean = sanitize(input);
        if (!clean) return null;
        const template: TaskTemplate = {
          id: uid(),
          name: clean.name,
          titles: clean.titles,
          createdAt: Date.now(),
        };
        set((state) => ({ templates: [template, ...state.templates] }));
        return template;
      },

      updateTemplate: (id, input) => {
        const clean = sanitize(input);
        if (!clean) return;
        set((state) => ({
          templates: state.templates.map((template) =>
            template.id === id ? { ...template, ...clean } : template,
          ),
        }));
      },

      deleteTemplate: (id) =>
        set((state) => ({
          templates: state.templates.filter((template) => template.id !== id),
        })),

      restoreTemplate: (template, index) =>
        set((state) => {
          if (state.templates.some((item) => item.id === template.id)) return state;
          const templates = [...state.templates];
          templates.splice(
            Math.max(0, Math.min(index, templates.length)),
            0,
            template,
          );
          return { templates };
        }),
    }),
    {
      // The `cadence:` family is frozen for compatibility (see the other two
      // stores); a third key in it is one less name to remember.
      name: "cadence:templates:v1",
      version: 1,
      skipHydration: true,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ templates: state.templates }),
      migrate: (persisted) => normalizeTemplates(persisted),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeTemplates(persisted),
      }),
    },
  ),
);
