# Helix UX research: information architecture and interaction design

Researched 2026-10-03. Audience: engineers building the Helix workspace (Next.js + TypeScript frontend, FastAPI backend).

Claim status tags used throughout:

- **[V]** verified today by calling the API with curl or reading the source file at a tagged version
- **[D]** read today in official docs, a changelog or a peer-reviewed paper
- **[S]** secondary: search-result summary or third-party page, primary source not opened
- **[P]** proposal made by this document

Nothing in this document was built or user-tested. Wireframes, key maps and colour tokens are proposals. Worked examples use STAT1 (UniProt P42224), an inborn-error-of-immunity gene, with values retrieved today.

---

## 0. Recommendation for Helix

1. **Make one residue axis the spine of the product.** A persistent "axis dock" (ruler, sequence, tracks, variant lollipops) sits under every stage from Gene to Intervention. 3D viewport, tables, heatmaps and comparison plots all read and write a single selection store keyed on UniProt canonical numbering.
2. **Navigate with a stage rail, a subject bar and a command palette.** The six stages run left to right across the top. The subject bar accumulates the chosen disease, gene, variant and structure as chips carrying source IDs. No left navigation sidebar and no card grid.
3. **Use a three-zone work area over the axis dock:** Ledger (dense table for the stage), Instrument (3D viewport or the stage's primary plot), Inspector (evidence for the current selection), plus an IDE-style status line showing selection, data release versions, job state and the research-use notice.
4. **Sequence dock: Nightingale 5.11 (MIT) for navigation, sequence, feature tracks, coloured-sequence rows and the 20-row substitution heatmap. Write the lollipop track in-house.** Nightingale ships no lollipop component [V]. `react-mutation-mapper` is AGPL-3.0-or-later and ProteinPaint is academic-use only [V].
5. _*3D: Mol* 5.12.0 (MIT) with its built-in panels switched off._* Helix supplies the chrome. Link through `plugin.behaviors.interaction.hover/click` and `plugin.managers.interactivity.lociHighlights/lociSelects` [V].
6. **Comparison is one stage with a segmented control: Split, Overlay, Difference.** Superpose with Mol* `tmAlign` (in core since 5.5.0) or `alignAndSuperpose` [V]. Draw difference metrics on the shared axis and mask residues where either model is low confidence.
7. **Evidence badges use four redundant channels: text code, shape, border style, fill.** Colour is a fifth, optional channel. Class assignment is a pure function of source metadata (ECO code, ClinVar review status, Open Targets datasource ID, 3D-Beacons `model_category`), never LLM output.
8. **Structure provenance is a separate three-class marker (EXP, PRD, OF)** shown in every list row, on axis coverage rows, in a non-removable viewport corner tag and burned into exported images.
9. **Keyboard: `Mod+K` palette (cmdk 1.1.1), `/` axis search, `?` help, `g`+letter stage jumps, `j k x Space Enter` in ledgers, zone-scoped single keys, and a setting that disables single-character shortcuts** (WCAG 2.1.4, Level A [D]).
10. **Put all view state in the URL**, following Auspice: only non-default values appear in the query string [D].
11. **Jobs never block.** A status-line indicator opens a jobs drawer. A finished prediction lands in the structure ledger as class OF with a provenance manifest (model, version, seed, parameters, input hash).
12. **Reserve two palettes and never reuse them:** the pLDDT four-band palette and the clinical-significance palette. Pair pLDDT colour with the letter codes H, M, L, D that AlphaFold DB already serves, because the cyan and yellow bands fall below 2:1 contrast on white [V computed].

---

## 1. Current state of the tools and libraries (2026-10-03)

| Item                                          | Current state                                                                                                                                | Licence                                                                                                                                                                                                  | Status                     |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| `molstar` (npm)                               | 5.12.0, published 2026-09-28. `engines.node >=22`, peer `react >=16.14`                                                                      | MIT                                                                                                                                                                                                      | [V] npm + CHANGELOG        |
| Mol* TM-align                                 | Added 5.5.0 (2025-12-22); performance work 5.7.0; Superposition UI panel reworked 5.11.0 (2026-07-18)                                        | MIT                                                                                                                                                                                                      | [V] CHANGELOG              |
| `@nightingale-elements/*`                     | 5.11.0 (2026-09-17) and 5.11.1 (2026-10-01). GitHub release tag lags at v5.6.0 (2025-05-02)                                                  | Repo MIT. npm metadata says ISC for manager, sequence, navigation, sequence-heatmap; MIT for track, track-canvas, variation, variation-canvas, new-core; field missing for structure and linegraph-track | [V]                        |
| `protvista-uniprot`                           | 4.9.4 (2026-08-05)                                                                                                                           | MIT                                                                                                                                                                                                      | [V]                        |
| `@rcsb/rcsb-saguaro` / `-3d`                  | 3.3.0 (2026-07-02) / 4.3.1 (2026-08-26)                                                                                                      | MIT                                                                                                                                                                                                      | [V]                        |
| `pdbe-molstar`                                | 3.12.0 (2026-04-24)                                                                                                                          | Apache-2.0                                                                                                                                                                                               | [V]                        |
| `react-mutation-mapper` (cBioPortal lollipop) | 0.9.13 (2026-09-21); cbioportal-frontend v7.1.0                                                                                              | AGPL-3.0-or-later                                                                                                                                                                                        | [V]                        |
| `auspice` (Nextstrain)                        | 3.0.0 (2026-09-02)                                                                                                                           | AGPL-3.0-only                                                                                                                                                                                            | [V]                        |
| `@sjcrh/proteinpaint-client`                  | 2.216.0 (2026-10-03)                                                                                                                         | Custom St. Jude licence: "academic use without restriction"                                                                                                                                              | [V] first lines of LICENSE |
| gnomAD browser                                | Repo active (pushed 2026-09-28)                                                                                                              | MIT                                                                                                                                                                                                      | [V]                        |
| Foldseek / MMseqs2-App (server UI)            | Foldseek tag 10-941cd33 (2025-01-19); app repo pushed 2026-10-02                                                                             | GPL-3.0                                                                                                                                                                                                  | [V]                        |
| `cmdk`                                        | 1.1.1 (2025-03-14). Repo now at `dip/cmdk`, last push 2025-10-29. Peers `react ^18 \|\| ^19`; depends on `@radix-ui/react-dialog`            | MIT                                                                                                                                                                                                      | [V]                        |
| `kbar`                                        | 1.0.0 (2026-08-10); depends on fuse.js and `@tanstack/react-virtual`                                                                         | MIT                                                                                                                                                                                                      | [V]                        |
| `tinykeys`                                    | 4.0.1 (2026-09-25); bindings are sequences of presses, `$mod` = Meta on macOS, Control elsewhere                                             | MIT                                                                                                                                                                                                      | [V]                        |
| `next` / `react`                              | 16.3.8 / 19.3.0 (npm latest)                                                                                                                 | MIT                                                                                                                                                                                                      | [V]                        |
| AlphaFold DB API                              | OpenAPI `info.version` 1.0.0. `latestVersion` 6 for P42224, `modelCreatedDate` 2025-08-01. Paper states the legacy API retires June 2026 [D] | Data licence not re-verified today                                                                                                                                                                       | [V]                        |
| UniProt REST                                  | Release 2026_03, dated 02-September-2026 (response headers `x-uniprot-release`, `x-uniprot-release-date`)                                    |                                                                                                                                                                                                          | [V]                        |
| gnomAD API                                    | Live; `meta.clinvar_release_date` = 2026-09-28; UniProt variation feed cites "gnomAD v4.1.0 Exomes"                                          |                                                                                                                                                                                                          | [V]                        |
| Open Targets                                  | API 26.9.0, data 26.09                                                                                                                       |                                                                                                                                                                                                          | [V]                        |
| ProtVar API                                   | OpenAPI `info.version` 2.0, docs JSON at `/ProtVar/api/docs`                                                                                 | CC BY 4.0                                                                                                                                                                                                | [V]                        |
| RCSB 1D coordinates API                       | Host is `sequence-coordinates.rcsb.org`. Old `1d-coordinates.rcsb.org` no longer connects [V]; shutdown dated 2025-05-31 [S]                 |                                                                                                                                                                                                          | [V]/[S]                    |
| Ensembl                                       | REST reports release 116 [V]. Legacy site ended with 116 (June 2026) and `www.ensembl.org` moved to the new platform Aug-Sep 2026 [S]        |                                                                                                                                                                                                          | mixed                      |
| GitHub command palette                        | Still a feature preview. Deprecation announced July 2025, then paused [S]                                                                    |                                                                                                                                                                                                          | [S]                        |
| Arc browser                                   | Security updates only since 2025-05-27; team moved to Dia; Atlassian acquisition closed 2025-10-21 [S, vendor blogs]                         |                                                                                                                                                                                                          | [S]                        |
| Vercel dashboard                              | Sidebar navigation became default 2026-02-26                                                                                                 |                                                                                                                                                                                                          | [D]                        |
| Boltz                                         | Latest tag v2.2.1 (2025-09-08), repo pushed 2026-05-29                                                                                       | MIT                                                                                                                                                                                                      | [V]                        |

Licence consequence: Mol*, Nightingale, Saguaro, gnomAD browser, cmdk, kbar and tinykeys are permissive and safe to depend on. cBioPortal's mutation mapper and Auspice are AGPL; study them, do not import them unless Helix itself ships under AGPL. ProteinPaint is out for a general open-source release.

---

## 2. Competitive findings

### 2.1 Scientific tools

| Tool                                     | Transferable pattern                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Avoid                                                                                                                                         | Status                            |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| **AlphaFold DB** entry page              | Tabbed entry (Summary, Domains). Central 3D viewer coloured by pLDDT. Right accordion lists domains and annotations and toggles colour scheme between domain and pLDDT. Domains tab drives the 3D viewer. PAE plot for inter-domain confidence. API exposes `fractionPlddtVeryHigh/Confident/Low/VeryLow` and `globalMetricValue` for a one-line confidence summary                                                                                                                                                                                 | Page is JS-rendered; live DOM not inspected. Details come from the NAR 2026 paper                                                             | [D] + [V] API                     |
| **RCSB PDB** Sequence Annotations viewer | First track defines the reference; a select menu switches reference (PDB entity or UniProtKB) or chain. Feature blocks show a white circle where a feature is truncated and a dashed line across insertions. Wheel zoom reveals residue letters; drag pans. Tooltip lists feature name, source database or software, position, PDB residue IDs, original reference IDs. Colour flag between track title and track marks provenance (blue RCSB, orange third party)                                                                                  | Right-click to select a custom region (undiscoverable, no touch equivalent). Provenance flag is colour-only                                   | [D] docs dated 2026-08-04         |
| **RCSB PDB** experimental vs computed    | Dark-blue flask icon for experimental entries, cyan computer icon for computed structure models. CSMs are opt-in through an "Include CSM" switch. Different ID scheme (`4HHB` vs `AF_AFP44795F1`). API returns `provenance_source` per feature (`Pfam`, `IUPred2(short)`, `Anchor2`, `PDB`, `biojava-7.2.4`)                                                                                                                                                                                                                                        |                                                                                                                                               | [S] docs via search, [V] API      |
| **Mol\*** viewer                         | Canvas left, sequence panel top, controls right, log bottom. Default mode: click focuses a residue and shows its surroundings as ball-and-stick. Selection mode: click selects, green tint. Hover highlights in magenta. Picking level defaults to residue. Sequence panel marks focused loci bold + underline                                                                                                                                                                                                                                      | State tree, log and full controls panel shown to newcomers. Canvas keys I (spin), O (rock), G (illumination), Shift+Space (fly) fire on focus | [D] RCSB docs, [V] source         |
| **UniProt** entry                        | Tabs: Entry, Variant viewer, Feature viewer, Genomic coordinates, Publications, External links, History. Feature viewer categories in order: Molecule processing, Sequence information, Topology, Domains, Sites, PTM, Epitopes, Antigenic sequences, Mutagenesis, Variants, RNA Editing, Proteomics, PDBe 3D structure coverage, AlphaFold, AlphaMissense. Variants render as a density line graph at overview; AlphaFold and AlphaMissense render as coloured-sequence rows. Evidence tag text such as "1 Publication" expands to the source list | Manual vs automatic assertion distinguished by colour alone (gold banner vs blue)                                                             | [V] source + REST help            |
| **ProtVar**                              | Accepts genomic, cDNA, protein and ID inputs. Per-variant annotation grouped as functional, population, structural. API mirrors the grouping: `/function`, `/population`, `/structure`, `/prediction/foldx`, `/prediction/pocket`, `/prediction/interaction`, `/score`. Predictions gated on model confidence (pLDDT 50 window for stability and pockets, 70 for interfaces)                                                                                                                                                                        |                                                                                                                                               | [V] API; inputs, thresholds [S]   |
| **gnomAD** gene page                     | ClinVar track is binned by default with an "expand to all variants" control. Expanded markers double-encode: shape = consequence (cross for LoF, triangle for missense and in-frame, diamond for splice region, circle for the rest), fill = clinical significance. Variant clicks open details in-page. A strip shows which variants are visible in the table. API returns `gold_stars` and `review_status` per ClinVar variant                                                                                                                    |                                                                                                                                               | [V] source + API; table strip [S] |
| **DECIPHER** protein browser             | Pfam domains in the centre; DECIPHER and ClinVar variants plotted above and below; separate gnomAD missense and LoF tracks; regional missense constraint; exon structure; secondary structure and 3D coverage at the bottom. Pathogenicity evidence screen: available evidence types left, selected criteria right                                                                                                                                                                                                                                  | Computing ACMG classes inside Helix (clinical decision territory). Source is a 2022 paper; current UI not inspected                       | [D]                               |
| **Open Targets** Associations on the Fly | Evidence matrix: rows are entities, columns are data sources. A cell button opens a detail widget for that source in place. Source weights are adjustable behind an advanced option and scores recompute. Facets: AND across categories, OR within. Pin rows. Export TSV or JSON. API exposes `datatypeScores` and `datasourceScores` by ID                                                                                                                                                                                                         | A single aggregate score shown without its components                                                                                         | [D] docs, [V] API                 |
| **ClinVar**                              | Review status always appears as stars plus text. 4 = practice guideline, 3 = expert panel, 2 = criteria provided, multiple submitters, no conflicts, 1 = criteria provided (single submitter or conflicting), 0 = no assertion criteria or no classification. Germline, somatic clinical impact and oncogenicity are separate classification types                                                                                                                                                                                                  |                                                                                                                                               | [D] page dated 2024-04-18         |
| **cBioPortal** mutation mapper           | Lollipop above a domain bar, annotation tracks underneath (hotspots, OncoKB, PTM, exon, UniProt topology) with a track selector. Y-max slider, legend toggle, percent toggle. Mirrored top and bottom axes for two groups with a same-scale option. Top lollipops are auto-labelled and label anchors shift near the plot edges. 3D view responds to lollipop and table selection [S]                                                                                                                                                               | AGPL dependency. Lollipop height = sample count suits cohorts and misleads for rare-disease variants seen once                                | [V] source props                  |
| **ProteinPaint**                         | Same-position variants collapse into a disc with a count and expand on click (not verified today: docs returned 503 and 403)                                                                                                                                                                                                                                                                                                                                                                                                                        | Academic-use licence                                                                                                                          | [V] licence only                  |
| **Benchling**                            | Base-level sequence map beside an overview linear map in a split workspace; annotations carry across both. Status bar reports selection start, end, length. One `Cmd+F` search covers bases, annotations, translations and primers                                                                                                                                                                                                                                                                                                                  |                                                                                                                                               | [S] help centre                   |
| **Nextstrain / Auspice**                 | Entire view state lives in URL query parameters (`c`, `d=tree,map`, `l`, `gmin`/`gmax`, `f_<name>`, `s`). Dataset JSON carries `display_defaults`; a parameter disappears from the URL when it returns to default. `onlyPanels` for embeds. Narratives step through saved views (`n=1`)                                                                                                                                                                                                                                                             | AGPL dependency                                                                                                                               | [D]                               |
| **Foldseek server**                      | Database list with explicit versions from `/api/databases/all` (`afdb50` v6, `pdb100` 20240101, `cath50` 4.3.0). Frontend has dedicated History and Queue views and a structure-alignment viewer per hit                                                                                                                                                                                                                                                                                                                                            | Hit-table colour rules not verified                                                                                                           | [V] API + file list               |
| **Neurosnap / Tamarind**                 | Neurosnap shows a cost and runtime estimate at the confirmation step and publishes runtime statistics from past runs. Tamarind keeps UI and API jobs in one queue, offers "Resubmit Job" with the previous settings, a validate-before-submit endpoint, stop and delete, and stores outputs as reusable inputs                                                                                                                                                                                                                                      | Tool-catalogue landing pages; credit meters as primary chrome                                                                                 | [S], Tamarind endpoints [D]       |

### 2.2 Developer tools

| Tool        | Transferable pattern                                                                                                                                                                                                                                                                                                                                                                       | Status                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------- |
| **Linear**  | `Mod+K` command menu acts on the current selection. Single keys: `x` select the highlighted row, `Space` peek (tap toggles, hold shows while held), `j`/`k` move, `/` search, `Esc` clears. `g` then a letter navigates [S, third-party sheets disagree on exact letters]                                                                                                                  | [S] linear.app/docs pages, search summary only |
| **Raycast** | `Enter` runs the primary action; `Mod+K` opens an action panel for the highlighted row, so every row operation is discoverable without memorising keys. `Esc` steps back one level, `Mod+Esc` returns to root. Aliases are typed keywords shown as badges. Ranking is frecency-based with a reset action                                                                                   | [S] manual.raycast.com                         |
| **Arc**     | Command bar fused tabs, history and actions behind one key. Product is frozen; its successor replaced the launcher with an AI chat box, and migration guides treat the lost fuzzy launcher as the thing to rebuild                                                                                                                                                                         | [S] vendor blogs                               |
| **GitHub**  | `?` opens a per-page shortcut sheet. `g c`, `g i`, `g p`, `g a` jump between repository tabs. `s` or `/` focuses search, `t` opens the file finder. Accessibility setting disables character-key shortcuts while keeping modifier shortcuts. The command palette has sat behind a feature-preview flag since 2021 and low usage was the stated reason for the 2025 deprecation attempt [S] | [D] docs                                       |
| **Vercel**  | 2026 navigation: resizable sidebar that hides, the same tabs at team and project level, projects act as filters on the current page, floating bottom bar on phones for one-handed use. Deployments list moved to tighter rows with status grouped by environment [S]. Tab icon reflects queued, building, error, ready [S, old post]                                                       | [D] changelog 2026-02-26                       |

---

## 3. Pattern synthesis

| Theme             | Pattern adopted                                                                                                                          | Taken from                   |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| Sequence + tracks | One reference track defines numbering; all other tracks map onto it; reference is switchable                                             | RCSB                         |
| Variant markers   | Shape = consequence, colour = clinical significance, clinical above the axis and population below, bins at low zoom                      | gnomAD, DECIPHER, cBioPortal |
| Sequence to 3D    | Hover is transient and distinct from selection; click focuses and shows the neighbourhood                                                | Mol*                         |
| Confidence        | Four pLDDT bands with fixed colours plus letter codes; computed annotations gated on confidence                                          | AlphaFold DB, ProtVar        |
| Provenance        | Every feature carries a source name; experimental and computed use different icons and IDs; computed is labelled at the point of display | RCSB, UniProt                |
| Evidence          | Matrix of sources with in-place drill-down; per-source scores visible                                                                    | Open Targets                 |
| Review strength   | Stars always paired with the status text                                                                                                 | ClinVar                      |
| State             | Everything shareable through the URL; saved views as steps                                                                               | Auspice                      |
| Commands          | Palette acts on the highlighted or selected object; row action panel; shortcut hints shown beside commands                               | Linear, Raycast              |
| Jobs              | Estimate before submit, one queue for UI and API, resubmit with prior settings                                                           | Neurosnap, Tamarind          |
| Mobile            | Floating bottom bar; filters instead of deep navigation                                                                                  | Vercel                       |

---

## 4. Deliverable 1: workspace layout

### 4.1 Principles [P]

- **Axis first.** The residue axis is the only widget present in five of six stages. It is the product's identity.
- **Stage rail.** Six numbered stages in a single row. A stage is reachable at any time; stages without a subject show what is missing ("Pick a structure in 3 Protein").
- **Subject bar.** Chips for disease, gene, variant, structure. Each chip shows label + source ID in monospace + class marker. Clicking a chip opens its source record. Experts enter mid-journey by pasting `STAT1 D165G` into the palette; earlier chips fill from database lookups.
- **Zones.** Ledger (left), Instrument (centre), Inspector (right), Axis dock (bottom), Status line. Dividers are draggable. Each zone collapses with one key.
- **No cards.** Tables with 26 px rows, hairline rules, monospace IDs. Summary numbers appear inline in headers.
- **Hypothesis ledger.** A drawer (`h`) collects claims. Each claim lists the evidence rows attached to it. It is the export artefact.

### 4.2 Stage definitions

| #   | Stage             | Ledger                                                                                   | Instrument                                                                            | Inspector                                                 | Axis dock                            |
| --- | ----------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------ |
| 1   | Disease           | Gene list for the disease with per-source evidence columns                               | Gene x evidence-source matrix (Open Targets pattern); cell opens source rows in place | Disease definition, ontology IDs, source records          | Hidden (no protein yet)              |
| 2   | Gene and variants | Variant table (ClinVar, UniProt, gnomAD) linked to the axis window                       | Lollipop plot at large size above domain architecture                                 | Variant record, review status, frequencies, evidence rows | Visible, overview                    |
| 3   | Protein           | Structure inventory grouped EXP, PRD, OF with method, resolution or confidence, coverage | 3D viewport                                                                           | Residue or feature evidence                               | Visible, full tracks                 |
| 4   | Compare           | Pair list (A vs B) and metric table of most-changed residues                             | Split, Overlay or Difference viewport                                                 | Per-residue deltas with provenance                        | Visible, difference tracks added     |
| 5   | Mechanism         | Interactions, interfaces, pockets                                                        | 3D with interaction and pocket overlays; mechanism chain editor                       | Evidence per link of the chain                            | Visible, interface and pocket tracks |
| 6   | Intervention      | Candidate interventions with evidence class per row                                      | Pocket or pose view; hypothesis summary                                               | Evidence, known-drug records, caveats                     | Visible                              |

### 4.3 Desktop wireframe (Protein stage, 1440 px)

Sequence letters, pLDDT codes, IDs, resolutions and release versions are real values retrieved today. Marker placements in the `cov`, `clin` and `pop` rows and "job 41" are illustrative.

```
+----------------------------------------------------------------------------------------------------------------------+
| Helix   1 Disease > 2 Gene+Variants > [3 PROTEIN] > 4 Compare > 5 Mechanism > 6 Intervention      Cmd+K   Jobs:1 |
+----------------------------------------------------------------------------------------------------------------------+
| IMD31C > STAT1 ENSG00000115415 > P42224 p.Asp165Gly VAR_065934 > AF-P42224-F1 v6 [PRD]            RESEARCH USE ONLY  |
+-------------------------------+------------------------------------------------------+-------------------------------+
| LEDGER  structures (22)     / | INSTRUMENT  3D  AF-P42224-F1 v6  chain A  1-750      | INSPECTOR  Asp165 (D)         |
| cls id            method      |                                                      | pLDDT 96.81 H [PRED] AFDB v6  |
| EXP 1BF5          X-ray 2.9A  |                                                      | ----------------------------- |
| EXP 1YVL          X-ray 3.0A  |          (Mol* canvas, Helix chrome only)        | EVIDENCE  p.Asp165Gly         |
| EXP 8YYU          EM    3.84A |                                                      | [EXP] in IMD31C; gain of      |
| PRD AF-P42224-F1  pLDDT 87.3  |                                                      |   function  PubMed:21727188   |
| PRD SWISS-MODEL   QMEANDisCo  |                                                      |   PubMed:23709754  (UniProt)  |
| OF  job 41        Boltz-2 run |                                                      | [CLIN] ClinVar  stars n/4     |
|                               | [PRD] AlphaFold DB v6: predicted, not experimental   | [PRED] FoldX ddG  (ProtVar)   |
| j/k move  x mark  c compare   | colour pLDDT | cartoon | T reset | f focus selection | [HYP] none attached    + add  |
+-------------------------------+------------------------------------------------------+-------------------------------+
| AXIS  P42224 canonical 1-750 | window 150-180 | / search [D165G      ] | tracks 7/15 | - + 0 fit                     |
| nav     |-----------[==]------------------------------------------------------------------------------|              |
| seq     K D K V M C I E H E I K S L E D L Q D E Y D F K C K T L Q N R                                                |
| pos     150       155       160       165       170       175       180                                              |
| dom     (SH2 573-670 is outside this window ->)                                                                      |
| cov     EXP ============================   PRD ############################   OF ::::::::::::::::                    |
| pLDDT   H H H H H H H H H H H H H H H H H H H H H H H H M H M M M M M                                                |
| clin                                  ^ D165G [EXP]                        above axis: clinical variants             |
| axis    +---------+---------+---------+---------+---------+---------+      shared residue axis                       |
| pop             o         o                     o                          below axis: population variants           |
+----------------------------------------------------------------------------------------------------------------------+
| sel D165 | hover - | UniProt 2026_03 | ClinVar 2026-09-28 | AFDB v6 | OT 26.09 | job 41 running 62% | ? shortcuts    |
+----------------------------------------------------------------------------------------------------------------------+
```

Sizing [P]: rail 36 px, subject bar 32 px, status line 24 px. Ledger 300 px (min 240), Inspector 340 px (min 280), Instrument takes the rest. Axis dock 220 px default with three heights (collapsed 56, normal 220, tall 50% of viewport).

### 4.4 Mobile wireframe (390 px)

```
+----------------------------------------------+
| 3/6 Protein  v            Search    Jobs:1   |
| STAT1 > p.Asp165Gly > AF-P42224-F1 [PRD]     |
+----------------------------------------------+
|                                              |
|        3D viewport (about 45% height)        |
|        drag rotate, pinch zoom               |
|        tap residue = select + inspect        |
|                                              |
| [PRD] AlphaFold DB v6: predicted             |
+----------------------------------------------+
| AXIS 150-166       pinch zoom, drag pan      |
| seq   K D K V M C I E H E I K S L E D L      |
| pLDDT H H H H H H H H H H H H H H H H H      |
| clin                          D165G ^        |
| axis  +---------+---------+---------+--      |
+----------------------------------------------+
| ====== INSPECTOR  Asp165 (D)  (peek) ======  |
| pLDDT 96.81 H [PRED]    evidence rows: 3     |
| swipe up: half sheet, full sheet             |
+----------------------------------------------+
|  ( Stage )  ( Search )  ( Select )  ( Jobs ) |
+----------------------------------------------+
```

Mobile rules [P]:

- Stage rail becomes a stepper label that opens a stage sheet. Subject bar scrolls horizontally on one line.
- Ledger and Inspector share one bottom sheet with three detents (peek 88 px, half, full). The sheet header names which one is showing.
- No hover on touch. First tap selects and opens the Inspector at peek. Long-press on the axis starts a range selection with drag handles.
- Axis dock keeps three rows by default (sequence, confidence, clinical). The track picker opens full screen.
- Compare stage offers Overlay, Difference and Blink. Split is desktop only.
- Floating bottom bar holds four targets of at least 44 px (Vercel pattern).
- Job submission works on mobile; the form is one column with the estimate pinned above the submit button.

### 4.5 URL state [P, pattern from Auspice]

```
/w/protein?acc=P42224&sel=165&win=150-180&s=afdb:AF-P42224-F1@6&color=plddt&tracks=dom,ptm,cov,plddt,clin,pop
/w/compare?acc=P42224&a=pdb:1BF5&b=helix:job_41&mode=difference&metric=ca_displacement&sel=165
```

- Path segment names the stage: `disease`, `gene`, `protein`, `compare`, `mechanism`, `intervention`.
- A parameter is written only when it differs from the default.
- `sel` and `win` always use UniProt canonical numbering; `iso=P42224-2` switches isoform (AlphaFold DB serves `AF-P42224-2-F1`, 712 residues [V]).

### 4.6 Shared selection contract [P]

```ts
type ResidueRange = { start: number; end: number }; // UniProt canonical, 1-based, inclusive

type WorkspaceSelection = {
  accession: string; // "P42224"
  isoform: string | null; // "P42224-2", null for canonical
  ranges: ResidueRange[];
  variant: {
    reference: string;
    position: number;
    alternate: string;
    sourceId: string | null;
  } | null;
  structureId: string | null; // "pdb:1BF5" | "afdb:AF-P42224-F1@6" | "helix:job_41"
  chain: string | null; // label_asym_id
};

type WorkspaceHover = {
  accession: string;
  position: number;
  origin: "axis" | "viewport" | "ledger" | "heatmap";
} | null;
```

Hover is ephemeral and never enters the URL. Selection is persistent and does.

---

## 5. Deliverable 2: sequence viewer (axis dock)

### 5.1 Rows, top to bottom [P]

| Row     | Content                                                                           | Encoding                                                                             | Component                                                                     |
| ------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------- |
| Toolbar | Reference (accession, isoform), window, residue search, track count, zoom buttons | Text                                                                                 | React                                                                         |
| `nav`   | Whole-protein minimap with a draggable, resizable window                          | Brush                                                                                | `nightingale-navigation` (`locate(start, end)`, `zoomIn()`, `zoomOut()`) [V]  |
| `seq`   | One-letter residues when zoom allows, ruler otherwise                             | Monospace letters                                                                    | `nightingale-sequence` (switches automatically) [V]                           |
| `dom`   | Domains, regions, repeats                                                         | Labelled rectangles, bumped onto sub-rows                                            | `nightingale-track-canvas`, `layout="non-overlapping"` [V]                    |
| `site`  | Active sites, binding sites, PTMs, mutagenesis                                    | Point shapes (diamond, triangle, circle, hexagon from the 22 Nightingale shapes) [V] | `nightingale-track-canvas`                                                    |
| `cov`   | Structure coverage, one sub-row per structure class                               | EXP solid bar, PRD hatched bar, OF dotted outline; unmodelled gaps left open         | custom canvas track                                                           |
| `conf`  | Per-residue confidence of the active predicted model                              | Four pLDDT band colours + letter code H, M, L, D once cells are at least 10 px wide  | `nightingale-colored-sequence` or custom                                      |
| `clin`  | Clinical and disease variants, above the axis                                     | Lollipop: shape = consequence, fill = significance, stem height = review strength    | custom lollipop track                                                         |
| `axis`  | Tick line with residue numbers                                                    |                                                                                      | custom                                                                        |
| `pop`   | Population variants, below the axis                                               | Lollipop hanging down: stem depth = log10 allele frequency                           | custom lollipop track                                                         |
| `sub`   | Substitution effect (AlphaMissense and similar)                                   | Collapsed: one strip of per-position mean. Expanded: 20-row heatmap                  | `nightingale-sequence-heatmap` (`setHeatmapData(xDomain, yDomain, data)`) [V] |
| `of`    | Helix tracks: pockets, interface residues, difference metrics, user marks     | Dotted outline on every mark + `OF` row label                                        | custom                                                                        |

Default visible set: `seq`, `dom`, `cov`, `conf`, `clin`, `pop`. The track picker (`t`) lists all tracks grouped like UniProt's 15 categories, each with its source and release.

### 5.2 Lollipop specification [P]

| Property            | Rule                                                                                                                                                                                                     |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Head shape          | Consequence class, reusing gnomAD's mapping: cross (rotated 45 degrees) = loss of function, triangle = missense or in-frame indel, diamond = splice region, circle = synonymous or other [V source]      |
| Head fill           | Clinical significance: pathogenic or likely pathogenic `#E6573D`, uncertain or conflicting `#FAB470`, benign or likely benign `#5E6F9E`, other `#BABABA` (gnomAD constants, MIT) [V]                     |
| Head stroke         | `#666` 0.5 px as in gnomAD [V]; 2 px ink stroke when selected                                                                                                                                            |
| Stem height, `clin` | Five discrete levels from ClinVar gold stars 0 to 4. Variants from UniProt without a ClinVar record use level 0 with a `CUR` badge                                                                       |
| Stem depth, `pop`   | Log10 allele frequency, clamped; axis label states the scale                                                                                                                                             |
| Same position       | One head with a count; click fans the stack out vertically (ProteinPaint pattern, not verified today)                                                                                                    |
| Low zoom            | When residue width is under 2 px, switch to stacked bins per significance category with a tooltip "This bin contains: n pathogenic variants" (gnomAD binned plot [V]) and offer "expand to all variants" |
| Labels              | Label the selected variant, variants pinned in the subject bar and the top n by review strength. Anchor flips to `start` or `end` near plot edges (cBioPortal behaviour [V])                             |
| Legend              | Always visible at the right of the row: shapes, fills, stem scale. Clicking a legend entry filters; shift-click isolates                                                                                 |
| Height meaning      | Never recurrence count                                                                                                                                                                                   |

### 5.3 Zoom, pan, search

| Action                           | Mouse / touch                                        | Keyboard (axis zone focused)                                       |
| -------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Zoom at cursor                   | `Ctrl`/`Cmd` + wheel, pinch                          | `+` / `-`                                                          |
| Fit whole protein                | Double-click empty `nav` area                        | `0`                                                                |
| Zoom to selection                | Double-click a feature                               | `z`                                                                |
| Pan                              | Drag on tracks, two-finger scroll, drag `nav` window | `Left` / `Right` (one residue), `PageUp` / `PageDown` (one window) |
| Select residue                   | Click                                                | `Enter` on the residue cursor                                      |
| Extend selection                 | `Shift` + click or drag                              | `Shift` + `Left` / `Right`                                         |
| Add to selection                 | `Cmd`/`Ctrl` + click                                 |                                                                    |
| Next / previous variant marker   |                                                      | `n` / `p`                                                          |
| Next / previous feature boundary |                                                      | `Alt` + `Right` / `Left`                                           |
| Focus selection in 3D            | Double-click selection                               | `f`                                                                |

- Wheel zoom requires the modifier so the page keeps scrolling. Nightingale exposes this as the `use-ctrl-to-zoom` attribute on zoomable elements [V].
- Zoom ceiling: 24 px per residue. Letters appear from 8 px per residue.
- Residue search (`/`) accepts: `165`, `D165`, `D165G`, `p.Asp165Gly`, `150-180`, a feature name (`SH2`), and a motif pattern (`S..[ST]`). Results list beneath the box with the row they come from.
- Search validates the reference residue against the sequence. Typing `E165G` on P42224 returns "Position 165 is D (Asp) in P42224 canonical. No match for E165." with a one-key fix to `D165G`.
- Numbering: UniProt canonical is primary everywhere. PDB author numbering appears second in tooltips when a PDB structure is active (RCSB tooltips list both [D]).

### 5.4 Hover and selection

| State           | Axis dock                                                                                            | 3D viewport                                                                        | Ledger and Inspector                             |
| --------------- | ---------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------ |
| Hover           | Full-height hairline column across all rows + tooltip (residue, position, per-row value with source) | Residue highlighted with Mol* `highlightColor`                                     | Matching row gets a left rule                    |
| Selection       | Filled column band + bold underlined letters (Mol* marks focused loci bold + underline [V])          | Mol* `selectColor` tint; neighbourhood within 5 Å shown as ball-and-stick on focus | Inspector loads the selection; ledger row marked |
| Range selection | Band with start and end handles and a length read-out in the status line                             | Same tint over the range                                                           | Inspector lists features overlapping the range   |

- Hover updates are throttled to one per animation frame. Mol* switched its own sequence panel from debounce to throttle for responsiveness [V changelog].
- Hover and selection use different colours and different shapes (hairline vs band). Keep Mol*'s defaults so users arriving from RCSB, PDBe or AlphaFold DB recognise them: highlight `rgb(255,102,153)`, select `rgb(51,255,26)` [V source values].
- Tooltip content order: residue and position, then one line per visible row with value, class badge and source ID. No tooltip-only information; everything in a tooltip is also in the Inspector.

### 5.5 Nightingale integration notes

- `nightingale-manager` propagates `display-start`, `display-end`, `highlight` and `length` to registered children and listens for `change` events with `detail: { type, value }` [V]. Drive it from the selection store by setting attributes; subscribe to `change` to write back.
- Track highlight ranges use `start:end` (`highlight="3:15"` in the sequence README); the `nightingale-structure` README documents `1-5,10-20`. Normalise in one adapter [V both READMEs].
- Default highlight colour is `#FFEB3B66` [V]; override with `highlight-color`.
- `nightingale-variation` is a 20-row amino-acid matrix and its README calls it redundant to `nightingale-variation-canvas` [V]. Neither is a lollipop.
- Elements depend on d3 7.9.0 and lodash-es [V]. They are custom elements: load them only on the client.
- Alternative considered: `@rcsb/rcsb-saguaro` (MIT) offers block, pin and area displays with hover and click callbacks [V README]. It brings its own board layout, which fights the shared-axis dock.

---

## 6. Deliverable 3: comparison UI

### 6.1 Entry and guard rails [P]

- A comparison is an ordered pair: A is the reference, B is the comparand. Pick with `x` on two ledger rows then `c`, or from the palette ("Compare 1BF5 with job 41").
- The header always spells out both classes: `A  EXP 1BF5 X-ray 2.9 A   vs   B  OF job 41 Boltz-2 (predicted)`.
- Mixed-class pairs (EXP vs PRD or OF) add a fixed caption: "Differences include model error. A is measured; B is predicted."
- Two predictions compared with each other add: "Both structures are predictions."

### 6.2 Modes

| Mode                 | Layout                                                                                                         | Behaviour                                                                                                                                                                            | Implementation notes                                                                                                                                                                                                        |
| -------------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Split** (`1`)      | Two viewports side by side, each with its own class tag and legend                                             | Cameras locked together by default (toggle). Hover and selection mirror in both. Axis dock shows two `cov` and two `conf` rows                                                       | Two Mol* `PluginContext` instances. `canvas3d.camera.stateChanged` is a `BehaviorSubject`; apply snapshots to the peer with `camera.setState(snapshot)` and guard against the echo [V names, untested]                      |
| **Overlay** (`2`)    | One viewport, B superposed on A                                                                                | A in neutral grey, B in the accent colour, per-structure opacity sliders, optional "colour both by confidence". Header shows RMSD, TM-score normalised by A and by B, aligned length | `tmAlign(lociA, lociB)` returns the transform plus `tmScoreA`, `tmScoreB`, `rmsd`, `alignedLength`; `alignAndSuperpose` for same-sequence pairs; `alignAndSuperposeWithSIFTSMapping` for PDB vs UniProt-numbered models [V] |
| **Difference** (`3`) | Overlay viewport coloured by the chosen metric + ranked table in the ledger + diverging track in the axis dock | Metrics: C-alpha displacement after superposition, confidence delta, contact-count delta, solvent-accessibility delta. Clicking a table row selects the residue everywhere           | Metrics computed in the backend and returned per residue with the method name and version, so they carry a `PRED` badge                                                                                                     |
| **Blink** (`b`)      | Overlay viewport showing A or B alone, swapping on key press or a 1 Hz timer                                   | Small motions become visible without colour. The current side is named in the corner tag                                                                                             | Visibility toggle on two structures; primary compare mode on mobile                                                                                                                                                         |

### 6.3 Difference rules [P]

- Mask residues where either structure is low confidence (default threshold pLDDT 70; ProtVar gates interface predictions at 70 and stability at 50 [S]). Masked cells draw as grey hatch with the reason in the tooltip.
- Mask residues unmodelled in either structure; never interpolate.
- Diverging scale has a neutral midpoint and a symmetric range. The legend prints the numeric range and the unit.
- Superposition scope is explicit: whole chain, selected domain, or "residues within 10 Å of the variant". The scope appears next to the RMSD because local and global fits tell different stories.
- Every number in the header and table links to how it was computed (method, version, inputs).
- Export produces a PNG with both class tags, the metric legend and the research-use line burned in, plus a JSON manifest.

---

## 7. Deliverable 4: evidence badge system

### 7.1 Six classes [P]

| Class                    | Code   | Shape                            | Border | Fill           | Required payload on the badge or its popover                                      |
| ------------------------ | ------ | -------------------------------- | ------ | -------------- | --------------------------------------------------------------------------------- |
| Experimental evidence    | `EXP`  | Square                           | Solid  | Filled         | Method, source ID (PDB ID, PMID, ECO code)                                        |
| Clinical database        | `CLIN` | Shield (square, pointed base)    | Solid  | Hollow         | Database, accession, review status as `n/4` + text, release date                  |
| Published literature     | `LIT`  | Page (rectangle, clipped corner) | Solid  | Hollow         | PMID or DOI, count, `text-mined` modifier where applicable                        |
| Curated database         | `CUR`  | Circle                           | Solid  | Hollow         | Database, record ID, `manual` or `auto` modifier                                  |
| Computational prediction | `PRED` | Diamond                          | Dashed | Diagonal hatch | Tool, version, confidence metric and value, origin (external or Helix job ID) |
| Helix hypothesis     | `HYP`  | Hexagon                          | Dotted | Hollow         | Hypothesis ID, author, timestamp, list of supporting badges                       |

Reading rules that hold without colour:

- The three-or-four-letter code is always printed. Minimum badge: `[shape] CODE`.
- Border style: solid = asserted by an external source from observation or curation; dashed = computed by a tool; dotted = authored inside Helix.
- Fill: only wet-lab observation is filled.
- Shape is unique per class, so the badge survives greyscale printing and 12 px rendering.
- Screen readers get the full label: "Computational prediction, AlphaFold DB version 6, pLDDT 96.81".

Compact, standard and expanded forms:

```
[#]EXP                          compact (table cell, tooltip line)
[#] EXP  PubMed:21727188        standard (Inspector row)
[#] EXP  Experimental evidence  expanded (popover header)
    in IMD31C; gain of function | ECO:0000269 via UniProt P42224 VAR_065934, release 2026_03
    Open at source   Copy citation   Attach to hypothesis
```

### 7.2 Colour tokens (redundant channel) [P, contrast computed today]

| Class | Light theme | Contrast on `#FFFFFF` | Dark theme | Contrast on `#0B0D10` |
| ----- | ----------- | --------------------- | ---------- | --------------------- |
| EXP   | `#111418`   | 18.47                 | `#F2F4F6`  | 17.65                 |
| CLIN  | `#0F6E6E`   | 6.04                  | `#5CC8C8`  | 9.78                  |
| LIT   | `#7A4B12`   | 7.39                  | `#D9A566`  | 8.82                  |
| CUR   | `#2F6B2F`   | 6.43                  | `#8BCB8B`  | 10.20                 |
| PRED  | `#5B3FA8`   | 7.72                  | `#B7A2F2`  | 8.77                  |
| HYP   | `#5A6068`   | 6.35                  | `#A2A9B1`  | 8.20                  |

All clear 4.5:1. Hues avoid the two reserved palettes in section 7.5. Not yet checked under colour-vision-deficiency simulation.

### 7.3 Deterministic mapping [V for the source values, P for the mapping]

| Source field                                              | Value                                                   | Class | Modifier                                |
| --------------------------------------------------------- | ------------------------------------------------------- | ----- | --------------------------------------- |
| UniProt `evidences[].evidenceCode`                        | `ECO:0000269` experimental evidence                     | EXP   | PMID from `source: "PubMed"`, `id`      |
|                                                           | `ECO:0007744` combinatorial evidence (manual)           | EXP   | source ID (PDB, PubMed)                 |
|                                                           | `ECO:0007829` combinatorial evidence (automatic)        | EXP   | `auto`                                  |
|                                                           | `ECO:0000303` non-traceable author statement            | LIT   |                                         |
|                                                           | `ECO:0000305` curator inference                         | CUR   | `manual`                                |
|                                                           | `ECO:0000250` sequence similarity                       | CUR   | `by similarity`                         |
|                                                           | `ECO:0000312` / `ECO:0000313` imported information      | CUR   | `manual` / `auto`                       |
|                                                           | `ECO:0000255` sequence model (manual)                   | PRED  | rule ID, `curator-verified`             |
|                                                           | `ECO:0000256`, `ECO:0000259` sequence model (automatic) | PRED  | rule ID, `auto`                         |
|                                                           | `ECO:0008006` deep learning method (automatic)          | PRED  | `auto`                                  |
| UniProt feature with no `evidences` array                 | e.g. `VAR_034521` "in dbSNP:rs34255470"                 | CUR   | `no evidence code`                      |
| ClinVar record                                            | any                                                     | CLIN  | `gold_stars` 0-4 + `review_status` text |
| gnomAD record                                             | any                                                     | CUR   | `population`, dataset version           |
| Open Targets `datasourceScores[].id`                      | `eva`, `clingen`, `genomics_england`                    | CLIN  | datasource ID                           |
|                                                           | `orphanet`, `uniprot_variants`, `uniprot_literature`    | CUR   | datasource ID                           |
|                                                           | unrecognised ID                                         | CUR   | `unmapped source`; log it               |
| RCSB entry                                                | `exptl[].method`, `rcsb_entry_info.resolution_combined` | EXP   | method + resolution                     |
| 3D-Beacons `model_category`                               | `EXPERIMENTALLY DETERMINED`                             | EXP   |                                         |
|                                                           | `TEMPLATE-BASED`, `AB-INITIO`                           | PRED  | provider, `confidence_type`             |
| AlphaFold DB pLDDT, PAE, AlphaMissense                    |                                                         | PRED  | model version                           |
| ProtVar `/prediction/foldx`, `/score` (`CONSERV`, `EVE`)  |                                                         | PRED  | tool name                               |
| Helix job output                                      |                                                         | PRED  | origin `helix:job_<id>`             |
| Mechanism or intervention statement composed in Helix |                                                         | HYP   | supporting badge IDs                    |

Implement as one pure function `classifyEvidence(source)` with a unit test per row. Display order in the Inspector: EXP, CLIN, CUR, LIT, PRED, HYP. The order is a reading convention and implies no numeric weight.

### 7.4 Structure class marker [P]

| Class                          | Code  | Icon                             | Axis `cov` row | Viewport corner tag (not removable)                          |
| ------------------------------ | ----- | -------------------------------- | -------------- | ------------------------------------------------------------ |
| Experimental structure         | `EXP` | Flask (RCSB convention [S])      | Solid bar      | `EXP 1BF5 X-ray 2.9 A`                                       |
| Existing predicted structure   | `PRD` | Chip                             | Hatched bar    | `PRD AlphaFold DB v6: predicted, not experimental`           |
| Helix-generated prediction | `OF`  | Helix mark in a dotted frame | Dotted outline | `OF job 41 Boltz-2 <version>: generated here, not validated` |

- Ledger groups rows by class with a group header and count. Sorting never interleaves classes unless the user asks.
- PRD and OF structures default to confidence colouring. EXP structures default to chain colouring.
- AlphaFold DB is labelled `AB-INITIO` by the 3D-Beacons schema and SWISS-MODEL `TEMPLATE-BASED` [V]; show the provider's own wording in the popover.

### 7.5 Reserved scientific palettes

| Palette                                                       | Values                                                                                                                                | Rule                                                                                         |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| pLDDT [V Mol* source, AFDB file]                              | Very high (> 90) `#0053D6` code H; Confident (70-90) `#65CBF3` code M; Low (50-70) `#FFDB13` code L; Very low (< 50) `#FF7D45` code D | Only for per-residue confidence. Print the code letter in 2D cells                           |
| Clinical significance [V gnomAD source]                       | `#E6573D`, `#FAB470`, `#5E6F9E`, `#BABABA`                                                                                            | Only for database classifications, never for Helix predictions                           |
| AlphaMissense classes [V thresholds from AFDB CSV for P42224] | `LBen` < 0.34, `Amb` 0.34 to 0.564, `LPath` >= 0.564                                                                                  | Official colours not verified today; use a diverging scale distinct from both palettes above |

---

## 8. Deliverable 5: keyboard and command palette

### 8.1 Layers [P]

| Layer                | Keys                                                                                                                                                                           | Notes                                                                                           |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| Global               | `Mod+K` palette. `/` residue and feature search. `?` shortcut sheet for the current zone. `Esc` closes the top layer, then clears selection. `F6` / `Shift+F6` cycle zones     | `Mod` = Cmd on macOS, Ctrl elsewhere (`$mod` in tinykeys [V])                                   |
| Stage jumps          | `g d` Disease, `g g` Gene and variants, `g p` Protein, `g c` Compare, `g m` Mechanism, `g i` Intervention, `g j` jobs drawer. `[` / `]` previous / next stage                  | Two-key sequences, GitHub convention [D]                                                        |
| Panels               | `l` Ledger, `i` Inspector, `a` cycle axis dock height, `h` hypothesis ledger, `e` explain overlay                                                                              | Single keys, inactive inside inputs and inside the 3D canvas                                    |
| Ledger zone          | `j` / `k` or arrows move. `x` mark. `Space` peek (tap toggles, hold shows while held). `Enter` set as subject. `c` add marked rows to Compare. `o` open at source. `y` copy ID | Linear conventions [D]                                                                          |
| Axis zone            | Section 5.3, plus `t` track picker                                                                                                                                             |                                                                                                 |
| Instrument zone (3D) | `T` reset view (Mol* default). `f` focus selection. `r` cycle representation. In Compare: `1` Split, `2` Overlay, `3` Difference, `b` blink                                    | Disable Mol* `I` spin, `O` rock, `G` illumination and `Shift+Space` fly bindings [V they exist] |
| Palette open         | `Up` / `Down` move. `Enter` primary action. `Mod+Enter` secondary action. `Tab` opens the row's action list. `Backspace` on empty input goes back one page                     | Raycast model [S]                                                                               |

Rules:

- Single-character shortcuts follow WCAG 2.1.4: a setting turns them off, and zone keys fire only while that zone has focus [D].
- Every command row in the palette prints its shortcut at the right edge, so the palette teaches the keys.
- A visible `Cmd+K` button sits in the rail. GitHub's palette stayed hidden behind a preview flag and saw low use [S].
- `Ctrl+J` and `Cmd+\` are left alone (browser downloads and password-manager fill).

### 8.2 Palette behaviour [P]

| Input      | Result                                                                                              |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Empty      | Sections: Recent subjects, Stage commands, Running jobs                                             |
| Free text  | Sections in fixed order: Parsed input, Genes and proteins, Diseases, Variants, Structures, Commands |
| `>` prefix | Commands only                                                                                       |
| `@` prefix | Entities: gene, protein, disease                                                                    |
| `#` prefix | Residue or variant on the current protein (`#165`, `#D165G`)                                        |
| `:` prefix | Structure IDs (`:1BF5`, `:AF-P42224-F1`)                                                            |
| `!` prefix | Jobs                                                                                                |

- **Parsed input** is recognised locally before any network call: UniProt accession, `GENE p.Xxx000Yyy`, `GENE X000Y`, `rs` IDs, PDB IDs, AlphaFold DB IDs, MONDO / Orphanet / OMIM IDs. The row shows what will be looked up and where.
- **Entity rows** come from database lookups through the backend. Each row shows a type glyph, label, source ID in monospace and the source name. No generated text.
- **Row actions** (`Tab`): Open, Add to compare, Set as subject, Copy ID, Open at source.
- **Ranking**: exact ID match, then recents, then frecency. "Reset ranking" is a command.
- **cmdk settings** [V README]: `shouldFilter={false}` for server-backed sections with your own ranking, `keywords` on items for aliases, `loop`, `Command.Loading` for pending sections, nested pages via a `pages` state array for row actions.
- Remote search debounces at 150 ms and cancels stale requests. Local commands filter synchronously.
- Failure row: "UniProt search failed (HTTP 503). Retry" stays inside its section; other sections still render.

---

## 9. States, disclosure, jobs, theming

### 9.1 Empty and failure states [P]

| Situation                             | What the UI prints                                                                                                                                                                                                                                                 |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Track has no data                     | Row stays, greyed: "No ClinVar variants for P42224 (ClinVar 2026-09-28)". The release date comes from the source (`meta.clinvar_release_date` on the gnomAD API [V])                                                                                               |
| Source says "none" with an error code | AlphaFold DB `GET /api/complex/P42224` returns HTTP 404 with body `{}`; ProtVar `GET /prediction/pocket/P42224/165` returns 404 with an empty body [V]. Backend maps these to an explicit `empty` result. UI prints "No complex models in AlphaFold DB for P42224" |
| Upstream outage                       | Row-level notice: "RCSB annotations unavailable (timeout 30 s at 16:36 UTC). Showing cached copy from 2026-10-01. Retry". Other rows keep working                                                                                                                  |
| Reference mismatch                    | "Position 165 is D in P42224 canonical. Variant E165G does not match." with the one-key correction                                                                                                                                                                 |
| Numbering mismatch                    | "1BF5 chain A does not cover residue 720 (modelled range shown in cov row)"                                                                                                                                                                                        |
| Version skew between sources          | Show both values with versions. Today AlphaFold DB v6 gives pLDDT 96.81 at residue 165 while ProtVar's FoldX record for the same residue reports `plddt: 97.29` [V], which indicates ProtVar computed on a different model version (inference)                     |
| Stage has no subject                  | One line naming the missing subject and the key to fix it: "No structure chosen. Press g p."                                                                                                                                                                       |
| No results                            | Echo the parsed query, list which sources were searched, offer the nearest valid forms                                                                                                                                                                             |

No illustrations and no marketing copy in empty states.

### 9.2 Progressive disclosure [P]

| Level                 | Mechanism                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Explain overlay (`e`) | Adds one-line definitions under headers and legends from a versioned, hand-written glossary. Off by default after first use                  |
| Default vs all tracks | Six rows by default; picker reveals the rest grouped by category                                                                             |
| Inspector             | Summary line, then evidence rows, then "Source record" disclosure with the raw JSON and request URL                                          |
| Advanced controls     | Source weighting, superposition scope and model parameters sit behind an "Advanced" disclosure (Open Targets hides weights the same way [D]) |
| Density               | One setting: compact (default) or comfortable. Same layout, same features                                                                    |

One interface for everyone. No separate novice mode.

### 9.3 Job and progress UI [P]

| State               | Glyph + text                               | Shown                                                                                     |
| ------------------- | ------------------------------------------ | ----------------------------------------------------------------------------------------- |
| Draft               | hollow circle, "Draft"                     | Form with validation results inline (Tamarind exposes a validate endpoint [D])            |
| Estimating          | "Estimate: about 6 min"                    | Estimate from past runs with the same model and sequence length (Neurosnap pattern [S])   |
| Queued              | clock, "Queued (position 3)"               | Status line + drawer                                                                      |
| Running             | spinner, "Running: inference 2/4"          | Named steps: input preparation, MSA, inference, scoring. Elapsed time. Log tail on demand |
| Succeeded           | check, "Done in 5 min 12 s"                | New OF row in the structure ledger; toast with "Open" and "Compare"                       |
| Failed              | cross, "Failed at MSA: <provider message>" | Inputs preserved; "Resubmit with changes" (Tamarind pattern [S])                          |
| Cancelled / Expired | dash, text                                 | Row remains with its manifest                                                             |

- The tab title and favicon reflect the most urgent job state (Vercel tab-icon pattern [S]).
- UI-submitted and API-submitted jobs share one queue view.
- Every job stores a manifest: provider adapter, model name and version, weights hash if available, seed, parameters, input sequence hash, timestamps, backend version.

### 9.4 Typography and density [P]

| Token                      | Value                                                                                  |
| -------------------------- | -------------------------------------------------------------------------------------- |
| UI text                    | 13 px / 18 px                                                                          |
| Table rows                 | 12 px text, 26 px row, tabular numerals                                                |
| IDs, coordinates, sequence | Monospace 12 px; sequence letters 12-14 px by zoom                                     |
| Fonts                      | Inter or Geist for UI; JetBrains Mono or IBM Plex Mono for data. All OFL-1.1 [V]       |
| Rules                      | 1 px hairlines; no shadows; radius 2 px on badges, 0 on panels                         |
| Colour budget              | Neutrals + one accent for interaction. Other colour appears only where it encodes data |

### 9.5 Molecular viewer theming [V contrast computed, P decisions]

| Canvas    | pLDDT `#0053D6` | `#65CBF3` | `#FFDB13` | `#FF7D45` |
| --------- | --------------- | --------- | --------- | --------- |
| `#000000` | 3.21            | 11.39     | 15.39     | 8.27      |
| `#0B0D10` | 2.97            | 10.55     | 14.26     | 7.66      |
| `#1B1F24` | 2.53            | 8.98      | 12.14     | 6.52      |
| `#FFFFFF` | 6.55            | 1.84      | 1.36      | 2.54      |

- Dark theme canvas: `#000000`. Of the dark values tested, only pure black keeps the very-high pLDDT blue at 3:1. Page chrome can be lighter (`#0B0D10`); separate with a 1 px rule.
- Light theme canvas: `#FFFFFF` with Mol* outline post-processing turned on (`postprocessing.outline`, default `off` [V]), because cyan and yellow bands are close to invisible on white.
- Data colours are identical in both themes. Only neutrals change.
- Set with `plugin.canvas3d.setProps({ renderer: { backgroundColor } })`; `highlightColor` and `selectColor` live in the same `renderer` group [V].
- Figure export always offers a white background regardless of theme.
- Mol* ships `light`, `dark` and `blue` SCSS skins for its own panels [V]; irrelevant once those panels are off.
- No auto-spin, no illumination mode by default.

---

## 10. Deliverable 6: anti-patterns

1. Left sidebar navigation with a grid of summary cards and KPI tiles.
2. Any evidence class, structure class or pathogenicity state encoded by colour alone (WCAG 1.4.1, Level A [D]).
3. Experimental and predicted structures in one unsorted list, or a predicted structure shown without its class tag and confidence.
4. Low-confidence regions drawn as confident cartoon with no visual difference.
5. Generated prose stating biological facts without a source ID; a single opaque score replacing per-source evidence.
6. Lollipop height meaning recurrence count for rare-disease variants (the lollipop critique in PLOS ONE 2016 [S]).
7. Independent selection per panel. One store, one selection.
8. Information available only on hover. Tooltips duplicate the Inspector; touch and keyboard users lose nothing.
9. Right-click as the only way to reach an action (RCSB region select).
10. Wheel zoom that captures page scroll without a modifier.
11. Ambiguous numbering: showing a residue number without saying which reference; silently assuming the canonical isoform.
12. Silent fallback to another isoform, structure, model version or cached copy.
13. Treating HTTP 404 from a source as an error banner when it means "no record".
14. Modal dialogs for results; spinners with no step name; a job that blocks the workspace.
15. Clinical vocabulary and visuals: "diagnosis", "recommended treatment", red and green verdict lights on Helix's own predictions, ACMG class calculators.
16. Reusing the pLDDT palette or the clinical-significance palette for anything else; rainbow chain colouring as a default.
17. Changing colour semantics between light and dark themes.
18. Auto-rotating molecules, glossy rendering by default, decorative gradients, animated counters.
19. View state that cannot be shared by URL; IDs truncated with no copy action.
20. Empty states with illustrations and slogans.
21. Dense data set in small low-contrast grey text. Density comes from layout, not from shrinking contrast.
22. A hidden command palette; shortcuts with no on-screen hint; single-key shortcuts that cannot be disabled.
23. Chat as the primary entry point in place of deterministic search (the Arc to Dia change [S]).
24. Exposing Mol*'s state tree, log and full controls panel as the default interface.
25. Importing AGPL or academic-only visualisation packages into a permissively licensed codebase.
26. Exported figures without class tags, legends and source versions.

---

## 11. Endpoints that feed these components (all called today)

| Component                                  | Request                                                                                                                                                                                                                                                                  | Fields used                                                                                                                                                                                                                                                                                                                                                                                                                                            | Result                                                                                               |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| Structure ledger (PRD), confidence summary | `GET https://alphafold.ebi.ac.uk/api/prediction/P42224`                                                                                                                                                                                                                  | `entryId`, `modelEntityId`, `latestVersion`, `allVersions`, `globalMetricValue`, `fractionPlddtVeryHigh`, `fractionPlddtConfident`, `fractionPlddtLow`, `fractionPlddtVeryLow`, `sequenceStart`, `sequenceEnd`, `toolUsed`, `providerId`, `modelCreatedDate`, `isComplex`, `bcifUrl`, `cifUrl`, `pdbUrl`, `plddtDocUrl`, `paeDocUrl`, `amAnnotationsUrl`, `msaUrl` (44 keys; older names such as `uniprotAccession`, `uniprotStart` are still present) | 200, 2 entries (canonical + isoform 2)                                                               |
| `conf` row                                 | `GET https://alphafold.ebi.ac.uk/files/AF-P42224-F1-confidence_v6.json`                                                                                                                                                                                                  | `residueNumber[]`, `confidenceScore[]`, `confidenceCategory[]` (`H`, `M`, `L`, `D`)                                                                                                                                                                                                                                                                                                                                                                    | 200                                                                                                  |
| PAE plot                                   | `GET https://alphafold.ebi.ac.uk/files/AF-P42224-F1-predicted_aligned_error_v6.json`                                                                                                                                                                                     | `[0].predicted_aligned_error` (750 rows), `[0].max_predicted_aligned_error` (31.75)                                                                                                                                                                                                                                                                                                                                                                    | 200                                                                                                  |
| `sub` heatmap                              | `GET https://alphafold.ebi.ac.uk/files/AF-P42224-F1-aa-substitutions.csv`                                                                                                                                                                                                | columns `protein_variant`, `am_pathogenicity`, `am_class`                                                                                                                                                                                                                                                                                                                                                                                              | 200, 14250 rows                                                                                      |
| AFDB annotations                           | `GET https://alphafold.ebi.ac.uk/api/annotations/P42224.json?type=MUTAGEN`                                                                                                                                                                                               | `annotation[].type`, `description`, `source_name`, `source_url`                                                                                                                                                                                                                                                                                                                                                                                        | 200 (`type` is required)                                                                             |
| Structure ledger (all providers)           | `GET https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P42224.json`                                                                                                                                                                                       | `structures[].summary.provider`, `model_category`, `experimental_method`, `resolution`, `confidence_type`, `coverage`, `uniprot_start`, `uniprot_end`, `model_url`, `model_page_url`, `created`                                                                                                                                                                                                                                                        | 200, 22 structures                                                                                   |
| `dom`, `site` rows, evidence badges        | `GET https://rest.uniprot.org/uniprotkb/P42224.json?fields=accession,gene_names,ft_domain,ft_region,ft_binding,ft_mod_res,ft_variant,ft_mutagen`                                                                                                                         | `features[].type`, `location.start.value`, `location.end.value`, `description`, `featureId`, `alternativeSequence`, `evidences[].evidenceCode`, `.source`, `.id`                                                                                                                                                                                                                                                                                       | 200, 75 features                                                                                     |
| `clin`, `pop` rows                         | `GET https://www.ebi.ac.uk/proteins/api/variation/P42224` (`Accept: application/json`)                                                                                                                                                                                   | `features[].begin`, `end`, `wildType`, `mutatedType`, `consequenceType`, `clinicalSignificances[].type`, `populationFrequencies[]`, `xrefs[]`, `genomicLocation`, `sourceType`                                                                                                                                                                                                                                                                         | 200, 936 features                                                                                    |
| `clin` row review strength                 | `POST https://gnomad.broadinstitute.org/api` with `{ gene(gene_symbol: "STAT1", reference_genome: GRCh38) { clinvar_variants { variant_id clinical_significance gold_stars hgvsp major_consequence review_status } } meta { clinvar_release_date } }`                    | as queried                                                                                                                                                                                                                                                                                                                                                                                                                                             | 200, 720 ClinVar variants                                                                            |
| Per-feature provenance                     | `POST https://sequence-coordinates.rcsb.org/graphql` with `{ annotations(reference: UNIPROT, sources: [UNIPROT, PDB_ENTITY], queryId: "P42224") { source target_id features { type name provenance_source description feature_positions { beg_seq_id end_seq_id } } } }` | as queried                                                                                                                                                                                                                                                                                                                                                                                                                                             | 200. A request carrying several `__type` introspection fields was rejected (`BadFaithIntrospection`) |
| Structure ledger (EXP detail)              | `GET https://data.rcsb.org/rest/v1/core/entry/1BF5`                                                                                                                                                                                                                      | `exptl[].method`, `rcsb_entry_info.resolution_combined`, `rcsb_accession_info`, `pdbx_vrpt_summary_diffraction`                                                                                                                                                                                                                                                                                                                                        | 200                                                                                                  |
| Inspector, per-residue predictions         | `GET https://www.ebi.ac.uk/ProtVar/api/function/P42224/165`, `/structure/P42224/165`, `/prediction/foldx/P42224/165`, `/score/P42224/165`                                                                                                                                | `/structure`: `pdbId`, `chainId`, `experimentalMethod`, `resolution`, `start`. `/prediction/foldx`: `wildType`, `mutatedType`, `foldxDdg`, `plddt`, `afId`. `/score`: `type`, `score`, `eveClass`                                                                                                                                                                                                                                                      | 200                                                                                                  |
| Disease-stage matrix                       | `POST https://api.platform.opentargets.org/api/v4/graphql` with `{ target(ensemblId: "ENSG00000115415") { associatedDiseases(page: {index: 0, size: 2}) { count rows { disease { id name } score datatypeScores { id score } datasourceScores { id score } } } } }`      | as queried                                                                                                                                                                                                                                                                                                                                                                                                                                             | 200, `count` 1955                                                                                    |
| Structure-search database chips            | `GET https://search.foldseek.com/api/databases/all`                                                                                                                                                                                                                      | `databases[].path`, `name`, `version`, `status`                                                                                                                                                                                                                                                                                                                                                                                                        | 200, 18 databases                                                                                    |

Not working today: `https://1d-coordinates.rcsb.org/graphql` (no connection), `https://www.ebi.ac.uk/ProtVar/api/v3/api-docs` (404; use `/ProtVar/api/docs`), `https://alphafold.ebi.ac.uk/api/annotations/P42224` without `.json` (404). ClinVar E-utilities responds, but the field tag `[CLNSIG]` was silently rewritten to `[All Fields]`; use documented ClinVar field names.

---

## 12. Implementation notes

_*Mol* glue (names verified in v5.12.0 source):_*

```ts
plugin.behaviors.interaction.hover.subscribe((event) => {
  /* event.current.loci -> position -> setHover */
});
plugin.behaviors.interaction.click.subscribe((event) => {
  /* event.current.loci -> setSelection */
});

plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
plugin.managers.interactivity.lociHighlights.clearHighlights();
plugin.managers.interactivity.lociSelects.selectOnly({ loci });
plugin.managers.interactivity.lociSelects.deselectAll();

plugin.canvas3d?.setProps({
  renderer: { backgroundColor, highlightColor, selectColor },
});
```

- Canvas only: `PluginContext.initViewerAsync(canvas, container)`. With Mol* React UI: `createPluginUI({ target, render, spec })` and set `spec.components.controls.{top,left,right,bottom}` to `'none'`.
- Picking level is `granularity: 'residue'` by default in `InteractivityManager` props.
- Confidence colour theme name: `'plddt-confidence'`; falls back to B-factor when no quality-assessment data exists and the model is not experimental.
- Superposition utilities: `superpose`, `alignAndSuperpose` (`mol-model/structure/structure/util/superposition`), `tmAlign`, `tmAlignMultiple` (`mol-model/structure/structure/util/tm-align`).
- Shareable scenes: MolViewSpec (docs at `https://molstar.org/mol-view-spec-docs/`); 5.12 added a `transition` node and MolQL selectors. Store one MVS state per hypothesis step.
- Residue mapping: AlphaFold DB models use UniProt numbering (`sequenceStart`, `sequenceEnd`). PDB entries need a UniProt to `label_seq_id` mapping (RCSB alignments query or SIFTS) before highlights are applied.

**Next.js:** load Mol* and Nightingale in client components through `next/dynamic` with `ssr: false` (WebGL and custom elements). Dispose each `PluginContext` on unmount; Split mode holds two.

**Suggested packages:** `molstar@5.12.0`, `@nightingale-elements/nightingale-manager`, `-navigation`, `-sequence`, `-track-canvas`, `-colored-sequence`, `-sequence-heatmap` at `^5.11`, `cmdk@1.1.1`, `tinykeys@4.0.1`, `@tanstack/react-virtual@3` for ledgers.

---

## 13. Unverified or open

- AlphaFold DB, UniProt, gnomAD, cBioPortal, DECIPHER, Open Targets, ProtVar and Foldseek web pages are JavaScript-rendered; their live DOM was not inspected. UI descriptions come from papers, help pages and source code.
- AlphaFold DB data licence (CC BY 4.0 expected) and its FAQ statement on point-mutation effects were not re-read today; the FAQ page returned no content to the fetcher.
- Official AlphaMissense display colours.
- gnomAD variant-track consequence colours (red pLoF, orange missense, green synonymous reported second-hand through UCSC).
- ProteinPaint lollipop behaviour (docs returned 503 and 403); only the first lines of its licence were read.
- DECIPHER's current protein browser and 3D viewer (source is a 2022 paper naming `pv` v1.8.1).
- cBioPortal 3D-viewer linking details (from a pull-request summary).
- Linear's exact `g`-sequence letters; Raycast and Benchling details (search summaries of official manuals); Arc and Dia status (vendor blogs).
- GitHub command palette status after the July 2025 pause, and its prefix modes.
- Neurosnap and Tamarind results-page layouts, job status labels and prices.
- New Ensembl site UI; Auspice 3.0.0 release notes; Open Targets 26.09 interface changes.
- ProtVar pLDDT gating thresholds (50 and 70) come from a search summary of the 2024 paper.
- The inference that ProtVar's FoldX records use an older AlphaFold DB model version.
- Mol* camera-sync between two plugins, in-browser TM-align speed on large structures, and Nightingale inside Next 16 / React 19 were not run.
- Nightingale licence metadata is inconsistent across packages on npm (ISC, MIT or missing) while the repository is MIT; confirm with maintainers before redistribution.
- `cmdk` has had no npm release since 2025-03-14; `kbar` 1.0.0 is the maintained alternative if that becomes a problem.
- Badge shapes, tokens, key map, wireframes and the 26 px density are untested proposals. Colour-vision-deficiency simulation and screen-reader passes are outstanding.
- WebGL context limits for multiple Mol* instances on mobile browsers.

---

## 14. Sources

Structure and sequence viewers

- AlphaFold DB API: https://alphafold.ebi.ac.uk/api/openapi.json , https://alphafold.ebi.ac.uk/api/prediction/P42224
- AlphaFold DB 2025 paper (NAR 54:D358): https://pmc.ncbi.nlm.nih.gov/articles/PMC12807749/
- AlphaFold DB complexes: https://www.embl.org/news/science-technology/first-complexes-alphafold-database/
- RCSB Sequence Annotations viewer: https://www.rcsb.org/docs/sequence-viewers/sequence-annotations-viewer
- RCSB Mol* guide: https://www.rcsb.org/docs/3d-viewers/mol*/getting-started
- RCSB computed structure models: https://www.rcsb.org/docs/general-help/computed-structure-models-and-rcsborg
- RCSB sequence coordinates API: https://sequence-coordinates.rcsb.org/ , https://sequence-coordinates.rcsb.org/migration/migration-guide.html
- RCSB Saguaro: https://github.com/rcsb/rcsb-saguaro
- Mol* changelog and source (v5.12.0): https://github.com/molstar/molstar/blob/v5.12.0/CHANGELOG.md , `src/mol-plugin/context.ts`, `src/mol-plugin-state/manager/interactivity.ts`, `src/mol-gl/renderer.ts`, `src/mol-canvas3d/camera.ts`, `src/mol-plugin/behavior/dynamic/camera.ts`, `src/mol-model/structure/structure/util/tm-align.ts`, `src/extensions/model-archive/quality-assessment/color/plddt.ts`, `src/mol-plugin-ui/spec.ts`
- Mol* viewer docs: https://molstar.org/viewer-docs/ ; MolViewSpec: https://molstar.org/mol-view-spec-docs/
- Nightingale: https://github.com/ebi-webcomponents/nightingale (package READMEs under `packages/`), https://ebi-webcomponents.github.io/nightingale/
- ProtVista UniProt track config: https://github.com/ebi-webcomponents/protvista-uniprot/blob/main/src/config.ts
- 3D-Beacons: https://www.ebi.ac.uk/pdbe/pdbe-kb/3dbeacons/api/uniprot/summary/P42224.json

Variant and evidence resources

- UniProt evidence help: https://www.uniprot.org/help/evidences (fetched via https://rest.uniprot.org/help/evidences)
- UniProt website source: https://github.com/ebi-uniprot/uniprot-website (`src/uniprotkb/types/entry.ts`, `entrySection.ts`)
- ProtVar API: https://www.ebi.ac.uk/ProtVar/api/docs ; papers https://academic.oup.com/nar/article/52/W1/W140/7676839 , https://dx.doi.org/10.1093/nar/gkaf1078
- gnomAD browser source: https://github.com/broadinstitute/gnomad-browser (`browser/src/ClinvarVariantsTrack/`, `browser/src/vepConsequences.ts`); ClinVar track notes https://gnomad.broadinstitute.org/news/2021-08-clinvar-variant-details-available-in-clinvar-variants-track/
- DECIPHER 2022: https://pmc.ncbi.nlm.nih.gov/articles/PMC9303633/
- Open Targets: https://platform-docs.opentargets.org/web-interface/associations-on-the-fly , https://platform-docs.opentargets.org/release-notes
- ClinVar review status: https://www.ncbi.nlm.nih.gov/clinvar/docs/review_status/
- Ensembl transition: https://www.ensembl.info/2026/06/09/ensembl-116-and-ensembl-genomes-63-have-been-released/
- cBioPortal source: https://github.com/cBioPortal/cbioportal-frontend (`packages/cbioportal-frontend-commons/src/lib/AlterationColors.ts`, `packages/react-mutation-mapper/`); PR https://github.com/cBioPortal/cbioportal-frontend/pull/5661
- Lollipop critique: https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0160519
- ProteinPaint licence: https://github.com/stjude/proteinpaint/blob/master/LICENSE
- Benchling help: https://help.benchling.com/hc/en-us/articles/9684249350541-View-DNA-sequences-and-change-display-features
- Auspice view settings: https://docs.nextstrain.org/projects/auspice/en/stable/advanced-functionality/view-settings.html
- Foldseek server: https://search.foldseek.com/api/databases/all , https://github.com/soedinglab/MMseqs2-App
- Tamarind API: https://app.tamarind.bio/api-docs ; Neurosnap Boltz-2: https://neurosnap.ai/service/Boltz-2%20(AlphaFold3)

Developer tools and accessibility

- Linear: https://linear.app/docs/select-issues , https://linear.app/docs/peek , https://linear.app/docs/search
- Raycast manual: https://manual.raycast.com/search-bar , https://manual.raycast.com/keyboard-shortcuts , https://manual.raycast.com/command-aliases-and-hotkeys
- GitHub shortcuts: https://docs.github.com/en/get-started/accessibility/keyboard-shortcuts ; palette deprecation pause: https://github.blog/changelog/2025-07-15-upcoming-deprecation-of-github-command-palette-feature-preview/
- Vercel navigation: https://vercel.com/changelog/dashboard-navigation-redesign-rollout
- Arc status (vendor trackers): https://supasidebar.com/blog/arc-browser-status-tracker ; https://en.wikipedia.org/wiki/Dia_(web_browser)
- cmdk: https://github.com/dip/cmdk ; kbar: https://github.com/timc1/kbar ; tinykeys: https://github.com/jamiebuilds/tinykeys
- WCAG 1.4.1: https://www.w3.org/WAI/WCAG22/Understanding/use-of-color.html ; WCAG 2.1.4: https://www.w3.org/WAI/WCAG22/Understanding/character-key-shortcuts.html
