"use client";

import {
  BookOpenIcon,
  BoxesIcon,
  CompassIcon,
  CornerDownLeftIcon,
  CpuIcon,
  FolderIcon,
  GraduationCapIcon,
  InfoIcon,
  KeyboardIcon,
  ListChecksIcon,
  MonitorIcon,
  MoonIcon,
  SlidersHorizontalIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { KeyHint } from "@/components/data/key-hint";
import { SEARCH_PLACEHOLDER } from "@/components/shell/search-trigger";
import {
  CommandDialog,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import {
  formatProteinChange,
  formatVariantId,
  isUniProtAccession,
  parseProteinChange,
  parseVariantId,
  routes,
} from "@/lib/ids";
import { usePreferences } from "@/lib/state/preferences";
import { useShell } from "@/lib/state/shell";
import {
  STAGES,
  resolveStage,
  useWorkspaceSubjectStore,
} from "@/lib/state/subject";

interface PaletteCommand {
  id: string;
  label: string;
  /** what will happen, printed in muted text */
  detail?: string;
  keywords?: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  run: () => void;
}

interface ParsedInput {
  id: string;
  label: string;
  detail: string;
  href: string;
}

/**
 * Recognises identifiers locally, before any network call. Each row says what will be opened.
 * Free-text entity search is provided by the search feature, which adds its sections to this palette.
 */
export function parsePaletteInput(raw: string): ParsedInput[] {
  const input = raw.trim();
  if (!input) return [];

  if (isUniProtAccession(input)) {
    const accession = input.toUpperCase();
    return [
      {
        id: "protein",
        label: `Open protein ${accession}`,
        detail: "UniProt accession",
        href: routes.protein(accession),
      },
    ];
  }

  const variantId = parseVariantId(input);
  if (variantId) {
    return [
      {
        id: "variant",
        label: `Open variant ${variantId.kind === "clinvar" ? variantId.accession : `${variantId.gene} ${variantId.label}`}`,
        detail:
          variantId.kind === "clinvar"
            ? "ClinVar accession"
            : "Variant identifier",
        href: routes.variant(
          variantId.kind === "clinvar"
            ? variantId.accession
            : formatVariantId(variantId.gene, variantId.change),
        ),
      },
    ];
  }

  const geneAndChange = /^([A-Za-z][A-Za-z0-9-]{0,11})[\s:]+(\S+)$/.exec(input);
  if (geneAndChange) {
    const change = parseProteinChange(geneAndChange[2]);
    if (change) {
      const gene = geneAndChange[1].toUpperCase();
      return [
        {
          id: "variant",
          label: `Open variant ${gene} ${formatProteinChange(change)}`,
          detail: "Gene symbol and protein change",
          href: routes.variant(formatVariantId(gene, change)),
        },
      ];
    }
  }

  if (/^[A-Za-z][A-Za-z0-9-]{1,11}$/.test(input)) {
    const symbol = input.toUpperCase();
    return [
      {
        id: "gene",
        label: `Open gene ${symbol}`,
        detail: "Read as an HGNC symbol; resolved when the page loads",
        href: routes.gene(symbol),
      },
    ];
  }
  return [];
}

const matches = (command: PaletteCommand, query: string) =>
  `${command.label} ${command.keywords ?? ""}`
    .toLowerCase()
    .includes(query.toLowerCase());

export function CommandPalette() {
  const router = useRouter();
  const open = useShell((state) => state.paletteOpen);
  const setOpen = useShell((state) => state.setPaletteOpen);
  const setShortcutsOpen = useShell((state) => state.setShortcutsOpen);
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const toggleLearnMode = usePreferences((state) => state.toggleLearnMode);
  const toggleAdvanced = usePreferences((state) => state.toggleAdvanced);
  const { setTheme } = useTheme();
  const [query, setQuery] = useState("");

  function close() {
    setOpen(false);
    setQuery("");
  }

  const go = (href: string) => () => {
    close();
    router.push(href);
  };

  const parsed = useMemo(() => parsePaletteInput(query), [query]);

  const stageCommands: PaletteCommand[] = STAGES.flatMap((stage) => {
    const target = resolveStage(stage.id, chain);
    if (!target.href) return [];
    return [
      {
        id: `stage-${stage.id}`,
        label: `${stage.number} ${stage.label}`,
        detail: target.subject?.label,
        keywords: "stage",
        shortcut: `g ${stage.key}`,
        run: go(target.href),
      },
    ];
  });

  const navigation: PaletteCommand[] = [
    {
      id: "explore",
      label: "Explore immune disorders and genes",
      icon: CompassIcon,
      shortcut: "g e",
      run: go(routes.explore()),
    },
    {
      id: "projects",
      label: "Projects",
      icon: FolderIcon,
      run: go(routes.projects()),
    },
    {
      id: "jobs",
      label: "Jobs",
      icon: ListChecksIcon,
      shortcut: "g j",
      run: go(routes.jobs()),
    },
    {
      id: "models",
      label: "Models and providers",
      icon: CpuIcon,
      run: go(routes.models()),
    },
    {
      id: "docs",
      label: "Documentation",
      icon: BookOpenIcon,
      run: go(routes.docs()),
    },
    {
      id: "about",
      label: "About, methodology and limitations",
      icon: InfoIcon,
      run: go(routes.about()),
    },
    {
      id: "kit",
      label: "Design kit",
      keywords: "dev components tokens",
      icon: BoxesIcon,
      run: go("/dev/kit"),
    },
  ];

  const preferences: PaletteCommand[] = [
    {
      id: "learn",
      label: "Toggle Learn Mode",
      keywords: "explain glossary",
      icon: GraduationCapIcon,
      run: () => {
        toggleLearnMode();
        close();
      },
    },
    {
      id: "advanced",
      label: "Toggle Advanced mode",
      keywords: "metrics parameters",
      icon: SlidersHorizontalIcon,
      run: () => {
        toggleAdvanced();
        close();
      },
    },
    {
      id: "theme-system",
      label: "Theme: follow system",
      icon: MonitorIcon,
      run: () => (setTheme("system"), close()),
    },
    {
      id: "theme-light",
      label: "Theme: light",
      icon: SunIcon,
      run: () => (setTheme("light"), close()),
    },
    {
      id: "theme-dark",
      label: "Theme: dark",
      icon: MoonIcon,
      run: () => (setTheme("dark"), close()),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: KeyboardIcon,
      shortcut: "?",
      run: () => {
        close();
        setShortcutsOpen(true);
      },
    },
  ];

  const groups = [
    { heading: "Stages", commands: stageCommands },
    { heading: "Go to", commands: navigation },
    { heading: "Preferences", commands: preferences },
  ]
    .map((group) => ({
      ...group,
      commands: group.commands.filter((command) =>
        matches(command, query.trim()),
      ),
    }))
    .filter((group) => group.commands.length > 0);

  const nothing = parsed.length === 0 && groups.length === 0;

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title="Search and commands"
      description="Search a disease, gene, protein or variant, or run a command."
      className="top-[18%] max-w-[calc(100%-2rem)] gap-0 duration-0 data-closed:animate-none data-open:animate-none sm:max-w-xl"
    >
      <Command
        shouldFilter={false}
        loop
        className="rounded-none bg-transparent p-0"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={SEARCH_PLACEHOLDER}
        />
        <CommandList className="max-h-[min(24rem,60dvh)] border-t border-border-subtle mt-1">
          {parsed.length > 0 ? (
            <CommandGroup heading="Parsed input">
              {parsed.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`parsed-${entry.id}`}
                  onSelect={go(entry.href)}
                >
                  <CornerDownLeftIcon className="text-muted-foreground" />
                  <span className="font-medium">{entry.label}</span>
                  <span className="truncate text-muted-foreground">
                    {entry.detail}
                  </span>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {groups.map((group) => (
            <CommandGroup key={group.heading} heading={group.heading}>
              {group.commands.map((command) => (
                <CommandItem
                  key={command.id}
                  value={command.id}
                  onSelect={command.run}
                >
                  {command.icon ? (
                    <command.icon className="text-muted-foreground" />
                  ) : (
                    <span className="w-3.5" />
                  )}
                  <span>{command.label}</span>
                  {command.detail ? (
                    <span className="truncate font-mono text-muted-foreground">
                      {command.detail}
                    </span>
                  ) : null}
                  {command.shortcut ? (
                    <CommandShortcut>
                      <KeyHint keys={command.shortcut} />
                    </CommandShortcut>
                  ) : null}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {nothing ? (
            <div className="px-3.5 py-4 text-xs text-muted-foreground">
              <p className="text-foreground">
                No identifier recognised in &ldquo;{query.trim()}&rdquo;.
              </p>
              <p className="mt-1">
                Recognised here without a lookup: a gene symbol (BTK), a UniProt
                accession (Q06187), or a gene with a protein change (RAG1 R396H,
                BTK p.Arg28His). Search by disease name needs the search
                service.
              </p>
            </div>
          ) : null}
        </CommandList>
        <div className="flex h-7 items-center gap-4 border-t border-border-subtle bg-sunken px-3">
          <KeyHint keys="enter" label="Open" />
          <KeyHint keys="up" label="" />
          <KeyHint keys="down" label="Move" className="-ml-3" />
          <KeyHint keys="esc" label="Close" className="ml-auto" />
        </div>
      </Command>
    </CommandDialog>
  );
}
