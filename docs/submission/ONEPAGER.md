# Helix — technical report

**An AI lab that works out what a drug could aim at in a rare disease.**
Hack-Nation × Databricks · Challenge 03, Agentic Scientific Discovery · 2026-10-03

Source of the PDF: `onepager.html` + `_fonts.css`, rendered by `render_onepager.mjs`
(headless Chromium from `web/node_modules`) to `Helix_OnePager.pdf`.

---

## Challenge Tackled

About five thousand rare diseases come down to one broken gene, and fewer than one in twenty has a
treatment. **Our user is a translational researcher with a gene and no therapy**: to find what might
help one protein they must check every molecule recorded as acting on it, one database at a time,
and judge whether each pushes the protein the right way or the wrong way. Helix covers the IUIS 2024
inborn-errors-of-immunity catalog: **511 genes, 604 diseases**.

```
disease → gene → mutation  →  mechanism          →  required action      →  5 bridges
(on the 3D protein)           (class + direction)   (fixed rule table)      (target, pathway,
                                                                             interaction,
                                                                             structure, class)
                                        ↓
                             direction filter  =  what the mechanism needs
                                                  × what the molecule does
                                                  × how it carries over
                                        ↓
                      ┌─────────────────┴──────────────────┐
             ranked candidates                      REFUSED
             (each a cited chain)                   (shown with the reason)
```

Nine Omnigent agents — a supervisor and eight specialists — drive the same tool layer through a
recorded loop.

## Tools / ML Models Used

- **Claude Sonnet 5** — reasoning, every agent, both arms
- **Omnigent 0.16.0** — supervisor + 8 specialists
- **ChEMBL** — action type + activities: the direction signal
- **Reactome, IntAct, STRING** — pathway, interaction
- **Open Targets** — held-out ground truth
- **AlphaFold DB, ESMFold v1** — structures
- **Boltz-2** — binding affinity, pending a GPU backend
- **AlphaMissense, ProtVar** — variant effect
- **PrankWeb** — pockets; **Mol\*** — 3D viewer
- **Europe PMC, OpenAlex** — literature
- **FastAPI** — API and discovery engine
- **Next.js** — web app

## What Worked Well

**Direction of effect is a hard filter, not a ranking factor.** A molecule that lowers a protein's
activity helps a disease where that protein is overactive and harms one where it is already too
weak, so anything pushing the wrong way is refused outright and shown with its reason. For X-linked
agammaglobulinemia the engine refuses **34 molecules**, among them all 20 that ChEMBL records as
lowering BTK — ibrutinib included, a cancer drug in use today.

The same rule still finds drugs: with the APDS link withheld, **leniolisib returns at rank 4 of 27**
through a chain of three cited records, and for STAT1 gain of function baricitinib returns at
**rank 2 of 23, aimed at JAK1 upstream**, not at STAT1. **All 4 stored controls pass.** One request
settles **410 molecule-direction judgments** from 492 upstream records over 8 databases.

## What Was Challenging

**Measuring the engine caught a real bug in our own filter.** Run across all 604 diseases with the
known drug links held out, it refused **plerixafor for WHIM syndrome** — the drug used for that
disease. ChEMBL records its one CXCR4 mechanism as `PARTIAL AGONIST`, while the four activities
ChEMBL holds for that same pair are all IC50: one curated field said raise, four measurements said
lower, and the filter believed the field. The fix — **a rejection may no longer rest on an action
type that another record of the same molecule and protein contradicts** — puts plerixafor back at
rank 8 and makes the case a permanent fourth control.

**Recall is low, and reported as it came out:** 12 of 226 held-out pairs (**5.3%**) over 32
evaluable diseases, median rank 5.5, 1 false rejection. The cause table for the 213 misses shows
most are antibodies, replacement proteins, transplant conditioning or drugs with no ChEMBL mechanism
record at all — things a mechanism engine is right to stay silent about.

**The ablation went against our own agent team, and we kept the result.** Same tools, model and
budget, 13 variants per arm: the lab took a median **198.5 s against 84.2 s** for one generalist
agent, slower in 13 of 13 pairs. It bought breadth — 10.69 against 7.46 databases cited — and all 26
runs produced a complete cited record.

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

**If we had 24 more hours,** we would add a functional-counterpart bridge: the 61-pair "no bridge
path" bucket holds amiloride on ENaC, the channel that counterbalances CFTR — a relationship no
physical-interaction record carries.

Every row is a hypothesis built from records and labelled as one. No treatment, no dose, no advice;
nothing validated in a laboratory.
