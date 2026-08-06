from __future__ import annotations

from dataclasses import dataclass
from enum import Enum
from typing import Mapping, Tuple


class LifecycleState(str, Enum):
    CREATED = "CREATED"
    ARMED = "ARMED"
    OBSERVING = "OBSERVING"
    ALIGNING = "ALIGNING"
    LOCKED = "LOCKED"
    SUBMITTED = "SUBMITTED"
    OBSERVED = "OBSERVED"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"
    EXPIRED = "EXPIRED"
    GAIA_REQUIRED = "GAIA_REQUIRED"


@dataclass(frozen=True, slots=True)
class ConditionUpdate:
    condition_id: str
    source: str
    sequence: int
    emitted_at_ms: int
    observed_at_ms: int
    valid_until_ms: int
    value: float
    predicate_result: bool

    def __post_init__(self) -> None:
        if not self.condition_id:
            raise ValueError("condition_id is required")
        if not self.source:
            raise ValueError("source is required")
        if self.sequence < 0:
            raise ValueError("sequence must be non-negative")
        if self.emitted_at_ms < 0 or self.observed_at_ms < 0:
            raise ValueError("timestamps must be non-negative")
        if self.observed_at_ms > self.emitted_at_ms:
            raise ValueError("an update cannot be observed after it is emitted in this fixture")
        if self.valid_until_ms <= self.observed_at_ms:
            raise ValueError("valid_until_ms must be greater than observed_at_ms")


@dataclass(frozen=True, slots=True)
class PathLimits:
    expires_at_ms: int
    max_notional: float
    max_cost_bps: float
    min_post_health: float

    def active_at(self, now_ms: int) -> bool:
        return now_ms < self.expires_at_ms


@dataclass(frozen=True, slots=True)
class ObjectiveSpec:
    objective_id: str
    required_conditions: Tuple[str, ...]
    minimum_remaining_overlap_ms: int
    path: PathLimits

    def __post_init__(self) -> None:
        if not self.objective_id:
            raise ValueError("objective_id is required")
        if not self.required_conditions:
            raise ValueError("at least one condition is required")
        if len(set(self.required_conditions)) != len(self.required_conditions):
            raise ValueError("required conditions must be unique")
        if self.minimum_remaining_overlap_ms < 0:
            raise ValueError("minimum_remaining_overlap_ms cannot be negative")


@dataclass(frozen=True, slots=True)
class LockedCondition:
    condition_id: str
    source: str
    sequence: int
    observed_at_ms: int
    valid_until_ms: int
    value: float


@dataclass(frozen=True, slots=True)
class ExecutionLock:
    lock_id: str
    objective_id: str
    locked_at_ms: int
    overlap_started_at_ms: int
    overlap_ends_at_ms: int
    conditions: Tuple[LockedCondition, ...]

    @property
    def remaining_overlap_ms(self) -> int:
        return self.overlap_ends_at_ms - self.locked_at_ms

    def versions(self) -> Mapping[str, int]:
        return {item.condition_id: item.sequence for item in self.conditions}


@dataclass(frozen=True, slots=True)
class PathResult:
    path_name: str
    final_state: LifecycleState
    lock: ExecutionLock | None
    verified: bool
    false_locks: int
    duplicate_lock_attempts: int
    first_alignment_at_ms: int | None
    locked_at_ms: int | None

    @property
    def detection_to_lock_ms(self) -> int | None:
        if self.first_alignment_at_ms is None or self.locked_at_ms is None:
            return None
        return self.locked_at_ms - self.first_alignment_at_ms
