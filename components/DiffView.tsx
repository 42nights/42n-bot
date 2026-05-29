import { cn } from "@/lib/utils";

export function DiffView({ diff, className }: { diff: string; className?: string }) {
  if (!diff) {
    return (
      <div className="text-sm text-muted-foreground italic">
        No diff captured.
      </div>
    );
  }
  const lines = diff.split("\n");
  return (
    <pre
      className={cn(
        "font-mono text-xs leading-5 overflow-x-auto rounded-md border border-border bg-[hsl(0,0%,99%)]",
        className,
      )}
    >
      <code className="block">
        {lines.map((line, i) => {
          let cls = "px-3";
          if (line.startsWith("+++") || line.startsWith("---")) cls += " text-zinc-500";
          else if (line.startsWith("@@")) cls += " diff-hunk px-3 py-0.5";
          else if (line.startsWith("+")) cls += " diff-add";
          else if (line.startsWith("-")) cls += " diff-del";
          else cls += " text-zinc-700";
          return (
            <span key={i} className={cls + " block"}>
              {line || " "}
            </span>
          );
        })}
      </code>
    </pre>
  );
}
