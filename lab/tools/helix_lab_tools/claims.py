"""Text checks shared by the record tools and the claims guard policy."""

import re

CLINICAL_PATTERNS = [
    r"\b(patients?|individuals?|carriers?|families|clinicians?|physicians?|doctors?)\s+(should|must|need to|ought to)\b",
    r"\b(should|must)\s+be\s+(treated|given|prescribed|administered|started|offered|screened|transplanted)\b",
    r"\b(we|i)\s+(recommend|advise)\b",
    r"\b(recommend(ed|s)?|advis(e|ed|es))\s+(treat\w*|prescrib\w*|administer\w*|starting|giving|therapy|a dose)\b",
    r"\b(recommended|preferred|appropriate|best)\s+(treatment|therapy|dose|dosage|regimen|drug)\b",
    r"\btreatment\s+(recommendation|plan|decision|advice|guidance)s?\b",
    r"\b(clinical|medical)\s+(advice|recommendation|decision|management|guidance)s?\b",
    r"\b(will|would|can|could|may|might)\s+(cure|treat|restore function in patients)\b",
    r"\b(is|are|as)\s+(a\s+|the\s+)?(cure|curative)\b",
    r"\b(prescrib\w+|dosage|dosing)\b",
    r"\b(start|begin|initiate|switch to|continue|stop)\s+(ivig|scig|immunoglobulin|ibrutinib|therapy|treatment|prophylaxis)\b",
    r"\bdiagnos(e|es|ed|ing)\s+(the|this|a|your)\s+(patient|individual|carrier)\b",
    r"\btherapeutic\s+recommendation",
]

NEGATION = re.compile(
    r"\b(no|not|never|without|nor|neither|isn't|aren't|is not|are not|does not|do not|cannot)\b[^.;:]{0,60}$",
    re.IGNORECASE,
)

CITATION = re.compile(r"\b([EGHTA]\d{1,3})\b")

# A sentence is treated as a factual statement when it reports a measured or scored value, a database
# classification, or what a named structure shows
FACT_MARKERS = [
    r"\d+(?:\.\d+)?\s?(?:Å|angstroms?|kcal/mol|kDa)",
    r"\b(?:pLDDT|ΔΔG|ddG|RMSD|AlphaMissense|popEVE|FoldX|allele frequency|probability)\b[^.\n]{0,60}?\d+\.\d+",
    r"\b(?:ClinVar|UniProt\w*|gnomAD|InterPro|IntAct)\b[^.\n]{0,80}\b(?:classif\w+|annotat\w+|lists?|reports?|pathogenic|benign|binding site)\b",
    r"\bPDB\s?(?:entry|structure|id)?\s?[0-9][A-Za-z][A-Za-z0-9]{2}\b",
]

INTENT = re.compile(
    r"^\s*(?:i'll|i will|let me|next,?|now,?|first,?|then,?|i am going to|i'm going to|calling|dispatch\w*)\b",
    re.IGNORECASE,
)

_COMPILED_CLINICAL = [re.compile(pattern, re.IGNORECASE) for pattern in CLINICAL_PATTERNS]
_COMPILED_MARKERS = [re.compile(pattern, re.IGNORECASE) for pattern in FACT_MARKERS]
_SENTENCE_BREAK = re.compile(r"(?<=[.!?])\s+|\n+")


def clinical_violations(text: str) -> list[str]:
    """Phrases that read as clinical advice or a treatment recommendation; negated mentions are allowed."""
    found: list[str] = []
    for pattern in _COMPILED_CLINICAL:
        for match in pattern.finditer(text):
            preceding = text[max(0, match.start() - 70) : match.start()]
            if NEGATION.search(preceding):
                continue
            found.append(match.group(0).strip())
    return sorted(set(found))


def cited_ids(text: str) -> set[str]:
    return set(CITATION.findall(text))


def uncited_factual_sentences(text: str) -> list[str]:
    """Sentences that name a database or a measurement without citing a record ID."""
    flagged: list[str] = []
    for sentence in _SENTENCE_BREAK.split(text):
        stripped = sentence.strip()
        if len(stripped) < 20 or INTENT.match(stripped) or stripped.endswith("?"):
            continue
        if not any(marker.search(stripped) for marker in _COMPILED_MARKERS):
            continue
        if CITATION.search(stripped):
            continue
        flagged.append(stripped[:160])
    return flagged


def check_text(text: str, known_ids: set[str] | None = None, *, require_citations: bool = False) -> list[str]:
    """Every reason this text may not leave the lab; empty when it is acceptable."""
    problems: list[str] = []
    phrases = clinical_violations(text)
    if phrases:
        quoted = ", ".join(f'"{phrase}"' for phrase in phrases[:4])
        problems.append(f"clinical or treatment wording: {quoted}")
    if known_ids is not None:
        unknown = sorted(cited_ids(text) - known_ids)
        if unknown:
            problems.append(f"cites IDs that are not in the run record: {', '.join(unknown[:8])}")
    if require_citations:
        uncited = uncited_factual_sentences(text)
        if uncited:
            quoted = " | ".join(f'"{sentence}"' for sentence in uncited[:3])
            problems.append(f"factual statement without a recorded source ID: {quoted}")
    return problems
