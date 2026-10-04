# Discovery: candidate targets and molecules

Helix's first question was "why is this mutation harmful". That is a lookup: the answer already
exists in a database, and the work is assembling it with its provenance intact.

The discovery engine answers a second question, which for most rare diseases nobody has answered:
**what could we aim a drug at, and is there already a molecule that does it?**

Every row it produces is a hypothesis Helix built from records. None of it is a treatment, a dose or
advice, and no row claims a molecule would work.

Code: `api/helix/discovery/`. Endpoints: `GET /api/v1/discovery/candidates`,
`GET /api/v1/discovery/controls`. Screen: `/discover/<gene>`, the seventh stage of the journey.

## What the engine does

```
disease ─▶ gene ─▶ mutation ─▶ mechanism ─▶ candidate targets and molecules ─▶ what to test next
```

Given a gene symbol, a catalog disease slug or a variant id, the engine:

1. resolves the subject to a gene, a UniProt accession and, where asked for, a disease and a variant;
2. reads the **mechanism class and direction** from the catalog (see precedence below);
3. derives the **required action** from a fixed rule table, with no model and no scoring;
4. runs **five bridges** concurrently, each proposing proteins that could be aimed at and molecules
   recorded as acting on them;
5. runs the **direction-of-effect filter** on every proposal. A proposal that pushes the wrong way is
   moved to `ruled_out` with its reason and is never ranked;
6. orders what survives by evidence strength and bridge directness only.

Every step of every chain is a separate claim with its own source record, and the reasons the chain
might be wrong are printed next to it.

### What this is not

Open Targets already answers gene → disease → known drug, and does it better than Helix would. The
engine does not rebuild that. Its own angle is structural and mechanistic, and inspectable:

- the druggable protein may be **upstream** of the broken one, not the broken one itself;
- a pocket on this protein may resemble a pocket on another protein that has a known binder, and
  both can be looked at in 3D;
- every link in the chain is **one claim with one record**, not a score.

## Mechanism and direction, in precedence order

From `api/helix/discovery/subject.py`. The direction is the single most load-bearing value in the
engine, so it is read in a documented order and never guessed.

| Tier | Source                                                                                                                                                                                                                                                    | Confidence reported          |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| 1    | The `mechanism` field of the catalog disease records in scope. IUIS states it                                                                                                                                                                             | `stated_in_the_catalog`      |
| 2    | Only when no record states one: the words of the IUIS disease label and its aliases. _deficiency, defect, absence, aplasia, agammaglobulinemia, -penia_ mean the protein does too little; _activated, activating, gain of function_ mean it does too much | `named_in_the_disease_label` |
| 3    | Anything else, and every conflict inside one tier                                                                                                                                                                                                         | `unknown`                    |

A conflict inside a tier is reported in `disagreements` and **nothing is ruled out on direction**.
`gene=STAT1` returns `unknown` with "the catalog records different mechanisms … ask for one
disease", because STAT1 has both gain-of-function and loss-of-function diseases in the catalog.
`gene=BTK` resolves to loss of function from the label.

A variant's mechanism endpoint is read when a variant was asked for. Its categories can corroborate
a decreased activity, but they never set a direction on their own, because that endpoint reports
what a residue sits in, not which way the activity moves.

## The required-action rule

A pure function of (mechanism class, direction). Nothing else is read. It is published in the
response as `required_action` and `action_rule_table`, so a screen can print the whole table.

| Mechanism class      | Direction            | Required actions                                                          | Why                                                                                                          |
| -------------------- | -------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `gain_of_function`   | `increased_activity` | inhibit, antagonise, block upstream                                       | The protein does too much, so a molecule can only help by reducing what it does                              |
| `neomorph`           | `increased_activity` | inhibit, antagonise, block upstream                                       | The protein does something it should not do, so a molecule can only help by removing that activity           |
| `loss_of_function`   | `decreased_activity` | restore, activate, stabilise, chaperone, replace, bypass, release a brake | The protein does too little, so a molecule can only help by bringing the activity back                       |
| `haploinsufficiency` | `decreased_activity` | the same as loss of function                                              | One working copy makes too little protein                                                                    |
| `dominant_negative`  | `decreased_activity` | remove the mutant protein, restore, stabilise, bypass, release a brake    | The broken copy blocks the working copy, so a molecule can only help by clearing it or working around it     |
| `unknown`            | any                  | _(none)_                                                                  | No record states which way the activity moves, so no action is derived and nothing is ruled out on direction |
| any                  | `unknown`            | _(none)_                                                                  | The same                                                                                                     |

When the class and the direction contradict each other, neither is trusted and the result is
`unknown`.

## The direction-of-effect filter

**Direction of effect is a hard filter, not a ranking factor.** A candidate that fails it is never
ranked; it moves to a visible `ruled_out` list with the reason in plain words.

Three signs are multiplied, and each one has to come from a record:

1. **What the mechanism needs.** Less activity for a gain, more for a loss. From the rule table.
2. **What the molecule does to the protein it acts on.** From the ChEMBL mechanism `action_type`.
   INHIBITOR, ANTAGONIST, NEGATIVE ALLOSTERIC MODULATOR, BLOCKER, DEGRADER and nine more lower it;
   AGONIST, ACTIVATOR, POSITIVE ALLOSTERIC MODULATOR, CHAPERONE and five more raise it. Anything
   else — MODULATOR, BINDING AGENT, SUBSTRATE, or no value — is unknown.
3. **How an effect on that protein carries over to the subject.** The bridge supplies this. Acting
   on the subject's own protein carries over the same way. Acting on a protein that produces the
   subject's active form carries over the same way. Acting on a **brake** — a protein that removes
   the subject's active form — carries over the _opposite_ way.

| Verdict   | Meaning                                   | What happens                                                                                       |
| --------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `matches` | The product equals the required direction | Ranked first                                                                                       |
| `opposes` | The product is the reverse                | **Ruled out**, with the reason                                                                     |
| `unknown` | Any of the three is unknown               | Ranked below `matches`, labelled "Direction unknown", carrying the caveat "may push the wrong way" |

The word "inhibitor" alone never decides anything. The brake case is why "inhibiting a brake
upstream of a weakened protein restores the pathway" comes out as a match rather than an opposition.

### The BTK example: the mistake this filter exists to stop

Ibrutinib blocks BTK and is recorded for neoplasm. X-linked agammaglobulinemia is caused by BTK
**loss** of function. A naive "same gene, same pathway" engine suggests ibrutinib for it
immediately, and that suggestion is dangerous nonsense: a blocker makes a disease caused by too
little of the same protein worse.

Helix's filter runs: the mechanism needs BTK to do **more**; ChEMBL records ibrutinib as an
**inhibitor** of BTK, which **lowers** it; this is the protein the disease's gene encodes, so the
effect carries over the same way. Lower against a need for more is `opposes`, and the row is ruled
out. The sentence the user reads is assembled from fixed phrases, so the same facts always produce
the same sentence:

> BTK deficiency, X-linked agammaglobulinemia needs BTK to do more. ChEMBL records this molecule as
> an inhibitor of Tyrosine-protein kinase BTK, which lowers that protein. Because this is the
> protein the disease's gene encodes, that lowers what BTK does. That is the opposite of what this
> mechanism needs, so it is ruled out.

**The ruled-out list is a feature, not an error log.** It is the evidence that the filter ran.

## The five bridges

A candidate has exactly one primary bridge: the kind of the module that produced it. The five run
concurrently, each with its own timeout; a bridge that fails or runs out of time reports itself in
`bridges` and never fails the request.

| Bridge                | What it claims                                                                                         | Sources                                                                      | Can it return `matches`? |
| --------------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------ |
| `same_target`         | A molecule acts on this very protein, approved or studied in another disease                           | UniProt, ChEMBL mechanisms and activities                                    | Yes                      |
| `pathway_node`        | A druggable protein upstream or downstream of this one, where acting on it would correct the direction | Reactome reactions and participants, ChEMBL                                  | Yes                      |
| `interaction_partner` | A curated physical partner that is druggable                                                           | IntAct, STRING physical subnetwork, ChEMBL                                   | **No, by construction**  |
| `structural_analogue` | A protein whose pocket resembles this one and has a known binder                                       | Fold similarity when available; otherwise shared chemistry; PrankWeb pockets | Yes                      |
| `mechanism_class`     | Another disease with the same mechanism class and direction, where a drug class exists                 | Helix catalog, ChEMBL                                                        | **No, by construction**  |

### `same_target`

Two claims. The catalog says which protein the gene encodes; ChEMBL says a molecule has a recorded
action on a target containing that protein. Nothing here comes from a disease-to-drug edge, which is
why this bridge still works when held-out mode withholds them. Measured activities are read through
the same compounds service the protein page uses, so the figure shown is the same one.

### `pathway_node`

Reactome records reactions, not only pathway membership, and a reaction says which molecule goes in
and which comes out. That is what makes a direction readable.

A reaction is kept only when the subject appears on one side in its modified form (Reactome writes
it with a `p-` prefix) and on the other side without it.

- Modified form in the **output** only: the reaction produces the subject's active form, so the
  other proteins in it are **upstream**. Lowering one lowers the subject's activity.
- Modified form in the **input** only: the reaction removes the active form, so the other proteins
  are **brakes**. Lowering a brake _raises_ the subject's activity.
- Anything else is dropped, because the direction cannot be read from the record.

STAT1 gain of function is the model case. Reactome's R-HSA-8986985 produces phosphorylated STAT1 and
names JAK1 as the catalysing entity, so JAK1 is upstream; a JAK inhibitor lowers STAT1 activity,
which is what a gain of function needs.

**The limit:** direction is read from phosphorylation only. Ubiquitination, acetylation and
methylation are matched as candidate reactions but their direction is not interpreted, because a
ubiquitin mark usually means degradation rather than activation and the engine would be guessing. A
protein whose regulation is not phosphorylation therefore gets no pathway candidates. PIK3CD is one:
27 reactions were read and none names a modification of it, and the response says exactly that.

### `interaction_partner`

Partners come from the same IntAct and STRING records the protein page shows. IntAct rows are
preferred because each is a curated experiment; a STRING partner is used only when it is in the
physical subnetwork.

**A partner's direction is never assumed.** IntAct says two proteins bind. It does not say which one
switches the other on. So every row from this bridge carries verdict `unknown` and is ranked below
every match. A partner whose direction _is_ recorded reaches the user through `pathway_node`
instead.

### `structural_analogue`

The intended source is fold similarity: a measured alignment between the subject's structure and
another protein's, with a pocket-level residue comparison and the molecules observed bound to the
analogue.

**As deployed today the bridge runs on a fallback, and says so on every response.** Helix does hold a
Foldseek-backed fold-similarity source — `api/helix/sources/foldseek.py`, served at
`GET /api/v1/structures/similar` and `GET /api/v1/structures/{id}/pocket-similarity`, which returns
PIK3CB, PIK3CA and PIK3R1 for O00329 — but the discovery engine probes for a module-level
`similar_structures`, `similar` or `search` on `helix.sources.foldseek`, and the fold work landed as
`helix.services.structure_similarity.fold_neighbours`. The probe does not find it, so the bridge
reports `partial` with the reason "No fold-similarity source is available in this deployment, so the
chain uses shared chemistry instead of a measured fold alignment". **Nothing in the engine's output
today rests on a measured fold alignment.** Connecting the two is one import away and has not been
done.

The fallback is shared chemistry inside records Helix already holds: if ChEMBL records one molecule
as acting on both this protein and another, the two sites accommodate the same chemistry, so other
molecules recorded against that other protein become a structural hypothesis for this one. PrankWeb
pockets are attached so both sites can be looked at in 3D. Nothing measures the molecule against the
subject's protein, and that is printed as a caveat on every row of this bridge.

### `mechanism_class`

A disease D is mechanism-matched to the subject when the catalog records the same mechanism class
and direction for D and D sits in the same IUIS subcategory (failing that, the same category). The
molecule then comes from D's own protein.

**This bridge never returns `matches`.** Claiming that a molecule acting on another disease's
protein "lowers what this protein does" would be false, because no record connects the two proteins.
The action class is compared in the chain's own visible step, the verdict stays `unknown`, every row
prints "no record connects _other gene_ to _subject gene_", and the bridge is ranked last. A
molecule whose action class is the opposite of what the mechanism needs is still moved to
`ruled_out`.

The grouping is a curated convenience, not a biological pathway link. A pathway-based matching rule
would be better and needs a Reactome lookup per candidate gene, which was too many calls for one
request.

## Held-out mode

`exclude_direct=true` drops **every** edge that links the subject disease straight to a molecule, so
a recovery must come through a bridge. The response lists what was withheld in `withheld_edges`.

Three kinds are withheld: `chembl_indication`, `open_targets_disease_drug` and
`literature_co_mention`.

It drops every disease-to-molecule row, **not only exact name matches**. ChEMBL files leniolisib
under "inborn error of immunity", a parent of APDS that a name match would miss, so a nearly-strict
filter would have leaked the answer. For APDS the engine withholds 18 edges, 16 of them ChEMBL
indications; one names leniolisib.

Where a source holds nothing to drop, the response says so rather than staying silent. Open Targets
holds no disease node for MONDO:0014222 or ORPHA:693661, and the withheld-edge row records that the
lookup was made and found none.

This mode is what makes the positive control meaningful: without it, recovering a known molecule
proves only that the known link is in the database.

## Ranking

There is no composite score, no probability of success and no claim of efficacy anywhere. Candidates
are sorted on these keys in this order and nothing else:

1. the direction verdict: `matches` before `unknown` (`opposes` is not here at all);
2. bridge directness: `same_target`, `pathway_node`, `interaction_partner`, `structural_analogue`,
   `mechanism_class`;
3. the strongest evidence class in the chain: experimental, clinical database, curated database,
   literature, computational prediction, Helix hypothesis;
4. whether the record is on this protein alone rather than on a group of related proteins;
5. the highest clinical phase ChEMBL records for the molecule, highest first;
6. the measured activity against the protein, highest first;
7. the number of distinct sources in the chain;
8. the molecule's name, so two equal rows always come back in the same order.

Keys 5 and 6 are strengths of _records_, not predictions of effect. No key is combined with another.
The rule is published in the response as `ranking_rule` in the same words.

Caveats are generated from conditions that are true of the row's own records, never decoratively.
"Tissue expression was not checked" is on every row because the engine never checks it.

Per-bridge caps are fixed and documented, not tuned: 12 rows for `same_target`, 4 per pathway node
over at most 8 nodes, 3 per partner over at most 5, 3 per analogue over at most 3, 3 per
mechanism-matched disease over at most 3, and 60 molecules per protein. A molecule can be cut by a
cap: tofacitinib is missing from the STAT1 list because its ChEMBL mechanism sits on a PROTEIN FAMILY
target, which sorts after every single-protein row and falls outside JAK1's four rows.

## The controls

Three calls are the product's own evidence that the filter works: one recovery with the answer held
out, one refusal, one upstream target. They are run by
`lab/experiments/run_discovery_controls.py`, stored in
`lab/experiments/results/discovery-controls.json`, written up in
`lab/experiments/DISCOVERY-CONTROLS.md` and served by `GET /api/v1/discovery/controls`.

Run 2026-10-04T01:08:36Z. **3 of 3 passed.**

| Control                                                                                  | Result   | Candidates | Ruled out | Sources | Server build |
| ---------------------------------------------------------------------------------------- | -------- | ---------- | --------- | ------- | ------------ |
| Held-out positive: a molecule studied for APDS, recovered without the edge that names it | **PASS** | 24         | 0         | 7 of 8  | 536.8 ms     |
| Negative: no molecule that lowers BTK is offered for BTK loss of function                | **PASS** | 4          | 33        | 8 of 8  | 208.5 ms     |
| Upstream positive: a JAK inhibitor reached through the pathway, not through STAT1        | **PASS** | 23         | 4         | 6 of 6  | 50.6 ms      |

Wall times in the stored file are 2-3 ms because the engine keeps assembled responses for fifteen
minutes and the final run was served from that cache; each control records whether it was, and how
long the engine took to build the response it served.

Every expected molecule is resolved to a ChEMBL id and an InChIKey through a **different** endpoint
before any candidate row is matched, so nothing passes on a name. The threshold for "among the top
candidates" is declared in the runner as rank ≤ 10 and printed in the result.

### 1. Held-out positive — APDS, PIK3CD, gain of function

`/discovery/candidates?disease=activated-p110-delta-syndrome-pik3cd&exclude_direct=true`

Leniolisib came back at **rank 4 of 24** through a `same_target` bridge, direction check `matches`,
`bridge.from_disease` null, while **18** disease-to-molecule edges were withheld, one of them naming
this molecule. All three steps cite a record:

1. PIK3CD encodes UniProt O00329 — `uniprot O00329`
2. ChEMBL records Leniolisib as an inhibitor of that protein, "PI3-kinase p110-delta subunit
   inhibitor" — `chembl mechanism:8305`
3. ChEMBL holds 6 measured activities against it, median pChEMBL 7.96 — `chembl activity:18320214`

**The withheld edge is a real edge, not a phantom.** The same subject with `exclude_direct=false`
returns a four-step chain whose third step cites `chembl drug_indication:147079` ("ChEMBL records
Leniolisib as studied or used for inborn error of immunity"). That step is absent in held-out mode
and the molecule still reaches rank 4 on mechanism and measured-activity records alone.

The identity was checked, and the brief this was built from was wrong about it: leniolisib is
**CHEMBL3643413** (MWKYMZXCGYXLPL-ZDUSSCGKSA-N, max phase 4, first approval 2023). CHEMBL4650319 is
mobocertinib, a different molecule; CHEMBL3989909 is leniolisib phosphate, the salt. The cited
mechanism was corroborated through a second endpoint: `GET /proteins/O00329/compounds` returns
mechanism 8305, action INHIBITOR, for the same molecule. Asking by gene rather than by disease
(`gene=PIK3CD&exclude_direct=true`) also gives rank 4 of 24, so the control does not rest on one
spelling of the request.

### 2. Negative — X-linked agammaglobulinemia, BTK, loss of function

`/discovery/candidates?disease=btk-deficiency-x-linked-agammaglobulinemia`

`GET /proteins/Q06187/compounds` holds 24 ChEMBL mechanism records lowering BTK, covering **20
distinct molecules**. **Zero** of those 20 appear in `candidates`. **All 20** appear in `ruled_out`
with verdict `opposes` and reason code `opposes_required_action`. The inhibitor set was read from
ChEMBL's own records, not written into the runner.

Ibrutinib resolved from those records to CHEMBL1873475 / XYFPWWZEPKGCCK-GOSISDBHSA-N, confirmed back
through `GET /compounds/XYFPWWZEPKGCCK-GOSISDBHSA-N` as IBRUTINIB, and sits in `ruled_out` with the
plain reason quoted above.

33 ruled-out rows in total, all `opposes_required_action`, including SYK- and SRC-family inhibitors
reached through the pathway bridge that would lower BTK phosphorylation. The only 4 candidates are
direction-unknown rows on CD79B and HSP90AB1. **Nothing aimed at BTK is ranked.**

### 3. Upstream positive — STAT1 gain of function

`/discovery/candidates?disease=stat1-gof`

Baricitinib (CHEMBL2105759 / XUZMWHLSFXCVMG-UHFFFAOYSA-N) came back at **rank 2 of 23** as a
`pathway_node` candidate on **JAK1 (P23458), not on STAT1**, verdict `matches`. The chain is two
steps: Reactome R-HSA-8986985, which produces phosphorylated STAT1 and names JAK1 as the catalysing
entity, then `chembl mechanism:5293`. Ruxolitinib (CHEMBL1789941) is also present, at rank 11 on
TYK2. **Zero candidates aim at STAT1 itself.** Conversely, IL10RB agonists are ruled out, because
raising an upstream activator raises STAT1.

JAK accessions were resolved through `GET /genes/{symbol}` and the INNs through ChEMBL mechanism
records on those proteins. JAK2 could not be resolved independently by the runner, so rows aimed at
it are reported but not counted. Tofacitinib is absent, for the cap reason given under Ranking; the
control needs one JAK-family molecule and two are present.

### What a pass here does not prove

- **Three subjects are three subjects.** Each control shows the rule behaving correctly once, on one
  disease, against today's records. It is not a measure of how often the engine is right.
- Ranking is checked for **position, not for quality**. Nothing here tests whether a higher-ranked
  molecule is a better hypothesis than a lower-ranked one.
- The engine was not touched and no rule was relaxed to make a control pass. Leniolisib landed at 4
  and baricitinib at 2, so the rank ≤ 10 threshold did not decide either outcome.
- Bridges that contributed nothing are named in each control's notes rather than left silent: for
  APDS, `pathway_node` and `mechanism_class` were empty and `structural_analogue` ran partial; for
  BTK and STAT1, `structural_analogue` was empty.
- Open Targets answered `empty` for APDS, so whatever it holds did not reach that result.
- No test suite covers this. Verification is the live calls recorded above. A source changing its
  data could change the ranks without anything failing loudly.

## Limitations of the method

These are limits of the reasoning, not bugs. They are listed again in
[`docs/scientific-limitations.md`](scientific-limitations.md).

- **Nothing here has been validated in a laboratory.** Every candidate is labelled a Helix
  hypothesis on screen and in the response.
- **No tissue or cell-type check.** The engine never asks whether the protein is present where the
  disease acts. Every row carries that caveat.
- **No pharmacokinetics.** Nothing asks whether a molecule reaches the tissue, crosses a membrane,
  survives metabolism or can be given at a useful exposure.
- **No toxicity, no safety, no dose.** A molecule ruled in by direction may be unusable for reasons
  the engine never looks at.
- **Direction is read from `action_type` alone.** A molecule recorded as MODULATOR, BINDING AGENT or
  SUBSTRATE, or with no action recorded, gets `unknown` rather than a decision. It is ranked below
  matches and never ruled out, which means **the ruled-out list is a lower bound** on what is
  actually wrong.
- **Only molecules ChEMBL records a mechanism for are considered.** A molecule without such a record
  is missing from both lists. Absence from a database is not evidence of absence.
- **Several bridges rest on a single source.** `pathway_node` rests on Reactome,
  `interaction_partner` on IntAct and STRING, `mechanism_class` on the IUIS grouping in the Helix
  catalog. When a chain has one source the row says so.
- **The mechanism itself can be wrong or mixed.** A gene with both gain- and loss-of-function
  diseases returns `unknown` for the gene and needs a disease. A disease whose direction is only
  inferred from its label carries the lower confidence `named_in_the_disease_label`, which is how
  the BTK control's subject is resolved.
- **A direction match is not an efficacy claim.** It says the molecule's recorded action points the
  way this mechanism needs. It says nothing about magnitude, about whether correcting this protein
  corrects the disease, or about whether the pathway compensates.
- **The same molecule appears once per target it acts on.** Baricitinib appears at ranks 2 and 3 for
  JAK1 and JAK2. Each row has its own chain so none is a duplicate, but they consume ranking slots.
- **`structural_analogue` is not doing what it is designed to do** in this deployment. See above.

## Reading a candidate

On `/discover/<gene>` each row is one sentence: the molecule, the protein it aims at, whether it is
in use for another disease or studied to a phase, and which way it pushes. Opening a row shows:

- **How we got here** — the chain, step by step, each with its source chips;
- **Direction** — what the mechanism needs, what the molecule does, and the full sentence;
- **The pocket** — the residues, with a 3D view, and the protein the chemistry was borrowed from
  when there is one;
- **Why this might be wrong** — the caveats generated from this row's own records.

Held-out mode shows a banner: "Held-out test — The known link for this disease was hidden, so
anything found here came another way." Every screen ends on "A Helix idea. Not a treatment."

## Running it

```bash
# the three controls, against the live API
api/.venv/bin/python lab/experiments/run_discovery_controls.py

# the stored result
curl http://localhost:8000/api/v1/discovery/controls

# one subject
curl "http://localhost:8000/api/v1/discovery/candidates?disease=stat1-gof"
curl "http://localhost:8000/api/v1/discovery/candidates?gene=PIK3CD&exclude_direct=true"
```

`GET /api/v1/discovery/controls` returns 404 `controls_not_run` before the runner has written the
file.
