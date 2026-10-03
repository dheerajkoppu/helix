"""Retrieval tools over the Helix API. Every fact carries the database record it came from."""

import re
from typing import Any

from helix_lab_tools.context import LabToolError, respond
from helix_lab_tools.http import get_json
from helix_lab_tools.sources import database_name, fact, fact_from_evidence, remember_facts, source

STARTING_EVIDENCE_KINDS = ("pathogenicity", "conservation", "language_model_llr")
MUTATION = re.compile(r"^[A-Z](\d+)[A-Z*]$")


def _clip(text: str | None, limit: int) -> str:
    text = " ".join((text or "").split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _first(evidence: Any) -> dict[str, Any] | None:
    if isinstance(evidence, list):
        return evidence[0] if evidence else None
    return evidence if isinstance(evidence, dict) else None


def _search_entities(query: str) -> dict[str, Any]:
    payload = get_json("/search", {"q": query, "limit": 6})
    results = []
    for group in payload.get("groups", []):
        for row in group.get("results", [])[:4]:
            results.append(
                {
                    "type": row.get("type"),
                    "id": row.get("id"),
                    "label": row.get("label"),
                    "description": _clip(row.get("description"), 140),
                    "gene": row.get("gene_symbol"),
                    "accession": row.get("accession"),
                }
            )
    top = payload.get("top") or {}
    return {
        "query": query,
        "top": {"type": top.get("type"), "id": top.get("id"), "label": top.get("label")},
        "results": results,
    }


def search_entities(query: str) -> str:
    """Resolve free text to Helix entities: disease, gene, protein, variant, structure or paper.

    Args:
        query: Text such as "BTK R28H", "XLA" or "Q06187".
    """
    return respond(_search_entities, query)


def _get_gene(symbol: str) -> dict[str, Any]:
    payload = get_json(f"/genes/{symbol}")
    facts = []
    for disease in payload.get("diseases", [])[:4]:
        origin = next(
            (row for row in disease.get("sources", []) if row.get("source_id", "").startswith("iuis")), None
        )
        if origin is None:
            continue
        inheritance = ", ".join(
            term["label"] for term in disease.get("inheritance_terms", [])
        ) or disease.get("inheritance_raw")
        facts.append(
            fact(
                f"{symbol} is the gene of the inborn error of immunity '{disease['name']}' "
                f"({disease.get('category_name')}; {inheritance}).",
                "curated_database",
                "IUIS expert committee classification",
                "IUIS 2024 classification",
                f"{origin.get('record_id')} ({disease['id']})",
                origin.get("url"),
            )
        )
    statistics = {row["key"]: row["value"] for row in payload.get("statistics", [])}
    protein = payload.get("protein") or {}
    return remember_facts(
        {
            "symbol": payload.get("symbol"),
            "name": payload.get("name"),
            "hgnc_id": payload.get("hgnc_id"),
            "uniprot_accession": payload.get("uniprot_accession"),
            "location": payload.get("location"),
            "protein_length": protein.get("length"),
            "statistics": statistics,
            "facts": facts,
        },
        "get_gene",
    )


def get_gene(symbol: str) -> str:
    """Gene record: identifiers, the inborn errors of immunity it causes, and counts of variants and structures.

    Args:
        symbol: HGNC gene symbol, for example BTK.
    """
    return respond(_get_gene, symbol)


def _get_protein(accession: str) -> dict[str, Any]:
    payload = get_json(f"/proteins/{accession}")
    provenance = payload.get("provenance") or {}
    url = provenance.get("record_url") or f"https://www.uniprot.org/uniprotkb/{accession}/entry"
    facts = []
    function = payload.get("function") or []
    if function:
        facts.append(
            fact(
                f"UniProtKB function of {payload.get('entry_name')}: {_clip(function[0].get('text'), 420)}",
                "curated_database",
                "reviewed UniProtKB entry" if payload.get("reviewed") else "unreviewed UniProtKB entry",
                "uniprot",
                accession,
                url,
            )
        )
    for row in (payload.get("subunit") or [])[:1]:
        facts.append(
            fact(
                f"UniProtKB subunit annotation: {_clip(row.get('text'), 380)}",
                "curated_database",
                "reviewed UniProtKB entry" if payload.get("reviewed") else "unreviewed UniProtKB entry",
                "uniprot",
                accession,
                url,
            )
        )
    domains = []
    for track in payload.get("tracks", []):
        if track.get("id") != "domains":
            continue
        for feature in track.get("features", []):
            domains.append(
                {"name": feature.get("description"), "start": feature.get("start"), "end": feature.get("end")}
            )
    names = payload.get("names") or {}
    return remember_facts(
        {
            "accession": accession,
            "name": names.get("recommended"),
            "gene": (payload.get("gene") or {}).get("id"),
            "length": (payload.get("sequence") or {}).get("length")
            if isinstance(payload.get("sequence"), dict)
            else None,
            "domains": domains,
            "catalytic_activity": [
                _clip(row.get("text"), 160) for row in (payload.get("catalytic_activity") or [])[:2]
            ],
            "subcellular_locations": [
                row.get("location") for row in (payload.get("subcellular_locations") or [])[:5]
            ],
            "facts": facts,
        },
        "get_protein",
    )


def get_protein(accession: str) -> str:
    """Protein entry from UniProtKB: function, domains with residue ranges, catalytic activity and locations.

    Args:
        accession: UniProt accession, for example Q06187.
    """
    return respond(_get_protein, accession)


def _get_variant(variant_id: str) -> dict[str, Any]:
    payload = get_json(f"/variants/{variant_id}")
    facts = []
    clinvar = payload.get("clinvar")
    if clinvar:
        conditions = ", ".join(
            row.get("name", "") for row in clinvar.get("conditions", [])[:3] if isinstance(row, dict)
        )
        summary = clinvar.get("submission_summary") or {}
        statement = (
            f"ClinVar classifies {clinvar.get('title')} as {clinvar.get('classification')} "
            f"({clinvar.get('review_status')}; {clinvar.get('review_stars')} of 4 stars; "
            f"{summary.get('scv_count')} submissions; last evaluated {clinvar.get('last_evaluated')})"
            + (f" for {conditions}." if conditions else ".")
        )
        built = fact_from_evidence(statement, clinvar.get("evidence"), url=clinvar.get("url"))
        if built:
            facts.append(built)
    uniprot = payload.get("uniprot")
    if uniprot:
        statement = (
            f"UniProtKB natural variant {uniprot.get('feature_id')} at residue {uniprot.get('position')} "
            f"({uniprot.get('wild_type')} to {uniprot.get('mutated_type')}): {'; '.join(uniprot.get('descriptions', [])[:4])}. "
            f"{len(uniprot.get('pmids', []))} publications cited."
        )
        built = fact_from_evidence(statement, uniprot.get("evidence"), url=uniprot.get("url"))
        if built:
            facts.append(built)
    gnomad = payload.get("gnomad") or {}
    for allele in gnomad.get("alleles", [])[:1]:
        counts = allele.get("exome") or allele.get("genome") or {}
        statement = (
            f"{gnomad.get('dataset')}: allele {allele.get('variant_id')} observed {counts.get('allele_count')} times in "
            f"{counts.get('allele_number')} alleles (frequency {counts.get('allele_frequency'):.2e}; "
            f"{counts.get('hemizygote_count')} hemizygotes, {counts.get('homozygote_count')} homozygotes)."
            if counts.get("allele_frequency") is not None
            else f"{gnomad.get('dataset')}: allele {allele.get('variant_id')} is listed."
        )
        built = fact_from_evidence(statement, allele.get("evidence"), url=allele.get("url"))
        if built:
            facts.append(built)
    if gnomad.get("status") and not gnomad.get("alleles"):
        facts_note = gnomad.get("label")
    else:
        facts_note = None
    vep = payload.get("vep")
    if vep:
        built = fact_from_evidence(
            f"Ensembl VEP predicts {vep.get('most_severe_consequence')} for {vep.get('hgvsc')} "
            f"({vep.get('hgvsp')}; exon {vep.get('exon')}; MANE Select {vep.get('mane_select')}).",
            vep.get("evidence"),
            url="https://rest.ensembl.org/documentation/info/vep_hgvs_get",
        )
        if built:
            facts.append(built)
    check = payload.get("reference_check") or {}
    return remember_facts(
        {
            "variant_id": payload.get("id"),
            "gene": (payload.get("gene") or {}).get("id"),
            "accession": (payload.get("protein") or {}).get("id"),
            "protein_change": payload.get("protein_change"),
            "position": payload.get("position"),
            "reference_residue": payload.get("reference_residue"),
            "alternate_residue": payload.get("alternate_residue"),
            "consequence": payload.get("consequence"),
            "hgvs_c": (payload.get("hgvs") or {}).get("c"),
            "reference_matches_uniprot": check.get("status") == "match",
            "gnomad_note": facts_note,
            "facts": facts,
        },
        "get_variant",
    )


def get_variant(variant_id: str) -> str:
    """One variant: ClinVar classification, UniProtKB variant annotation, gnomAD frequency and predicted consequence.

    Args:
        variant_id: Helix variant ID, for example BTK-p.Arg28His.
    """
    return respond(_get_variant, variant_id)


def _list_variants_near(gene: str, position: int, window: int) -> dict[str, Any]:
    window = max(0, min(int(window), 15))
    payload = get_json(
        f"/genes/{gene}/variants",
        {
            "residue_start": max(1, position - window),
            "residue_end": position + window,
            "limit": 60,
            "sort": "position",
        },
        timeout=120,
    )
    rows = []
    facts = []
    for item in payload.get("items", []):
        if item.get("change_kind") != "substitution" or not item.get("position"):
            continue
        row = {
            "variant_id": item.get("id"),
            "position": item.get("position"),
            "change": item.get("protein_change_short"),
            "significance": item.get("clinical_significance"),
            "stars": item.get("review_stars"),
        }
        rows.append(row)
        if item.get("position") == position and item.get("vcv"):
            facts.append(
                fact(
                    f"ClinVar lists {item.get('name')} at the same residue as {item.get('clinical_significance')} "
                    f"({item.get('review_status')}).",
                    "clinical_database",
                    f"{item.get('review_stars')} of 4 review stars",
                    "clinvar",
                    item.get("vcv_version") or item["vcv"],
                    f"https://www.ncbi.nlm.nih.gov/clinvar/variation/{item.get('variation_id')}/",
                )
            )
    same = [row for row in rows if row["position"] == position]
    return remember_facts(
        {
            "gene": gene,
            "window": [max(1, position - window), position + window],
            "filter": "ClinVar pathogenic or likely pathogenic substitutions and UniProtKB disease variants",
            "substitutions_in_window": len(rows),
            "at_same_residue": same,
            "neighbours": [row for row in rows if row["position"] != position][:20],
            "facts": facts[:6],
        },
        "list_variants_near",
    )


def list_variants_near(gene: str, position: int, window: int = 5) -> str:
    """Disease substitutions reported at the residue and within a window around it.

    Args:
        gene: HGNC gene symbol.
        position: Residue position, UniProt numbering.
        window: Residues on each side to include, 0 to 15.
    """
    return respond(_list_variants_near, gene, position, window)


def _get_residue_annotations(accession: str, position: int) -> dict[str, Any]:
    payload = get_json(f"/proteins/{accession}/residues/{position}")
    features = []
    facts = []
    for track in payload.get("tracks", []):
        for feature in track.get("features", []):
            evidence = _first(feature.get("evidence"))
            ligand = feature.get("ligand") or {}
            label = feature.get("type") or track.get("label")
            description = feature.get("description") or ligand.get("name") or ""
            span = (
                f"{feature.get('start')}-{feature.get('end')}"
                if feature.get("start") != feature.get("end")
                else str(feature.get("start"))
            )
            pmids = [row.get("pmid") for row in (evidence or {}).get("citations", []) if row.get("pmid")]
            features.append(
                {"type": label, "residues": span, "description": _clip(description, 120), "pmids": pmids[:4]}
            )
            if track.get("id") in ("chains", "natural_variants") or not evidence:
                continue
            eco = (evidence.get("eco") or {}).get("label")
            statement = (
                f"{database_name(evidence['source'].get('database'))} annotates residues {span} of {accession} "
                f"as {label}{': ' + description if description else ''}"
                + (
                    f" (ligand {ligand.get('name')}, {ligand.get('id')})"
                    if ligand.get("name") and ligand.get("name") != description
                    else ""
                )
                + (f"; evidence: {eco}" if eco else "")
                + (f"; PubMed {', '.join(pmids[:3])}" if pmids else "")
                + "."
            )
            built = fact_from_evidence(statement, evidence)
            if built:
                facts.append(built)
    return remember_facts(
        {
            "accession": accession,
            "position": position,
            "amino_acid": payload.get("amino_acid_three"),
            "sequence_window": payload.get("window"),
            "window_start": payload.get("window_start"),
            "features": features,
            "facts": facts,
        },
        "get_residue_annotations",
    )


def get_residue_annotations(accession: str, position: int) -> str:
    """Every UniProtKB and InterPro annotation covering one residue: domain, binding site, active site, region, secondary structure.

    Args:
        accession: UniProt accession.
        position: Residue position, UniProt numbering.
    """
    return respond(_get_residue_annotations, accession, position)


def _get_variant_effect_values(accession: str, position: int, alternate: str) -> dict[str, Any]:
    payload = get_json(f"/proteins/{accession}/residues/{position}/effects", {"alt": alternate}, timeout=120)
    values = []
    facts = []
    for group in payload.get("groups", []):
        for value in group.get("values", []):
            if value.get("kind") not in STARTING_EVIDENCE_KINDS:
                continue
            row = {
                "key": value.get("key"),
                "label": value.get("label"),
                "state": value.get("state"),
                "value": value.get("value"),
                "class": value.get("class_label") or value.get("normalized_class"),
                "scale": value.get("scale"),
            }
            values.append(row)
            if value.get("state") != "ok" or value.get("value") is None:
                continue
            classification = f", classed as {row['class']}" if row["class"] else ""
            built = fact_from_evidence(
                f"{value.get('tool')} gives {payload.get('hgvs_p')} of {accession} a {value.get('label')} of "
                f"{value.get('value')}{classification} (scale: {value.get('scale')}).",
                value.get("evidence"),
            )
            if built:
                built["strength"] = "computational prediction, not validated for clinical use"
                facts.append(built)
    assays = [row for row in payload.get("mave_score_sets", []) if row.get("covers_residue")]
    return remember_facts(
        {
            "accession": accession,
            "position": position,
            "substitution": payload.get("hgvs_p"),
            "values": values,
            "functional_assays_covering_residue": len(assays),
            "not_included": (
                "Structure-based measurements (stability change, pocket, interface, ligand contact, structure "
                "comparison) are tests the runner executes; they are not part of the starting evidence."
            ),
            "facts": facts,
        },
        "get_variant_effect_values",
    )


def get_variant_effect_values(accession: str, position: int, alternate: str) -> str:
    """Pathogenicity and conservation predictions for one substitution: AlphaMissense, popEVE, EVE, conservation.

    Args:
        accession: UniProt accession.
        position: Residue position, UniProt numbering.
        alternate: One-letter code of the variant amino acid, for example H.
    """
    return respond(_get_variant_effect_values, accession, position, alternate)


def covering_structures(accession: str, position: int) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The structure ledger of a protein and its experimental entries that observe the residue."""
    payload = get_json(f"/proteins/{accession}/structures", timeout=150)
    covering = []
    for entry in payload.get("experimental", []):
        ranges = ((entry.get("structure") or {}).get("coverage") or {}).get("ranges") or []
        if any(row.get("start", 0) <= position <= row.get("end", -1) for row in ranges):
            covering.append(entry)
    return payload, covering


def site_mutation(entry: dict[str, Any], position: int) -> str | None:
    for row in entry.get("engineered_mutations", []):
        for mutation in row.get("mutations", []):
            match = MUTATION.match(mutation)
            if match and int(match.group(1)) == position:
                return mutation
    return None


def _get_structure_ledger(accession: str, position: int) -> dict[str, Any]:
    payload, covering = covering_structures(accession, position)
    experimental = payload.get("experimental", [])
    rows = []
    ligand_index: dict[str, dict[str, Any]] = {}
    for entry in covering:
        structure = entry["structure"]
        identifier = structure["id"].split(":")[-1]
        ligands = [row for row in entry.get("ligands", []) if not row.get("common_additive")]
        for ligand in ligands:
            indexed = ligand_index.setdefault(
                ligand["comp_id"],
                {"ligand": ligand["comp_id"], "name": _clip(ligand.get("name"), 60), "structures": []},
            )
            indexed["structures"].append(identifier)
        rows.append(
            {
                "pdb_id": identifier,
                "title": _clip(structure.get("title"), 90),
                "method": structure.get("method"),
                "resolution": structure.get("resolution"),
                "deposited": entry.get("deposit_date"),
                "ligands": [row["comp_id"] for row in ligands][:5],
                "residue_mutated_in_structure": site_mutation(entry, position),
            }
        )
    best = sorted(rows, key=lambda row: row["resolution"] or 99)[:4]
    earliest = sorted(rows, key=lambda row: row["deposited"] or "9999")[:4]
    listed = []
    for row in [*best, *earliest]:
        if row not in listed:
            listed.append(row)
    facts = [
        fact(
            f"{len(covering)} of {len(experimental)} experimental structures of {accession} in the Protein Data Bank "
            f"observe residue {position}.",
            "experimental",
            "PDBe SIFTS residue-level mapping",
            "pdbe",
            accession,
            f"https://www.ebi.ac.uk/pdbe/pdbe-kb/proteins/{accession}",
        )
    ]
    for row in listed:
        facts.append(
            fact(
                f"PDB entry {row['pdb_id']} ({row['method']}, {row['resolution']} Å, deposited {row['deposited']}) observes "
                f"residue {position} of {accession}: {row['title']}"
                + (f"; ligands {', '.join(row['ligands'])}" if row["ligands"] else "; no non-solvent ligand")
                + (
                    f"; the residue is mutated in this entry ({row['residue_mutated_in_structure']})"
                    if row["residue_mutated_in_structure"]
                    else ""
                )
                + ".",
                "experimental",
                f"{row['method']}, {row['resolution']} Å",
                "rcsb",
                row["pdb_id"],
                f"https://www.rcsb.org/structure/{row['pdb_id']}",
            )
        )
    predicted = (payload.get("predicted_external") or [{}])[0]
    confidence = predicted.get("confidence") or {}
    if predicted.get("source_id"):
        facts.append(
            fact(
                f"AlphaFold DB model {predicted['source_id']} covers the full sequence of {accession} "
                f"(mean pLDDT {confidence.get('plddt_mean')}).",
                "computational_prediction",
                f"mean pLDDT {confidence.get('plddt_mean')}",
                "afdb",
                predicted["source_id"],
                predicted.get("source_url"),
            )
        )
    index = sorted(ligand_index.values(), key=lambda row: -len(row["structures"]))
    return remember_facts(
        {
            "accession": accession,
            "position": position,
            "experimental_structures_total": len(experimental),
            "experimental_structures_observing_residue": len(covering),
            "of_those_with_the_reference_residue": sum(
                1 for row in rows if not row["residue_mutated_in_structure"]
            ),
            "of_those_with_the_residue_mutated": sum(
                1 for row in rows if row["residue_mutated_in_structure"]
            ),
            "examples_only": f"{len(listed)} of {len(rows)} entries are shown: the four best-resolved and the four earliest deposited. Counts above and the ligand list below cover all {len(rows)}.",
            "example_structures": listed,
            "ligands_across_all_observing_structures": [
                {
                    "ligand": row["ligand"],
                    "name": row["name"],
                    "structures": len(row["structures"]),
                    "example": row["structures"][0],
                }
                for row in index[:12]
            ],
            "distinct_ligands": len(index),
            "predicted_model": {"id": predicted.get("id"), "mean_plddt": confidence.get("plddt_mean")},
            "note": "Which residues a ligand touches is not part of the ledger; the ligand contact test measures it.",
            "facts": facts,
        },
        "get_structure_ledger",
    )


def get_structure_ledger(accession: str, position: int) -> str:
    """Structures of a protein that observe one residue: experimental entries with method, resolution and ligands, and the predicted model.

    Args:
        accession: UniProt accession.
        position: Residue position, UniProt numbering.
    """
    return respond(_get_structure_ledger, accession, position)


def _get_interactions(accession: str) -> dict[str, Any]:
    payload = get_json(f"/proteins/{accession}/interactions", timeout=120)
    curated = payload.get("curated") or {}
    partners = sorted(curated.get("partners", []), key=lambda row: -(row.get("evidence_count") or 0))
    rows = []
    facts = []
    for partner in partners[:8]:
        rows.append(
            {
                "partner": partner.get("partner_symbol") or partner.get("partner_id"),
                "accession": partner.get("partner_id"),
                "evidence_count": partner.get("evidence_count"),
                "mi_score": partner.get("mi_score"),
                "methods": [row.get("label") for row in partner.get("methods", [])[:3]],
            }
        )
    for partner in partners[:3]:
        identifier = (partner.get("interaction_acs") or [None])[0]
        if not identifier:
            continue
        facts.append(
            fact(
                f"IntAct curates a physical interaction of {accession} with {partner.get('partner_symbol')} "
                f"({partner.get('evidence_count')} experiments; MI score {partner.get('mi_score')}; "
                f"{', '.join(row.get('label', '') for row in partner.get('methods', [])[:2])}). "
                "The interaction surface is not mapped to residues in this record.",
                "experimental",
                f"IntAct MI score {partner.get('mi_score')}",
                "intact",
                identifier,
                partner.get("url"),
            )
        )
    return remember_facts(
        {
            "accession": accession,
            "curated_partners": len(curated.get("partners", [])),
            "top_partners": rows,
            "note": "IntAct rows do not say which residues form the interface.",
            "facts": facts,
        },
        "get_interactions",
    )


def get_interactions(accession: str) -> str:
    """Curated protein-protein interactions of a protein from IntAct, strongest first.

    Args:
        accession: UniProt accession.
    """
    return respond(_get_interactions, accession)


def _publication_row(item: dict[str, Any], abstract_limit: int) -> dict[str, Any]:
    return {
        "pmid": item.get("pmid"),
        "title": _clip(item.get("title"), 200),
        "journal": item.get("journal_abbreviation") or item.get("journal"),
        "year": item.get("year"),
        "cited_by": item.get("cited_by_count"),
        "is_review": item.get("is_review"),
        "matched": [row.get("label") for row in item.get("relevance", [])],
        "abstract": _clip(item.get("abstract"), abstract_limit),
        "source": source("europepmc", f"PMID:{item.get('pmid')}", item.get("url") or item.get("pubmed_url")),
    }


def _search_literature(gene: str, variant_id: str | None, query: str | None, limit: int) -> dict[str, Any]:
    limit = max(1, min(int(limit), 10))
    payload = get_json(
        "/literature",
        {
            "gene": gene,
            "variant": variant_id or None,
            "q": query or None,
            "page_size": limit,
            "sort": "relevance",
        },
        timeout=120,
    )
    rows = [_publication_row(item, 420) for item in payload.get("items", []) if item.get("pmid")]
    return remember_facts(
        {
            "database": "Europe PMC",
            "query_url": payload.get("query_url"),
            "total": payload.get("total"),
            "publications": rows,
            "sources": [row["source"] for row in rows],
            "how_to_cite": "Record evidence with evidence_class literature, database Europe PMC and record_id PMID:<pmid>.",
        },
        "search_literature",
    )


def search_literature(
    gene: str, variant_id: str | None = None, query: str | None = None, limit: int = 6
) -> str:
    """Search Europe PMC for publications on a gene, optionally narrowed to a variant or to free text.

    Args:
        gene: HGNC gene symbol.
        variant_id: Helix variant ID to narrow the search to papers naming the variant.
        query: Extra free-text terms, for example "PH domain inositol phosphate binding".
        limit: Number of publications to return, 1 to 10.
    """
    return respond(_search_literature, gene, variant_id, query, limit)


def _get_publication(pmid: str) -> dict[str, Any]:
    identifier = str(pmid).upper().replace("PMID:", "").strip()
    if not identifier.isdigit():
        raise LabToolError("pmid must be a PubMed identifier, digits only.")
    payload = get_json(f"/literature/{identifier}")
    row = _publication_row(payload.get("publication") or {}, 1800)
    row["authors"] = (payload.get("publication") or {}).get("author_string")
    return remember_facts({**row, "sources": [row["source"]]}, "get_publication")


def get_publication(pmid: str) -> str:
    """One publication with its full abstract.

    Args:
        pmid: PubMed identifier.
    """
    return respond(_get_publication, pmid)


def _get_job_status(job_id: str) -> dict[str, Any]:
    payload = get_json(f"/jobs/{job_id}")
    return {
        "job_id": payload.get("id"),
        "kind": payload.get("kind"),
        "status": payload.get("status"),
        "stages": [{"id": row.get("id"), "status": row.get("status")} for row in payload.get("stages", [])],
        "error": payload.get("error"),
        "created_at": payload.get("created_at"),
        "finished_at": payload.get("finished_at"),
        "manifest_url": payload.get("manifest_url") or f"/api/v1/jobs/{job_id}/manifest",
    }


def get_job_status(job_id: str) -> str:
    """Status, stages and manifest location of an Helix computational job.

    Args:
        job_id: Job ID, starting with job_.
    """
    return respond(_get_job_status, job_id)


def comparison_summary(job_id: str) -> dict[str, Any]:
    payload = get_json(f"/compare/results/{job_id}", timeout=120)
    summary = payload.get("summary") or (payload.get("difference") or {}).get("summary") or {}
    return {
        "job_id": job_id,
        "origin": payload.get("origin"),
        "label": payload.get("label"),
        "construct": {
            key: (payload.get("construct") or {}).get(key)
            for key in ("start", "end", "length", "rule", "full_length")
        },
        "provider": {
            key: (payload.get("provider") or {}).get(key)
            for key in ("id", "model_name", "model_version", "performs_inference", "deterministic")
        },
        "summary": summary,
        "caveats": [_clip(row.get("text"), 200) for row in payload.get("caveats", [])[:4]],
    }


def get_comparison_result(job_id: str) -> str:
    """Geometric difference between the reference and variant models of a finished variant_comparison job.

    Args:
        job_id: Job ID of the comparison.
    """
    return respond(comparison_summary, job_id)
