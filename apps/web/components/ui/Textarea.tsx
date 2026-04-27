import { forwardRef, type TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, rows = 4, ...rest }, ref) => (
    <textarea
      ref={ref}
      rows={rows}
      className={cn(
        "block w-full resize-y rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm leading-6 text-ink placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  ),
);

Textarea.displayName = "Textarea";
