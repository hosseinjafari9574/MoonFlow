import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "flex h-10 w-full min-w-0 rounded-xl border border-white/12 bg-white/[0.03] px-3.5 py-2 text-sm text-foreground outline-none transition-colors",
        "placeholder:text-muted-foreground/70",
        "focus-visible:border-primary/60 focus-visible:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-ring/25",
        "disabled:pointer-events-none disabled:opacity-50",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
