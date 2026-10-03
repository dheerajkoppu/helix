import Link from "next/link";
import { cn } from "cn";

import { DOC_GROUPS } from "./registry";
import type { DocHeading } from "./source";

const LABEL =
  "text-2xs font-medium tracking-[0.06em] text-muted-foreground uppercase";

/** Right-hand rail of a documentation page: the sections of this page, then every document. */
export function DocRail({
  current,
  headings,
}: {
  current: string;
  headings: DocHeading[];
}) {
  return (
    <aside className="flex flex-col gap-6 text-sm lg:sticky lg:top-16 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto">
      {headings.length > 0 ? (
        <nav aria-label="On this page" className="hidden lg:block">
          <p className={LABEL}>On this page</p>
          <ul className="mt-2 flex flex-col border-l border-border-subtle">
            {headings.map((heading) => (
              <li key={heading.id}>
                <a
                  href={`#${heading.id}`}
                  className="-ml-px block border-l border-transparent py-1 pl-3 text-muted-foreground hover:border-foreground hover:text-foreground"
                >
                  {heading.text}
                </a>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
      <nav aria-label="Documentation">
        <p className={LABEL}>Documentation</p>
        <ul className="mt-2 flex flex-col">
          {DOC_GROUPS.flatMap((group) => group.entries).map((entry) => (
            <li key={entry.slug}>
              <Link
                href={`/docs/${entry.slug}`}
                aria-current={entry.slug === current ? "page" : undefined}
                className={cn(
                  "block border-l py-1 pl-3",
                  entry.slug === current
                    ? "border-foreground font-medium text-foreground"
                    : "border-border-subtle text-muted-foreground hover:border-border-strong hover:text-foreground",
                )}
              >
                {entry.title}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
}
