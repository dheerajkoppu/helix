"""Orphadata free-access products (CC BY 4.0): names, cross-references, genes, phenotypes, inheritance."""

from __future__ import annotations

import xml.etree.ElementTree as ElementTree
from collections import defaultdict
from dataclasses import dataclass, field
from pathlib import Path

INACTIVE_FLAGS = {"Inactive", "Obsolete entity", "Deprecated entity", "Obsolete with resources"}
GERMLINE_CAUSAL = "Disease-causing germline mutation(s)"


@dataclass
class Disorder:
    code: str
    name: str
    synonyms: list[str] = field(default_factory=list)
    definition: str = ""
    disorder_type: str = ""
    group: str = ""
    active: bool = True
    exact_omim: list[str] = field(default_factory=list)
    exact_mondo: list[str] = field(default_factory=list)
    inheritance: list[str] = field(default_factory=list)
    phenotypes: list[dict] = field(default_factory=list)
    causal_genes: dict[str, str] = field(default_factory=dict)


@dataclass
class Orphadata:
    release: str
    disorders: dict[str, Disorder]
    by_omim: dict[str, list[str]]
    by_mondo: dict[str, list[str]]
    by_gene: dict[str, list[str]]


def is_exact(reference) -> bool:
    return (reference.findtext("DisorderMappingRelation/Name") or "").startswith("E ")


def load_orphadata(product1: Path, product4: Path, product6: Path, product9: Path) -> Orphadata:
    root = ElementTree.parse(product1).getroot()
    release = root.get("date", "")[:10]
    disorders: dict[str, Disorder] = {}
    for element in root.iter("Disorder"):
        code = "ORPHA:" + element.findtext("OrphaCode")
        flags = {flag.findtext("Label") for flag in element.findall("DisorderFlagList/DisorderFlag")}
        disorder = Disorder(
            code=code,
            name=(element.findtext("Name") or "").strip(),
            synonyms=[item.text.strip() for item in element.findall("SynonymList/Synonym") if item.text],
            disorder_type=element.findtext("DisorderType/Name") or "",
            group=element.findtext("DisorderGroup/Name") or "",
            active=not (flags & INACTIVE_FLAGS),
        )
        for section in element.findall(
            "SummaryInformationList/SummaryInformation/TextSectionList/TextSection"
        ):
            if section.findtext("TextSectionType/Name") == "Definition":
                disorder.definition = " ".join((section.findtext("Contents") or "").split())
        for reference in element.findall("ExternalReferenceList/ExternalReference"):
            if not is_exact(reference):
                continue
            source = reference.findtext("Source")
            if source == "OMIM":
                disorder.exact_omim.append(reference.findtext("Reference"))
            elif source == "MONDO":
                disorder.exact_mondo.append("MONDO:" + reference.findtext("Reference"))
        disorders[code] = disorder

    for element in ElementTree.parse(product9).getroot().iter("Disorder"):
        disorder = disorders.get("ORPHA:" + element.findtext("OrphaCode"))
        if disorder is not None:
            disorder.inheritance = [
                item.findtext("Name") for item in element.findall("TypeOfInheritanceList/TypeOfInheritance")
            ]

    for element in ElementTree.parse(product4).getroot().iter("Disorder"):
        disorder = disorders.get("ORPHA:" + element.findtext("OrphaCode"))
        if disorder is None:
            continue
        for association in element.findall("HPODisorderAssociationList/HPODisorderAssociation"):
            disorder.phenotypes.append(
                {
                    "hpo_id": association.findtext("HPO/HPOId"),
                    "label": association.findtext("HPO/HPOTerm"),
                    "frequency": association.findtext("HPOFrequency/Name"),
                }
            )

    by_gene: dict[str, list[str]] = defaultdict(list)
    for element in ElementTree.parse(product6).getroot().iter("Disorder"):
        disorder = disorders.get("ORPHA:" + element.findtext("OrphaCode"))
        if disorder is None:
            continue
        for association in element.findall("DisorderGeneAssociationList/DisorderGeneAssociation"):
            association_type = association.findtext("DisorderGeneAssociationType/Name") or ""
            if not association_type.startswith(GERMLINE_CAUSAL):
                continue
            for reference in association.findall("Gene/ExternalReferenceList/ExternalReference"):
                if reference.findtext("Source") == "HGNC":
                    hgnc_id = "HGNC:" + reference.findtext("Reference")
                    disorder.causal_genes[hgnc_id] = association_type
                    if disorder.code not in by_gene[hgnc_id]:
                        by_gene[hgnc_id].append(disorder.code)

    by_omim: dict[str, list[str]] = defaultdict(list)
    by_mondo: dict[str, list[str]] = defaultdict(list)
    for disorder in disorders.values():
        if not disorder.active:
            continue
        for mim_number in disorder.exact_omim:
            by_omim[mim_number].append(disorder.code)
        for mondo_id in disorder.exact_mondo:
            by_mondo[mondo_id].append(disorder.code)
    return Orphadata(release, disorders, dict(by_omim), dict(by_mondo), dict(by_gene))
