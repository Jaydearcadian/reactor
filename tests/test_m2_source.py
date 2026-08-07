from pathlib import Path
import unittest


PROGRAM = Path("programs/reactor/src/program.rs").read_text()


class M2SourceContractTests(unittest.TestCase):
    def test_objective_is_bound_to_path_and_vault(self):
        self.assertIn("objective.path, path.key()", PROGRAM)
        self.assertIn("vault.objective, objective.key()", PROGRAM)

    def test_lock_binds_exact_condition_versions(self):
        self.assertIn("condition.sequence == expected_sequences[i]", PROGRAM)
        self.assertIn("lock.sequences = expected_sequences", PROGRAM)
        self.assertIn("lock.values = values", PROGRAM)
        self.assertIn("lock.valid_until_slots = valid_until_slots", PROGRAM)

    def test_false_predicate_and_expired_state_cannot_lock(self):
        self.assertIn("condition.predicate_result", PROGRAM)
        self.assertIn("condition.valid_until_slot > clock.slot", PROGRAM)
        self.assertIn("InsufficientValidityWindow", PROGRAM)

    def test_lock_freezes_recipient_and_economic_action(self):
        self.assertIn("lock.recipient = ctx.accounts.recipient.key()", PROGRAM)
        self.assertIn("lock.transfer_lamports = transfer_lamports", PROGRAM)
        self.assertIn("lock.exposure_reduction = exposure_reduction", PROGRAM)

    def test_predicted_postcondition_must_succeed_before_lock(self):
        self.assertIn("predicted_exposure <= objective.target_exposure", PROGRAM)
        self.assertIn("PredictedPostconditionFailed", PROGRAM)

    def test_execution_rejects_changed_vault_state(self):
        self.assertIn("exposure_after == lock.predicted_exposure", PROGRAM)
        self.assertIn("VaultStateChangedAfterLock", PROGRAM)

    def test_receipt_only_marks_verified_after_postcondition(self):
        postcondition = PROGRAM.index("exposure_after <= objective.target_exposure")
        verified = PROGRAM.index("receipt.verified = true")
        self.assertLess(postcondition, verified)

    def test_lock_is_single_use(self):
        self.assertIn("!lock.consumed", PROGRAM)
        self.assertIn("lock.consumed = true", PROGRAM)

    def test_no_millisecond_claim_is_embedded_onchain(self):
        self.assertNotIn("observed_at_ms", PROGRAM)
        self.assertNotIn("valid_until_ms", PROGRAM)


if __name__ == "__main__":
    unittest.main()
