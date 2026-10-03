import { ArrowUpRightIcon } from "lucide-react";
import { cn } from "cn";

export interface ExternalLinkProps extends Omit<
  React.ComponentProps<"a">,
  "target" | "rel"
> {
  href: string;
  /** hide the arrow when the link sits inside a chip that already marks itself as external */
  bare?: boolean;
}

/** The only treatment for links that leave OrphaFold: underlined on hover, arrow, new tab. */
export function ExternalLink({
  href,
  bare = false,
  className,
  children,
  ...props
}: ExternalLinkProps) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-baseline gap-0.5 rounded-xs text-foreground underline decoration-border-strong decoration-1 underline-offset-[3px] hover:decoration-foreground",
        className,
      )}
      {...props}
    >
      {children}
      {bare ? null : (
        <ArrowUpRightIcon
          className="size-3 shrink-0 self-center text-subtle-foreground"
          aria-hidden
        />
      )}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}
