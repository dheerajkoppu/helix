# OrphaFold design system

The single source of visual and structural truth for `web/`. Follow it literally. If you need something that is not here, add it to the shared components and to `/dev/kit` first, then use it.

See it running: `/dev/kit` (every component and token, light and dark) and `/dev/frame` (a complete workspace stage on live data: copy its structure).

## 1. Direction

A scientific instrument: paper and ink. One working surface divided by 1px rules. Dense rows, calm type. Chrome is monochrome; saturated colour appears only where it encodes a scientific fact. The residue axis is the product's signature: ticks on a baseline appear in the stage rail, section headers and the dock.

Never: a left navigation sidebar, card grids, stat tiles, gradients, glows, pills, decorative colour, illustrations, animated numbers.

## 2. Layout

### App shell (every route)

| Part        | Height | Component              | Rule                                                                                            |
| ----------- | ------ | ---------------------- | ----------------------------------------------------------------------------------------------- |
| Top bar     | 40px   | `TopBar`               | The only global navigation. Wordmark, nav, search trigger, Learn, Advanced, theme, source link. |
| Main        | fills  | `<main>` in `AppShell` | The viewport never scrolls; `main` does. Workspace routes fill it exactly.                      |
| Status line | 24px   | `StatusLine`           | API state, source status, selection, research-use notice, `?` and `⌘K` hints.                   |

### Pages outside the workspace

Explore, Projects, Jobs, Models, About, Docs, Compound, Project, Snapshot. Build them from `Page`, `PageHeader`, `PageBody`, `PageSection`, `Plate` (`@/components/shell/page`). A ruled header band over one left-aligned column (max 72rem). Sections stack and are separated by rules. A `Plate` is a square ruled box for one table, plot or state.

### Workspace frame (disease, gene, protein, variant, compare)

Mounted once by `src/app/(workspace)/layout.tsx`, so it persists across stages.

| Part        | Size             | Holds                                                       | Use it for                                                                                               |
| ----------- | ---------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Stage rail  | 36px             | Six stages on an axis, each with the entity that fills it   | Moving between stages. A stage that cannot open says what it needs. Never add tabs that compete with it. |
| Subject bar | 32px             | Source-ID chips: disease, gene, variant, protein, structure | Showing what the page is about. Page actions (Add to project, Export) go in `SubjectBarActions`.         |
| Ledger      | 320px, min 240   | The dense table for the stage                               | Lists the user picks from: variants, structures, candidates. Always a `DataTable`.                       |
| Instrument  | fills            | The 3D viewport or the stage's primary plot                 | The one thing the stage is for. Exactly one per stage.                                                   |
| Inspector   | 340px, min 280   | Evidence for the current selection                          | Detail for whatever is selected. Never navigation, never a second table.                                 |
| Axis dock   | 28 / 220 / 46dvh | The persistent sequence axis                                | Present on every stage except Disease. Fed with `useAxisDock`.                                           |

Below 1024px the Instrument fills the area, Ledger and Inspector open as bottom sheets, the rail becomes a stepper, and the dock scrolls horizontally.

### A workspace page, complete

```tsx
"use client";
import { WorkspaceZones, Zone, useAxisDock, useWorkspaceSubject } from "@/components/workspace";
import { useReportSources } from "@/lib/state/shell";

export function ProteinStage({ accession }: { accession: string }) {
  const protein = useQuery(apiQuery<Protein>(`/proteins/${accession}`));

  useWorkspaceSubject({ gene, protein: proteinRef });          // 1. declare every entity you know
  useAxisDock(dockData, { loadingAccession: accession });      // 2. feed the sequence axis (memoised object)
  useReportSources("protein-stage", protein.data?.sources);    // 3. publish source status

  return (
    <WorkspaceZones
      layoutId="protein"
      ledger={<Zone zone="ledger" title="Structures" count={n} scroll={false}><DataTable … /></Zone>}
      instrument={<Zone zone="instrument" title="3D" scroll={false}><MolecularViewer … /></Zone>}
      inspector={<Zone zone="inspector" title="Asp165">…</Zone>}
    />
  );
}
```

`Zone` gives a 36px header (zone name, title, count, `detail`, `actions`), an optional 32px `toolbar`, a scrolling body and an optional 24px `footer` for key hints and legends. Pass `scroll={false}` when the child scrolls itself.

## 3. Shared state

One selection, one hover channel. No panel keeps its own.

| What               | Import                                                                                       | Notes                                                                                                                                          |
| ------------------ | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Selection          | `useWorkspaceSelection` from `@/lib/state/selection`                                         | Residue ranges, variant, structure, chain, window, colour mode, representation, compare mode. UniProt canonical numbering, 1-based, inclusive. |
| Hover              | `setWorkspaceHover`, `useWorkspaceHover`, `subscribeWorkspaceHover` from `@/lib/state/hover` | Transient, one update per frame, never in the URL. Use `subscribe…` in canvas code.                                                            |
| Subject chain      | `useWorkspaceSubject` from `@/components/workspace`                                          | Declare links together; a link tied to a replaced link is dropped.                                                                             |
| Preferences        | `usePreferences`, `useLearnMode`, `useAdvancedMode` from `@/lib/state/preferences`           | Persisted locally.                                                                                                                             |
| Workspace identity | `getWorkspaceId` from `@/lib/workspace-identity`                                             | Sent automatically as `X-OrphaFold-Workspace`.                                                                                                 |

URL parameters are written only when they differ from the default. Do not reuse these keys for anything else:

| Key     | Meaning                            | Example                                                                                      |
| ------- | ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `sel`   | selected residues                  | `165`, `150-180`, `28,150-180`                                                               |
| `var`   | selected variant                   | `p.Arg28His`, `p.Arg28His@VCV000011348`                                                      |
| `s`     | active structure                   | `pdb:1BF5`, `afdb:AF-P42224-F1`, `of:<job_id>`                                               |
| `chain` | chain in focus                     | `A`                                                                                          |
| `win`   | sequence axis window               | `150-180`                                                                                    |
| `iso`   | isoform                            | `P42224-2`                                                                                   |
| `color` | colour mode                        | `confidence`, `chain`, `domain`, `secondary-structure`, `alphamissense`, `reference-variant` |
| `rep`   | representation (default `cartoon`) | `surface`, `ball-and-stick`                                                                  |
| `mode`  | compare mode (default `split`)     | `overlay`, `difference`                                                                      |

Page-owned parameters (filters, sort) are left untouched by the sync. Build internal links with `routes` from `@/lib/ids`.

API: `useQuery(apiQuery("/explore/genes", query))` from `@/lib/api/query`. The result is `{ data, sources, status, requestId }`. A route written as a literal is typed from the generated schema; for a path built at run time, name the model: `apiQuery<Schema<"JobOut">>(`/jobs/${id}`)`. Errors are `ApiError` (`status`, `code`, `message`, `problem`, `isUnreachable`, `isNotFound`); `code` is the API's machine-readable problem code and `problem` the whole problem JSON document.

Backend types come from `Schema<"Name">` in `@/lib/api/types`, with `ApiGetResponse<"/path">` and `ApiGetQuery<"/path">` for a route's response and query parameters. They are generated: `web/src/lib/api/schema.ts` is written from `api/openapi.json` by `make types` and is never edited by hand. Run `make types` after a route or schema changes in the API. Every response field is present, so a field is `T | null` rather than optional; request bodies keep their optional fields. A model used in both a request and a response appears as `Name-Input` and `Name-Output`.

`SourceStatus` rows use the backend's field names: `source`, `name`, `state`, `message`, `release`, `retrieved_at`, `license`, `url`, `from_cache`, `stale`, `elapsed_ms`. `src/app/explore/explore-genes.tsx` is a complete example of a page that reads the API: query, source report, error state and table.

## 4. Typography and density

IBM Plex Sans for everything. IBM Plex Mono for sequences, HGVS, accessions, structure and job IDs, coordinates and every numeric column. Weights 400, 500, 600 only. Ligatures are off globally.

| Utility     | Size / line | Use                                                  |
| ----------- | ----------- | ---------------------------------------------------- |
| `text-2xs`  | 11 / 16     | Column headers, badges, axis ticks, legends, footers |
| `text-xs`   | 12 / 16     | Table cells, controls, zone content, identifiers     |
| `text-sm`   | 13 / 20     | Body default, page prose                             |
| `text-base` | 14 / 20     | Long explanation, hypothesis text, section titles    |
| `text-lg`   | 16 / 24     | Panel titles, rarely needed                          |
| `text-xl`   | 18 / 24     | Kit and page group titles                            |
| `text-2xl`  | 22 / 28     | Page title, entity title                             |
| `text-3xl`  | 28 / 32     | A rare single headline number                        |

Rules:

- Minimum size 11px. Density comes from layout, never from low contrast.
- Uppercase only for `text-2xs` labels (column headers, zone names, section headers).
- Numbers are right-aligned, monospace and tabular (`tabular font-mono`).
- Identifiers are never truncated without a copy action: use `MonoId`.
- 4px grid. Controls 28px (`h-7`), small 24px, table rows 28px, zone header 36px, toolbar 32px, footer 24px. Icons 14px in controls, stroke as shipped by lucide.
- Radius: 2px badges, chips and swatches; 4px controls; 6px popovers and menus; 8px dialogs. Zones, plates and tables are square.
- Every separation is a 1px line: `border-border-subtle` between rows, `border-border` between panels, `border-border-strong` on inputs, swatches and the axis. No shadows on in-flow content; only popovers and dialogs are elevated.
- Selected row: `bg-active` plus a 2px ink bar on the leading edge. Selection is never coloured.

## 5. Colour means something

Neutral surfaces: `bg-background` (work), `bg-sunken` (frame, bars, footers), `bg-muted` (table header), `bg-accent` (hover), `bg-active` (selected), `bg-canvas` (3D ground). Ink: `text-foreground`, `text-muted-foreground`, `text-subtle-foreground`, `text-disabled-foreground`. Use the utilities; never write a raw colour.

| Meaning                                              | Tokens                                                                                                    | Second channel (mandatory)                                                             | Component                    |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | ---------------------------- |
| pLDDT confidence, per residue only                   | `bg-plddt-very-high` `#0053D6`, `-high` `#65CBF3`, `-low` `#FFDB13`, `-very-low` `#FF7D45`, `-none`       | Letter H, M, L, D in the cell; legend always shown                                     | `PlddtLegend`, `plddtBand()` |
| AlphaMissense (a prediction)                         | `bg-am-benign` `#2166AC`, `-ambiguous` `#A8A9AC`, `-pathogenic` `#B2182B`, ramp in `alphaMissenseColor()` | The label "AlphaMissense (predicted)" and the number                                   | `AlphaMissenseLegend`        |
| Clinical significance (database classification only) | `bg-clin-pathogenic`, `-uncertain`, `-benign`, `-other`                                                   | Printed code P, LP, VUS, CONF, LB, B; hatch on the likely classes; review stars as n/4 | `ClinicalSignificanceChip`   |
| Reference vs variant                                 | `bg-reference` (grey), `bg-variant` (magenta)                                                             | Variant site: ball-and-stick, outline and a text label                                 | `ReferenceVariantLegend`     |
| Evidence class                                       | `text-ev-experimental`, `-clinical`, `-literature`, `-curated`, `-prediction`, `-hypothesis`              | Code, glyph shape, border style, glyph fill                                            | `EvidenceBadge`              |
| Structure origin                                     | `text-origin-experimental`, `-predicted-external`, `-predicted-orphafold`                                 | Tag EXP, PRD, OF; glyph; border style; caption                                         | `StructureOriginTag`         |
| Chains                                               | `bg-chain-1..3`                                                                                           | Chain letter always printed                                                            | `Swatch`                     |
| Destructive, warning                                 | `text-destructive`, `text-warning`                                                                        | Icon and text                                                                          |                              |

Evidence classes:

| Class                      | Code | Glyph           | Border | Reads as                 |
| -------------------------- | ---- | --------------- | ------ | ------------------------ |
| `experimental`             | EXP  | filled square   | solid  | Known experimentally     |
| `clinical_database`        | CLIN | shield          | solid  | Database annotation      |
| `literature`               | LIT  | page            | solid  | Database annotation      |
| `curated_database`         | CUR  | circle          | solid  | Database annotation      |
| `computational_prediction` | PRED | hatched diamond | dashed | Computational prediction |
| `orphafold_hypothesis`     | HYP  | dotted hexagon  | dotted | OrphaFold hypothesis     |

Solid means asserted by an external source, dashed means computed by a tool, dotted means authored in OrphaFold. Only wet-lab observation has a filled glyph. Display order EXP, CLIN, CUR, LIT, PRED, HYP is a reading convention and implies no weight.

Rules:

- One colour mode at a time in the viewer and the tracks.
- Canonical scales are identical in light and dark. Do not theme them.
- Text never takes a scale colour. Write the value in ink beside a `Swatch`.
- Every swatch is ringed (the component does it).
- Never reuse a scientific palette for anything else. No cross-source composite score, ever: show each source's own strength.
- A prediction never takes the visual form of a database classification.

## 6. Component inventory

| Component                                                                                    | Import                                       | Use                                                                                                                                 |
| -------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `EvidenceBadge`                                                                              | `@/components/evidence/evidence-badge`       | `<EvidenceBadge evidenceClass="clinical_database" />`; `size="compact"` in table cells.                                             |
| `EvidencePopover`                                                                            | `@/components/evidence/evidence-popover`     | `<EvidencePopover evidence={item} />`: the default way to cite; click shows source, record ID, release, retrieval date, link.       |
| `ClaimLabel`                                                                                 | `@/components/evidence/evidence-badge`       | Four-label reading for comparison and mechanism claims.                                                                             |
| `SourceChip`                                                                                 | `@/components/evidence/source-chip`          | `<SourceChip source="UniProt" id="Q06187" href={url} />` for any source identifier.                                                 |
| `SourceStatusList`                                                                           | `@/components/evidence/source-status-list`   | `<SourceStatusList sources={result.sources} />`: which sources answered, were empty or are down.                                    |
| `StructureOriginTag`                                                                         | `@/components/evidence/structure-origin-tag` | `<StructureOriginTag origin="predicted_external" detail="AlphaFold DB v6" caption />` on every structure.                           |
| `MetricReadout`                                                                              | `@/components/science/metric-readout`        | `<MetricReadout metric="plddt" value={93} producedBy="AlphaFold DB v6" />` for pLDDT, PAE, pTM, ipTM, AlphaMissense, ΔΔG, affinity. |
| `LearnTerm`                                                                                  | `@/components/science/learn-term`            | `<LearnTerm term="plddt">pLDDT</LearnTerm>`; add terms in `@/lib/glossary`.                                                         |
| `PlddtLegend`, `AlphaMissenseLegend`, `ClinicalSignificanceLegend`, `ReferenceVariantLegend` | `@/components/science/legends`               | Required beside any coloured view; `wrap={false}` in footers.                                                                       |
| `ClinicalSignificanceChip`                                                                   | `@/components/science/legends`               | `<ClinicalSignificanceChip significance="pathogenic" reviewStars={2} />`.                                                           |
| `Swatch`                                                                                     | `@/components/science/swatch`                | A ringed colour sample with an optional code.                                                                                       |
| `DataTable`                                                                                  | `@/components/data/data-table`               | Every list: sortable, virtualised, keyboard navigable, optional grouping. Parent needs a bounded height.                            |
| `Table`                                                                                      | `@/components/ui/table`                      | Small static tables without sorting.                                                                                                |
| `SectionHeader`                                                                              | `@/components/data/section-header`           | `<SectionHeader title="Evidence" count={3} />` between blocks inside a zone.                                                        |
| `DefinitionList`, `DefinitionRow`, `Unknown`                                                 | `@/components/data/definition-list`          | Label and value rows; an empty value prints "Unknown".                                                                              |
| `MonoId`                                                                                     | `@/components/data/mono-id`                  | `<MonoId value="Q06187" />`: monospace identifier with copy.                                                                        |
| `ExternalLink`, `TextLink`, `ButtonLink`                                                     | `@/components/data/*`                        | Leaves the app (arrow, new tab) / internal link / internal link styled as a button.                                                 |
| `KeyHint`                                                                                    | `@/components/data/key-hint`                 | `<KeyHint keys="g p" label="Protein" />`; `mod` renders ⌘ or Ctrl.                                                                  |
| `EmptyState`                                                                                 | `@/components/states/empty-state`            | What is absent, which sources were searched, the next step.                                                                         |
| `SourceUnavailable`                                                                          | `@/components/states/source-unavailable`     | One source failed; the rest of the page stays.                                                                                      |
| `QueryErrorState`, `RowsSkeleton`                                                            | `@/components/states/query-state`            | Maps an `ApiError` to the right state; 28px loading rows.                                                                           |
| `toast`                                                                                      | `sonner`                                     | Events that finish out of view: job done, copied, exported.                                                                         |
| `Zone`, `WorkspaceZones`, `SubjectBarActions`, `useWorkspaceSubject`, `useAxisDock`          | `@/components/workspace`                     | The workspace frame parts.                                                                                                          |
| `Page`, `PageHeader`, `PageBody`, `PageSection`, `Plate`                                     | `@/components/shell/page`                    | Pages outside the workspace.                                                                                                        |
| `SearchTrigger`                                                                              | `@/components/shell/search-trigger`          | Opens the command palette; `variant="hero"` on the home page.                                                                       |
| `MolecularViewer`                                                                            | `@/components/viewer`                        | Reserved contract (placeholder until the Mol* build lands). Control it through the `MolecularViewerHandle` ref.                     |
| `SequenceAxisDock`                                                                           | `@/components/sequence`                      | Reserved contract with a working lightweight axis. Pages do not render it; they call `useAxisDock`.                                 |
| Controls                                                                                     | `@/components/ui/*`                          | shadcn/ui on Base UI, Mira. `Button` default is ink; `outline` for secondary; `ghost` in toolbars.                                  |

## 7. States

| Situation                 | Show                                                                                                                                                  |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| No record in a source     | `EmptyState`: "No experimental structure", `searched={[…]}`, and the next step when one exists. A 404 that means "no record" is this, never an error. |
| A source is down          | `SourceUnavailable` at row level with the source's own message, the cached copy date if any, and Retry. Everything else keeps rendering.              |
| API unreachable or failed | `<QueryErrorState error={error} subject="variants for BTK" onRetry={refetch} />`.                                                                     |
| Loading                   | `RowsSkeleton` or the final layout with skeleton blocks, shown after 200ms. Never a spinner without a named step.                                     |
| Unknown value             | `Unknown` ("Unknown" or "No source found"). Never a guess, never a blank.                                                                             |
| Stage has no subject      | The rail says what is missing; the zone says how to get it.                                                                                           |
| Prediction                | Always with model, version, confidence and the `PRED` class; fixed captions from `STRUCTURE_ORIGIN_META`.                                             |

No illustrations, no slogans, no modal dialogs for results, no banner warnings. Provenance and uncertainty are part of the content.

## 8. Motion

- CSS transitions only; `transform` and `opacity` only; never `transition: all`.
- Durations: `--dur-fast` 100ms hover and press, `--dur-base` 150ms tooltips and every close, `--dur-moderate` 200ms popover and menu open, `--dur-slow` 250ms dialog and sheet. 250ms is the ceiling.
- Easing `ease-out-strong`. No bounce, no spring, no stagger on tables.
- Zero animation on anything keyboard-triggered: command palette, row selection, residue hover, tab change by key.
- Never animate a scientific value, a chart or a heatmap entrance. No auto-rotating molecules.
- `prefers-reduced-motion` is handled globally. Pass it to the viewer through `reducedMotion`.

## 9. Keyboard

Register keys with `useHotkeys` (`@/hooks/use-hotkeys`) and list them in `@/lib/shortcuts`. Single-character keys respect the user's setting and never fire in a field. Print every shortcut somewhere with `KeyHint`.

Reserved: `⌘K` palette, `?` shortcuts, `Esc` clear, `g` + `d g p c m i` stages, `g j` jobs, `g e` explore, `[` `]` previous and next stage, `l` ledger, `i` inspector, `a` axis height, `j` `k` `Enter` in tables, arrows on the axis.

## 10. Anti-patterns

1. A left sidebar, a grid of cards, KPI tiles, a hero gradient.
2. Any class, origin or significance carried by colour alone.
3. Experimental and predicted structures in one unsorted list, or a prediction without its tag and confidence.
4. A statement about biology without a source ID; an LLM as the source of a fact.
5. One opaque score replacing per-source evidence.
6. A second selection store, or state that cannot be shared by URL.
7. Information that exists only in a tooltip.
8. Treating "no record" as an error, or blanking a page because one source failed.
9. Silent fallback to another isoform, structure, model version or cached copy.
10. A residue number without its reference (always UniProt canonical).
11. Clinical vocabulary for OrphaFold output: "diagnosis", "recommended treatment", "will treat".
12. Marketing copy: "revolutionize", "unlock", "AI-powered". Do not keep saying something is AI.
13. A raw hex value, a new font size, a new radius, or a component that duplicates one in section 6.
14. A second `TooltipProvider`, a second theme provider, or a bare single-key shortcut outside `useHotkeys`.
