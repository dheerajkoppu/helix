# Scientific limitations

OrphaFold is a research and hypothesis-generation tool. It is not clinical decision software. It
does not diagnose, and it does not recommend treatment.

This page lists what the outputs do not show. The same statements travel with the results in the
interface: each provider's limitations are returned by `GET /api/v1/models`, and every
reference-versus-variant comparison carries its caveats in the response.

## Predicted structures

- A predicted structure is a computational prediction. It is never presented as experimentally
  established. Terwilliger et al. (Nat Methods 2024, doi:10.1038/s41592-023-02087-4): "AlphaFold
  predictions are valuable hypotheses and accelerate but do not replace experimental structure
  determination".
- **pLDDT** is a per-residue local confidence estimate. It says nothing about the relative
  placement of domains; a confident domain arrangement needs low inter-domain PAE. In complexes it
  does not by itself indicate whether the relative placement of chains or the predicted interface
  is correct.
- **Low pLDDT** means either disorder or insufficient information for a confident prediction. It
  never means misfolding caused by a variant. Regions with pLDDT below 50 often have a ribbon-like
  appearance and should not be interpreted.
- **Ranking scores** order samples within one run. They are not a probability of correctness and
  are not comparable across models.
- **AlphaFold DB coverage**: sequences of 16 to 2,700 amino acids for proteomes and Swiss-Prot, and
  up to 1,280 for the rest of UniProt. Sequences with non-standard residues are excluded, and long
  proteins can have isoform models only.
- **ESMFold v1 through ESM Atlas** is a single-sequence language-model prediction, generally less
  accurate than MSA-based models. It accepts one chain of at most 400 residues and returns one
  model with pLDDT only; PAE and pTM are not provided. Complexes, ligands, nucleic acids and
  modified residues are not supported. A longer protein is predicted as a residue window, which
  removes every contact with the rest of the chain.

## Structure predictors and single variants

This is the limitation that matters most for the comparison view.

Structure predictors are not validated for single-residue substitutions. A variant model that
matches the reference carries no information about whether the variant is tolerated.

The AlphaFold DB FAQ states: "AlphaFold has not been validated for predicting the effect of
mutations. In particular, AlphaFold is not expected to produce an unfolded protein structure given
a sequence containing a destabilising point mutation." OrphaFold applies the same caveat to every
structure predictor.

Published findings behind that caveat:

| Source                                                                               | Finding                                                                                                                                                         |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Buel and Walters, Nat Struct Mol Biol 2022, doi:10.1038/s41594-021-00714-2           | Correspondence titled "Can AlphaFold2 predict the impact of missense mutations on structure?"                                                                   |
| Pak et al., PLoS ONE 2023, doi:10.1371/journal.pone.0282689                          | "We found a very weak or no correlation between AlphaFold output metrics and change of protein stability or fluorescence."                                      |
| Feldman, Brogi and Skolnick, Comput Struct Biotechnol J 2026, doi:10.34133/csbj.0142 | AlphaFold 3 on 200 proteins: "predicted structures remain invariant to mutations of up to 40% of residues - including deliberately destabilizing substitutions" |
| Counterpoint: McBride et al., Phys Rev Lett 2023, doi:10.1103/PhysRevLett.131.218401 | Local deformation between AlphaFold 2 models of near-identical sequences correlates with experimental structure pairs "on average"                              |

No Boltz-specific benchmark of missense structural effects was found. OrphaFold applies the caveat
to Boltz-2 as well; that is an inference from its model family, not a published result.

What follows for a comparison in OrphaFold:

- A similar fold for the variant sequence is expected for most single substitutions and is
  uninformative about stability.
- The two pLDDT values at the site are model behaviour, never measured destabilisation.
- Distances, contacts and displacements are geometry computed from predicted models, not
  observations of the protein.
- Differences smaller than run-to-run variation are noise. For a deterministic model, or a model
  run once, run-to-run variation is not estimated and no noise baseline is available.
- When the protein is longer than the provider's limit, both models are a window of the protein.
  Contacts with residues outside the window do not exist in either model.

Functional assays, curated annotations, population frequency and variant-effect predictors are
shown beside the comparison because they bear on the question the structure models do not answer.

## Variant-effect predictions

- AlphaMissense has not been validated for, and is not approved for, any clinical use. Its scores
  are retrieved, not computed: the model weights are not released, so no new prediction can be run.
  Scores are for the UniProt canonical isoform as of UniProt release 2021_02; other isoforms score
  differently.
- FoldX values are computed by ProtVar on AlphaFold models and inherit the uncertainty of those
  models. A stability prediction says nothing about variants that act through binding, catalysis or
  regulation.
- Scores from different predictors are shown side by side, each on its own scale with its own
  thresholds. They are never combined into one number.
- A pathogenicity prediction is not a clinical classification. Clinical classifications come from
  ClinVar with their review status.

## Clinical and population data

- ClinVar is not intended for direct diagnostic use or medical decision-making without review by a
  genetics professional. A classification belongs to its submitters and comes with a review status;
  classifications can conflict and can change.
- gnomAD positions are those of the gnomAD canonical transcript. A row whose reference residue
  differs from the UniProt sequence is dropped from the sequence axis and the number dropped is
  reported. A protein whose gnomAD canonical transcript encodes another isoform would lose rows.
- Absence from a database is not evidence of absence. When a source has no record, the page says
  No source found; when a source did not answer, the page says it is unavailable. The two are never
  shown as the same thing.

## Pockets and binding

- A predicted pocket is a computational prediction, not a measured binding site. Pockets can be
  computed for PDB entries and AlphaFold DB models only, not for OrphaFold-generated structures.
- A predicted affinity is a model output for comparing candidate molecules. It is never a clinical
  recommendation and says nothing about whether a molecule would be tolerated or would work in a
  person.
- Boltz-2 `affinity_pred_value` is log10(IC50) with IC50 in µM. Per the Boltz documentation it
  should only be used when comparing different active molecules, not inactives.
  `affinity_probability_binary` is the predicted probability that the ligand is a binder, intended
  for separating binders from decoys; it is not a measure of binding strength.
- An affinity is read together with the pose confidence of the same run. A pose with low ligand
  ipTM makes the affinity uninterpretable.
- The Boltz-2 affinity module was evaluated on the FEP+ benchmark, CASP16 and the authors' MF-PCBA
  test set. A target without a studied series of active compounds is outside that evaluation.
- No real Boltz-2 prediction has been made through OrphaFold yet.

## Interactions, pathways and known drugs

- STRING scores are per evidence channel. Text-mining and prediction channels are not experiments
  and are classified accordingly.
- A drug listed for a target is a database record of a mechanism or an indication. It is not a
  statement that the drug is appropriate for a disease, a variant or a patient.

## Literature

- Search covers the records Europe PMC indexes from PubMed. Preprints and books are left out.
- Relevance is a list of fixed rules (text match in title or abstract, UniProt citation list,
  publication type, citation count), each reported separately. No language model reads the papers.
- A variant or residue is matched in the notations `R28H` and `Arg28His` only. A paper that
  describes the variant another way is not found by that filter.

## The dataset

- Scope is the IUIS 2024 classification of inborn errors of immunity. A disease or gene outside it
  is not in the catalog.
- Twenty-one entries name no gene, and five genes are non-coding and have no protein.
- A disease cross-reference is stored only when a mapping route gave a single answer. Otherwise the
  list is empty; nothing is guessed.
- Residue numbering is UniProt canonical everywhere. Experimental structures are mapped through
  SIFTS; residues outside every mapped segment are not shown on the axis.
- The sequence axis draws the best SIFTS-ranked chain of each PDB entry. Other chains of the same
  entry are not drawn.
- There is no whole-protein conservation track. Conservation is available per residue.

## The assistant

The research assistant drafts text from evidence records that already exist. It is not a source of
facts. A statement it writes is an OrphaFold hypothesis and must list the records it rests on.

## Reporting a problem

A wrong mapping, a mislabelled evidence class or a missing limitation is a bug. See
`CONTRIBUTING.md` in the repository root.
