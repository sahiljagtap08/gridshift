"""Tiny in-process pub/sub used to fan out live updates over Server-Sent Events."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import Any


def _default(o: Any):
    if isinstance(o, datetime):
        return o.isoformat()
    if hasattr(o, "model_dump"):
        return o.model_dump(mode="json")
    raise TypeError(f"not serializable: {type(o)}")


def dumps(payload: Any) -> str:
    return json.dumps(payload, default=_default)


class Bus:
    def __init__(self) -> None:
        self._subs: set[asyncio.Queue] = set()

    def subscribe(self) -> asyncio.Queue:
        q: asyncio.Queue = asyncio.Queue(maxsize=500)
        self._subs.add(q)
        return q

    def unsubscribe(self, q: asyncio.Queue) -> None:
        self._subs.discard(q)

    def publish(self, type_: str, payload: dict[str, Any]) -> None:
        msg = {"type": type_, **payload}
        for q in list(self._subs):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                self._subs.discard(q)


_bus = Bus()


def get_bus() -> Bus:
    return _bus
