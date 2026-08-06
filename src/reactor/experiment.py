from __future__ import annotations

from dataclasses import dataclass
from heapq import heappop, heappush
from itertools import count
from typing import Iterable

from .engine import ReactorEngine
from .model import ConditionUpdate, LifecycleState, ObjectiveSpec, PathResult


@dataclass(slots=True)
class DelayedPath:
    name: str
    reaction_delay_ms: int
    engine: ReactorEngine

    def __post_init__(self) -> None:
        if self.reaction_delay_ms < 0:
            raise ValueError("reaction_delay_ms cannot be negative")


class ExperimentRunner:
    """Feeds identical events to multiple deterministic delayed paths."""

    def __init__(self, objective: ObjectiveSpec, paths: Iterable[DelayedPath]) -> None:
        self.objective = objective
        self.paths = tuple(paths)
        if not self.paths:
            raise ValueError("at least one path is required")

    def run(
        self,
        updates: Iterable[ConditionUpdate],
        *,
        settlement: str = "success",
    ) -> tuple[PathResult, ...]:
        if settlement not in {"success", "failure", "ambiguous"}:
            raise ValueError("settlement must be success, failure, or ambiguous")

        updates_by_time: dict[int, list[ConditionUpdate]] = {}
        for update in updates:
            updates_by_time.setdefault(update.emitted_at_ms, []).append(update)

        queue: list[tuple[int, int, str, int]] = []
        order = count()
        for time_ms in updates_by_time:
            heappush(queue, (time_ms, next(order), "updates", -1))

        for path in self.paths:
            path.engine.arm(0)

        while queue:
            now_ms, _, kind, path_index = heappop(queue)
            if kind == "updates":
                batch = sorted(
                    updates_by_time[now_ms],
                    key=lambda item: (item.condition_id, item.sequence),
                )
                for path_idx, path in enumerate(self.paths):
                    accepted_any = False
                    for update in batch:
                        accepted_any = path.engine.ingest(update) or accepted_any
                    if accepted_any and path.engine.lock is None:
                        heappush(
                            queue,
                            (
                                now_ms + path.reaction_delay_ms,
                                next(order),
                                "evaluate",
                                path_idx,
                            ),
                        )
            else:
                path = self.paths[path_index]
                if path.engine.lock is None:
                    path.engine.evaluate_and_lock(now_ms)

        for path in self.paths:
            if path.engine.lock is None:
                continue
            path.engine.submit()
            if settlement == "ambiguous":
                path.engine.observe(ambiguous=True)
            elif settlement == "failure":
                path.engine.observe(known_failure=True)
            else:
                path.engine.observe()
                path.engine.verify(postcondition_satisfied=True)

        return tuple(
            PathResult(
                path_name=path.name,
                final_state=path.engine.state,
                lock=path.engine.lock,
                verified=path.engine.state is LifecycleState.VERIFIED,
                false_locks=path.engine.false_locks,
                duplicate_lock_attempts=path.engine.duplicate_lock_attempts,
                first_alignment_at_ms=path.engine.first_alignment_at_ms,
                locked_at_ms=(path.engine.lock.locked_at_ms if path.engine.lock else None),
            )
            for path in self.paths
        )
