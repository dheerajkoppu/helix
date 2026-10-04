# The effort the discovery engine removes, and how long the engine takes

Run 2026-10-04. Runner: `lab/experiments/run_discovery_effort.py`. Stored figures:
`lab/experiments/results/discovery-effort.json`. Every number below is in that file, and every
derived total, median and ratio is recomputed from it by `--phase summary` rather than typed in here.

This measures **effort and time**. It is not a measure of whether the engine is right. That is what
[`DISCOVERY-CONTROLS.md`](DISCOVERY-CONTROLS.md) covers, on three subjects, and three subjects is
still all the correctness evidence there is.

It is also not the agent-lab benchmark. [`RESULTS.md`](RESULTS.md) compared eight agents against one
agent (the lab as it stood then: a supervisor and seven specialists, before the translator) and found
the lab 2.4 times slower; that comparison stands and is about a different question.
The bottleneck measured here is the one the product actually removes: crossing ChEMBL mechanisms,
Reactome reactions, interaction records and a disease catalog by hand, molecule by molecule, deciding
for each whether it pushes the protein the right way.

---

## 1. The unit of work

**One unit of manual work is one molecule-target pair whose recorded action has to be looked up and
whose direction has to be judged against the disease.** Concretely, one unit is the triple

> (molecule, the protein target a record says it acts on, the direction this mechanism needs)

and settling one unit needs three things, each of which has to come from a record:

1. **what the mechanism needs** — less activity for a gain of function, more for a loss — from the
   disease record;
2. **what the molecule does to that protein** — from the ChEMBL mechanism `action_type`;
3. **how an effect on that protein carries over to the subject** — from the bridge's own record: the
   same protein, a protein that produces the subject's active form, a protein that removes it (a
   brake, where the sign flips), a protein it binds, a similar pocket, or another disease with the
   same mechanism.

A unit is settled when the three signs have been multiplied and the pair has been recorded as
`matches`, `opposes` or `unknown`. Nothing is a unit unless a decision was reached.

**Where the count comes from.** `bridges[].candidate_count + bridges[].ruled_out_count`, summed over
the five bridges. The engine reports those per bridge **before** the response is de-duplicated and
before the 40-row display caps, so this is the number of judgments actually made, not the number
shown on screen. `judgments_dropped_before_display` is the difference.

---

## 2. What one request settles

**n = 16 requests** over 14 distinct subjects: the 13 flagship genes of `data/seed/catalog.json`
asked for by gene symbol, plus the three control subjects asked for by disease slug. PIK3CD and STAT1
appear in both groups, so two subjects are measured twice under different request forms, and the two
forms of PIK3CD return the same counts.

Conditions: live API at `http://localhost:8000`, `warm_rebuild` tier (see §4), engine build **after**
the change in §5. The `before` build produced identical counts on all 16 — that is the equivalence
check in §5.

| Subject                     | Judgments made | Ranked | Ruled out | Dropped before display | Distinct upstream records | Databases consulted | Target proteins judged | Molecules recorded against those proteins |
| --------------------------- | -------------- | ------ | --------- | ---------------------- | ------------------------- | ------------------- | ---------------------- | ----------------------------------------- |
| ADA                         | 2              | 0      | 2         | 0                      | 7                         | 7                   | 1                      | 2                                         |
| IL2RG                       | 94             | 19     | 40        | 35                     | 54                        | 7                   | 8                      | 85                                        |
| BTK                         | 37             | 4      | 33        | 0                      | 80                        | 7                   | 4                      | 43                                        |
| WAS                         | 8              | 8      | 0         | 0                      | 9                         | 5                   | 2                      | 27                                        |
| RAG1                        | 0              | 0      | 0         | 0                      | 0                         | 5                   | 0                      | 0                                         |
| JAK3                        | 81             | 10     | 40        | 31                     | 51                        | 7                   | 6                      | 58                                        |
| CYBB                        | 0              | 0      | 0         | 0                      | 0                         | 5                   | 0                      | 0                                         |
| STAT3                       | 29             | 29     | 0         | 0                      | 37                        | 5                   | 11                     | 143                                       |
| STAT1                       | 24             | 21     | 0         | 3                      | 24                        | 5                   | 6                      | 123                                       |
| FOXP3                       | 0              | 0      | 0         | 0                      | 0                         | 5                   | 0                      | 0                                         |
| CD40LG                      | 9              | 3      | 6         | 0                      | 16                        | 7                   | 2                      | 17                                        |
| PIK3CD                      | 24             | 24     | 0         | 0                      | 47                        | 7                   | 4                      | 126                                       |
| CTLA4                       | 11             | 5      | 6         | 0                      | 20                        | 7                   | 3                      | 11                                        |
| APDS, held out              | 24             | 24     | 0         | 0                      | 35                        | 8                   | 4                      | 126                                       |
| X-linked agammaglobulinemia | 37             | 4      | 33        | 0                      | 80                        | 8                   | 4                      | 43                                        |
| STAT1 gain of function      | 30             | 23     | 4         | 3                      | 32                        | 6                   | 8                      | 138                                       |

Over the 16 requests:

- **410 judgments made**, median 24 per request, range 0 to 94. 174 ranked, 164 ruled out, 72 made
  and then dropped by de-duplication or a display cap.
- **492 distinct upstream records** behind them, median 28, range 0 to 80. By database: ChEMBL 445,
  Reactome 18, IntAct 15, UniProt 9, STRING 3, IUIS 2.
- **5 to 8 databases consulted per request**, median 7; eight across the set — ChEMBL, Reactome,
  IntAct, STRING, PDBe, RCSB PDB, Open Targets and the Helix seed catalog.
- **63 target proteins judged**, median 4 per request, up to 11 for STAT3.
- **942 molecules** carry a recorded action on the proteins reached, median 43 per request, up to 143. This is the size of the pool the direction rule has to be applied across, and it is larger
  than the judgment count because the per-bridge row caps stop the engine before it reaches every
  molecule on a protein.
- **4 of the 16 requests settle nothing**: RAG1, CYBB and FOXP3 return no judgment at all, and ADA
  returns two, both ruled out. Those are real results, not failures — ChEMBL records no molecule
  against those proteins and none of their partners. A quarter of the flagship genes get nothing out
  of this engine.

**Proteins read per request**, counted inside the engine by wrapping its protein-records call
(`--phase fetches`, 7 subjects): 9 for PIK3CD and APDS, 14 for STAT3 and STAT1 gain of function, 15
for IL2RG, 18 for JAK3 and X-linked agammaglobulinemia. One fetch covers one protein's ChEMBL
targets, the mechanism records on them, and the molecules behind them.

---

## 3. The manual equivalent

**What was measured.** A machine doing the same lookups the way a person has to: one request at a
time, no concurrency, no cache shared between items, every record fetched from the public API that
holds it — ChEMBL, Reactome, IntAct, UniProt. It walks the same path the engine walks, under the
engine's own caps: the subject's protein and every molecule recorded against it; Reactome's reactions
for that protein, each kept reaction's two sides and its participants; each participant protein's
molecules; IntAct's partners and each partner's molecules.

**n = 3 subjects**, the three control subjects, run 2026-10-04 against the live public APIs. Every
request returned HTTP 200; median request 0.59 to 0.60 s.

| Subject                     | Requests issued | Wall seconds | Judgments reached | Requests per judgment | Seconds per judgment |
| --------------------------- | --------------- | ------------ | ----------------- | --------------------- | -------------------- |
| APDS, held out              | 60              | 37.8         | 43                | 1.40                  | 0.88                 |
| X-linked agammaglobulinemia | 97              | 76.9         | 31                | 3.13                  | 2.48                 |
| STAT1 gain of function      | 144             | 133.2        | 58                | 2.48                  | 2.30                 |
| **All three**               | **301**         | **247.8**    | **132**           | **2.28**              | **1.88**             |

The engine, for the same three subjects, issues **one** HTTP request each and settles 24, 37 and 30
judgments in 195.0 ms, 198.7 ms and 118.8 ms end to end (`after` pass, `warm_rebuild` tier) - 8.1 ms,
5.4 ms and 4.0 ms per judgment.

**The ratio, stated the only way it can honestly be stated:** to reach the same kind of judgment set,
the serial uncached path spent **301 requests and 247.8 seconds across three subjects**, against
three requests and 0.51 seconds for the engine. Per subject that is 194x, 387x and 1121x the wall
seconds. Those three ratios move with whichever engine pass they are divided by - the same three
subjects in a different after-pass give 191x, 379x and 2762x - so the order of magnitude is the
claim, not the figure.

**This is a lower bound on the manual path, and only that.** The machine does not read, decide or
record anything — it only fetches. A person doing this also has to read each record, apply the
direction rule, and write the decision down, and none of that is in the figure. **No scientist was
timed, so nothing here is a claim about human time.** The figures are requests and seconds to reach
the same set of judgments, and that is all they are.

**Where the two sides do not line up, and it matters:**

- The emulation covers three of the five bridges (`same_target`, `pathway_node`,
  `interaction_partner`). `structural_analogue` and `mechanism_class` are not emulated, so the manual
  figure is **too low** by whatever those two would cost.
- It picks IntAct partners in the order the result list returns them; the engine ranks them by MI
  score and prefers curated rows. So the partner sets differ.
- It counts every (molecule, target) pair it reaches rather than stopping at the engine's per-bridge
  row caps, which is why it reaches 43 pairs for APDS where the engine made 24 judgments.

Because of all three, **the totals are not comparable and the per-judgment columns are the ones to
read.** For PIK3CD the emulation found zero usable Reactome reactions, which matches the engine: that
protein has no reaction naming a modification of it, so `pathway_node` is genuinely empty for APDS.

**The cache conditions are not symmetric, by construction.** The engine figure above is a warm
rebuild against a local HTTP cache; the emulation has no cache at all. That is the comparison the
task asks for — a person has no shared cache either — but it means the seconds ratio mixes two
effects: the engine's concurrency and batching, and the engine's cache. The request-per-judgment
column is free of that, and the engine's own upstream request count was **not** measured, so no
request-count ratio is claimed.

---

## 4. The engine's own time, and what "cold" means here

Three tiers, each with its cache precondition stated in the result file. The server was never
killed; the assembled-response cache was emptied by touching a module the dev server watches, which
reloads the worker and leaves the source adapters' database-backed HTTP cache alone.

| Tier                | Precondition                                                                 | Total over 16 requests (after) | Median  | Range          |
| ------------------- | ---------------------------------------------------------------------------- | ------------------------------ | ------- | -------------- |
| `first_rebuild`     | response cache empty; HTTP cache in whatever state earlier use left it       | 1891 ms end to end             | 46.0 ms | 5.9 – 513.5 ms |
| `warm_rebuild`      | response cache empty again; HTTP cache holds every record this subject needs | 1899 ms end to end             | 74.2 ms | 6.0 – 522.5 ms |
| `served_from_cache` | same request repeated, assembled response returned, no chain rebuilt         | 41 ms end to end               | 2.5 ms  | 1.1 – 6.9 ms   |

**There is no honest cold number in this report, and that is the biggest gap in it.** A true cold
run means an empty HTTP cache, which would mean purging a cache shared with a running dev server and
re-fetching every record from the public APIs. That was not done. The one cold-ish datum on record is
the `before` pass's `first_rebuild`, where subjects never requested before paid full upstream
latency: IL2RG 3.6 s, JAK3 2.9 s, STAT3 2.5 s, CD40LG 1.2 s, WAS 1.1 s - 15.5 s for all 16, against
1.9 s for all 16 once those records were cached. That shows the order of magnitude upstream latency
adds. It cannot be used as a before/after comparison, and §5 does not use it.

---

## 5. What was made faster

### The change

`api/helix/discovery/engine.py` ran `same_target` to completion and only then started the other four
bridges, because two bridges want the subject's own ChEMBL records and the second reused what the
first had left in `context.shared`. The comment said as much.

Two edits, both about scheduling and nothing else:

1. **`BridgeContext.protein_actions(accession)`** (`api/helix/discovery/context.py`) — one fetch per
   protein per request, however many bridges ask for it. The in-flight task is shared and
   `asyncio.shield`ed, so one bridge's timeout cannot cancel a fetch another bridge is waiting on.
   `release_protein_actions()` cancels any fetch nobody waited for once the bridges are done. All
   five bridges now go through it instead of calling `protein_actions` directly.
2. **All five bridges start together** (`engine.py`) — one `asyncio.gather` over `BRIDGES`. The
   results are then sorted back into `BRIDGES` order before rows are collected, so the order two
   equally ranked rows come back in does not depend on which bridge finished first.

No rule, no ranking key, no threshold, no cap and no filter was touched.

### Did it change any answer

No. Compared subject by subject on judgments made, ranked, ruled out, dropped, distinct upstream
records, databases consulted, target proteins and molecules: **0 of 16 subjects differ**, in each of
the three after-passes independently (`summary.equivalence_before_vs_after`, and the same comparison
against `after2` and `after3`).

The three controls that existed at the time were re-run after the change and **3 of 3 pass**, with
the same ranks as before:
leniolisib at rank 4 of 24 for APDS with its own edge held out; 20 of 20 BTK-lowering molecules ruled
out with verdict `opposes` and none ranked; baricitinib at rank 2 of 23 on JAK1, not on STAT1.

### How much faster

**The cross-pass figure is the `warm_rebuild` tier, where every pass reads the same warm HTTP
cache.** The after build was measured three times, to see how much of any difference is noise. The
before build could only be measured once, because measuring it again means reverting the change.

| `warm_rebuild`, 16 requests | Server build time         | End to end | Median per request |
| --------------------------- | ------------------------- | ---------- | ------------------ |
| before (n = 1 pass)         | 1937.9 ms                 | 2008.4 ms  | 44.9 ms            |
| after, pass 1               | 1847.3 ms                 | 1898.7 ms  | 70.9 ms            |
| after, pass 2               | 1743.3 ms                 | 1796.9 ms  | 40.5 ms            |
| after, pass 3               | 1732.9 ms                 | 1783.5 ms  | 40.2 ms            |
| **after, mean of 3**        | **1774.5 ms** (**-8.4%**) | 1826.4 ms  | -                  |

**The spread between three identical after-passes is 114 ms, against a measured improvement of
163 ms.** The cross-pass number is therefore real but imprecise: between -4.7% and -10.6% depending
which pass you compare against, and with one before-pass there is no way to narrow it.

**The schedule change itself can be read inside a single pass, which removes both the cache question
and the run-to-run noise.** Each pass's own per-bridge timings give two models: what the build costs
if `same_target` runs to completion before the others start, and what it costs if all five overlap.
Whichever model the observed build matches is the schedule that ran.

| Pass          | Serial-head model | All-concurrent model | Observed  | Observed / serial | Observed / concurrent |
| ------------- | ----------------- | -------------------- | --------- | ----------------- | --------------------- |
| before        | 1921.3 ms         | 1736.2 ms            | 1937.9 ms | **1.009**         | 1.116                 |
| after, pass 1 | 2254.9 ms         | 1831.2 ms            | 1847.3 ms | 0.819             | **1.009**             |
| after, pass 2 | 2131.2 ms         | 1728.3 ms            | 1743.3 ms | 0.818             | **1.009**             |
| after, pass 3 | 2112.5 ms         | 1717.6 ms            | 1732.9 ms | 0.820             | **1.009**             |

The before build matched the serial model to within 1%. Every after build matches the concurrent
model to within 1%. And observed over serial-head is 0.819, 0.818, 0.820 across three passes:
**the overlap removes 18% of what the serial schedule costs, and that figure is stable to 0.2
percentage points.** It is the one number in this section worth quoting.

The cross-pass gain (-8.4%) is smaller than the within-pass counterfactual (-18%) because
`same_target` itself got slower once it stopped having the event loop and the ChEMBL concurrency
limit to itself: for X-linked agammaglobulinemia it went from 29.2 ms to 48-56 ms, for CTLA4 from
8.4 ms to 26-29 ms. It still finishes inside the window the other four occupy, so the build is
shorter, but the overlap is not free.

**Six of the 16 subjects got slower** on the mean of the three after-passes: STAT1 gain of function
38.9 -> 64.4 ms (+66%, and the three passes read 115.6, 37.0, 40.7 ms, so one pass carries all of
it), CTLA4 25.4 -> 27.7 ms (+9%), RAG1 4.7 -> 4.9 ms, STAT3 78.0 -> 80.4 ms, IL2RG 500.2 ->
510.5 ms, CD40LG 11.0 -> 11.1 ms. Five of those six are within the pass-to-pass spread of the after
runs themselves. None is investigated further here, and none is dismissed.

### What was looked at and left alone

- **The de-duplication in change 1 saves nothing measurable.** Counted in process over 7 subjects:
  9 to 18 protein fetches per request, and **0 duplicate fetches avoided** in every one. Bridges do
  not in fact land on the same protein on these subjects. The memo earns its place by letting the
  five bridges start together without the subject's protein being fetched twice, not by de-duplicating.
- **`protein_actions` issues two ChEMBL calls that could be one.** The molecule records and the
  withdrawn flags are fetched separately because `MOLECULE_FIELDS` does not include
  `withdrawn_flag`. They already run concurrently, so merging them would save a request but little
  wall time, and it changes what a source call returns. Not done; worth doing for upstream politeness.
- **ChEMBL's `max_concurrency` is 4.** On a genuinely cold request, 9 to 18 proteins at 3 to 4 calls
  each queue behind that semaphore, and that is probably the real cold-path bottleneck. Raising it
  was not attempted: it is an upstream-politeness setting, and with no cold measurement there would
  be no way to show the change helped.

---

## 6. Threats to validity

- **Repeats only on one side.** The after build was measured three times, the before build once,
  and the manual phase once. Three identical after-passes spread 114 ms over a 1774 ms total, which
  is the noise floor this design can resolve: differences smaller than that mean nothing here.
- **No cold measurement.** See §4. The before/after claim is about warm rebuilds and about the
  bridge schedule, not about the path a first-ever request takes.
- **The `first_rebuild` tier is not comparable between passes.** The before pass fetched records the
  after pass then read from cache. Its 88% apparent improvement is cache warming, not the change,
  and is not quoted as a result anywhere above.
- **Shared machine.** The web dev server and another agent's work were running throughout. Nothing
  was isolated or pinned.
- **n = 16 requests, 14 subjects, for the effort counts; n = 3 for the manual equivalent.** Both are
  small, and the manual phase covers three of five bridges. See §3.
- **The manual emulation is a machine, not a person**, and it is a lower bound by construction. No
  human-time figure appears in this document, because no human was measured.
- **The judgment count is itself a lower bound on what a person would face.** `judgments_made` counts
  the pairs the engine reached under its own per-bridge caps. 942 molecules carry a recorded action
  on the proteins it read; a person without caps would have to judge more of them.
- **Counts come from the engine's own report.** `bridges[].candidate_count` is read, not
  independently recounted from the rows, and the per-bridge counts are pre-de-duplication, so a
  molecule judged by two bridges on the same protein is two judgments here.
- **All of this says nothing about whether the answers are right.** Effort removed and time taken are
  not accuracy. Correctness evidence is four controls on four subjects, and no test suite covers
  the engine.

---

## 7. Reproducing it

```bash
# what one request settles, and the engine's three timing tiers (16 requests, ~1 min)
lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase engine --label after

# proteins read per request, counted inside the engine (needs the API's interpreter)
api/.venv/bin/python lab/experiments/run_discovery_effort.py --phase fetches

# the serial uncached path, against the public APIs (3 subjects, ~4 min)
lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase manual

# recompute every total, median and ratio quoted above from the stored passes
lab/.venv/bin/python lab/experiments/run_discovery_effort.py --phase summary

# the four correctness controls, which must still pass
api/.venv/bin/python lab/experiments/run_discovery_controls.py
```

`--label` names the pass. The stored file holds `before` (the pre-change build, one pass) and
`after`, `after2`, `after3` (three passes of the post-change build, which is where the 114 ms noise
floor in §5 comes from).

`--phase engine` empties the engine's assembled-response cache by touching
`api/helix/discovery/cache.py`, which the dev server watches. It never stops the server. Re-running a
pass under the label `before` would overwrite the stored before-pass, which was taken against the
pre-change build and cannot be reproduced without reverting the two edits in §5.
