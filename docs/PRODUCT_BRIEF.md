# OrphaFold product brief

The requirements every part of OrphaFold is built against.

## What it is

OrphaFold is an open-source research platform that makes computational rare-disease drug discovery accessible to far more people. A motivated researcher, college student, or advanced high-school student should be able to choose a rare disease or gene, understand how a pathogenic variant changes a protein, inspect the structure in 3D, investigate interactions and possible binding sites, explore compounds or therapeutic hypotheses, run computational models, and share the resulting research.

Initial focus: **inborn errors of immunity / primary immunodeficiencies**. The architecture must generalise to rare genetic disease overall.

It is a **research and hypothesis-generation platform**. It is never marketed as finding cures and never gives clinical recommendations.

The journey:

**disease → gene → pathogenic variant → protein → structural change → molecular mechanism → interactions / pockets → candidate interventions → research hypothesis**

Differentiation is the complete rare-disease workflow in one application (replacing hops between disease databases, variant databases, UniProt, papers, structure databases, molecular viewers, command-line models, docking tools, drug databases) and openness: anyone can inspect how conclusions were generated, reproduce analyses, download results, run models locally, add models, contribute data sources.

Desired feeling: tools previously scattered across a computational-biology lab, assembled into one understandable open research environment.

## Priority order

1. Exceptional search → disease → variant → protein journey
2. Exceptional interactive protein viewer
3. Reference vs pathogenic-variant structural comparison
4. Real biological data and provenance
5. Research project / research trail
6. Real model-provider architecture
7. Boltz / structure prediction integration
8. Compound / interaction exploration
9. Scientific copilot
10. Collaboration and sharing
11. Secondary pages

Six exceptionally integrated workflows beat thirty shallow screens.

## Scientific rules (non-negotiable)

- Biological facts come from real databases with source links, IDs and provenance. An LLM is never the source of truth.
- Never fabricate unavailable fields. Show "Unknown" or "No source found".
- Three structure classes are always distinguished and never presented as equivalent: (1) experimentally determined, (2) existing predicted (for example AlphaFold DB), (3) OrphaFold-generated predictions.
- Every prediction exposes confidence: pLDDT or equivalent, PAE where supported, interface confidence for complexes, model/provider, model version, inference date, inputs, limitations.
- Never present randomly generated or placeholder coordinates as model output. Never fake job progress.
- A predicted structural difference is never implied to be experimentally established. A predicted affinity is never a clinical recommendation.
- Wording: "This model predicts an interaction at this site." "Experimental validation has not been identified." "This structural change is computationally predicted." Never "this compound will treat this disease". No treatment instructions.
- No giant warning banners. Provenance, confidence, uncertainty and experimental-vs-predicted status are native parts of the interface.

## Evidence system

Every meaningful scientific statement is attributable to one or more evidence classes, each rendered differently (not by colour alone), each clickable to inspect its source:

1. Experimental evidence
2. Clinical database
3. Published literature
4. Curated database
5. Computational prediction
6. OrphaFold hypothesis

Comparison and mechanism views additionally label claims as: Known experimentally / Database annotation / Computational prediction / OrphaFold hypothesis.

## Knowledge model

Entities: Disease, Disease category, Gene, Transcript, Protein, Variant, Protein residue, Protein domain, Molecular interaction, Phenotype, Pathway, Experimental structure, Predicted structure, Compound, Drug, Binding site, Molecular target, Publication, Computational run, Hypothesis, Research project.

Relationships are first-class: Disease —caused by→ Gene —produces→ Protein; Variant —changes→ Residue —belongs to→ Domain —participates in→ Interaction —may affect→ Pathway; Compound —may bind→ Protein.

Initial dataset: the current IUIS classification of inborn errors of immunity, imported where legally and technically practical, with enough real seeded data that the app is immediately useful. Each disease page aggregates: name, aliases, description, inheritance, gene(s), known pathogenic variants, protein, protein function, pathways, phenotypes, known treatments, experimental structures, predicted structures, key publications, source provenance.

Data sources (real adapters, cached, ID-normalised, source metadata stored, tolerant of any one source failing): UniProt, ClinVar, NCBI, RCSB PDB, AlphaFold DB, Orphanet where permitted, IUIS, Open Targets, Ensembl, plus literature via PubMed / Europe PMC. A page still renders when a source is unavailable and says which source is temporarily unavailable.

## Models

Models are replaceable compute providers behind adapters, never hardcoded: Boltz-2 (primary inspiration and likely primary structure/interaction backend, subject to verified license), AlphaFold-compatible workflows where licensing permits, Chai-1, ESM-based models, future models.

Conceptual interfaces:

- StructurePredictor: predict(sequence | complex) → prediction
- BindingPredictor: predict(protein, ligand) → interaction prediction
- VariantEffectProvider: analyze(reference, mutation) → effect data
- PocketProvider: find(structure) → pockets
- LiteratureProvider: search(entity) → publications

If a heavyweight model cannot run in the development environment, there is a real provider abstraction plus a local/dev provider using legitimate cached example outputs, with an obvious boundary so production compute attaches cleanly. Scientific compute is separate from the web server.

## Flagship workflow

### Home

Extraordinarily simple. Logo "OrphaFold". Tagline direction: "Open protein research for rare disease." One obvious action: a large universal search, "Search a disease, gene, protein, or variant", with examples ADA, IL2RG, BTK, WAS, RAG1. A mission entry such as "N immune-disease genes. One open research workspace." using only a number the data supports. A compact explanation: "Understand the mutation. See the structure. Explore what might restore function." A short open-source mission section without marketing fluff, and a prominent GitHub / open source entry point.

### Workspace stages

The workspace tells a story through stages rather than a dashboard.

**Stage 1 — Disease.** Name, one-sentence explanation, affected gene(s), inheritance, major phenotype tags, current treatment summary, research status, data sources, and a simple relationship diagram showing where the disease sits biologically.

**Stage 2 — Gene + variants.** Pathogenic / likely pathogenic variants when the databases support them. An excellent sequence visualisation: search residues, hover variants, filter variants, select a mutation, see domains and annotation tracks, see conservation or functional evidence where available, click a residue to highlight it in 3D.

**Stage 3 — Protein.** One of the strongest parts of the product: a beautiful interactive 3D molecular viewer (Mol* or equivalent). Rotate, zoom, pan, select residue, select domain, surface / cartoon / atom views, confidence colouring, chain colouring, mutation highlighting, binding-pocket highlighting, ligand highlighting, reset camera, focus selection, fullscreen, screenshot / export, structure download. Selecting a variant in the sequence view animates to that residue in 3D.

Viewer ↔ sequence linking: hovering a residue in the sequence highlights it in 3D; clicking a residue in 3D scrolls to and selects it in the sequence; variant markers sit along the sequence; domains and known functional sites are annotation tracks. Colour by confidence, chain, domain, secondary structure, variant impact. Display cartoon, surface, ball-and-stick. Selections are shareable through the URL where practical.

**Stage 4 — Compare healthy vs variant.** A defining feature. Compare reference protein vs disease variant, generating or retrieving structures as appropriate. Modes: Split (synchronised cameras), Overlay (aligned, clearly distinguished), Difference. A Reference ↔ Variant slider/toggle. Show reference structure, variant structure, affected residue, local structural neighbourhood, domain, predicted structural difference, nearby interaction changes, confidence, available stability predictions, known functional evidence. Clicking a changed residue opens a panel: reference amino acid, variant amino acid, position, domain, local confidence, nearby residues, known annotation, predicted change, evidence. Never overstate predicted geometric differences.

**Stage 5 — Mechanism.** "What might this mutation disrupt?" Candidate mechanisms: stability, folding, catalytic site, ligand binding, protein–protein interaction, localisation, signalling, domain interface. Only mechanisms supported by data or computational results appear. Every claim is clickable to reveal its evidence, with confidence labels.

**Stage 6 — Explore intervention.** Explicitly exploratory. Known drugs, known ligands, experimentally observed binders, structural analogs, protein interaction partners, potentially druggable pockets, existing compounds relevant to the target, therapeutic mechanism classes. Where technically reasonable, select a compound and run a protein–ligand interaction / affinity prediction with an open model such as Boltz-2. Compare compounds in a table: compound, structure, predicted pose, binding region, predicted affinity where supported, model, confidence / uncertainty, known experimental evidence, source.

## Research projects

Projects (for example "Investigating BTK C481 variants") save diseases, genes, variants, structures, residues, compounds, papers, model runs, notes, screenshots, hypotheses.

A visual **Research Trail**: Disease → BTK → p.Arg28His → SH3 domain → structural comparison → altered interaction hypothesis → candidate molecule → Boltz run → saved hypothesis. Every node preserves where it came from.

Collaboration foundations: a public project can expose its trail, inputs, model versions, output files, citations, hypotheses, notes; a reproducible analysis has a stable share URL; **Fork Research** lets someone fork a public project and continue from it, with lineage preserved.

No account is required to explore. Accounts become useful to save projects, run expensive computation, keep history, publish, and fork.

## Assistant ("Orpha")

A research copilot in the workspace that knows the current disease, gene, mutation, residue, structure, compound and project. Example questions: why is this residue important; what changed between these two models; what proteins interact with BTK; what evidence connects this mutation to disease; explain this for a high-school biology student; explain it for a structural biologist; what experiments could distinguish these hypotheses.

It cites sources directly in answers and separates database facts, paper findings, computational results, and reasoning / hypothesis. Speculation never quietly becomes fact.

## Progressive disclosure

Sophisticated biology must be usable without a PhD, without removing scientific information. Default interface: clear. Advanced mode: full metrics and parameters. Every technical metric has an inline explanation (for example "pLDDT 93 — High local structural confidence — What does this mean?"). Optional **Learn Mode**: hovering concepts (pathogenic variant, binding affinity, protein domain, pLDDT, PAE, ligand, residue, missense mutation) shows a short explanation. Never childish for researchers.

## Jobs

Computational jobs take time. A prediction creates a job with real stages such as: preparing input, resolving sequence, building MSA if required, running model, processing confidence, rendering structure. Users can leave the page and keep working. Results persist. Job history is visible. Progress is never faked.

Every run produces a downloadable machine-readable manifest: job ID, creation time, input sequences, variants, database identifiers, model, model version, parameters, source dataset versions, software versions, confidence outputs, artifact identifiers.

## Search and command palette

Federated search with entity resolution rather than exact string matching. "BTK" resolves to gene, protein, diseases, variants, structures; results visually distinguish entity types. Must handle "XLA", "Bruton agammaglobulinemia", "P00519", "RAG1 R396H".

Command palette on Cmd/Ctrl+K searching diseases, genes, proteins, variants, residues, compounds, papers, projects and actions: Search IL2RG, Open residue R226, Compare variant, Run structure prediction, Find binding pockets, Add to project, Export structure, Ask Orpha. Keyboard interaction must be excellent.

## Literature

Every disease / gene / variant has a literature panel from a legitimate source: title, journal, year, authors, a short relevance indicator. Actions: save to project, ask Orpha about paper, view source, find papers related to the selected residue / mutation. Use abstracts where permissible to improve relevance.

## Export

mmCIF/PDB structures, FASTA, variant table CSV, figures, prediction metadata JSON, complete analysis manifest, research project report.

## Routes

`/` home + universal search · `/explore` browse immune disorders and genes · `/disease/[id]` · `/gene/[id]` · `/protein/[id]` · `/variant/[id]` · `/compare/[...]` · `/compound/[id]` · `/project/[id]` · `/jobs` · `/models` · `/about` (mission, methodology, openness, limitations) · `/docs` (developer and scientific documentation).

**Explore** makes the IEI gene set explorable with filters: IUIS category, inheritance, gene, protein family, known structure availability, number of reported variants, research coverage. No fake "cure probability". Users can discover understudied proteins or diseases without OrphaFold pretending to know which leads to a cure.

## Design

Product design is as important as engineering. Not a generic AI-generated SaaS dashboard. Avoid: endless rounded cards, giant gradient heroes, glowing purple blobs, excessive pills, meaningless analytics charts, generic sidebar + cards everywhere, huge amounts of text.

Inspiration for interaction quality: AlphaFold DB, RCSB PDB, Mol*, Linear, Raycast, Arc, GitHub, Vercel, modern scientific visualisation software. OrphaFold must still be visually distinct: a serious scientific instrument that happens to be remarkably easy to use. Precision, density, clarity, speed, hierarchy, confidence.

Visual language: restrained; mostly neutral surfaces; colour only where it has scientific meaning (confidence gradient, reference vs variant, protein chains, selected residues, binding sites, evidence strength). Excellent typography: a clean modern sans for UI, monospace for sequences, residue identifiers, gene IDs, model parameters. The protein visualisation is the visual centrepiece whenever structure is relevant. Crisp dividers, strong hierarchy, subtle depth, excellent spacing. Dark mode exceptional; light mode first-class.

Copy: short, precise, scientific. No "revolutionize", "unlock the power of", "AI-powered breakthrough", "change the world". Do not keep telling the user something is AI.

Empty states are never dead UI: no experimental structure → say so and offer predicted structures; no structural analysis for a variant → offer to generate one; no known compounds → say none were retrieved; API failed → say the source is temporarily unavailable.

Performance: the app feels fast even when computation is not. Interactive UI, API calls and long-running compute are separated; public metadata is cached; large structure assets lazy-load; a page never blocks on a running model.

Mobile: responsive, not shrunk desktop. Viewer stays usable, panels become sheets, sequence scrolls horizontally, search stays excellent, projects stay navigable.

Accessibility: keyboard navigation, useful text descriptions of structure-dependent information for screen readers, no information encoded only in colour, reduced-motion respected, proper contrast.

## Open-source identity

Prominent GitHub / open source entry point. A very good README: what OrphaFold is, why it exists, architecture, how to run it, data sources, model providers, how to add a model, how to contribute, scientific limitations, license. The repository must be clean enough for another developer to understand and extend.
