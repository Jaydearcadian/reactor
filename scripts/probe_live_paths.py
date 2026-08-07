#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from reactor.rpc import JsonRpcClient
from reactor.telemetry import TelemetryRecorder


def probe(name: str, endpoint: str) -> dict[str, object]:
    telemetry = TelemetryRecorder()
    response = JsonRpcClient(endpoint).call("getVersion", telemetry=telemetry)
    return {
        "path": name,
        "endpoint_configured": True,
        "rpc_ok": response.ok,
        "http_status": response.http_status,
        "result": response.result,
        "error": response.error,
        "request_round_trip_ms": telemetry.delta_ms(
            "rpc_request_started", "rpc_response_received"
        ),
        "telemetry": telemetry.as_dict(),
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Probe configured Solana-compatible RPC endpoints without submitting transactions."
    )
    parser.add_argument("--solana-rpc", default=os.getenv("SOLANA_RPC_URL"))
    parser.add_argument("--magicblock-rpc", default=os.getenv("MAGICBLOCK_RPC_URL"))
    parser.add_argument("--output", default="experiment/results/live-probe.json")
    args = parser.parse_args()

    endpoints = {
        "solana": args.solana_rpc,
        "magicblock": args.magicblock_rpc,
    }
    results: list[dict[str, object]] = []
    for name, endpoint in endpoints.items():
        if not endpoint:
            results.append(
                {
                    "path": name,
                    "endpoint_configured": False,
                    "rpc_ok": False,
                    "error": "endpoint not configured",
                }
            )
            continue
        results.append(probe(name, endpoint))

    payload = {
        "evidence_level": "connectivity-probe-only",
        "warning": "Successful RPC connectivity is not execution evidence.",
        "results": results,
    }
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(payload, indent=2))
    return 0 if any(item.get("rpc_ok") for item in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
