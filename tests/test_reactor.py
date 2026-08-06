from __future__ import annotations

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reactor.engine import ReactorEngine
from reactor.experiment import DelayedPath, ExperimentRunner
from reactor.model import ConditionUpdate, LifecycleState
from reactor.scenario import (
    default_objective,
    invalidated_before_evaluation,
    overlap_scenario,
)


class ReactorEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.objective = default_objective()

    def test_short_window_reactor_captures_baseline_misses(self) -> None:
        runner = ExperimentRunner(
            self.objective,
            (
                DelayedPath("baseline", 400, ReactorEngine(self.objective)),
                DelayedPath("reactor", 20, ReactorEngine(self.objective)),
            ),
        )
        baseline, reactor = runner.run(overlap_scenario(150))
        self.assertFalse(baseline.verified)
        self.assertIsNone(baseline.lock)
        self.assertTrue(reactor.verified)
        self.assertIsNotNone(reactor.lock)
        self.assertEqual(reactor.false_locks, 0)

    def test_long_window_both_paths_capture(self) -> None:
        runner = ExperimentRunner(
            self.objective,
            (
                DelayedPath("baseline", 400, ReactorEngine(self.objective)),
                DelayedPath("reactor", 20, ReactorEngine(self.objective)),
            ),
        )
        baseline, reactor = runner.run(overlap_scenario(1_000))
        self.assertTrue(baseline.verified)
        self.assertTrue(reactor.verified)

    def test_invalidation_before_evaluation_prevents_lock(self) -> None:
        runner = ExperimentRunner(
            self.objective,
            (DelayedPath("reactor", 20, ReactorEngine(self.objective)),),
        )
        (result,) = runner.run(invalidated_before_evaluation())
        self.assertIsNone(result.lock)
        self.assertFalse(result.verified)
        self.assertEqual(result.false_locks, 0)

    def test_missing_condition_prevents_lock(self) -> None:
        engine = ReactorEngine(self.objective)
        engine.arm()
        for update in overlap_scenario(150)[:-1]:
            engine.ingest(update)
        self.assertIsNone(engine.evaluate_and_lock(120))

    def test_stale_sequence_is_rejected(self) -> None:
        engine = ReactorEngine(self.objective)
        engine.arm()
        first = overlap_scenario(150)[0]
        self.assertTrue(engine.ingest(first))
        replay = ConditionUpdate(
            condition_id=first.condition_id,
            source=first.source,
            sequence=first.sequence,
            emitted_at_ms=1,
            observed_at_ms=1,
            valid_until_ms=5_000,
            value=first.value,
            predicate_result=True,
        )
        self.assertFalse(engine.ingest(replay))
        self.assertEqual(engine.latest[first.condition_id].sequence, first.sequence)

    def test_lock_is_immutable_after_later_updates(self) -> None:
        engine = ReactorEngine(self.objective)
        engine.arm()
        for update in overlap_scenario(500):
            engine.ingest(update)
        lock = engine.evaluate_and_lock(120)
        self.assertIsNotNone(lock)
        assert lock is not None
        versions_before = dict(lock.versions())
        engine.ingest(
            ConditionUpdate(
                condition_id="oracle",
                source="fixture:oracle",
                sequence=2,
                emitted_at_ms=130,
                observed_at_ms=130,
                valid_until_ms=700,
                value=155,
                predicate_result=False,
            )
        )
        self.assertEqual(lock.versions(), versions_before)
        self.assertEqual(engine.lock, lock)

    def test_duplicate_evaluation_does_not_create_second_lock(self) -> None:
        engine = ReactorEngine(self.objective)
        engine.arm()
        for update in overlap_scenario(500):
            engine.ingest(update)
        first = engine.evaluate_and_lock(120)
        second = engine.evaluate_and_lock(121)
        self.assertEqual(first, second)
        self.assertEqual(engine.duplicate_lock_attempts, 1)

    def test_failed_settlement_is_not_verified(self) -> None:
        runner = ExperimentRunner(
            self.objective,
            (DelayedPath("reactor", 20, ReactorEngine(self.objective)),),
        )
        (result,) = runner.run(overlap_scenario(150), settlement="failure")
        self.assertEqual(result.final_state, LifecycleState.FAILED)
        self.assertFalse(result.verified)

    def test_ambiguous_settlement_enters_gaia(self) -> None:
        runner = ExperimentRunner(
            self.objective,
            (DelayedPath("reactor", 20, ReactorEngine(self.objective)),),
        )
        (result,) = runner.run(overlap_scenario(150), settlement="ambiguous")
        self.assertEqual(result.final_state, LifecycleState.GAIA_REQUIRED)
        self.assertFalse(result.verified)


if __name__ == "__main__":
    unittest.main()
