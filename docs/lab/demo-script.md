# Two minute demo: shot by shot

Total 2:00. Every label in quotes is what the screen showed when this script was checked against the
running app on 2026-10-04 (simple mode, dark theme, 1440 x 900). Re-check the quoted labels before
recording and say what is on screen.

The demo ends on the held-out recovery, which is the strongest thing the product does: the known
link between the disease and its molecule is hidden, and the molecule comes back anyway through a
chain of records.

The Lab shot is a replay of a recorded run, `lab/runs/candidates-PIK3CD-p.Glu1021Lys/`. It is a real
run. Say so.

## Timing

| Part                                                        | Time         | Length |
| ----------------------------------------------------------- | ------------ | ------ |
| A. The question: a disease with a gene and no therapy       | 0:00 to 0:15 | 15 s   |
| B. The Lab: a recorded run that now ends on candidates      | 0:15 to 0:40 | 25 s   |
| C. The filter refusing: BTK, and why ibrutinib is ruled out | 0:40 to 1:10 | 30 s   |
| D. The held-out recovery: APDS with the answer hidden       | 1:10 to 1:50 | 40 s   |
| E. The four controls and the caveat                        | 1:50 to 2:00 | 10 s   |

## A. The question (0:00 to 0:15)

| Shot | Time         | On screen                                                                                                                                                                                                                                                                                                                                                    | Do                                                                       | Say                                                                                                                                  |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| A1   | 0:00 to 0:06 | `http://localhost:3000/`. "Helix", "See how a mutation breaks a protein.", the search box "Search a disease, gene or mutation", "Try a gene" with ADA, IL2RG, BTK, WAS, RAG1, and "511 immune-disease genes. Browse all"                                                                                                                                     | Type `APDS` in the search box and open "Activated p110δ syndrome (APDS)" | "Helix covers 511 rare immune-disease genes. Almost all of them have a known gene and no therapy."                                   |
| A2   | 0:06 to 0:15 | `http://localhost:3000/disease/activated-p110-delta-syndrome-pik3cd`. Left: "Activated p110δ syndrome (APDS)", "An inherited immune disease caused by mutations in the PIK3CD gene.", "Gene PIK3CD", "Inherited One faulty copy is enough", "Harmful mutations found 70", "Structures solved in the lab 20". The stage rail reads "1 Disease … 7 Candidates" | Point at the stage rail, at "7 Candidates"                               | "Helix used to end at why the mutation is harmful. That is a lookup. The journey now ends on a seventh step: what to aim a drug at." |

## B. The Lab: a recorded run that now ends on candidates (0:15 to 0:40)

Open `http://localhost:3000/lab/candidates-PIK3CD-p.Glu1021Lys`. Do not press "Replay" — there is
not time for the full replay in two minutes. Click the steps directly.

| Shot | Time         | On screen                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | Do                                               | Say                                                                                                                                        |
| ---- | ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| B1   | 0:15 to 0:25 | Header "PIK3CD Glu1021 → Lys", "Finished". The step bar: "Question — Why is this mutation harmful?", "Evidence — 23 facts from 11 sources", "Hypothesis — 3 possible causes", "Experiment — Chose 1 of 4 tests", "Result — Test finished", "Decision — Answer held", "Candidates — 4 candidates". Left column "AGENTS" ends with "Translator — Found 4 candidates"                                                                                                           | Let the page settle. Point at the last two steps | "A real recorded run. Seven steps now, not six. A ninth agent, the translator, turns the decision into candidates."                        |
| B2   | 0:25 to 0:40 | Click "Candidates". Panel header "Candidates", "4 candidates", "Full record →". Then "Direction — The protein does too much" → "What to aim at — Turn it down". Rows "Duvelisib on PIK3CD", "Idelalisib on PIK3CD", "Leniolisib on PIK3CD", each with the badge "Pushes the right way", the line "Acts on this same protein · … · In use for another disease", an "Only if:" sentence and "How we got here". Right column "Time 4 min 34 s", "Steps taken 116", "Sources 11" | Click the step "Candidates" in the step bar      | "The protein does too much, so a drug would have to turn it down. Four molecules push that way. Each one says what would have to be true." |

Behind this shot, for questions afterwards: the translator can only record a candidate by reference
to a row the discovery endpoint returned, the safety agent reviews every proposal first, and the
tools refuse any candidate whose direction check is not "matches". No agent can type a molecule name
into the record.

## C. The filter refusing (0:40 to 1:10)

This is the shot that makes the rest believable. Do not skip it.

| Shot | Time         | On screen                                                                                                                                                                                                                                                                                                                                                                                                 | Do                                                                                         | Say                                                                                                                                                                                                     |
| ---- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| C1   | 0:40 to 0:52 | `http://localhost:3000/discover/BTK?disease=btk-deficiency-x-linked-agammaglobulinemia`. "Candidates 4". The headline "The protein does too little, so a drug would need to turn it back on." with the source chip "IUIS". Four rows, each tagged "Direction unknown": "Polatuzumab Vedotin aims at CD79B", "CD24FC aims at HSP90AB1", "Ganetespib", "Retaspimycin". Footer "4 candidates · 34 ruled out" | Let it load. Point at the headline                                                         | "A second disease. This one is the opposite: BTK does too little. A drug would have to turn it back on. Four candidates — and thirty-four molecules thrown out."                                       |
| C2   | 0:52 to 1:02 | Click the bar "Ruled out — Pushed the protein the wrong way" (count "33" on the right). It opens on "Abivertinib aims at BTK", "Abivertinib slows BTK down. In this disease the protein does too little.", source chips "UniProt" and "ChEMBL", and "The full reason"                                                                                                                                     | Click "Ruled out", then click "Show every ruled-out molecule (33)" and scroll to Ibrutinib | "Every molecule that lowers BTK is here, with its reason. Ibrutinib is the famous one. It blocks BTK, and it treats cancer. Point it at a disease where BTK is already too weak and you make it worse." |
| C3   | 1:02 to 1:10 | On the Ibrutinib row, click "The full reason". It reads: "BTK deficiency, X-linked agammaglobulinemia needs BTK to do more. ChEMBL records this molecule as an inhibitor of Tyrosine-protein kinase BTK, which lowers that protein. Because this is the protein the disease's gene encodes, that lowers what BTK does. That is the opposite of what this mechanism needs, so it is ruled out."            | Click "The full reason" on the Ibrutinib row                                               | "Direction of effect is a hard filter, not a score. A naive same-gene engine suggests this immediately. Helix never ranks it — it shows you it was refused, and why."                                   |

If the Ibrutinib row cannot be reached in time, use the first row, Abivertinib. The sentence is the
same shape and the point is the same. Do not say "ibrutinib" over a row that shows another molecule.

## D. The held-out recovery (1:10 to 1:50)

| Shot | Time         | On screen                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Do                                               | Say                                                                                                                                                                                  |
| ---- | ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | 1:10 to 1:22 | `http://localhost:3000/discover/PIK3CD?disease=activated-p110-delta-syndrome-pik3cd&held_out=1`. "Candidates 24". Headline "The protein does too much, so a drug would need to turn it down." with the chip "IUIS". Under it the banner "**Held-out test** The known link for this disease was hidden, so anything found here came another way." Footer "24 candidates · 0 ruled out"                                                                               | Let it load. Point at the "Held-out test" banner | "Back to APDS, with one change. Every record that links this disease straight to a molecule has been withheld. Eighteen of them. Anything that comes back had to come another way."  |
| D2   | 1:22 to 1:32 | The list: "1 Duvelisib aims at PIK3CD", "2 Idelalisib", "3 Copanlisib", "**4 Leniolisib** aims at PIK3CD — In use for another disease — Slows it down.", each row ending "Acts on this same protein ›"                                                                                                                                                                                                                                                              | Click the row "Leniolisib"                       | "Fourth of twenty-four: leniolisib. That is the one molecule ChEMBL records as studied or used for this group of diseases — and that record is exactly what was withheld."           |
| D3   | 1:32 to 1:45 | The inspector opens on "Leniolisib", "Agent idea", "Acts on this same protein — A molecule that already acts on this very protein." Then "HOW WE GOT HERE 3": step 1 "PIK3CD encodes UniProt O00329 …" with the chip "UniProt"; step 2 "ChEMBL records Leniolisib as an inhibitor of … described as 'PI3-kinase p110-delta subunit inhibitor'" with "ChEMBL"; step 3 "ChEMBL holds 6 measured activities of Leniolisib against … median pChEMBL 7.96" with "ChEMBL" | Point down the three steps, one at a time        | "Three steps, three records. The gene makes this protein. ChEMBL records this molecule as an inhibitor of it. ChEMBL holds six measurements. No step uses the link that was hidden." |
| D4   | 1:45 to 1:50 | Scroll the inspector to "DIRECTION": "Pushes the right way", "Needed: turn it down, or block the step before it.", "This molecule slows it down.", "Measured strength: Measured in 6 lab tests". Below it "THE POCKET" with a "3D" button and "26 residues of O00329 line a ligand in an experimental PDB entry, so a pocket is known to exist here."                                                                                                               | Scroll the inspector down to "DIRECTION"         | "The direction check: the mechanism needs it turned down, the molecule turns it down. That is the whole claim. Nothing here says it would work."                                     |

## E. The controls and the caveat (1:50 to 2:00)

| Shot | Time         | On screen                                                                                                                                                                                                                                 | Do                                              | Say                                                                                                                                                                              |
| ---- | ------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| E1   | 1:50 to 2:00 | Still on the Leniolisib inspector, with the footer line visible at the bottom of the list: "A Helix idea. Not a treatment." Alternative shot: an editor on `lab/experiments/DISCOVERY-CONTROLS.md`, the table at the top, "4 of 4 passed" | Scroll the list so the footer line is on screen | "We ran that as a control, with a negative, an upstream case and a safety case: four of four pass. Every row is a Helix idea built from records. Not a treatment, and nothing is lab-tested." |

## The optional extra shot

If there is time, or for questions afterwards: turn Advanced on in the "…" menu, close the
inspector, and the right panel reads "Run" with "Links hidden for this run 18". Each row names what
was dropped, including, for leniolisib: "ChEMBL records 4 diseases for Leniolisib (Sjogren syndrome,
common variable immunodeficiency, inborn error of immunity, neoplasm). No disease-to-molecule row
was used to reach this molecule." Below that, "Limits" and "Sources".

Note that ChEMBL files leniolisib under "inborn error of immunity", which is a parent of APDS, not
APDS itself. A filter that matched the disease name would have missed it and leaked the answer. The
held-out mode drops every disease-to-molecule row for every disease, which is why the recovery is
worth something.

Advanced mode changes labels across the whole app, so turn it off again before any other shot.

## Check before recording

1. `make dev` is running: the API on `http://localhost:8000`, the web app on `http://localhost:3000`.
2. Simple mode is on (the "…" menu, Advanced off). In Advanced mode the screens show codes and
   technical terms and the quoted labels above do not match.
3. Open each of the three `/discover` URLs once before recording. A cold call takes three to five
   seconds; a warm one is milliseconds. The screen reads "Looking for candidate targets and
   molecules. Can take a minute." while it waits. The engine keeps a response for fifteen minutes,
   so warm all three within fifteen minutes of the take.
4. On the APDS held-out page, read the footer: it must say "24 candidates · 0 ruled out" and
   Leniolisib must be at rank 4. If a ChEMBL refresh has moved it, say the rank on the screen.
5. On the BTK page, read the footer: "4 candidates · 34 ruled out". Confirm no row in the candidate
   list aims at BTK. If one does, stop and do not record part C.
6. `curl http://localhost:8000/api/v1/discovery/controls` returns 200 and `"all_passed": true`. If
   it returns 404 `controls_not_run`, run
   `api/.venv/bin/python lab/experiments/run_discovery_controls.py` first, and if any control fails,
   say so on camera rather than cutting the shot.
7. The home page still reads "See how a mutation breaks a protein.", which describes the old
   question. Do not read that line aloud as the product's description; say what A1's script says
   instead.
8. The 3D viewer loads on the disease page. Wait for it before you start.
9. Do not press "Run" on `/lab` while recording. It starts a real run with real agents that takes
   several minutes.
10. Do not press "Replay" on the lab run. The replay takes about 70 seconds and there is no room for
    it in this cut.
11. Do not open the Compare stage for a new prediction, the Boltz-2 provider or the chat assistant
    on camera. Live structure predictions fail at present because the public ESMFold server returns
    errors; Boltz-2 has no GPU backend attached; the chat assistant needs an API key.
12. Nobody edits files under `web/` while recording. An edit mid-take has stopped a replay part-way
    before.

## Words to keep out

- "Treatment", "therapy", "cure", "treats", "would work", "patients", "dose". Every row is a
  hypothesis built from records. The screen says "A Helix idea. Not a treatment."
- "Discovered", "proved", "found a drug for APDS". Leniolisib was recovered from public records with
  one link withheld. That shows the method works on a case with a known answer. It is not a
  discovery.
- "Repurposing candidate", "ready to test in patients". The next step is in the screen's own words:
  "check the molecule binds this protein, then check it corrects the fault in cells."
- "Safe", "ruled out as unsafe". The ruled-out list means the molecule pushes the wrong way for this
  mechanism. It says nothing about safety, and a molecule can be wrong for reasons Helix never
  checks: tissue, pharmacokinetics, toxicity.
- "Ranked by promise" or any score. There is no composite score and no probability of success.
- "Faster": the Lab comparison shows the team is slower than one agent, and no person was timed.
- "A scientist approved": no kept run holds an approval given by a person on the page.
