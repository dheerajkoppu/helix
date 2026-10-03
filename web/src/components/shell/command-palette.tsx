"use client";

import {
  BookOpenIcon,
  BoxesIcon,
  CompassIcon,
  CornerDownLeftIcon,
  CpuIcon,
  CrosshairIcon,
  DownloadIcon,
  FlaskConicalIcon,
  FolderIcon,
  FolderPlusIcon,
  GitCompareArrowsIcon,
  GraduationCapIcon,
  InfoIcon,
  KeyboardIcon,
  ListChecksIcon,
  MessageSquareIcon,
  MonitorIcon,
  MoonIcon,
  PlayIcon,
  ScanSearchIcon,
  SlidersHorizontalIcon,
  SunIcon,
} from "lucide-react";
import { useTheme } from "next-themes";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { KeyHint } from "@/components/data/key-hint";
import { openAddToProject } from "@/components/project/add-to-project";
import {
  parsePaletteInput,
  parseResidueInput,
  unresolvedParsedRows,
} from "@/components/search/parse-input";
import {
  SearchResultRow,
  openAtSource,
  openSearchResult,
  resultValue,
} from "@/components/search/result-row";
import type { SearchResult } from "@/components/search/types";
import { useEntitySearch } from "@/components/search/use-entity-search";
import { useSearchPlaceholder } from "@/components/shell/search-trigger";
import {
  CommandDialog,
  Command,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command";
import { Spinner } from "@/components/ui/spinner";
import { isApiError } from "@/lib/api/client";
import {
  formatProteinChange,
  formatVariantId,
  routes,
} from "@/lib/ids";
import { askHelix, useAssistant } from "@/lib/state/assistant";
import { PlainResultRow } from "@/components/shell/plain-result-row";
import {
  PALETTE_WORDS,
  SEARCH_WORDS,
  plainCommand,
  plainCommandGroup,
  plainStage,
} from "@/lib/plain-language";
import { usePreferences } from "@/lib/state/preferences";
import type { ProjectItemDraft } from "@/lib/state/projects";
import { useWorkspaceSelection } from "@/lib/state/selection";
import { useShell } from "@/lib/state/shell";
import {
  STAGES,
  resolveStage,
  stageFromPathname,
  useWorkspaceSubjectStore,
} from "@/lib/state/subject";

export { parsePaletteInput } from "@/components/search/parse-input";

type CommandKind = "action" | "stage" | "page" | "setting" | "residue";

interface PaletteCommand {
  id: string;
  label: string;
  /** what the command acts on, or what it still needs */
  detail?: string;
  keywords?: string;
  /** matched in place of `label` when the label repeats what was typed */
  matchText?: string;
  icon?: React.ComponentType<{ className?: string }>;
  shortcut?: string;
  kind: CommandKind;
  /** a command that cannot run yet stays listed, with the reason in `detail` */
  disabled?: boolean;
  run: () => void;
}

type PaletteMode = "all" | "commands" | "entities" | "residue";

const MODE_PREFIXES: Record<string, PaletteMode> = {
  ">": "commands",
  "@": "entities",
  "#": "residue",
};

function readMode(raw: string): { mode: PaletteMode; text: string } {
  const trimmed = raw.trim();
  const mode = MODE_PREFIXES[trimmed.charAt(0)];
  return mode
    ? { mode, text: trimmed.slice(1).trim() }
    : { mode: "all", text: trimmed };
}

const matches = (command: PaletteCommand, query: string) =>
  `${command.matchText ?? command.label} ${command.keywords ?? ""}`
    .toLowerCase()
    .includes(query.toLowerCase());

/** Job dialog URL contract: /jobs?new=<kind>&<params>. */
function newJobHref(kind: string, params: Record<string, string | null>) {
  const search = new URLSearchParams({ new: kind });
  for (const [key, value] of Object.entries(params))
    if (value) search.set(key, value);
  return `${routes.jobs()}?${search.toString()}`;
}

/** Where the coordinates of a structure can be saved from, by origin. */
function structureExport(
  structureId: string | null,
): { detail: string; open: (navigate: (href: string) => void) => void } | null {
  if (!structureId) return null;
  const separator = structureId.indexOf(":");
  const kind = structureId.slice(0, separator);
  const identifier = structureId.slice(separator + 1);
  if (kind === "pdb")
    return {
      detail: `${structureId} · mmCIF from RCSB PDB`,
      open: () =>
        window.open(
          `https://files.rcsb.org/download/${identifier.toUpperCase()}.cif`,
          "_blank",
          "noopener,noreferrer",
        ),
    };
  if (kind === "afdb") {
    const accession = identifier.split("-")[1];
    return {
      detail: `${structureId} · download page at AlphaFold DB`,
      open: () =>
        window.open(
          `https://alphafold.ebi.ac.uk/entry/${accession}`,
          "_blank",
          "noopener,noreferrer",
        ),
    };
  }
  if (kind === "of")
    return {
      detail: `${structureId} · files of the Helix job`,
      open: (navigate) => navigate(routes.job(identifier)),
    };
  return null;
}

function PendingRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-7 items-center gap-2 px-2.5 py-1.5 text-xs text-muted-foreground">
      <Spinner className="size-3" />
      {children}
    </div>
  );
}

export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const open = useShell((state) => state.paletteOpen);
  const setOpen = useShell((state) => state.setPaletteOpen);
  const setShortcutsOpen = useShell((state) => state.setShortcutsOpen);
  const chain = useWorkspaceSubjectStore((state) => state.chain);
  const selectedRanges = useWorkspaceSelection((state) => state.ranges);
  const selectedStructure = useWorkspaceSelection((state) => state.structureId);
  const boundAccession = useWorkspaceSelection((state) => state.accession);
  const selectResidue = useWorkspaceSelection((state) => state.selectResidue);
  const learnMode = usePreferences((state) => state.learnMode);
  const advanced = usePreferences((state) => state.advanced);
  const placeholder = useSearchPlaceholder();
  const toggleLearnMode = usePreferences((state) => state.toggleLearnMode);
  const toggleAdvanced = usePreferences((state) => state.toggleAdvanced);
  const setAssistantOpen = useAssistant((state) => state.setOpen);
  const { setTheme, resolvedTheme } = useTheme();
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<{ scope: string; value: string } | null>(
    null,
  );

  const { mode, text } = readMode(query);
  const { disease, gene, protein, variant } = chain;
  const accession = protein?.id ?? boundAccession;
  const residue =
    accession && (mode === "all" || mode === "residue")
      ? parseResidueInput(text)
      : null;
  const entityText = mode === "all" || mode === "entities" ? text : "";
  const locallyParsed = parsePaletteInput(entityText);
  // An identifier or a residue names one record: no text search of compounds or papers for it
  const liveText =
    mode === "all" && !residue && locallyParsed.every((row) => row.guess)
      ? text
      : "";

  const search = useEntitySearch(entityText, { enabled: open, limit: 5 });
  const compounds = useEntitySearch(liveText, {
    types: ["compound"],
    enabled: open,
    minLength: 3,
    debounceMs: 400,
    limit: 4,
  });
  const papers = useEntitySearch(liveText, {
    types: ["paper"],
    enabled: open,
    minLength: 3,
    debounceMs: 400,
    limit: 4,
  });

  function close() {
    setOpen(false);
    setQuery("");
  }

  const navigate = (href: string) => {
    close();
    router.push(href);
  };
  const go = (href: string | null) => () => {
    if (href) navigate(href);
  };

  const structureId = selectedStructure ?? chain.structure?.id ?? null;
  const singleResidue =
    selectedRanges.length === 1 &&
    selectedRanges[0].start === selectedRanges[0].end
      ? selectedRanges[0].start
      : null;
  const inWorkspace = stageFromPathname(pathname) !== null;

  const parsed = unresolvedParsedRows(locallyParsed, search.answer);
  const entityGroups = entityText ? (search.shown?.groups ?? []) : [];
  const liveGroups = [
    {
      key: "compounds",
      heading: "Compounds",
      step: "Searching ChEMBL",
      state: compounds,
    },
    {
      key: "papers",
      heading: "Papers",
      step: "Searching Europe PMC",
      state: papers,
    },
  ].map((section) => ({
    ...section,
    // Only the answer for the current text: another query's papers under this one would mislead
    results: section.state.answer?.groups ?? [],
    unanswered: (section.state.answer?.sources ?? []).filter(
      (source) => source.state === "unavailable",
    ),
  }));

  const residueCommands: PaletteCommand[] = [];
  if (residue && accession) {
    const name = `${residue.reference ?? ""}${residue.position}`;
    residueCommands.push({
      id: "residue-open",
      label: `Open residue ${name}`,
      detail: `${accession} · UniProt canonical numbering`,
      kind: "residue",
      icon: CrosshairIcon,
      run: () => {
        selectResidue(residue.position);
        if (inWorkspace) close();
        else navigate(`${routes.protein(accession)}?sel=${residue.position}`);
      },
    });
    if (residue.change && gene) {
      const change = formatProteinChange(residue.change);
      residueCommands.push(
        {
          id: "residue-variant",
          label: `Open variant ${gene.id} ${change}`,
          detail: "Reference residue is checked when the variant opens",
          kind: "residue",
          icon: CornerDownLeftIcon,
          run: go(routes.variant(formatVariantId(gene.id, residue.change))),
        },
        {
          id: "residue-compare",
          label: `Compare ${gene.id} ${change} with the reference`,
          kind: "residue",
          icon: GitCompareArrowsIcon,
          run: go(routes.compare(gene.id, change)),
        },
      );
    }
  }

  const compare = resolveStage("compare", chain);
  const exportTarget = structureExport(structureId);

  let draft: ProjectItemDraft | null = null;
  if (singleResidue !== null && accession)
    draft = {
      kind: "residue",
      ref: `${accession}:${singleResidue}`,
      label: `${protein?.label ?? accession} residue ${singleResidue}`,
      data: { accession, position: singleResidue },
    };
  else if (variant)
    draft = {
      kind: "variant",
      ref: variant.id,
      label: gene ? `${gene.label} ${variant.label}` : variant.label,
    };
  else if (structureId)
    draft = { kind: "structure", ref: structureId, label: structureId };
  else if (protein)
    draft = { kind: "protein", ref: protein.id, label: protein.label };
  else if (gene) draft = { kind: "gene", ref: gene.id, label: gene.label };
  else if (disease)
    draft = { kind: "disease", ref: disease.id, label: disease.label };

  const assistantContext = {
    route: pathname,
    disease: disease?.id,
    gene: gene?.id,
    accession: accession ?? undefined,
    variant: variant?.id,
    structure: structureId ?? undefined,
    residue: singleResidue ?? undefined,
  };
  const subjectLabel =
    variant && gene
      ? `${gene.label} ${variant.label}`
      : (protein?.label ?? gene?.label ?? disease?.label ?? null);

  const actions: PaletteCommand[] = [
    {
      id: "compare",
      label: "Compare variant",
      detail:
        compare.href && gene && compare.subject
          ? `${gene.label} ${compare.subject.label} against the reference`
          : "Needs a variant: pick one in Gene and variants",
      keywords: "difference reference overlay",
      icon: GitCompareArrowsIcon,
      shortcut: "g c",
      kind: "action",
      disabled: !compare.href,
      run: go(compare.href),
    },
    {
      id: "predict",
      label: "Run structure prediction",
      detail: accession
        ? `${accession}${variant ? ` with ${variant.label}` : ""} · opens the job form`
        : "Needs a protein: open a gene to reach its protein",
      keywords: "job fold model boltz predict",
      icon: PlayIcon,
      kind: "action",
      disabled: !accession,
      run: go(
        accession
          ? newJobHref("structure_prediction", {
              uniprot_accession: accession,
              substitution: variant?.label ?? null,
            })
          : null,
      ),
    },
    {
      id: "pockets",
      label: "Find binding pockets",
      detail: accession
        ? `${accession} · opens Intervention, where predicted pockets are listed`
        : "Needs a protein: open a gene to reach its protein",
      keywords: "pocket site ligand cavity p2rank",
      icon: ScanSearchIcon,
      kind: "action",
      disabled: !accession,
      run: go(accession ? routes.interventions(accession) : null),
    },
    {
      id: "add-to-project",
      label: "Add to project",
      detail: draft
        ? `${draft.kind} ${draft.label}`
        : "Needs a subject: open a disease, gene, protein or variant",
      keywords: "save collect trail",
      icon: FolderPlusIcon,
      kind: "action",
      disabled: !draft,
      run: () => {
        if (!draft) return;
        close();
        openAddToProject({ ...draft, origin: { route: pathname } });
      },
    },
    {
      id: "export-structure",
      label: "Export structure",
      detail:
        exportTarget?.detail ??
        "Needs a structure: pick one on the Protein stage",
      keywords: "download mmcif cif pdb coordinates save",
      icon: DownloadIcon,
      kind: "action",
      disabled: !exportTarget,
      run: () => {
        close();
        exportTarget?.open((href) => router.push(href));
      },
    },
    {
      id: "ask-orpha",
      label: text && mode !== "commands" ? `Ask Helix “${text}”` : "Ask Helix",
      detail: subjectLabel ? `about ${subjectLabel}` : "opens the assistant",
      matchText: "Ask Helix",
      keywords: "ask orpha assistant explain question chat",
      icon: MessageSquareIcon,
      kind: "action",
      run: () => {
        const prompt = mode === "commands" ? "" : text;
        close();
        if (prompt) askHelix(prompt, assistantContext);
        else setAssistantOpen(true);
      },
    },
  ];

  const stageCommands: PaletteCommand[] = STAGES.map((stage) => {
    const target = resolveStage(stage.id, chain);
    return {
      id: `stage-${stage.id}`,
      label: `${stage.number} ${advanced ? stage.label : plainStage(stage.id)}`,
      detail: target.subject?.label ?? target.missing ?? undefined,
      keywords: "stage jump go",
      shortcut: `g ${stage.key}`,
      kind: "stage",
      disabled: !target.href,
      run: go(target.href),
    };
  });

  const navigation: PaletteCommand[] = [
    {
      id: "lab",
      label: "Lab",
      keywords: "agents discovery run",
      icon: FlaskConicalIcon,
      kind: "page",
      run: go("/lab"),
    },
    {
      id: "explore",
      label: "Explore",
      keywords: "immune disorders genes browse",
      icon: CompassIcon,
      shortcut: "g e",
      kind: "page",
      run: go(routes.explore()),
    },
    {
      id: "projects",
      label: "Projects",
      icon: FolderIcon,
      kind: "page",
      run: go(routes.projects()),
    },
    {
      id: "jobs",
      label: "Jobs",
      icon: ListChecksIcon,
      shortcut: "g j",
      kind: "page",
      run: go(routes.jobs()),
    },
    {
      id: "models",
      label: "Models",
      keywords: "providers",
      icon: CpuIcon,
      kind: "page",
      run: go(routes.models()),
    },
    {
      id: "docs",
      label: "Docs",
      keywords: "documentation",
      icon: BookOpenIcon,
      kind: "page",
      run: go(routes.docs()),
    },
    {
      id: "about",
      label: "About",
      keywords: "methodology limitations mission",
      icon: InfoIcon,
      kind: "page",
      run: go(routes.about()),
    },
    {
      id: "kit",
      label: "Design kit",
      keywords: "dev components tokens",
      icon: BoxesIcon,
      kind: "page",
      run: go("/dev/kit"),
    },
  ];

  const preferences: PaletteCommand[] = [
    {
      id: "learn",
      label: "Toggle Learn Mode",
      detail: learnMode ? "on" : "off",
      keywords: "explain glossary",
      icon: GraduationCapIcon,
      kind: "setting",
      run: () => {
        toggleLearnMode();
        close();
      },
    },
    {
      id: "advanced",
      label: "Toggle Advanced mode",
      detail: advanced ? "on" : "off",
      keywords: "metrics parameters",
      icon: SlidersHorizontalIcon,
      kind: "setting",
      run: () => {
        toggleAdvanced();
        close();
      },
    },
    {
      id: "theme-toggle",
      label: "Toggle theme",
      detail: resolvedTheme === "dark" ? "dark, switch to light" : "switch to dark",
      keywords: "dark light appearance",
      icon: resolvedTheme === "dark" ? SunIcon : MoonIcon,
      kind: "setting",
      run: () => (setTheme(resolvedTheme === "dark" ? "light" : "dark"), close()),
    },
    {
      id: "theme-system",
      label: "Theme: follow system",
      icon: MonitorIcon,
      kind: "setting",
      run: () => (setTheme("system"), close()),
    },
    {
      id: "theme-light",
      label: "Theme: light",
      icon: SunIcon,
      kind: "setting",
      run: () => (setTheme("light"), close()),
    },
    {
      id: "theme-dark",
      label: "Theme: dark",
      icon: MoonIcon,
      kind: "setting",
      run: () => (setTheme("dark"), close()),
    },
    {
      id: "shortcuts",
      label: "Keyboard shortcuts",
      icon: KeyboardIcon,
      shortcut: "?",
      kind: "setting",
      run: () => {
        close();
        setShortcutsOpen(true);
      },
    },
  ];

  const commandText = mode === "residue" || mode === "entities" ? null : text;
  const commandGroups =
    commandText === null
      ? []
      : [
          { heading: "Actions", commands: actions },
          { heading: "Stages", commands: stageCommands },
          {
            heading: "Go to",
            commands: advanced
              ? navigation
              : navigation.filter((command) => command.id !== "kit"),
          },
          { heading: "Preferences", commands: preferences },
        ]
          .map((group) => ({
            ...group,
            commands: group.commands.filter((command) =>
              matches(command, commandText),
            ),
          }))
          .filter((group) => group.commands.length > 0);
  // Any text can be put to the assistant; the row sits last so it never takes Enter from a match
  const askCommand = actions.find((command) => command.id === "ask-orpha");
  if (mode === "all" && text && askCommand && !matches(askCommand, text))
    commandGroups.push({ heading: "Assistant", commands: [askCommand] });

  const entityRows = entityGroups.flatMap((group) => group.results);
  const liveRows = liveGroups.flatMap((section) =>
    section.results.flatMap((group) => group.results),
  );
  const resultsByValue = new Map<string, SearchResult>(
    [...entityRows, ...liveRows].map((result) => [resultValue(result), result]),
  );
  const firstCommand = commandGroups
    .flatMap((group) => group.commands)
    .find((command) => !command.disabled);
  const firstValue = residueCommands[0]
    ? `command:${residueCommands[0].id}`
    : parsed[0]
      ? `parsed:${parsed[0].id}`
      : entityRows[0]
      ? resultValue(entityRows[0])
      : firstCommand
        ? `command:${firstCommand.id}`
        : "";
  // The highlight returns to the first row whenever the text or the answer changes
  const scope = `${query}\n${search.shown?.query ?? ""}`;
  const selected = picked?.scope === scope ? picked.value : firstValue;

  const searchFailed = entityText ? search.error : null;
  const noEntities =
    entityText !== "" &&
    search.answer !== null &&
    parsed.length === 0 &&
    entityRows.length === 0;
  const noRows =
    text !== "" &&
    !entityText &&
    residueCommands.length === 0 &&
    commandGroups.length === 0;

  const renderCommand = (command: PaletteCommand) => (
    <CommandItem
      key={command.id}
      value={`command:${command.id}`}
      disabled={command.disabled}
      onSelect={command.run}
    >
      {command.icon ? (
        <command.icon className="text-muted-foreground" />
      ) : (
        <span className="w-3.5 shrink-0" />
      )}
      <span className="shrink-0">
        {advanced
          ? command.label
          : command.id === "ask-orpha" && command.label.includes("“")
            ? `${plainCommand(command.id)} ${command.label.slice(command.label.indexOf("“"))}`
            : (plainCommand(command.id) ?? command.label)}
      </span>
      {command.detail && (advanced || command.kind === "setting") ? (
        <span className="min-w-0 truncate text-muted-foreground">
          {command.detail}
        </span>
      ) : null}
      <CommandShortcut className="shrink-0 pl-2 tracking-normal">
        {command.shortcut ? (
          <KeyHint keys={command.shortcut} />
        ) : advanced ? (
          <span className="text-2xs text-subtle-foreground">
            {command.kind}
          </span>
        ) : null}
      </CommandShortcut>
    </CommandItem>
  );

  const renderResult = (result: SearchResult) => (
    <CommandItem
      key={resultValue(result)}
      value={resultValue(result)}
      onSelect={() => openSearchResult(result, navigate)}
    >
      {advanced ? (
        <SearchResultRow result={result} />
      ) : (
        <PlainResultRow result={result} />
      )}
    </CommandItem>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={(next) => (next ? setOpen(true) : close())}
      title={advanced ? "Search and commands" : PALETTE_WORDS.title}
      description="Search a disease, gene, protein or variant, or run a command."
      className="top-[14%] max-w-[calc(100%-2rem)] gap-0 duration-0 data-closed:animate-none data-open:animate-none sm:max-w-2xl"
    >
      <Command
        shouldFilter={false}
        loop
        vimBindings={false}
        value={selected}
        onValueChange={(value) => setPicked({ scope, value })}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            const result = resultsByValue.get(selected);
            if (result?.external_url) {
              event.preventDefault();
              openAtSource(result);
            }
          }
        }}
        className="rounded-none bg-transparent p-0"
      >
        <CommandInput
          value={query}
          onValueChange={setQuery}
          placeholder={placeholder}
        />
        <CommandList className="mt-1 max-h-[min(30rem,62dvh)] border-t border-border-subtle">
          {residueCommands.length > 0 ? (
            <CommandGroup
              heading={
                advanced ? `Residue on ${accession}` : PALETTE_WORDS.jumpTo
              }
            >
              {residueCommands.map(renderCommand)}
            </CommandGroup>
          ) : null}

          {parsed.length > 0 ? (
            <CommandGroup
              heading={advanced ? "Parsed input" : SEARCH_WORDS.goTo}
            >
              {parsed.map((entry) => (
                <CommandItem
                  key={entry.id}
                  value={`parsed:${entry.id}`}
                  onSelect={go(entry.href)}
                >
                  <CornerDownLeftIcon className="text-muted-foreground" />
                  <span className="font-medium" translate="no">
                    {entry.label}
                  </span>
                  <span className="min-w-0 truncate text-muted-foreground">
                    {advanced ? entry.detail : null}
                  </span>
                  <CommandShortcut className="shrink-0 pl-2 tracking-normal">
                    <KeyHint keys="enter" />
                  </CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          ) : null}

          {entityGroups.map((group) => (
            <CommandGroup
              key={group.type}
              heading={
                !advanced
                  ? plainCommandGroup(group.label)
                  : group.total > group.results.length
                    ? `${group.label} · ${group.results.length} of ${group.total}`
                    : group.label
              }
            >
              {group.results.map(renderResult)}
            </CommandGroup>
          ))}

          {entityText && search.pending && entityRows.length === 0 ? (
            <PendingRow>
              {advanced ? "Searching the catalog" : SEARCH_WORDS.searching}
            </PendingRow>
          ) : null}

          {noEntities && !advanced ? (
            <div className="px-3.5 py-3 text-sm text-muted-foreground">
              <p className="text-foreground">{SEARCH_WORDS.nothing}</p>
              <p className="mt-1">{SEARCH_WORDS.tryThis}</p>
            </div>
          ) : null}

          {noEntities && advanced ? (
            <div className="px-3.5 py-3 text-xs text-muted-foreground">
              <p className="text-foreground">
                No source found for &ldquo;{entityText}&rdquo;.
              </p>
              <p className="mt-1">
                Searched: the IEI catalog by name, alias, symbol and
                cross-reference
                {(search.answer?.sources.length ?? 0) > 1
                  ? `, then ${search.answer?.sources
                      .slice(1)
                      .map((source) => source.name ?? source.source)
                      .join(", ")}`
                  : ""}
                . Identifiers are read directly: BTK, Q06187, RAG1 R396H,
                MONDO:0010421, VCV000011348, 1BF5.
              </p>
            </div>
          ) : null}

          {searchFailed ? (
            <CommandGroup heading="Search">
              <CommandItem value="retry:search" onSelect={() => search.retry()}>
                <span className="text-foreground">
                  {!advanced
                    ? SEARCH_WORDS.offline
                    : isApiError(searchFailed) && searchFailed.isUnreachable
                      ? "The Helix API did not answer. Names and aliases cannot be resolved."
                      : `Search failed: ${searchFailed.message}`}
                </span>
                <CommandShortcut className="shrink-0 pl-2 tracking-normal">
                  {advanced ? "Retry" : SEARCH_WORDS.retry}
                </CommandShortcut>
              </CommandItem>
            </CommandGroup>
          ) : null}

          {liveGroups.map((section) =>
            section.results.length > 0 ||
            section.unanswered.length > 0 ||
            (section.state.pending && liveText.length >= 3) ? (
              <CommandGroup
                key={section.key}
                heading={
                  advanced ? section.heading : plainCommandGroup(section.heading)
                }
              >
                {section.results.flatMap((group) =>
                  group.results.map(renderResult),
                )}
                {section.state.pending && section.results.length === 0 ? (
                  <PendingRow>
                    {advanced ? section.step : SEARCH_WORDS.searching}
                  </PendingRow>
                ) : null}
                {section.unanswered.map((source) => (
                  <CommandItem
                    key={source.source}
                    value={`retry:${section.key}`}
                    onSelect={() => section.state.retry()}
                  >
                    <span className="text-muted-foreground">
                      {advanced
                        ? (source.message ??
                          `${source.name ?? source.source} did not answer.`)
                        : SEARCH_WORDS.offline}
                    </span>
                    <CommandShortcut className="shrink-0 pl-2 tracking-normal">
                      {advanced ? "Retry" : SEARCH_WORDS.retry}
                    </CommandShortcut>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : null,
          )}

          {commandGroups.map((group) => (
            <CommandGroup
              key={group.heading}
              heading={
                advanced ? group.heading : plainCommandGroup(group.heading)
              }
            >
              {group.commands.map(renderCommand)}
            </CommandGroup>
          ))}

          {noRows ? (
            <div className="px-3.5 py-4 text-xs text-muted-foreground">
              <p className="text-foreground">
                {!advanced
                  ? PALETTE_WORDS.noCommand
                  : mode !== "residue"
                    ? `No command matches “${text}”.`
                  : accession
                    ? `“${text}” is not a residue or a substitution.`
                    : "No protein in context. Open a gene or protein first."}
              </p>
              {mode === "residue" && advanced ? (
                <p className="mt-1">
                  Type a position (165), a residue (R226, Arg226) or a
                  substitution (D165G, p.Asp165Gly).
                </p>
              ) : null}
            </div>
          ) : null}
        </CommandList>
        <div className="flex h-7 items-center gap-4 border-t border-border-subtle bg-sunken px-3">
          <KeyHint keys="enter" label="Open" />
          {advanced ? (
            <KeyHint
              keys="mod+enter"
              label="Open at source"
              className="hidden sm:inline-flex"
            />
          ) : null}
          <span className="inline-flex items-center">
            <KeyHint keys="up" />
            <KeyHint keys="down" label="Move" />
          </span>
          {advanced ? (
            <span className="hidden items-center gap-3 font-mono text-2xs text-subtle-foreground md:inline-flex">
              <span>&gt; commands</span>
              <span>@ entities</span>
              <span># residue</span>
            </span>
          ) : null}
          <KeyHint keys="esc" label="Close" className="ml-auto" />
        </div>
      </Command>
    </CommandDialog>
  );
}
