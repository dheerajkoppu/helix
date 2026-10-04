# Helix — technical report

**An AI lab that works out what a drug could aim at in a rare disease.**
Hack-Nation × Databricks · Challenge 03, Agentic Scientific Discovery · 2026-10-03

---

## Challenge Tackled

About five thousand rare diseases come down to a single broken gene, and fewer than one in twenty has
a treatment. Helix is for the researcher who has the gene and nothing else. Their job today is to
open one database at a time, find every molecule recorded as acting on that protein, and decide one
by one whether it pushes the protein the way the disease needs or the wrong way. Helix does that pass
over the IUIS 2024 catalog of inborn errors of immunity — **511 genes and 604 diseases** — and shows
its working.

```
disease → gene → mutation  →  what went wrong    →  direction needed     →  five ways across
(on the 3D protein)           (too much activity,   (fixed rule table,      (target, pathway,
                               or too little)        no model)                interaction,
                                        ↓                                     structure, class)
                              the filter  =  what's needed
                                             × what the drug does
                                             × how it carries
                                        ↓
                      ┌─────────────────┴──────────────────┐
             ranked candidates                      REFUSED
             (each a cited chain)                   (shown with the reason)
```

Read it left to right: Helix works out which way the broken protein has to move, follows five kinds
of recorded relationship to find molecules, and the filter throws out everything pushing the wrong
way. Nine Omnigent agents drive this loop, and every step is recorded.

## Tools / ML Models Used

- **Omnigent 0.16.0 with Claude Sonnet 5** — runs the nine agents, one supervisor and eight
  specialists; same model in both arms of our comparison.
- **ChEMBL** — what a drug actually does to its target, up or down. The filter runs on that one fact.
- **Reactome, IntAct, STRING** — which proteins sit upstream of the broken one or touch it, so we can
  aim at a neighbour.
- **Open Targets** — drugs already known to work. We hide them, then see if we find them again.
- **AlphaFold DB, ESMFold v1** — a predicted structure when no experiment has solved one.
  **PrankWeb** finds the pockets a drug could bind; **Mol\*** draws them.
- **AlphaMissense, ProtVar** — how damaging one mutation looks.
- **Boltz-2** — would score binding strength; waiting on a GPU.
- **Europe PMC, OpenAlex** — the papers behind each claim.
- **FastAPI** — the API and discovery engine; **Next.js** — the web app.

## What Worked Well

**The filter turns away 34 molecules in X-linked agammaglobulinemia, and it is right to.** In that
disease the BTK protein is already too weak, so a drug that weakens it further would make things
worse. All 20 molecules ChEMBL records as lowering BTK are among the 34 refused — ibrutinib included,
a cancer drug in use today.

Being this strict does not stop it finding drugs. We hid the record linking leniolisib to APDS and
asked again: it came back at **rank 4 of 27** through three cited records. For STAT1 gain of function
it returned baricitinib at **rank 2 of 23** by aiming at JAK1, the protein one step upstream, not at
STAT1 itself. **All four stored controls pass.** Over 16 requests the engine settled **410** such
judgments from 492 records across 8 databases.

## What Was Challenging

**Measuring the engine caught our own filter making a mistake.** We ran it over all 604 diseases with
the known drug links hidden. It refused **plerixafor for WHIM syndrome** — and plerixafor is the drug
used for WHIM syndrome. ChEMBL's one curated field calls plerixafor a `PARTIAL AGONIST` of CXCR4,
meaning it turns the protein up; all four activity measurements for that same pair say it turns it
down. One field said raise, four measurements said lower, and our filter believed the field. So we
changed the rule: **a refusal may no longer rest on an action type that another record of the same
molecule and protein contradicts.** Plerixafor now comes back at rank 8, and that case is a permanent
fourth control.

**Recall is low, and we report it as it came out.** The engine recovered 12 of 226 hidden
drug-disease pairs — **5.3%** — across the 32 diseases we could check against, at a median rank of
5.5, with one wrong refusal left. Of the 213 misses, 53 molecules have no ChEMBL mechanism record at
all, 51 are not small molecules (antibodies, replacement proteins, gene therapies) and 47 act on a
non-human protein — things a mechanism engine is right to stay silent about.

**Our own comparison went against our agent team, and we kept the result.** Same tools, model and
budget, 13 variants each: the nine-agent lab took a median **198.5 seconds against 84.2** for one
generalist agent, slower in all 13 pairs. It bought breadth — **10.69** databases cited on average
against 7.46 — and all 26 runs produced a complete cited record.

## How We Spent the Time

One day, 2026-10-03, from `git log`.

| Time        | What                                             |     | Time        | What                                            |
| ----------- | ------------------------------------------------ | --- | ----------- | ----------------------------------------------- |
| 12:45       | Foundation — backend core, design system, shell  |     | 19:11–19:43 | Interface — three stages, type scale, new mark  |
| 15:04       | Platform — engines, journey pages, simple UI     |     | 20:00       | Lab as the demo centrepiece                     |
| 15:07–15:41 | Benchmark: 26 runs, agent team against one agent |     | 20:06       | Measure the engine over 604 diseases            |
| 16:30       | Lab, measured comparison, plain-language pass    |     | 20:23       | **Fix the filter**, re-measure, classify misses |
| 18:49       | **Discovery engine** — bridges, direction filter |     | 20:51       | MIT relicence                                   |

---

**If we had 24 more hours,** we would add a bridge for proteins that work against each other rather
than touch each other. The 61 misses with no path include amiloride on ENaC, the channel that
counterbalances CFTR in cystic fibrosis — a relationship no interaction database records.

Every row is a hypothesis built from records and labelled as one. No treatment, no dose, no advice;
nothing validated in a laboratory.
