from __future__ import annotations

from typing import Any, Literal

from app.core.store import Store, now
from app.models import AuditEvent, TimelineEntry


def record_audit(
    store: Store,
    *,
    actor_type: Literal["user", "system", "foundry"],
    actor_id: str,
    event_type: str,
    entity_type: str,
    entity_id: str,
    payload: dict[str, Any] | None = None,
) -> AuditEvent:
    """Append-only audit log (INV-6: every action is audit logged)."""
    entry = AuditEvent(
        id=store.new_id("aud"),
        actor_type=actor_type,
        actor_id=actor_id,
        event_type=event_type,
        entity_type=entity_type,
        entity_id=entity_id,
        payload=payload or {},
        created_at=now(),
    )
    store.audit.append(entry)
    return entry


def record_timeline(store: Store, event_id: str, kind: str, message: str, **data: Any) -> TimelineEntry:
    entry = TimelineEntry(at=now(), event_id=event_id, kind=kind, message=message, data=data)
    store.timeline.append(entry)
    return entry
