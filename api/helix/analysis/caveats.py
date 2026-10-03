"""Fixed caveats carried by every reference-versus-variant comparison.

The wording is taken from docs/research/variant-effect.md section 6 and
docs/research/structure-models.md section 5.7. Quotations are verbatim.
"""

from helix.providers.base import ExecutionMode, Provider
from helix.schemas.common import Citation
from helix.schemas.compare import CachedOrigin, ComparisonCaveat, ComparisonProvider

AFDB_FAQ_URL = "https://alphafold.ebi.ac.uk/faq"

NOT_VALIDATED = ComparisonCaveat(
    id="not_validated_for_substitutions",
    text=(
        "Structure predictors are not validated for single-residue substitutions. A variant model "
        "that matches the reference carries no information about whether the variant is tolerated. "
        "Differences smaller than run-to-run variation are noise. See the evidence panel for "
        "functional, curated, population and predictor data."
    ),
    citations=[
        Citation(
            text="Buel & Walters, Nat Struct Mol Biol 2022, 29:1-2",
            title="Can AlphaFold2 predict the impact of missense mutations on structure?",
            year=2022,
            doi="10.1038/s41594-021-00714-2",
        ),
        Citation(
            text="Pak et al., PLoS ONE 2023, 18:e0282689", year=2023, doi="10.1371/journal.pone.0282689"
        ),
        Citation(
            text="Feldman, Brogi & Skolnick, Comput Struct Biotechnol J 2026",
            year=2026,
            doi="10.34133/csbj.0142",
        ),
        Citation(text="Terwilliger et al., Nat Methods 2024", year=2024, doi="10.1038/s41592-023-02087-4"),
        Citation(
            text="McBride et al., Phys Rev Lett 2023 (counterpoint)",
            year=2023,
            doi="10.1103/PhysRevLett.131.218401",
        ),
    ],
)

AFDB_STATEMENT = ComparisonCaveat(
    id="alphafold_db_statement",
    text=(
        "AlphaFold has not been validated for predicting the effect of mutations. In particular, "
        "AlphaFold is not expected to produce an unfolded protein structure given a sequence "
        "containing a destabilising point mutation."
    ),
    quoted_from="AlphaFold DB FAQ. Helix applies the same caveat to every structure predictor.",
    citations=[Citation(text="AlphaFold Protein Structure Database, FAQ", url=AFDB_FAQ_URL)],
)

SIMILAR_FOLD = ComparisonCaveat(
    id="similar_fold_is_uninformative",
    text=(
        "A predictor producing a similar fold for the variant sequence is expected for most single "
        "substitutions and is uninformative about stability."
    ),
)

CONFIDENCE_IS_NOT_EFFECT = ComparisonCaveat(
    id="plddt_is_model_behaviour",
    text=(
        "pLDDT is each model's own confidence estimate. The two values at the site are model "
        "behaviour, never measured destabilisation. Low pLDDT means disorder or insufficient "
        "information."
    ),
)

GEOMETRY = ComparisonCaveat(
    id="geometry_from_predicted_models",
    text=(
        "Distances, contacts and displacements are geometry computed from predicted models, not "
        "observations of the protein."
    ),
)

DETERMINISTIC = ComparisonCaveat(
    id="run_to_run_variation_not_estimated",
    text=(
        "This model is deterministic: there is no seed and one model per sequence, so run-to-run "
        "variation is not estimated and no noise baseline is available for these differences."
    ),
)

SINGLE_RUN = ComparisonCaveat(
    id="run_to_run_variation_not_estimated",
    text=(
        "Each model was predicted once, so run-to-run variation is not estimated and no noise "
        "baseline is available for these differences."
    ),
)

WINDOW = ComparisonCaveat(
    id="construct_is_a_window",
    text=(
        "Both models cover a residue window, not the full-length protein. Contacts with the rest of "
        "the chain, with partners and with ligands are absent from both."
    ),
)


def is_deterministic(provider: Provider) -> bool | None:
    return getattr(provider, "deterministic", None)


def provider_ref(provider: Provider, cached_from: CachedOrigin | None = None) -> ComparisonProvider:
    return ComparisonProvider(
        id=provider.id,
        name=provider.name,
        model_name=cached_from.model_name if cached_from else provider.model_name,
        model_version=cached_from.model_version if cached_from else provider.model_version,
        execution_mode=provider.execution_mode.value,
        performs_inference=provider.execution_mode is not ExecutionMode.RETRIEVAL,
        deterministic=is_deterministic(provider),
        cached_from=cached_from,
    )


def comparison_caveats(*, deterministic: bool | None, full_length: bool) -> list[ComparisonCaveat]:
    caveats = [NOT_VALIDATED, AFDB_STATEMENT, SIMILAR_FOLD, CONFIDENCE_IS_NOT_EFFECT, GEOMETRY]
    caveats.append(DETERMINISTIC if deterministic else SINGLE_RUN)
    if not full_length:
        caveats.append(WINDOW)
    return [caveat.model_copy(deep=True) for caveat in caveats]
