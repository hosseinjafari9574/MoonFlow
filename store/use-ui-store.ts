import { create } from "zustand";

import type { TaskFilter } from "@/lib/activity";
import { uid } from "@/lib/format";

export type { TaskFilter };

export interface Toast {
  id: string;
  message: string;
  tone?: "default" | "warning";
  action?: { label: string; run: () => void };
}

interface UiState {
  hydrated: boolean;
  setHydrated: (value: boolean) => void;

  selectedId: string | null;
  select: (id: string | null) => void;

  /** Task shown in the immersive focus overlay. */
  focusTaskId: string | null;
  openFocus: (id: string) => void;
  closeFocus: () => void;

  /** Task being edited in the dialog. */
  editingId: string | null;
  openEdit: (id: string) => void;
  closeEdit: () => void;

  /**
   * Routine open in the templates dialog. `null` means closed; an entry whose
   * `id` is `null` is a new, unsaved routine.
   */
  templateEditor: { id: string | null } | null;
  openTemplateEditor: (id: string | null) => void;
  closeTemplateEditor: () => void;

  shortcutsOpen: boolean;
  setShortcutsOpen: (open: boolean) => void;

  filter: TaskFilter;
  tagFilter: string | null;
  setFilter: (filter: TaskFilter) => void;
  setTagFilter: (tag: string | null) => void;

  /** Incremented to ask the composer to focus its input. */
  composerNonce: number;
  focusComposer: () => void;

  toasts: Toast[];
  pushToast: (toast: Omit<Toast, "id">) => void;
  dismissToast: (id: string) => void;
}

export const useUiStore = create<UiState>()((set) => ({
  hydrated: false,
  setHydrated: (value) => set({ hydrated: value }),

  selectedId: null,
  select: (id) => set({ selectedId: id }),

  focusTaskId: null,
  openFocus: (id) => set({ focusTaskId: id, selectedId: id }),
  closeFocus: () => set({ focusTaskId: null }),

  editingId: null,
  openEdit: (id) => set({ editingId: id }),
  closeEdit: () => set({ editingId: null }),

  templateEditor: null,
  openTemplateEditor: (id) => set({ templateEditor: { id } }),
  closeTemplateEditor: () => set({ templateEditor: null }),

  shortcutsOpen: false,
  setShortcutsOpen: (open) => set({ shortcutsOpen: open }),

  filter: "all",
  tagFilter: null,
  setFilter: (filter) => set({ filter }),
  setTagFilter: (tag) => set({ tagFilter: tag }),

  composerNonce: 0,
  focusComposer: () =>
    set((state) => ({ composerNonce: state.composerNonce + 1 })),

  toasts: [],
  pushToast: (toast) =>
    set((state) => ({
      toasts: [...state.toasts.slice(-2), { ...toast, id: uid() }],
    })),
  dismissToast: (id) =>
    set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) })),
}));
