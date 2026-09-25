from __future__ import annotations

from app.core.bus import get_bus
from app.core.config import get_settings
from app.core.store import get_store
from app.services.orchestrator import Orchestrator

_orchestrator: Orchestrator | None = None


def get_orchestrator() -> Orchestrator:
    global _orchestrator
    if _orchestrator is None:
        _orchestrator = Orchestrator(get_store(), get_settings(), get_bus())
    return _orchestrator
