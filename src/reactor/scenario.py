from __future__ import annotations

from .model import ConditionUpdate, ObjectiveSpec, PathLimits


REQUIRED_CONDITIONS = (
    "authority",
    "cost",
    "exposure",
    "health",
    "liquidity",
    "oracle",
)


def default_objective(*, minimum_remaining_overlap_ms: int = 1) -> ObjectiveSpec:
    return ObjectiveSpec(
        objective_id="inventory-defense-001",
        required_conditions=REQUIRED_CONDITIONS,
        minimum_remaining_overlap_ms=minimum_remaining_overlap_ms,
        path=PathLimits(
            expires_at_ms=10_000,
            max_notional=35_000,
            max_cost_bps=25,
            min_post_health=1.5,
        ),
    )


def _update(
    condition_id: str,
    *,
    sequence: int,
    at: int,
    valid_until: int,
    value: float,
    valid: bool,
) -> ConditionUpdate:
    return ConditionUpdate(
        condition_id=condition_id,
        source=f"fixture:{condition_id}",
        sequence=sequence,
        emitted_at_ms=at,
        observed_at_ms=at,
        valid_until_ms=valid_until,
        value=value,
        predicate_result=valid,
    )


def overlap_scenario(duration_ms: int) -> list[ConditionUpdate]:
    """Create one full alignment beginning at 100ms for ``duration_ms``."""
    if duration_ms <= 0:
        raise ValueError("duration_ms must be positive")
    end = 100 + duration_ms
    return [
        _update("authority", sequence=1, at=0, valid_until=5_000, value=1, valid=True),
        _update("exposure", sequence=1, at=10, valid_until=5_000, value=700, valid=True),
        _update("oracle", sequence=1, at=30, valid_until=end, value=148.2, valid=True),
        _update("liquidity", sequence=1, at=60, valid_until=end, value=224, valid=True),
        _update("cost", sequence=1, at=80, valid_until=end, value=21, valid=True),
        _update("health", sequence=1, at=100, valid_until=end, value=1.69, valid=True),
    ]


def invalidated_before_evaluation() -> list[ConditionUpdate]:
    """Create a complete overlap at 100ms that is invalidated at 105ms.

    The final valid cost update is emitted at 95ms, so a 20ms reaction path
    cannot evaluate the complete set before the invalidation arrives.
    """
    events = [item for item in overlap_scenario(150) if item.condition_id != "cost"]
    events.extend(
        [
            _update("cost", sequence=1, at=95, valid_until=250, value=21, valid=True),
            _update("cost", sequence=2, at=105, valid_until=500, value=31, valid=False),
        ]
    )
    return events
