"""Readable, unique, deterministic disease slugs derived from IUIS disease labels."""

from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass
from itertools import combinations

from .mapping import to_ascii

MAXIMUM_LENGTH = 64
TRAILING_WORDS = {"and", "or", "with", "of", "the", "to", "due", "in", "by", "for"}
MECHANISM_CODES = {
    "gain_of_function": "gof",
    "loss_of_function": "lof",
    "dominant_negative": "dn",
    "haploinsufficiency": "haploinsufficiency",
    "neomorph": "neomorph",
}
DISCRIMINATORS = ("gene", "inheritance", "mechanism", "table")


@dataclass(frozen=True)
class SlugInput:
    key: int
    label: str
    symbol: str | None
    inheritance_codes: tuple[str, ...]
    mechanism: tuple[str, ...]
    table: int
    is_phenocopy: bool


def slugify(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", to_ascii(text).lower()).strip("-")


def shorten(slug: str) -> str:
    """Cut at a word boundary and drop the connecting words left dangling at the end."""
    if len(slug) <= MAXIMUM_LENGTH:
        return slug
    words = slug[: MAXIMUM_LENGTH + 1].split("-")[:-1]
    while len(words) > 1 and words[-1] in TRAILING_WORDS:
        words.pop()
    return "-".join(words)


def base_slug(item: SlugInput) -> str:
    """The label without its parenthetical parts; phenocopies get a suffix as they reuse disease names."""
    short = re.sub(r"\(.*?\)", " ", re.sub(r"\[.*?\]", " ", item.label))
    slug = slugify(short) or slugify(item.label)
    first_name = slugify(short.split("/")[0])
    if len(slug) > MAXIMUM_LENGTH and first_name.count("-") >= 2:
        slug = first_name
    slug = shorten(slug)
    return f"{slug}-phenocopy" if item.is_phenocopy else slug


def discriminator(item: SlugInput, name: str) -> str:
    if name == "gene":
        return item.symbol.lower() if item.symbol else "unknown-gene"
    if name == "inheritance":
        return "-".join(code.lower() for code in item.inheritance_codes) or "unknown-inheritance"
    if name == "mechanism":
        return "-".join(MECHANISM_CODES[label] for label in item.mechanism)
    return f"t{item.table}"


def assign_slugs(items: list[SlugInput]) -> dict[int, str]:
    """Slugs keyed by item key. The gene symbol and further discriminators go only on colliding labels."""
    groups: dict[str, list[SlugInput]] = defaultdict(list)
    for item in items:
        groups[base_slug(item)].append(item)

    slugs: dict[int, str] = {}
    for base, members in groups.items():
        if len(members) == 1:
            slugs[members[0].key] = base
            continue
        for size in range(1, len(DISCRIMINATORS) + 1):
            chosen = next(
                (
                    names
                    for names in combinations(DISCRIMINATORS, size)
                    if len({tuple(discriminator(item, name) for name in names) for item in members})
                    == len(members)
                ),
                None,
            )
            if chosen:
                break
        else:
            raise ValueError(
                f"IUIS rows cannot be told apart for slug {base!r}: {[item.label for item in members]}"
            )
        for item in members:
            parts = [part for part in (discriminator(item, name) for name in chosen) if part]
            slugs[item.key] = "-".join([base, *parts])

    seen: dict[str, int] = {}
    for key, slug in slugs.items():
        if slug in seen:
            raise ValueError(f"slug {slug!r} assigned to two IUIS rows ({seen[slug]} and {key})")
        seen[slug] = key
    return slugs
