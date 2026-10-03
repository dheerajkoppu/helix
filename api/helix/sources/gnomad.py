"""gnomAD GraphQL: one gene-level query per gene, cached. Never queried per variant."""

from typing import Any

from helix.sources.base import SourceAdapter, SourceResult

DATASET = "gnomad_r4"
DATASET_LABEL = "gnomAD v4.1"

_FREQUENCY = "ac an af homozygote_count hemizygote_count filters"
GENE_QUERY = f"""
query GeneVariants($symbol: String!) {{
  gene(gene_symbol: $symbol, reference_genome: GRCh38) {{
    gene_id symbol chrom canonical_transcript_id
    variants(dataset: {DATASET}) {{
      variant_id pos ref alt rsids consequence hgvsc hgvsp transcript_id flags
      exome {{ {_FREQUENCY} }}
      genome {{ {_FREQUENCY} }}
    }}
    clinvar_variants {{ variant_id clinvar_variation_id in_gnomad }}
  }}
}}
"""


class GnomadSource(SourceAdapter):
    id = "gnomad"
    name = "gnomAD"
    base_url = "https://gnomad.broadinstitute.org/api"
    homepage = "https://gnomad.broadinstitute.org"
    license = "CC0-1.0"
    license_url = "https://gnomad.broadinstitute.org/policies"
    attribution = "This tool includes data from the gnomAD v4.1 release."
    release = DATASET_LABEL
    timeout = 40.0
    # 10 requests per IP per 60 seconds
    rate_limit_per_second = 0.15
    max_concurrency = 1
    cache_ttl = 7 * 24 * 3600

    def record_url(self, record_id: str) -> str | None:
        return f"https://gnomad.broadinstitute.org/variant/{record_id}?dataset={DATASET}"

    async def gene_variants(self, symbol: str) -> SourceResult[dict[str, Any]]:
        """Every gnomAD v4 variant of a gene, keyed by variant ID, plus the ClinVar join table."""
        raw = await self.graphql(GENE_QUERY, {"symbol": symbol}, root="gene", record_id=symbol)

        def parse(gene: Any) -> dict[str, Any]:
            return {
                "gene_id": gene.get("gene_id"),
                "chromosome": gene.get("chrom"),
                "canonical_transcript_id": gene.get("canonical_transcript_id"),
                "variants": {row["variant_id"]: row for row in gene.get("variants") or []},
                "clinvar": {
                    str(row["clinvar_variation_id"]): row for row in gene.get("clinvar_variants") or []
                },
            }

        return raw.map(parse)


gnomad = GnomadSource()
