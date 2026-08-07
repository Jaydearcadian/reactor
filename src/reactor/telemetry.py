from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from time import monotonic_ns
from typing import Callable


@dataclass(frozen=True, slots=True)
class EventMark:
    name: str
    monotonic_ns: int
    wall_time: str
    metadata: dict[str, object]


class TelemetryRecorder:
    """Records monotonic timing marks without conflating them with wall time."""

    def __init__(
        self,
        *,
        clock_ns: Callable[[], int] = monotonic_ns,
        wall_clock: Callable[[], datetime] | None = None,
    ) -> None:
        self._clock_ns = clock_ns
        self._wall_clock = wall_clock or (lambda: datetime.now(timezone.utc))
        self._events: list[EventMark] = []

    @property
    def events(self) -> tuple[EventMark, ...]:
        return tuple(self._events)

    def mark(self, name: str, **metadata: object) -> EventMark:
        if not name:
            raise ValueError("event name is required")
        mark = EventMark(
            name=name,
            monotonic_ns=self._clock_ns(),
            wall_time=self._wall_clock().isoformat(),
            metadata=dict(metadata),
        )
        self._events.append(mark)
        return mark

    def first(self, name: str) -> EventMark | None:
        return next((event for event in self._events if event.name == name), None)

    def delta_ms(self, start: str, end: str) -> float | None:
        a = self.first(start)
        b = self.first(end)
        if a is None or b is None:
            return None
        return (b.monotonic_ns - a.monotonic_ns) / 1_000_000

    def as_dict(self) -> dict[str, object]:
        return {"events": [asdict(event) for event in self._events]}
