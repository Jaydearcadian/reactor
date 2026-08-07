from __future__ import annotations

import json
import urllib.error
import urllib.request
from dataclasses import dataclass
from typing import Any

from .telemetry import TelemetryRecorder


@dataclass(frozen=True, slots=True)
class RpcResponse:
    endpoint: str
    method: str
    ok: bool
    result: Any = None
    error: Any = None
    http_status: int | None = None


class JsonRpcClient:
    """Minimal dependency-free JSON-RPC client for benchmark probes.

    This is intentionally a transport primitive, not a wallet or transaction
    builder. Signed transaction creation belongs in an execution adapter.
    """

    def __init__(self, endpoint: str, *, timeout_s: float = 10.0) -> None:
        if not endpoint.startswith(("http://", "https://")):
            raise ValueError("endpoint must be http(s)")
        self.endpoint = endpoint
        self.timeout_s = timeout_s
        self._id = 0

    def call(
        self,
        method: str,
        params: list[Any] | None = None,
        *,
        telemetry: TelemetryRecorder | None = None,
    ) -> RpcResponse:
        self._id += 1
        telemetry = telemetry or TelemetryRecorder()
        telemetry.mark("rpc_request_started", endpoint=self.endpoint, method=method)
        payload = json.dumps(
            {"jsonrpc": "2.0", "id": self._id, "method": method, "params": params or []}
        ).encode("utf-8")
        request = urllib.request.Request(
            self.endpoint,
            data=payload,
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout_s) as response:
                body = json.loads(response.read().decode("utf-8"))
                telemetry.mark(
                    "rpc_response_received",
                    endpoint=self.endpoint,
                    method=method,
                    http_status=response.status,
                )
                return RpcResponse(
                    endpoint=self.endpoint,
                    method=method,
                    ok="error" not in body,
                    result=body.get("result"),
                    error=body.get("error"),
                    http_status=response.status,
                )
        except urllib.error.HTTPError as exc:
            telemetry.mark(
                "rpc_http_error",
                endpoint=self.endpoint,
                method=method,
                http_status=exc.code,
            )
            return RpcResponse(
                endpoint=self.endpoint,
                method=method,
                ok=False,
                error=str(exc),
                http_status=exc.code,
            )
        except (urllib.error.URLError, TimeoutError, OSError) as exc:
            telemetry.mark("rpc_transport_error", endpoint=self.endpoint, method=method)
            return RpcResponse(
                endpoint=self.endpoint,
                method=method,
                ok=False,
                error=str(exc),
            )
