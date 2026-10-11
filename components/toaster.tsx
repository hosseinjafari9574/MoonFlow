"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Check, TriangleAlert, X } from "lucide-react";

import { SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { useUiStore, type Toast } from "@/store/use-ui-store";

const TOAST_LIFETIME_MS = 4500;

function ToastCard({ toast }: { toast: Toast }) {
  const dismiss = useUiStore((state) => state.dismissToast);

  useEffect(() => {
    const timeout = window.setTimeout(() => dismiss(toast.id), TOAST_LIFETIME_MS);
    return () => window.clearTimeout(timeout);
  }, [toast.id, dismiss]);

  const isWarning = toast.tone === "warning";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 16, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 8, scale: 0.98, transition: { duration: 0.18 } }}
      transition={SPRING.snappy}
      className="pointer-events-auto relative flex items-center gap-3 overflow-hidden rounded-xl border border-hairline bg-[#141417]/95 px-3.5 py-3 shadow-[0_28px_70px_-28px_rgba(0,0,0,0.95)] backdrop-blur-xl"
      role="status"
    >
      <motion.span
        className={cn(
          "grid size-7 shrink-0 place-items-center rounded-lg",
          isWarning ? "bg-destructive/12 text-destructive" : "bg-ivory/12 text-ivory",
        )}
        aria-hidden
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ ...SPRING.pop, delay: 0.04 }}
      >
        {isWarning ? (
          <TriangleAlert className="size-4" />
        ) : (
          <Check className="size-4" />
        )}
      </motion.span>
      <p className="min-w-0 flex-1 text-caption leading-relaxed text-secondary-foreground">
        {toast.message}
      </p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.run();
            dismiss(toast.id);
          }}
          className="cursor-pointer rounded-lg bg-primary/12 px-2.5 py-1.5 font-mono text-[11px] font-medium text-primary-soft transition-colors duration-200 hover:bg-primary/20"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismiss(toast.id)}
        aria-label="Dismiss notification"
        className="grid size-6 shrink-0 cursor-pointer place-items-center rounded-md text-muted-foreground transition-colors duration-200 hover:bg-white/[0.07] hover:text-foreground"
      >
        <X className="size-3.5" />
      </button>

      {/* Lifetime draining away — quiet, but you can feel the time left. */}
      <motion.span
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-px origin-left bg-gradient-to-r from-transparent via-ivory/45 to-ivory/45"
        initial={{ scaleX: 1 }}
        animate={{ scaleX: 0 }}
        transition={{ duration: TOAST_LIFETIME_MS / 1000, ease: "linear" }}
      />
    </motion.div>
  );
}

export function Toaster() {
  const toasts = useUiStore((state) => state.toasts);

  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-[70] flex w-[min(22rem,calc(100vw-2.5rem))] flex-col gap-2">
      <AnimatePresence initial={false} mode="popLayout">
        {toasts.map((toast) => (
          <ToastCard key={toast.id} toast={toast} />
        ))}
      </AnimatePresence>
    </div>
  );
}
