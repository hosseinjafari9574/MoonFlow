import * as React from "react";

import { cn } from "@/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "field flex h-10 w-full min-w-0 px-3.5 py-2 text-sm text-foreground outline-none",
        "placeholder:text-muted-foreground/70",
        "disabled:pointer-events-none",
        className,
      )}
      {...props}
    />
  );
}

export { Input };
