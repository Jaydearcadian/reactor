from __future__ import annotations

from dataclasses import asdict, dataclass
from enum import Enum
from typing import Protocol

from .telemetry import TelemetryRecorder


class EvidenceState(str, Enum):
    READY = "READY"
    SUBMITTED = "SUBMITTED"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    OBSERVED = "OBSERVED"
    VERIFIED = "VERIFIED"
    FAILED = "FAILED"
    AMBIGUOUS = "AMBIGUOUS"


@dataclass(frozen=True, slots=True)
class AttemptEvidence:
    path_name: str
    state: EvidenceState
    attempt_id: str | None
    transport_ack: bool
    observed: bool
    verified: bool
    failure: str | None
    telemetry: dict[str, object]


class LiveExecutionPath(Protocol):
    name: str

    def execute(self, payload: bytes) -> AttemptEvidence:
        """Submit one already-signed execution payload and verify its postcondition."""


class EvidenceTracker:
    """Strictly separates transport acknowledgement from execution evidence."""

    def __init__(self, path_name: str, telemetry: TelemetryRecorder | None = None) -> None:
        self.path_name = path_name
        self.telemetry = telemetry or TelemetryRecorder()
        self.state = EvidenceState.READY
        self.attempt_id: str | None = None
        self.failure: str | None = None

    def submitted(self, attempt_id: str | None = None) -> None:
        self.state = EvidenceState.SUBMITTED
        self.attempt_id = attempt_id
        self.telemetry.mark("attempt_submitted", attempt_id=attempt_id)

    def acknowledged(self, attempt_id: str | None = None) -> None:
        if self.state is not EvidenceState.SUBMITTED:
            raise RuntimeError("acknowledged requires SUBMITTED")
        self.state = EvidenceState.ACKNOWLEDGED
        self.attempt_id = attempt_id or self.attempt_id
        self.telemetry.mark("transport_acknowledged", attempt_id=self.attempt_id)

    def observed(self) -> None:
        if self.state not in {EvidenceState.SUBMITTED, EvidenceState.ACKNOWLEDGED}:
            raise RuntimeError("observed requires SUBMITTED or ACKNOWLEDGED")
        self.state = EvidenceState.OBSERVED
        self.telemetry.mark("attempt_observed", attempt_id=self.attempt_id)

    def verified(self) -> None:
        if self.state is not EvidenceState.OBSERVED:
            raise RuntimeError("verified requires OBSERVED")
        self.state = EvidenceState.VERIFIED
        self.telemetry.mark("postcondition_verified", attempt_id=self.attempt_id)

    def failed(self, reason: str) -> None:
        self.state = EvidenceState.FAILED
        self.failure = reason
        self.telemetry.mark("attempt_failed", reason=reason, attempt_id=self.attempt_id)

    def ambiguous(self, reason: str) -> None:
        self.state = EvidenceState.AMBIGUOUS
        self.failure = reason
        self.telemetry.mark("attempt_ambiguous", reason=reason, attempt_id=self.attempt_id)

    def result(self) -> AttemptEvidence:
        return AttemptEvidence(
            path_name=self.path_name,
            state=self.state,
            attempt_id=self.attempt_id,
            transport_ack=self.state in {
                EvidenceState.ACKNOWLEDGED,
                EvidenceState.OBSERVED,
                EvidenceState.VERIFIED,
            },
            observed=self.state in {EvidenceState.OBSERVED, EvidenceState.VERIFIED},
            verified=self.state is EvidenceState.VERIFIED,
            failure=self.failure,
            telemetry=self.telemetry.as_dict(),
        )
