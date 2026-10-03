export interface DocEntry {
  slug: string;
  title: string;
  /** one line for the index */
  summary: string;
  /** path under the repository docs directory; absent for pages generated from code */
  file?: string;
}

export interface DocGroup {
  id: string;
  title: string;
  entries: DocEntry[];
}

export const DOC_GROUPS: DocGroup[] = [
  {
    id: "run",
    title: "Run and build",
    entries: [
      {
        slug: "getting-started",
        title: "Getting started",
        summary:
          "Install, run and configure.",
        file: "getting-started.md",
      },
      {
        slug: "architecture",
        title: "Architecture",
        summary:
          "Contracts, identifiers, sources and jobs.",
        file: "ARCHITECTURE.md",
      },
    ],
  },
  {
    id: "science",
    title: "Data and evidence",
    entries: [
      {
        slug: "data-sources",
        title: "Data sources",
        summary:
          "Each source, its licence and failure behaviour.",
        file: "data-sources.md",
      },
      {
        slug: "evidence-classes",
        title: "Evidence classes",
        summary:
          "Six evidence classes and three structure origins.",
        file: "evidence-classes.md",
      },
      {
        slug: "limitations",
        title: "Scientific limitations",
        summary:
          "What predictions and database records do not show.",
        file: "scientific-limitations.md",
      },
      {
        slug: "glossary",
        title: "Glossary",
        summary: "Every term Learn Mode explains.",
      },
    ],
  },
  {
    id: "models",
    title: "Models and runs",
    entries: [
      {
        slug: "model-providers",
        title: "Model providers",
        summary:
          "Registered models and what runs without a GPU.",
        file: "model-providers.md",
      },
      {
        slug: "adding-a-model",
        title: "Adding a model",
        summary:
          "Checklist for a new model provider.",
        file: "adding-a-model.md",
      },
      {
        slug: "boltz2",
        title: "Boltz-2 provider",
        summary:
          "Attaching a Boltz backend.",
        file: "providers/boltz2.md",
      },
      {
        slug: "reproducibility",
        title: "Reproducibility and manifests",
        summary:
          "Provenance, run manifests, snapshots and exports.",
        file: "reproducibility.md",
      },
    ],
  },
  {
    id: "interface",
    title: "Interface",
    entries: [
      {
        slug: "design-system",
        title: "Design system",
        summary: "Components, tokens and page rules.",
        file: "DESIGN_SYSTEM.md",
      },
    ],
  },
];

export const DOC_ENTRIES: DocEntry[] = DOC_GROUPS.flatMap(
  (group) => group.entries,
);

export function docEntry(slug: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.slug === slug);
}

export function docEntryForFile(file: string): DocEntry | undefined {
  return DOC_ENTRIES.find((entry) => entry.file === file);
}
