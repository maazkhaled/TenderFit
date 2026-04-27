import { cn } from "@/lib/ui/cn";

function iso2ToFlag(iso2: string | null | undefined) {
  if (!iso2 || iso2.length !== 2) return null;
  const code = iso2.toUpperCase();
  const A = 0x1f1e6;
  const a = "A".charCodeAt(0);
  return String.fromCodePoint(A + code.charCodeAt(0) - a) +
    String.fromCodePoint(A + code.charCodeAt(1) - a);
}

export function CountryFlag({
  iso2,
  showCode = true,
  className,
}: {
  iso2: string | null | undefined;
  showCode?: boolean;
  className?: string;
}) {
  const flag = iso2ToFlag(iso2);
  if (!iso2) return <span className="text-zinc-400">—</span>;
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <span aria-hidden className="text-base leading-none">
        {flag ?? "🏳️"}
      </span>
      {showCode && (
        <span className="text-xs font-medium uppercase text-zinc-600">
          {iso2}
        </span>
      )}
    </span>
  );
}
