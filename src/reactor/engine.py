from __future__ import annotations

from hashlib import sha256
from typing import Dict

from .model import (
    ConditionUpdate,
    ExecutionLock,
    LifecycleState,
    LockedCondition,
    ObjectiveSpec,
)


class ReactorEngine:
    """Deterministic condition evaluator and immutable lock engine.

    This class models lock semantics only. It does not model a blockchain,
    network propagation, consensus, or economic settlement.
    """

    def __init__(self, objective: ObjectiveSpec) -> None:
        self.objective = objective
        self.state = LifecycleState.CREATED
        self._latest: Dict[str, ConditionUpdate] = {}
        self.lock: ExecutionLock | None = None
        self.false_locks = 0
        self.duplicate_lock_attempts = 0
        self.first_alignment_at_ms: int | None = None

    @property
    def latest(self) -> dict[str, ConditionUpdate]:
        return dict(self._latest)

    def arm(self, now_ms: int = 0) -> None:
        if self.state is not LifecycleState.CREATED:
            raise RuntimeError("engine can only be armed from CREATED")
        if not self.objective.path.active_at(now_ms):
            self.state = LifecycleState.EXPIRED
            return
        self.state = LifecycleState.ARMED
        self.state = LifecycleState.OBSERVING

    def ingest(self, update: ConditionUpdate) -> bool:
        if update.condition_id not in self.objective.required_conditions:
            return False
        current = self._latest.get(update.condition_id)
        if current is not None and update.sequence <= current.sequence:
            return False
        self._latest[update.condition_id] = update
        return True

    def _compatible(self, now_ms: int) -> tuple[bool, int, int]:
        if not self.objective.path.active_at(now_ms):
            return False, 0, 0
        if any(condition_id not in self._latest for condition_id in self.objective.required_conditions):
            return False, 0, 0

        snapshots = [self._latest[condition_id] for condition_id in self.objective.required_conditions]
        if any(not item.predicate_result for item in snapshots):
            return False, 0, 0

        overlap_start = max(item.observed_at_ms for item in snapshots)
        overlap_end = min(item.valid_until_ms for item in snapshots)
        remaining = overlap_end - now_ms
        compatible = (
            overlap_start <= now_ms < overlap_end
            and remaining >= self.objective.minimum_remaining_overlap_ms
        )
        return compatible, overlap_start, overlap_end

    def evaluate_and_lock(self, now_ms: int) -> ExecutionLock | None:
        if self.lock is not None:
            self.duplicate_lock_attempts += 1
            return self.lock
        if self.state in {
            LifecycleState.VERIFIED,
            LifecycleState.FAILED,
            LifecycleState.EXPIRED,
            LifecycleState.GAIA_REQUIRED,
        }:
            return None
        if not self.objective.path.active_at(now_ms):
            self.state = LifecycleState.EXPIRED
            return None

        compatible, overlap_start, overlap_end = self._compatible(now_ms)
        if not compatible:
            self.state = LifecycleState.OBSERVING
            return None

        self.state = LifecycleState.ALIGNING
        if self.first_alignment_at_ms is None:
            self.first_alignment_at_ms = overlap_start

        snapshots = tuple(
            LockedCondition(
                condition_id=item.condition_id,
                source=item.source,
                sequence=item.sequence,
                observed_at_ms=item.observed_at_ms,
                valid_until_ms=item.valid_until_ms,
                value=item.value,
            )
            for item in (self._latest[c] for c in sorted(self.objective.required_conditions))
        )
        material = "|".join(
            [self.objective.objective_id, str(now_ms)]
            + [f"{item.condition_id}:{item.source}:{item.sequence}" for item in snapshots]
        )
        lock = ExecutionLock(
            lock_id=sha256(material.encode("utf-8")).hexdigest(),
            objective_id=self.objective.objective_id,
            locked_at_ms=now_ms,
            overlap_started_at_ms=overlap_start,
            overlap_ends_at_ms=overlap_end,
            conditions=snapshots,
        )

        if any(item.valid_until_ms <= now_ms for item in snapshots):
            self.false_locks += 1
            self.state = LifecycleState.OBSERVING
            return None

        self.lock = lock
        self.state = LifecycleState.LOCKED
        return lock

    def submit(self) -> None:
        if self.state is not LifecycleState.LOCKED:
            raise RuntimeError("submit requires LOCKED")
        self.state = LifecycleState.SUBMITTED

    def observe(self, *, known_failure: bool = False, ambiguous: bool = False) -> None:
        if self.state is not LifecycleState.SUBMITTED:
            raise RuntimeError("observe requires SUBMITTED")
        if ambiguous:
            self.state = LifecycleState.GAIA_REQUIRED
        elif known_failure:
            self.state = LifecycleState.FAILED
        else:
            self.state = LifecycleState.OBSERVED

    def verify(self, *, postcondition_satisfied: bool) -> None:
        if self.state is not LifecycleState.OBSERVED:
            raise RuntimeError("verify requires OBSERVED")
        self.state = (
            LifecycleState.VERIFIED if postcondition_satisfied else LifecycleState.FAILED
        )
