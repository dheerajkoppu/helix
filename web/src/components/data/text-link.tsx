import Link from "next/link";
import { cn } from "cn";

/** Inline link to another OrphaFold route. Links that leave the app use ExternalLink. */
export function TextLink({ className, ...props }: React.ComponentProps<typeof Link>) {
  return (
    <Link
      className={cn(
        "rounded-xs text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground",
        className,
      )}
      {...props}
    />
  );
}
