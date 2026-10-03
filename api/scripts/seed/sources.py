"""Registry of every source the seed build reads: where it lives, its licence and how to credit it."""

from __future__ import annotations

from dataclasses import dataclass

IUIS_PMCID = "PMC12829761"
IUIS_FALLBACK_URL = (
    f"https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pmc&id={IUIS_PMCID}&rettype=xml"
)
HPO_RELEASE = "https://github.com/obophenotype/human-phenotype-ontology/releases/latest/download"
MONDO_MAPPINGS = "https://raw.githubusercontent.com/monarch-initiative/mondo/master/src/ontology/mappings"
ORPHADATA_NOTICE = (
    "Orphadata Science: Free access data from Orphanet. © INSERM 1999. "
    "Available on http://sciences.orphadata.com/. Data version {release}. Modified: subset, reformatted."
)


@dataclass(frozen=True)
class Source:
    id: str
    name: str
    url: str
    license: str
    license_url: str
    citation: str
    used_for: str
    file_name: str | None = None


SOURCES: tuple[Source, ...] = (
    Source(
        id="iuis_2024",
        name="IUIS classification of human inborn errors of immunity, 2024 update",
        url=f"https://www.ebi.ac.uk/europepmc/webservices/rest/{IUIS_PMCID}/fullTextXML",
        license="CC BY-ND 4.0",
        license_url="https://creativecommons.org/licenses/by-nd/4.0/",
        citation=(
            "Poli MC, Aksentijevich I, Bousfiha AA, et al. Human inborn errors of immunity: 2024 update on "
            "the classification from the International Union of Immunological Societies Expert Committee. "
            "J Hum Immun. 2025;1(1):e20250003. doi:10.70962/jhi.20250003"
        ),
        used_for=(
            "Table and subtable, disease label, gene, inheritance code and OMIM number of every entry. "
            "The article's tables and clinical text are not redistributed."
        ),
        file_name=f"{IUIS_PMCID}.jats.xml",
    ),
    Source(
        id="hgnc",
        name="HGNC complete gene set",
        url="https://storage.googleapis.com/public-download-files/hgnc/tsv/tsv/hgnc_complete_set.txt",
        license="CC0 1.0",
        license_url="https://www.genenames.org/about/license/",
        citation="HUGO Gene Nomenclature Committee (HGNC), https://www.genenames.org",
        used_for="Symbol normalisation; HGNC, Ensembl, NCBI Gene and UniProt identifiers; gene name.",
        file_name="hgnc_complete_set.txt",
    ),
    Source(
        id="gencc",
        name="Gene Curation Coalition (GenCC) submissions",
        url="https://search.thegencc.org/download/action/submissions-export-tsv",
        license="CC0 1.0",
        license_url="https://thegencc.org/terms",
        citation="The Gene Curation Coalition (GenCC), https://thegencc.org",
        used_for="Gene to MONDO disease candidates with validity classification and mode of inheritance.",
        file_name="gencc_submissions.tsv",
    ),
    Source(
        id="clingen",
        name="ClinGen gene-disease validity curations",
        url="https://search.clinicalgenome.org/kb/gene-validity/download",
        license="CC0 1.0",
        license_url="https://clinicalgenome.org/docs/terms-of-use/",
        citation=(
            "Clinical Genome Resource, https://clinicalgenome.org (accessed {retrieved}). "
            "Rehm HL et al., N Engl J Med (2015)."
        ),
        used_for="Disease entity chosen by the immunology expert panels for a gene and mode of inheritance.",
        file_name="gene-validity.csv",
    ),
    Source(
        id="mondo",
        name="Mondo Disease Ontology",
        url="http://purl.obolibrary.org/obo/mondo.obo",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        citation="Mondo. Vasilevsky NA et al., Genetics 232(4):iyaf215 (2026). Modified: subset.",
        used_for="Disease labels, synonyms, definitions, hierarchy and germline gene links.",
        file_name="mondo.obo",
    ),
    Source(
        id="mondo_sssom_omim",
        name="Mondo exact mappings to OMIM (SSSOM)",
        url=f"{MONDO_MAPPINGS}/mondo_exactmatch_omim.sssom.tsv",
        license="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        citation="Mondo Disease Ontology mapping set mondo_exactmatch_omim.sssom.tsv",
        used_for="Exact OMIM phenotype number to MONDO identifier mapping.",
        file_name="mondo_exactmatch_omim.sssom.tsv",
    ),
    Source(
        id="mondo_sssom_orphanet",
        name="Mondo exact mappings to Orphanet (SSSOM)",
        url=f"{MONDO_MAPPINGS}/mondo_exactmatch_orphanet.sssom.tsv",
        license="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        citation="Mondo Disease Ontology mapping set mondo_exactmatch_orphanet.sssom.tsv",
        used_for="Exact ORPHAcode to MONDO identifier mapping.",
        file_name="mondo_exactmatch_orphanet.sssom.tsv",
    ),
    Source(
        id="orphadata_product1",
        name="Orphadata: rare diseases and cross-references (product 1)",
        url="https://www.orphadata.com/data/xml/en_product1.xml",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/legalcode",
        citation=ORPHADATA_NOTICE,
        used_for="Disease names, synonyms, definitions and exact OMIM and MONDO cross-references.",
        file_name="en_product1.xml",
    ),
    Source(
        id="orphadata_product4",
        name="Orphadata: phenotypes associated with rare disorders (product 4)",
        url="https://www.orphadata.com/data/xml/en_product4.xml",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/legalcode",
        citation=ORPHADATA_NOTICE,
        used_for="HPO phenotypes with frequency per disorder.",
        file_name="en_product4.xml",
    ),
    Source(
        id="orphadata_product6",
        name="Orphadata: genes associated with rare diseases (product 6)",
        url="https://www.orphadata.com/data/xml/en_product6.xml",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/legalcode",
        citation=ORPHADATA_NOTICE,
        used_for="Germline disease-causing gene associations of each disorder.",
        file_name="en_product6.xml",
    ),
    Source(
        id="orphadata_product9_ages",
        name="Orphadata: natural history of rare diseases (product 9, ages)",
        url="https://www.orphadata.com/data/xml/en_product9_ages.xml",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/legalcode",
        citation=ORPHADATA_NOTICE,
        used_for="Type of inheritance per disorder, used to check candidate diseases against the IUIS code.",
        file_name="en_product9_ages.xml",
    ),
    Source(
        id="hpo_ontology",
        name="Human Phenotype Ontology (hp.obo)",
        url=f"{HPO_RELEASE}/hp.obo",
        license="HPO licence (free to use with attribution; content must not be altered)",
        license_url="https://human-phenotype-ontology.github.io/license.html",
        citation=(
            "This product uses the Human Phenotype Ontology (version {release}). "
            "Find out more at http://www.human-phenotype-ontology.org"
        ),
        used_for="Labels of inheritance and phenotype terms.",
        file_name="hp.obo",
    ),
    Source(
        id="hpo_annotations",
        name="Human Phenotype Ontology annotations (phenotype.hpoa)",
        url=f"{HPO_RELEASE}/phenotype.hpoa",
        license="HPO licence (free to use with attribution; content must not be altered)",
        license_url="https://human-phenotype-ontology.github.io/license.html",
        citation=(
            "This product uses the Human Phenotype Ontology annotations (version {release}). "
            "Find out more at http://www.human-phenotype-ontology.org"
        ),
        used_for="HPO phenotypes with frequency per OMIM disease; inheritance annotations for mapping.",
        file_name="phenotype.hpoa",
    ),
    Source(
        id="uniprot",
        name="UniProtKB",
        url="https://rest.uniprot.org/uniprotkb/accessions",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        citation=(
            "© UniProt Consortium. Nucleic Acids Res 53:D609-D617 (2025). Modified: subset, reformatted."
        ),
        used_for="Protein name, length and family; canonical sequence for checking flagship variants.",
    ),
    Source(
        id="pdbe_sifts",
        name="PDBe SIFTS best structures",
        url="https://www.ebi.ac.uk/pdbe/api/mappings/best_structures/{accession}",
        license="CC0 1.0",
        license_url="https://creativecommons.org/publicdomain/zero/1.0/",
        citation="PDBe SIFTS, https://www.ebi.ac.uk/pdbe/. Cite PDB IDs and primary citations.",
        used_for="Number of experimental PDB entries mapped to each protein.",
    ),
    Source(
        id="rcsb_search",
        name="RCSB PDB Search API",
        url="https://search.rcsb.org/rcsbsearch/v2/query",
        license="CC0 1.0",
        license_url="https://www.rcsb.org/pages/usage-policy",
        citation="RCSB PDB, https://www.rcsb.org. Cite PDB IDs and primary citations of individual entries.",
        used_for="Fallback for the experimental structure count when PDBe cannot be reached.",
    ),
    Source(
        id="alphafold_db",
        name="AlphaFold Protein Structure Database",
        url="https://alphafold.ebi.ac.uk/api/prediction/{accession}",
        license="CC BY 4.0",
        license_url="https://creativecommons.org/licenses/by/4.0/",
        citation=(
            "AlphaFold Data Copyright (2022) DeepMind Technologies Limited. Jumper J et al., Nature (2021); "
            "Fleming J et al., J Mol Biol (2025); Bertoni D et al., Nucleic Acids Res (2025)."
        ),
        used_for="Whether a predicted model exists for the canonical protein sequence.",
    ),
    Source(
        id="clinvar",
        name="ClinVar (NCBI E-utilities)",
        url="https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi?db=clinvar",
        license="Public domain (no NCBI-imposed restrictions)",
        license_url="https://www.ncbi.nlm.nih.gov/clinvar/docs/maintenance_use/",
        citation=(
            "ClinVar, NCBI/NLM. Landrum MJ et al., Nucleic Acids Res 2018 (PMID 29165669). Not intended for "
            "direct diagnostic use or medical decision-making without review by a genetics professional."
        ),
        used_for="Variant record counts per gene; review status and dbSNP identifiers of flagship variants.",
    ),
    Source(
        id="europe_pmc",
        name="Europe PMC",
        url="https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        license="Bibliographic metadata open; abstracts and full text remain with publishers and authors",
        license_url="https://europepmc.org/Copyright",
        citation="Europe PMC, https://europepmc.org. Bibliographic identifiers and counts only.",
        used_for="Number of publications linked to each protein's UniProtKB entry.",
    ),
)

SOURCE_BY_ID = {source.id: source for source in SOURCES}
BULK_SOURCES = tuple(source for source in SOURCES if source.file_name)

# Sources the application queries at run time. Statements follow docs/research/provenance-reproducibility.md.
RUNTIME_NOTICES = (
    ("AlphaMissense", "CC BY 4.0. Cheng J et al., Science (2023). doi:10.5281/zenodo.10813168."),
    ("RCSB PDB / wwPDB", "CC0 1.0. Cite PDB IDs and primary citations of individual entries."),
    (
        "ChEMBL",
        "EMBL-EBI. CC BY-SA 3.0 Unported. Mendez D et al., Nucleic Acids Res 47:D930-D940 (2019). "
        "ChEMBL IDs preserved. Distributed separately from other data; adaptations are CC BY-SA 3.0.",
    ),
    ("PubChem", "NCBI/NLM. Depositor-contributed content is subject to the terms of the original source."),
    ("Open Targets", "CC0 1.0. Buniello A et al., Nucleic Acids Res (2025)."),
    ("Ensembl", "EMBL-EBI. Data without restriction; code Apache-2.0."),
    ("STRING", "CC BY 4.0. Szklarczyk D et al., Nucleic Acids Res 53:D730-D737 (2025). Modified: subset."),
    ("Reactome", "Data CC0. Ragueneau E et al., Nucleic Acids Res (2025), doi:10.1093/nar/gkaf1223."),
    ("ECO", "Evidence and Conclusion Ontology. CC0 1.0."),
    (
        "OMIM",
        "No OMIM content is included. MIM numbers appear only as cross-references supplied by other sources "
        "and are used as link-outs.",
    ),
)
