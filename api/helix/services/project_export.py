"""Project exports: project.json, a Markdown research report and a zip with a manifest, items,
hypotheses, citations and the run manifests of every job the project refers to."""

import io
import json
import re
import zipfile
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from helix.artifacts.store import ArtifactStore
from helix.errors import ApiError
from helix.hashing import canonical_sha256, sha256_hex
from helix.ids import utcnow
from helix.jobs import service as job_service

# Wording of the NOTICE in docs/research/provenance-reproducibility.md section 7.4
RESEARCH_NOTICE = "Helix is a research and hypothesis-generation tool. It is not clinical decision software."
KIND_ORDER = [
    "disease",
    "gene",
    "variant",
    "protein",
    "structure",
    "residue",
    "compound",
    "paper",
    "job",
    "hypothesis",
    "note",
    "screenshot",
]
KIND_LABELS = {
    "disease": "Diseases",
    "gene": "Genes",
    "variant": "Variants",
    "protein": "Proteins",
    "structure": "Structures",
    "residue": "Residues",
    "compound": "Compounds",
    "paper": "Papers",
    "job": "Computational runs",
    "hypothesis": "Hypotheses",
    "note": "Notes",
    "screenshot": "Screenshots",
}
EVIDENCE_LABELS = {
    "experimental": "Experimental evidence",
    "clinical_database": "Clinical database",
    "literature": "Published literature",
    "curated_database": "Curated database",
    "computational_prediction": "Computational prediction",
    "helix_hypothesis": "Helix hypothesis",
}
LICENSE_URLS = {
    "CC-BY-4.0": "https://creativecommons.org/licenses/by/4.0/",
    "CC0-1.0": "https://creativecommons.org/publicdomain/zero/1.0/",
}


@dataclass
class RunManifest:
    job_id: str
    state: str
    body: bytes | None = None
    manifest_sha256: str | None = None
    reason: str | None = None


@dataclass
class ExportFile:
    path: str
    body: bytes
    media_type: str
    description: str

    @property
    def sha256(self) -> str:
        return sha256_hex(self.body)


@dataclass
class Citations:
    papers: list[dict[str, Any]] = field(default_factory=list)
    source_records: list[dict[str, Any]] = field(default_factory=list)


def export_slug(document: dict[str, Any]) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", (document.get("title") or "project").lower()).strip("-")[:60]
    identifier = (document.get("snapshot") or {}).get("snapshot_id") or document.get("project_id") or "export"
    return f"{slug or 'project'}-{identifier}"


def collect_citations(document: dict[str, Any]) -> Citations:
    """Papers saved as items, citations carried by evidence records and the source record of every
    evidence row. Nothing is added that an item does not already hold."""
    papers: dict[str, dict[str, Any]] = {}
    records: dict[str, dict[str, Any]] = {}

    def add_paper(key: str | None, paper: dict[str, Any], cited_by: str) -> None:
        if not key:
            return
        entry = papers.setdefault(key, {**paper, "cited_by_items": []})
        if cited_by not in entry["cited_by_items"]:
            entry["cited_by_items"].append(cited_by)

    for item in document.get("items", []):
        if item["kind"] == "paper":
            data = item.get("data") or {}
            add_paper(
                item.get("ref") or item["label"],
                {
                    "ref": item.get("ref"),
                    "title": data.get("title") or item["label"],
                    "pmid": data.get("pmid"),
                    "pmcid": data.get("pmcid"),
                    "doi": data.get("doi"),
                    "year": data.get("year"),
                    "journal": data.get("journal"),
                    "authors": data.get("authors"),
                    "url": data.get("url"),
                },
                item["id"],
            )
        for evidence in item.get("evidence") or []:
            if not isinstance(evidence, dict):
                continue
            for citation in evidence.get("citations") or []:
                if isinstance(citation, dict):
                    key = citation.get("pmid") or citation.get("doi") or citation.get("url") or citation.get("text")
                    add_paper(str(key) if key else None, {"ref": None, **citation}, item["id"])
            source = evidence.get("source")
            if isinstance(source, dict) and source.get("database") and source.get("record_id"):
                key = f"{source['database']}:{source['record_id']}"
                entry = records.setdefault(
                    key, {**source, "evidence_class": evidence.get("evidence_class"), "cited_by_items": []}
                )
                if item["id"] not in entry["cited_by_items"]:
                    entry["cited_by_items"].append(item["id"])
    return Citations(papers=list(papers.values()), source_records=list(records.values()))


async def collect_run_manifests(
    session: AsyncSession, store: ArtifactStore, document: dict[str, Any]
) -> list[RunManifest]:
    """The stored manifest of each referenced job. A job that is missing or not finished is listed
    with the reason, never dropped."""
    runs: list[RunManifest] = []
    for job_id in (document.get("contents") or {}).get("runs", []):
        try:
            job, artifact = await job_service.read_manifest(session, job_id)
            body = await store.get_bytes(artifact.storage_key)
            runs.append(RunManifest(job_id=job_id, state="included", body=body, manifest_sha256=job.manifest_sha256))
        except ApiError as error:
            runs.append(RunManifest(job_id=job_id, state="unavailable", reason=error.detail or error.title))
        except OSError as error:
            runs.append(RunManifest(job_id=job_id, state="unavailable", reason=f"manifest file unreadable: {error}"))
    return runs


def _cell(value: Any) -> str:
    text = "" if value is None else str(value)
    return text.replace("|", "\\|").replace("\n", " ").strip()


def _paper_line(paper: dict[str, Any]) -> str:
    parts = [paper.get("title") or paper.get("text") or paper.get("ref") or "Untitled"]
    if paper.get("journal"):
        parts.append(str(paper["journal"]))
    if paper.get("year"):
        parts.append(str(paper["year"]))
    identifiers = [
        f"PMID:{paper['pmid']}" if paper.get("pmid") else None,
        f"PMCID:{paper['pmcid']}" if paper.get("pmcid") else None,
        f"doi:{paper['doi']}" if paper.get("doi") else None,
        paper.get("url"),
    ]
    parts.extend(identifier for identifier in identifiers if identifier)
    return ". ".join(str(part) for part in parts)


def render_markdown(document: dict[str, Any], runs: list[RunManifest] | None = None) -> str:
    items: list[dict[str, Any]] = document.get("items", [])
    by_id = {item["id"]: item for item in items}
    snapshot = document.get("snapshot")
    lineage = document.get("lineage") or {}
    citations = collect_citations(document)
    lines: list[str] = [f"# {document.get('title') or 'Untitled project'}", ""]
    if document.get("description"):
        lines += [document["description"], ""]
    lines += [f"> {RESEARCH_NOTICE}", ""]

    lines += ["| Field | Value |", "| --- | --- |", f"| Project | `{document.get('project_id')}` |"]
    if snapshot:
        lines += [
            f"| Snapshot | `{snapshot.get('snapshot_id')}` (number {snapshot.get('sequence_number')}) |",
            f"| Published | {snapshot.get('created_at')} |",
        ]
        if snapshot.get("message"):
            lines.append(f"| Message | {_cell(snapshot['message'])} |")
        if snapshot.get("parent_snapshot_id"):
            lines.append(f"| Previous snapshot | `{snapshot['parent_snapshot_id']}` |")
    else:
        lines.append("| Snapshot | Not published: this report describes the working project |")
    forked_from = lineage.get("forked_from")
    if forked_from:
        source = f"project `{forked_from.get('project_id')}`"
        if forked_from.get("snapshot_id"):
            source += f", snapshot `{forked_from['snapshot_id']}`"
        lines.append(f"| Forked from | {source} |")
        lines.append(f"| Root project | `{lineage.get('root_project_id')}` (fork depth {lineage.get('fork_depth')}) |")
    lines += [
        f"| License | {document.get('license')} (notes and hypotheses; source records keep their own license) |",
        f"| State digest | `{document.get('state_sha256')}` |",
        f"| Report generated | {utcnow().isoformat(timespec='seconds')} |",
        "",
    ]

    lines += ["## Research trail", ""]
    nodes = (document.get("trail") or {}).get("nodes", [])
    if not nodes:
        lines += ["No items saved.", ""]
    for node in nodes:
        item = by_id.get(node["item_id"], {})
        origin = item.get("origin") or {}
        detail = [f"`{node['ref']}`"] if node.get("ref") else []
        if origin.get("route"):
            detail.append(f"saved from `{origin['route']}`")
        if origin.get("created_at"):
            detail.append(f"at {origin['created_at']}")
        suffix = f" ({'; '.join(detail)})" if detail else ""
        lines.append(f"{'  ' * node['depth']}- **{node['kind']}** {node['label']}{suffix}")
    lines.append("")

    hypotheses = [item for item in items if item["kind"] == "hypothesis" and item.get("hypothesis")]
    lines += ["## Hypotheses", ""]
    if not hypotheses:
        lines += ["None recorded.", ""]
    for item in hypotheses:
        hypothesis = item["hypothesis"]
        authoring = (hypothesis.get("record") or {}).get("authoring") or {}
        lines += [
            f"### {item['label']}",
            "",
            f"**HYP · Helix hypothesis** (status: {hypothesis['status']}; "
            f"authored: {authoring.get('method', 'human')}; record `{hypothesis['record']['id']}`)",
            "",
            hypothesis["statement"],
            "",
            "A hypothesis is a statement authored in Helix. It is not an established finding. It rests on:",
            "",
        ]
        for identifier in hypothesis["supporting_item_ids"]:
            supporting = by_id.get(identifier)
            if supporting:
                reference = f" `{supporting['ref']}`" if supporting.get("ref") else ""
                lines.append(f"- {supporting['kind']}: {supporting['label']}{reference} (`{identifier}`)")
        lines.append("")

    lines += ["## Items", ""]
    for kind in KIND_ORDER:
        if kind in ("hypothesis", "note"):
            continue
        group = [item for item in items if item["kind"] == kind]
        if not group:
            continue
        lines += [f"### {KIND_LABELS[kind]}", "", "| Item | Identifier | Evidence carried | Saved from |", "| --- | --- | --- | --- |"]
        for item in group:
            classes: dict[str, int] = {}
            for evidence in item.get("evidence") or []:
                if isinstance(evidence, dict) and evidence.get("evidence_class"):
                    label = EVIDENCE_LABELS.get(evidence["evidence_class"], evidence["evidence_class"])
                    classes[label] = classes.get(label, 0) + 1
            carried = ", ".join(f"{label} × {count}" for label, count in classes.items()) or "None attached"
            lines.append(
                f"| {_cell(item['label'])} | `{_cell(item.get('ref') or item['id'])}` | {carried} | "
                f"{_cell((item.get('origin') or {}).get('route') or 'Not recorded')} |"
            )
        lines.append("")
        for item in group:
            if item.get("note"):
                lines += [f"Note on {item['label']}: {item['note']}", ""]

    notes = [item for item in items if item["kind"] == "note"]
    lines += ["## Notes", ""]
    if not notes:
        lines += ["None recorded.", ""]
    for item in notes:
        parent = by_id.get(item.get("parent_item_id") or "")
        attached = f" (on {parent['kind']} {parent['label']})" if parent else ""
        lines += [f"### {item['label']}{attached}", "", item.get("note") or "", ""]

    lines += ["## Citations", ""]
    if not citations.papers and not citations.source_records:
        lines += ["No citations are attached to the items of this project.", ""]
    if citations.papers:
        lines += ["### Publications", ""]
        lines += [f"{index}. {_paper_line(paper)}" for index, paper in enumerate(citations.papers, 1)]
        lines.append("")
    if citations.source_records:
        lines += ["### Source records", "", "| Database | Record | Release | License | Retrieved |", "| --- | --- | --- | --- | --- |"]
        for record in citations.source_records:
            lines.append(
                f"| {_cell(record.get('database'))} | {_cell(record.get('record_id'))} | "
                f"{_cell(record.get('release') or 'Unknown')} | {_cell(record.get('license') or 'Unknown')} | "
                f"{_cell(record.get('retrieved_at') or 'Unknown')} |"
            )
        lines.append("")

    job_ids = (document.get("contents") or {}).get("runs", [])
    lines += ["## Computational runs", ""]
    if not job_ids:
        lines += ["No runs are referenced.", ""]
    else:
        known = {run.job_id: run for run in runs or []}
        for job_id in job_ids:
            run = known.get(job_id)
            if run is None:
                lines.append(f"- `{job_id}`")
            elif run.state == "included":
                lines.append(f"- `{job_id}`: manifest SHA-256 `{run.manifest_sha256}`")
            else:
                lines.append(f"- `{job_id}`: manifest not available ({run.reason})")
        lines += ["", "Outputs of computational runs are predictions.", ""]
    return "\n".join(lines).rstrip() + "\n"


def _json(value: Any) -> bytes:
    return (json.dumps(value, indent=2, ensure_ascii=False, sort_keys=True) + "\n").encode("utf-8")


def _jsonl(rows: list[dict[str, Any]]) -> bytes:
    return "".join(json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n" for row in rows).encode("utf-8")


def _ro_crate(document: dict[str, Any], files: list[ExportFile], generated_at: str) -> dict[str, Any]:
    """RO-Crate 1.3 metadata listing every file of the export (research section 6.4)."""
    snapshot = document.get("snapshot") or {}
    forked_from = (document.get("lineage") or {}).get("forked_from") or {}
    root: dict[str, Any] = {
        "@id": "./",
        "@type": "Dataset",
        "name": document.get("title") or "Untitled project",
        "description": f"Helix research project export. {RESEARCH_NOTICE}",
        "datePublished": snapshot.get("created_at") or generated_at,
        "license": {"@id": LICENSE_URLS.get(document.get("license") or "", LICENSE_URLS["CC-BY-4.0"])},
        "hasPart": [{"@id": file.path} for file in files],
    }
    graph: list[dict[str, Any]] = [
        {
            "@id": "ro-crate-metadata.json",
            "@type": "CreativeWork",
            "conformsTo": {"@id": "https://w3id.org/ro/crate/1.3"},
            "about": {"@id": "./"},
        },
        root,
        {"@id": root["license"]["@id"], "@type": "CreativeWork", "name": document.get("license")},
    ]
    if snapshot.get("snapshot_id"):
        root["identifier"] = {"@id": "#snapshot-id"}
        graph.append(
            {
                "@id": "#snapshot-id",
                "@type": "PropertyValue",
                "propertyID": "helix-snapshot",
                "name": "Helix snapshot id",
                "value": snapshot["snapshot_id"],
            }
        )
    if forked_from.get("snapshot_id"):
        parent = f"urn:helix:snapshot:{forked_from['snapshot_id']}"
        root["isBasedOn"] = {"@id": parent}
        graph.append({"@id": parent, "@type": "CreativeWork", "name": "Parent snapshot this project was forked from"})
    for file in files:
        graph.append(
            {
                "@id": file.path,
                "@type": "File",
                "name": file.description,
                "description": file.description,
                "encodingFormat": file.media_type,
                "contentSize": str(len(file.body)),
                "sha256": file.sha256,
            }
        )
    return {"@context": "https://w3id.org/ro/crate/1.3/context", "@graph": graph}


async def build_zip(session: AsyncSession, store: ArtifactStore, document: dict[str, Any]) -> bytes:
    generated_at = utcnow().isoformat(timespec="seconds")
    runs = await collect_run_manifests(session, store, document)
    citations = collect_citations(document)
    items: list[dict[str, Any]] = document.get("items", [])
    hypotheses = [item["hypothesis"]["record"] for item in items if item.get("hypothesis")]

    files = [
        ExportFile("project.json", _json(document), "application/json", "Project document"),
        ExportFile("report.md", render_markdown(document, runs).encode("utf-8"), "text/markdown", "Research report"),
        ExportFile("items/items.jsonl", _jsonl(items), "application/jsonl", "Project items, one per line"),
        ExportFile(
            "hypotheses/hypotheses.jsonl",
            _jsonl(hypotheses),
            "application/jsonl",
            "Hypotheses as evidence records of class helix_hypothesis",
        ),
        ExportFile(
            "citations/citations.json",
            _json({"papers": citations.papers, "source_records": citations.source_records}),
            "application/json",
            "Publications and source records cited by the items",
        ),
    ]
    for run in runs:
        if run.body is not None:
            files.append(
                ExportFile(
                    f"runs/{run.job_id}/manifest.json", run.body, "application/json", f"Run manifest of {run.job_id}"
                )
            )

    manifest: dict[str, Any] = {
        "export_version": document.get("export_version"),
        "generator": document.get("generator"),
        "generated_at": generated_at,
        "project_id": document.get("project_id"),
        "snapshot_id": (document.get("snapshot") or {}).get("snapshot_id"),
        "state_sha256": document.get("state_sha256"),
        "research_use_only": True,
        "notice": RESEARCH_NOTICE,
        "files": [
            {
                "path": file.path,
                "sha256": file.sha256,
                "size_bytes": len(file.body),
                "media_type": file.media_type,
                "description": file.description,
            }
            for file in files
        ],
        "runs": [
            {
                "job_id": run.job_id,
                "state": run.state,
                "manifest_path": f"runs/{run.job_id}/manifest.json" if run.body is not None else None,
                "manifest_sha256": run.manifest_sha256,
                "reason": run.reason,
            }
            for run in runs
        ],
        "counts": {
            "items": len(items),
            "hypotheses": len(hypotheses),
            "papers": len(citations.papers),
            "source_records": len(citations.source_records),
        },
    }
    manifest["integrity"] = {"algorithm": "sha256-rfc8785", "manifest_sha256": canonical_sha256(manifest)}
    crate = _ro_crate(document, files, generated_at)

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", _json(manifest))
        archive.writestr("ro-crate-metadata.json", _json(crate))
        for file in files:
            archive.writestr(file.path, file.body)
    return buffer.getvalue()
