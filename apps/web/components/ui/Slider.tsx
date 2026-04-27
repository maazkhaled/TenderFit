"use client";

import { forwardRef, type InputHTMLAttributes } from "react";
import { cn } from "@/lib/ui/cn";

export interface SliderProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "type"> {
  valueLabel?: string;
}

export const Slider = forwardRef<HTMLInputElement, SliderProps>(
  ({ className, valueLabel, ...rest }, ref) => (
    <div className="space-y-2">
      <input
        ref={ref}
        type="range"
        className={cn(
          "h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-200 accent-indigo-600",
          className,
        )}
        {...rest}
      />
      {valueLabel && (
        <div className="text-right text-xs font-medium tabular-nums text-zinc-600">
          {valueLabel}
        </div>
      )}
    </div>
  ),
);

Slider.displayName = "Slider";
