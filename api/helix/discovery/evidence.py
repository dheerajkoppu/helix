"""Evidence helpers the bridges share: seeded-catalog provenance and a Helix hypothesis row."""

from datetime import UTC, datetime

from helix.evidence import build_hypothesis
from helix.knowledge.catalog import Catalog, SeedProvenance
from helix.schemas.common import (
    Authoring,
    EntityRef,
    Evidence,
    EvidenceObject,
    Provenance,
)

AUTHORING = Authoring(method="human")


def seed_provenance(catalog: Catalog, items: list[SeedProvenance], database: str) -> Provenance | None:
    """Provenance envelope of a seeded catalog record, so it can back an Evidence row."""
    item = next((row for row in items if row.source_id.startswith(database)), None)
    if item is None:
        item = items[0] if items else None
    if item is None or item.record_id is None:
        return None
    seed = catalog.seed_source(item.source_id)
    try:
        retrieved_at = datetime.fromisoformat((seed.retrieved_at or "").replace("Z", "+00:00"))
    except ValueError, AttributeError:
        retrieved_at = catalog.status.loaded_at or datetime.now(UTC)
    return Provenance(
        source=database,
        source_name=(seed.name if seed else None) or database,
        release=seed.release if seed else catalog.release,
        request_url=(seed.url if seed else None) or item.url or "",
        retrieved_at=retrieved_at,
        record_id=str(item.record_id),
        record_url=item.url,
        license=seed.license if seed else None,
        response_sha256=seed.sha256 if seed else None,
        from_cache=True,
    )


def hypothesis(
    statement: str,
    *,
    rests_on: list[Evidence],
    subject: EntityRef | None = None,
    predicate: str | None = None,
    object: EvidenceObject | None = None,
) -> Evidence | None:
    """A statement Helix authored. None when no retrieved record backs it, because a hypothesis
    with nothing under it is not published."""
    ids = [row.id for row in rests_on if row is not None]
    if not ids:
        return None
    return build_hypothesis(
        statement,
        derived_from=ids,
        authoring=AUTHORING,
        subject=subject,
        predicate=predicate,
        object=object,
    )
