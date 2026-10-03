"""HGNC complete set: symbol normalisation and gene identifiers."""

from __future__ import annotations

import csv
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class Hgnc:
    approved: dict[str, dict[str, str]]
    previous: dict[str, list[str]]
    aliases: dict[str, list[str]]
    gene_mim_numbers: frozenset[str]

    def resolve(self, symbol: str) -> str | None:
        """Approved symbol, then a unique previous symbol, then a unique alias."""
        if symbol in self.approved:
            return symbol
        if len(self.previous.get(symbol, [])) == 1:
            return self.previous[symbol][0]
        if len(self.aliases.get(symbol, [])) == 1:
            return self.aliases[symbol][0]
        return None


def split_multi(value: str) -> list[str]:
    return [item for item in value.strip('"').split("|") if item]


def load_hgnc(path: Path) -> Hgnc:
    approved: dict[str, dict[str, str]] = {}
    previous: dict[str, list[str]] = defaultdict(list)
    aliases: dict[str, list[str]] = defaultdict(list)
    gene_mim_numbers: set[str] = set()
    with open(path, encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter="\t"):
            if row["status"] != "Approved":
                continue
            approved[row["symbol"]] = row
            for symbol in split_multi(row["prev_symbol"]):
                previous[symbol].append(row["symbol"])
            for symbol in split_multi(row["alias_symbol"]):
                aliases[symbol].append(row["symbol"])
            gene_mim_numbers.update(split_multi(row["omim_id"]))
    return Hgnc(approved, dict(previous), dict(aliases), frozenset(gene_mim_numbers))
