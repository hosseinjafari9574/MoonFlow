"use client";

import { motion } from "framer-motion";

import { EASE_OUT_EXPO } from "@/lib/motion";
import { MoonFlowMark } from "@/components/moonflow-mark";

/**
 * Mirrors the real shell's silhouette so the first paint doesn't jump when
 * the hydrated UI takes over — identical columns, identical rhythm.
 */
export function LoadingScreen() {
  return (
    <div
      className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-5 lg:py-8"
      aria-busy="true"
      aria-label="Loading your tasks"
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5, ease: EASE_OUT_EXPO }}
      >
        <div className="flex h-16 items-center gap-3">
          {/* The mark itself, so the first paint is already branded. */}
          <span
            className="grid size-10 animate-pulse-soft place-items-center rounded-xl text-ivory"
            style={{
              backgroundImage:
                "linear-gradient(160deg, rgba(75,98,255,0.22), rgba(75,98,255,0.05))",
              boxShadow: "inset 0 0 0 1px rgba(139,153,255,0.20)",
            }}
          >
            <MoonFlowMark />
          </span>
          <div className="grid gap-1.5">
            <span className="skeleton h-3.5 w-24" />
            <span className="skeleton h-2.5 w-36" />
          </div>
        </div>

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="grid content-start gap-5">
            <div className="panel p-4">
              <div className="flex justify-between">
                <span className="skeleton h-2.5 w-14" />
                <span className="skeleton h-2.5 w-28" />
              </div>
              <div className="mt-5 grid grid-cols-3 divide-x divide-white/[0.06]">
                {[0, 1, 2].map((index) => (
                  <div key={index} className="grid gap-2 px-4">
                    <span className="skeleton h-2.5 w-16" />
                    <span className="skeleton h-6 w-12" />
                  </div>
                ))}
              </div>
              <div className="mt-5 h-24">
                <span className="skeleton h-full w-full" />
              </div>
            </div>
            <div className="panel flex h-[60px] items-center gap-3 px-4">
              <span className="skeleton size-8" />
              <span className="skeleton h-3 w-52" />
            </div>
            <div className="panel grid gap-1 p-2">
              {[0, 1, 2, 3].map((index) => (
                <div key={index} className="flex items-center gap-3 px-2 py-3">
                  <span className="skeleton size-[22px] rounded-full" />
                  <div className="grid flex-1 gap-1.5">
                    <span className="skeleton h-3 w-[46%]" />
                    <span className="skeleton h-2.5 w-[28%]" />
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div className="panel grid content-start gap-4 p-4 lg:sticky lg:top-24">
            <span className="skeleton h-2.5 w-20" />
            <span className="skeleton mx-auto size-[180px] rounded-full" />
            <div className="flex justify-center gap-2">
              <span className="skeleton h-10 w-32" />
              <span className="skeleton size-10" />
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
