import { forwardRef, type SelectHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  ({ className, children, ...rest }, ref) => (
    <select
      ref={ref}
      className={cn(
        "block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-ink focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  ),
);

Select.displayName = "Select";
