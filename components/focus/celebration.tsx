"use client";

import { AnimatePresence, motion } from "framer-motion";
import { Check } from "lucide-react";

import { CELEBRATION_SPARKS } from "@/components/focus/geometry";

/**
 * Completing the task itself, on the dial.
 *
 * Two rings and a radial burst around a tick, held for the second the
 * orchestrator keeps it mounted for — the moment after a task is finished is the
 * one place in Focus Mode where a flourish is the point.
 */
export function Celebration({ show }: { show: boolean }) {
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key="celebration"
          className="pointer-events-none absolute inset-0 grid place-items-center"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.3 } }}
          aria-hidden
        >
          {[0, 0.16].map((delay) => (
            <motion.span
              key={delay}
              className="absolute size-44 rounded-full border-2 border-ivory/70"
              initial={{ scale: 0.35, opacity: 0.9 }}
              animate={{ scale: 2, opacity: 0 }}
              transition={{ duration: 1.05, delay, ease: "easeOut" }}
            />
          ))}
          {CELEBRATION_SPARKS.map((spark) => (
            <motion.span
              key={spark.id}
              className="absolute size-1.5 rounded-full bg-ivory"
              initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
              animate={{
                x: spark.x,
                y: spark.y,
                opacity: 0,
                scale: 0.4,
              }}
              transition={{
                duration: 0.9,
                delay: 0.05 + spark.delay,
                ease: "easeOut",
              }}
            />
          ))}
          <motion.span
            className="absolute grid size-16 place-items-center rounded-full bg-ivory text-[#0a0a0b] shadow-[0_18px_50px_-14px_rgba(232,226,214,0.85)]"
            initial={{ scale: 0, opacity: 0 }}
            animate={{ scale: [0, 1.14, 1], opacity: 1 }}
            exit={{
              scale: 0.7,
              opacity: 0,
              transition: { duration: 0.24 },
            }}
            transition={{
              duration: 0.46,
              ease: "easeOut",
              times: [0, 0.6, 1],
            }}
          >
            <Check className="size-7" strokeWidth={3} />
          </motion.span>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
