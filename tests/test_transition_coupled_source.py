from pathlib import Path
import unittest

PROGRAM = Path("programs/reactor/src/lib.rs").read_text()


class TransitionCoupledSourceTests(unittest.TestCase):
    def test_instruction_exists(self):
        self.assertIn("pub fn update_condition_and_maybe_seal", PROGRAM)
        self.assertIn("pub struct UpdateConditionAndMaybeSeal", PROGRAM)

    def test_source_update_is_authenticated_and_monotonic(self):
        self.assertIn("selected.source, source_key", PROGRAM)
        self.assertIn("sequence > selected.sequence", PROGRAM)
        self.assertIn("selected.sequence = sequence", PROGRAM)

    def test_non_executable_state_returns_success_without_sealing(self):
        marker = "Not-yet-executable state is normal"
        self.assertIn(marker, PROGRAM)
        marker_index = PROGRAM.index(marker)
        ready_index = PROGRAM.index("candidate.ready = true", marker_index)
        return_index = PROGRAM.index("return Ok(())", marker_index)
        self.assertLess(return_index, ready_index)

    def test_candidate_uses_current_versions_not_external_expected_vector(self):
        start = PROGRAM.index("pub fn update_condition_and_maybe_seal")
        end = PROGRAM.index("pub fn initialize_session_candidate", start)
        body = PROGRAM[start:end]
        self.assertIn("sequences[i] = condition.sequence", body)
        self.assertIn("candidate.frozen_sequences = sequences", body)
        self.assertNotIn("expected_sequences", body)

    def test_candidate_is_immutable_after_seal(self):
        start = PROGRAM.index("pub fn update_condition_and_maybe_seal")
        end = PROGRAM.index("pub fn initialize_session_candidate", start)
        body = PROGRAM[start:end]
        self.assertIn("if candidate.ready", body)
        self.assertIn("return Ok(())", body)

    def test_structural_mismatches_still_revert(self):
        start = PROGRAM.index("pub fn update_condition_and_maybe_seal")
        end = PROGRAM.index("pub fn initialize_session_candidate", start)
        body = PROGRAM[start:end]
        self.assertIn("ConditionKeyMismatch", body)
        self.assertIn("ConditionObjectiveMismatch", body)
        self.assertIn("ConditionOrderMismatch", body)

    def test_seal_event_is_emitted(self):
        self.assertIn("SessionCandidateSealedEvent", PROGRAM)
        self.assertIn("frozen_sequences: candidate.frozen_sequences", PROGRAM)


if __name__ == "__main__":
    unittest.main()
