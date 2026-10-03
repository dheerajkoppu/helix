import { readFile } from "node:fs/promises";
import path from "node:path";
import { cache } from "react";

import { docEntryForFile, type DocEntry } from "./registry";

// The web app runs from web/; the documentation lives beside it in the repository
const DOCS_DIRECTORY = path.resolve(process.cwd(), "..", "docs");

export interface DocHeading {
  id: string;
  text: string;
}

export interface LoadedDoc {
  /** Markdown without its leading title */
  body: string;
  headings: DocHeading[];
}

export function headingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sectionHeadings(markdown: string): DocHeading[] {
  const headings: DocHeading[] = [];
  let insideFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) insideFence = !insideFence;
    if (insideFence) continue;
    const match = /^## (.+)$/.exec(line);
    if (match) {
      const text = match[1].replace(/[`*]/g, "").trim();
      headings.push({ id: headingId(text), text });
    }
  }
  return headings;
}

export const loadDoc = cache(
  async (entry: DocEntry): Promise<LoadedDoc | null> => {
    if (!entry.file) return null;
    try {
      const markdown = await readFile(
        path.join(DOCS_DIRECTORY, entry.file),
        "utf8",
      );
      const body = markdown.replace(/^# .+\n+/, "");
      return { body, headings: sectionHeadings(body) };
    } catch {
      return null;
    }
  },
);

/** Route of a relative Markdown link when it points at a published document, otherwise null. */
export function resolveDocLink(fromFile: string, href: string): string | null {
  const [target, fragment] = href.split("#");
  if (!target) return fragment ? `#${fragment}` : null;
  const resolved = path.posix.normalize(
    path.posix.join(path.posix.dirname(fromFile), target),
  );
  const entry = docEntryForFile(resolved);
  if (!entry) return null;
  return `/docs/${entry.slug}${fragment ? `#${fragment}` : ""}`;
}
