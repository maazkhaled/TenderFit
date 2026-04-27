import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, type = "text", ...rest }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "block w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-ink placeholder:text-zinc-400 focus:border-indigo-500 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-60",
        className,
      )}
      {...rest}
    />
  ),
);

Input.displayName = "Input";

export interface FieldProps {
  label: string;
  hint?: string;
  htmlFor?: string;
  error?: string | null;
  children: React.ReactNode;
}

export function Field({ label, hint, htmlFor, error, children }: FieldProps) {
  return (
    <div className="space-y-1.5">
      <label
        htmlFor={htmlFor}
        className="block text-sm font-medium text-ink-soft"
      >
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-zinc-500">{hint}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
