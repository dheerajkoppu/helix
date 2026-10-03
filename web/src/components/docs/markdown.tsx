import { isValidElement, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { ExternalLink } from "@/components/data/external-link";
import { TextLink } from "@/components/data/text-link";

import { headingId, resolveDocLink } from "./source";

function plainText(node: ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(plainText).join("");
  if (isValidElement<{ children?: ReactNode }>(node))
    return plainText(node.props.children);
  return "";
}

function components(file: string): Components {
  return {
    h1: ({ children }) => (
      <h2 className="mt-8 mb-3 text-lg font-semibold text-foreground">
        {children}
      </h2>
    ),
    h2: ({ children }) => (
      <h2
        id={headingId(plainText(children))}
        className="mt-9 mb-3 scroll-mt-20 border-t border-border-subtle pt-5 text-lg font-semibold tracking-[-0.01em] text-foreground first:mt-0 first:border-t-0 first:pt-0"
      >
        {children}
      </h2>
    ),
    h3: ({ children }) => (
      <h3
        id={headingId(plainText(children))}
        className="mt-6 mb-2 scroll-mt-20 text-base font-medium text-foreground"
      >
        {children}
      </h3>
    ),
    h4: ({ children }) => (
      <h4 className="mt-5 mb-1.5 text-sm font-medium text-foreground">
        {children}
      </h4>
    ),
    p: ({ children }) => (
      <p className="my-3 max-w-[76ch] text-base leading-6 text-foreground">
        {children}
      </p>
    ),
    ul: ({ children }) => (
      <ul className="my-3 flex max-w-[76ch] list-disc flex-col gap-1.5 pl-5 text-base leading-6 marker:text-subtle-foreground">
        {children}
      </ul>
    ),
    ol: ({ children }) => (
      <ol className="my-3 flex max-w-[76ch] list-decimal flex-col gap-1.5 pl-5 text-base leading-6 marker:font-mono marker:text-xs marker:text-subtle-foreground">
        {children}
      </ol>
    ),
    li: ({ children }) => (
      <li className="pl-1 text-foreground [&>p]:my-0">{children}</li>
    ),
    strong: ({ children }) => (
      <strong className="font-semibold text-foreground">{children}</strong>
    ),
    hr: () => <hr className="my-6 border-border-subtle" />,
    blockquote: ({ children }) => (
      <blockquote className="my-3 max-w-[76ch] border-l border-border-strong pl-3 text-muted-foreground">
        {children}
      </blockquote>
    ),
    a: ({ href, children }) => {
      if (!href) return <>{children}</>;
      if (/^https?:\/\//.test(href))
        return <ExternalLink href={href}>{children}</ExternalLink>;
      const route = resolveDocLink(file, href);
      // A file of the repository that is not published here stays as text
      return route ? (
        <TextLink href={route}>{children}</TextLink>
      ) : (
        <>{children}</>
      );
    },
    pre: ({ children }) => (
      <div className="my-4 overflow-x-auto border border-border bg-sunken">
        <pre className="w-max min-w-full px-3 py-2.5 font-mono text-xs leading-5 text-foreground">
          {children}
        </pre>
      </div>
    ),
    code: ({ children, className }) =>
      className || String(children).includes("\n") ? (
        <code>{children}</code>
      ) : (
        <code className="rounded-xs bg-sunken px-1 py-px font-mono text-[0.92em] break-words text-foreground">
          {children}
        </code>
      ),
    table: ({ children }) => (
      <div className="my-4 overflow-x-auto border border-border">
        <table className="w-full border-collapse text-left text-sm">
          {children}
        </table>
      </div>
    ),
    thead: ({ children }) => <thead className="bg-sunken">{children}</thead>,
    th: ({ children }) => (
      <th className="border-b border-border px-2.5 py-1.5 text-2xs font-medium tracking-[0.04em] whitespace-nowrap text-muted-foreground uppercase">
        {children}
      </th>
    ),
    tr: ({ children }) => (
      <tr className="border-b border-border-subtle last:border-b-0">
        {children}
      </tr>
    ),
    td: ({ children }) => (
      <td className="px-2.5 py-1.5 align-top leading-5 text-foreground">
        {children}
      </td>
    ),
  };
}

/** A repository Markdown file drawn with the design tokens. `file` is its path under docs/. */
export function DocMarkdown({
  file,
  children,
}: {
  file: string;
  children: string;
}) {
  return (
    <div data-slot="doc-markdown" className="min-w-0">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components(file)}>
        {children}
      </ReactMarkdown>
    </div>
  );
}
