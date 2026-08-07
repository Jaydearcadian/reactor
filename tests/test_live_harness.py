from __future__ import annotations

import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reactor.live_paths import EvidenceState, EvidenceTracker
from reactor.telemetry import TelemetryRecorder


class FakeClock:
    def __init__(self) -> None:
        self.value = 1_000_000_000

    def __call__(self) -> int:
        value = self.value
        self.value += 25_000_000
        return value


class LiveHarnessTests(unittest.TestCase):
    def test_telemetry_uses_monotonic_delta(self) -> None:
        clock = FakeClock()
        telemetry = TelemetryRecorder(
            clock_ns=clock,
            wall_clock=lambda: datetime(2026, 8, 7, tzinfo=timezone.utc),
        )
        telemetry.mark("start")
        telemetry.mark("end")
        self.assertEqual(telemetry.delta_ms("start", "end"), 25.0)

    def test_ack_is_not_verification(self) -> None:
        tracker = EvidenceTracker("jito")
        tracker.submitted("attempt-1")
        tracker.acknowledged()
        result = tracker.result()
        self.assertEqual(result.state, EvidenceState.ACKNOWLEDGED)
        self.assertTrue(result.transport_ack)
        self.assertFalse(result.observed)
        self.assertFalse(result.verified)

    def test_verification_requires_observation(self) -> None:
        tracker = EvidenceTracker("solana")
        tracker.submitted("attempt-2")
        with self.assertRaises(RuntimeError):
            tracker.verified()

    def test_full_evidence_chain(self) -> None:
        tracker = EvidenceTracker("magicblock")
        tracker.submitted("attempt-3")
        tracker.acknowledged()
        tracker.observed()
        tracker.verified()
        result = tracker.result()
        self.assertEqual(result.state, EvidenceState.VERIFIED)
        self.assertTrue(result.transport_ack)
        self.assertTrue(result.observed)
        self.assertTrue(result.verified)

    def test_ambiguous_is_not_failure_or_success(self) -> None:
        tracker = EvidenceTracker("magicblock")
        tracker.submitted("attempt-4")
        tracker.ambiguous("receipt unavailable")
        result = tracker.result()
        self.assertEqual(result.state, EvidenceState.AMBIGUOUS)
        self.assertFalse(result.verified)
        self.assertEqual(result.failure, "receipt unavailable")


if __name__ == "__main__":
    unittest.main()
