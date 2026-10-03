"""ClinVar through NCBI E-utilities: gene-level variant sets, single records, submissions."""

import asyncio
import xml.etree.ElementTree as ElementTree
from collections.abc import Mapping
from dataclasses import replace
from typing import Any

from helix.schemas.common import SourceState
from helix.sources.base import SourceAdapter, SourceResult

SUMMARY_BATCH_SIZE = 200
MAX_GENE_RECORDS = 4000
PATHOGENIC_TERM = '("clinsig pathogenic"[Properties] OR "clinsig likely pathogenic"[Properties])'


def _date(value: str | None) -> str | None:
    """'2025/11/24 00:00' -> '2025-11-24'. ClinVar writes 1/01/01 for 'never evaluated'."""
    if not value:
        return None
    day = value.split(" ")[0].replace("/", "-")
    parts = day.split("-")
    if len(parts) != 3 or len(parts[0]) != 4 or parts[0] < "1900":
        return None
    return day


def _classification(block: Mapping[str, Any] | None) -> dict[str, Any] | None:
    if not block or not (block.get("description") or "").strip():
        return None
    return {
        "description": block["description"].strip(),
        "review_status": (block.get("review_status") or "").strip() or None,
        "last_evaluated": _date(block.get("last_evaluated")),
        "conditions": [
            {
                "name": trait.get("trait_name"),
                "xrefs": [
                    {"db": xref.get("db_source"), "id": str(xref.get("db_id"))}
                    for xref in trait.get("trait_xrefs") or []
                    if xref.get("db_source") and xref.get("db_id")
                ],
            }
            for trait in block.get("trait_set") or []
            if trait.get("trait_name")
        ],
    }


def parse_summary(record: Mapping[str, Any]) -> dict[str, Any]:
    """Flatten one esummary record to the fields Helix reads."""
    variation = (record.get("variation_set") or [{}])[0]
    location = next(
        (
            row
            for row in variation.get("variation_loc") or []
            if row.get("assembly_name") == "GRCh38" and row.get("status") == "current"
        ),
        None,
    )
    xrefs = [
        {"db": xref.get("db_source"), "id": str(xref.get("db_id"))}
        for xref in variation.get("variation_xrefs") or []
        if xref.get("db_source") and xref.get("db_id")
    ]
    rsid = next((f"rs{xref['id']}" for xref in xrefs if xref["db"] == "dbSNP"), None)
    submissions = record.get("supporting_submissions") or {}
    return {
        "variation_id": str(record.get("uid")),
        "vcv": record.get("accession"),
        "vcv_version": record.get("accession_version"),
        "title": record.get("title"),
        "variant_type": record.get("obj_type") or variation.get("variant_type"),
        "protein_changes": [
            part.strip() for part in (record.get("protein_change") or "").split(",") if part.strip()
        ],
        "cdna_change": variation.get("cdna_change") or None,
        "spdi": variation.get("canonical_spdi") or None,
        "chromosome": location.get("chr") if location else None,
        "start": int(location["start"]) if location and str(location.get("start", "")).isdigit() else None,
        "stop": int(location["stop"]) if location and str(location.get("stop", "")).isdigit() else None,
        "germline": _classification(record.get("germline_classification")),
        "oncogenicity": _classification(record.get("oncogenicity_classification")),
        "clinical_impact": _classification(record.get("clinical_impact_classification")),
        "consequences": list(record.get("molecular_consequence_list") or []),
        "rsid": rsid,
        "xrefs": xrefs,
        "scv": list(submissions.get("scv") or []),
        "rcv": list(submissions.get("rcv") or []),
        "genes": [gene.get("symbol") for gene in record.get("genes") or [] if gene.get("symbol")],
    }


def parse_vcv_xml(text: str) -> list[dict[str, Any]]:
    """Submitter-level records (SCV) of a VCV XML document."""
    root = ElementTree.fromstring(text)
    submissions = []
    for assertion in root.iter("ClinicalAssertion"):
        accession = assertion.find("ClinVarAccession")
        classification = assertion.find("Classification")
        if accession is None:
            continue
        described = None
        review_status = None
        last_evaluated = None
        pmids: list[str] = []
        if classification is not None:
            last_evaluated = classification.get("DateLastEvaluated")
            review_status = classification.findtext("ReviewStatus")
            for tag in ("GermlineClassification", "SomaticClinicalImpact", "OncogenicityClassification"):
                described = classification.findtext(tag)
                if described:
                    break
            pmids = [
                node.text
                for node in classification.findall("Citation/ID")
                if node.get("Source") == "PubMed" and node.text
            ]
        submissions.append(
            {
                "scv": accession.get("Accession"),
                "version": accession.get("Version"),
                "submitter": accession.get("SubmitterName"),
                "classification": described,
                "review_status": review_status,
                "last_evaluated": last_evaluated,
                "date_updated": accession.get("DateUpdated"),
                "method": next(
                    (
                        node.text
                        for node in assertion.findall("AttributeSet/Attribute")
                        if node.get("Type") == "AssertionMethod"
                    ),
                    None,
                ),
                "origins": sorted({node.text for node in assertion.iter("Origin") if node.text}),
                "contributes_to_aggregate": assertion.get("ContributesToAggregateClassification") == "true",
                "pmids": pmids,
            }
        )
    return submissions


class ClinVarSource(SourceAdapter):
    id = "clinvar"
    name = "ClinVar"
    base_url = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
    homepage = "https://www.ncbi.nlm.nih.gov/clinvar/"
    license = "LicenseRef-NCBI-Public-Domain"
    license_url = "https://www.ncbi.nlm.nih.gov/home/about/policies/"
    timeout = 25.0
    # 3 requests per second without an API key
    rate_limit_per_second = 2.5
    max_concurrency = 2

    def __init__(self) -> None:
        super().__init__()
        # Batches E-utilities refused for their size: split at once instead of asking again
        self._refused_batches: set[str] = set()

    def default_params(self) -> dict[str, Any]:
        settings = self.settings
        return {"tool": "helix", "email": settings.contact_email, "api_key": settings.ncbi_api_key}

    def payload_error(self, payload: Any) -> str | None:
        if not isinstance(payload, dict):
            return None
        if payload.get("error"):
            return str(payload["error"])
        failure = (payload.get("eutilsresult") or {}).get("ERROR")
        return str(failure) if failure else None

    def record_url(self, record_id: str) -> str | None:
        return f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{record_id}/"

    async def release_date(self) -> SourceResult[str]:
        """Date of the ClinVar build served by E-utilities, e.g. 2026-09-29."""
        raw = await self.get_json("/einfo.fcgi", params={"db": "clinvar", "retmode": "json"}, ttl=6 * 3600)
        return raw.map(lambda payload: _date(payload["einforesult"]["dbinfo"][0]["lastupdate"]))

    async def search(self, term: str, *, limit: int = MAX_GENE_RECORDS) -> SourceResult[dict[str, Any]]:
        raw = await self.get_json(
            "/esearch.fcgi",
            params={"db": "clinvar", "term": term, "retmode": "json", "retmax": limit},
        )
        return raw.map(
            lambda payload: {
                "count": int(payload["esearchresult"]["count"]),
                "ids": list(payload["esearchresult"].get("idlist") or []),
            }
        )

    async def summaries(self, variation_ids: list[str]) -> SourceResult[list[dict[str, Any]]]:
        """Parsed esummary records for up to SUMMARY_BATCH_SIZE Variation IDs."""
        raw = await self.post_json(
            "/esummary.fcgi",
            form={"db": "clinvar", "retmode": "json", "id": ",".join(variation_ids)},
            timeout=40.0,
        )

        def parse(payload: Any) -> list[dict[str, Any]]:
            result = payload["result"]
            return [
                parse_summary(result[uid])
                for uid in result.get("uids") or []
                if uid in result and not result[uid].get("error")
            ]

        return raw.map(parse)

    async def _summaries_split(self, variation_ids: list[str]) -> SourceResult[list[dict[str, Any]]]:
        """Summaries of a batch, halving it when E-utilities refuses the response size (records
        of large copy-number variants run to megabytes each)."""
        batch = ",".join(variation_ids)
        result = None if batch in self._refused_batches else await self.summaries(variation_ids)
        if result is not None:
            if result.answered or len(variation_ids) == 1:
                return result
            if result.status_code == 200:
                self._refused_batches.add(batch)
        middle = len(variation_ids) // 2
        halves = await asyncio.gather(
            self._summaries_split(variation_ids[:middle]), self._summaries_split(variation_ids[middle:])
        )
        answered = [half for half in halves if half.answered]
        if not answered:
            return result if result is not None else halves[0]
        return replace(
            answered[0],
            state=SourceState.OK,
            data=[record for half in answered for record in half.data or []],
        )

    async def records(self, term: str, *, limit: int = MAX_GENE_RECORDS) -> SourceResult[dict[str, Any]]:
        """Search, then load every summary. Data: {count, records, release}. The provenance is the
        search request, with the ClinVar build date as release."""
        found, release = await asyncio.gather(self.search(term, limit=limit), self.release_date())
        if not found.ok or found.data is None:
            return found
        ids = found.data["ids"]
        if not ids:
            return replace(found, state=SourceState.EMPTY, data={"count": 0, "records": [], "release": release.data})
        batches = await asyncio.gather(
            *(
                self._summaries_split(ids[index : index + SUMMARY_BATCH_SIZE])
                for index in range(0, len(ids), SUMMARY_BATCH_SIZE)
            )
        )
        failed = next((batch for batch in batches if not batch.answered), None)
        if failed is not None:
            return failed
        records = [record for batch in batches for record in batch.data or []]
        provenance = found.provenance
        if provenance is not None and release.data:
            provenance = provenance.model_copy(update={"release": release.data})
        return replace(
            found,
            data={"count": found.data["count"], "records": records, "release": release.data},
            provenance=provenance,
        )

    async def gene_records(self, symbol: str) -> SourceResult[dict[str, Any]]:
        """Every ClinVar record of a gene. A gene with more than MAX_GENE_RECORDS records is loaded
        as its pathogenic and likely pathogenic records only, with truncated set."""
        result = await self.records(f"{symbol}[gene]")
        if result.ok and result.data and result.data["count"] > MAX_GENE_RECORDS:
            total = result.data["count"]
            result = await self.records(f"{symbol}[gene] AND {PATHOGENIC_TERM}")
            if result.data is not None:
                result.data["truncated"] = True
                result.data["gene_total"] = total
        return result

    async def protein_change_records(self, symbol: str, hgvs_p: str) -> SourceResult[dict[str, Any]]:
        return await self.records(f'{symbol}[gene] AND "{hgvs_p}"[Variant name]', limit=50)

    async def variation_records(self, variation_ids: list[str]) -> SourceResult[dict[str, Any]]:
        summaries, release = await asyncio.gather(self.summaries(variation_ids), self.release_date())
        if not summaries.ok:
            return summaries  # type: ignore[return-value]
        provenance = summaries.provenance
        if provenance is not None and release.data:
            provenance = provenance.model_copy(update={"release": release.data})
        return replace(
            summaries,  # type: ignore[arg-type]
            data={"count": len(summaries.data or []), "records": summaries.data, "release": release.data},
            provenance=provenance,
        )

    async def rsid_records(self, rsid: str) -> SourceResult[dict[str, Any]]:
        return await self.records(rsid, limit=50)

    async def submissions(self, variation_id: str) -> SourceResult[list[dict[str, Any]]]:
        """Submitter-level classifications from the VCV XML record."""
        raw = await self.get_text(
            "/efetch.fcgi",
            params={"db": "clinvar", "rettype": "vcv", "is_variationid": "", "id": variation_id},
            record_id=variation_id,
        )
        return raw.map(parse_vcv_xml)


clinvar = ClinVarSource()
