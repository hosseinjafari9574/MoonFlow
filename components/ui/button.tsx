import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap rounded-xl text-sm font-semibold outline-none transition-all duration-200 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[0_12px_30px_-18px_rgba(75,98,255,0.95)] hover:-translate-y-px hover:bg-[#5b70ff] active:translate-y-0",
        secondary:
          "border border-hairline bg-secondary text-secondary-foreground hover:border-white/15 hover:bg-accent active:bg-accent/70",
        outline:
          "border border-white/12 bg-transparent text-foreground hover:border-white/20 hover:bg-surface active:bg-white/[0.06]",
        ghost:
          "text-muted-foreground hover:bg-surface hover:text-foreground active:bg-white/[0.08]",
        ivory:
          "bg-ivory text-[#0a0a0b] shadow-[0_12px_30px_-20px_rgba(232,226,214,0.8)] hover:-translate-y-px hover:brightness-105 active:translate-y-0",
        destructive:
          "bg-destructive text-destructive-foreground hover:brightness-110",
        link: "text-primary-soft underline-offset-4 hover:underline",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-xl px-6 text-[15px]",
        icon: "size-9 rounded-lg",
        iconSm: "size-8 rounded-lg",
        free: "h-auto p-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
