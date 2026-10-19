import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/*
 * tailwind-merge reads the stock Tailwind scale, so it classified our own
 * `text-micro` / `text-caption` / `text-body` / `text-title` / `text-display`
 * tokens as *colours* — the same group as `text-muted-foreground` — and kept
 * only the last one. A `cn("text-micro … text-muted-foreground")` therefore lost
 * its size and line-height and rendered at the browser's 16px in exactly the
 * places that pass through `cn`: the dialog's field labels and Focus Mode's
 * phase line. Registering the names here keeps the size and the colour as two
 * independent decisions, which is what every component already assumes.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        { text: ["micro", "caption", "body", "title", "display"] },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
