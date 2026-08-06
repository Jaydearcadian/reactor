#!/usr/bin/env python3
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reactor.engine import ReactorEngine  # noqa: E402
from reactor.experiment import DelayedPath, ExperimentRunner  # noqa: E402
from reactor.scenario import default_objective, overlap_scenario  # noqa: E402


def run_trial(duration_ms: int) -> dict[str, object]:
    objective = default_objective(minimum_remaining_overlap_ms=1)
    runner = ExperimentRunner(
        objective,
        (
            DelayedPath("baseline-model", 400, ReactorEngine(objective)),
            DelayedPath("reactor-model", 20, ReactorEngine(objective)),
        ),
    )
    results = runner.run(overlap_scenario(duration_ms))
    return {
        "nominal_window_ms": duration_ms,
        "paths": [
            {
                "name": result.path_name,
                "final_state": result.final_state.value,
                "captured": result.lock is not None,
                "verified": result.verified,
                "locked_at_ms": result.locked_at_ms,
                "detection_to_lock_ms": result.detection_to_lock_ms,
                "false_locks": result.false_locks,
                "duplicate_lock_attempts": result.duplicate_lock_attempts,
                "versions": result.lock.versions() if result.lock else None,
            }
            for result in results
        ],
    }


def main() -> None:
    trials = [run_trial(duration) for duration in (50, 100, 150, 250, 500, 1_000)]
    output = {
        "evidence_level": "X1 deterministic local fixture",
        "warning": "These are configured reaction-delay models, not measured Solana, Jito, or MagicBlock results.",
        "trials": trials,
    }
    destination = ROOT / "experiment" / "results" / "latest.json"
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(output, indent=2) + "\n", encoding="utf-8")

    print("Reactor deterministic experiment")
    print("NOTE: model output only; no blockchain latency claim is implied.\n")
    print(f"{'window':>8}  {'baseline':>10}  {'reactor':>10}  {'false locks':>11}")
    for trial in trials:
        paths = {item["name"]: item for item in trial["paths"]}
        baseline = "verified" if paths["baseline-model"]["verified"] else "missed"
        reactor = "verified" if paths["reactor-model"]["verified"] else "missed"
        false_locks = sum(int(item["false_locks"]) for item in trial["paths"])
        print(f"{trial['nominal_window_ms']:>6}ms  {baseline:>10}  {reactor:>10}  {false_locks:>11}")
    print(f"\nWrote {destination.relative_to(ROOT)}")


if __name__ == "__main__":
    main()
