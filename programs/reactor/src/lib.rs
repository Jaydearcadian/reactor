use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};
use ephemeral_rollups_sdk::anchor::{commit, delegate, ephemeral};
use ephemeral_rollups_sdk::cpi::DelegateConfig;
use ephemeral_rollups_sdk::ephem::MagicIntentBundleBuilder;

declare_id!("75ph49gq12tUVV2XAfmDozseGfuu5ZTSZDPB8MPF8oax");

pub const CONDITION_COUNT: usize = 6;
pub const CONDITION_SEED: &[u8] = b"condition";
pub const SESSION_CANDIDATE_SEED: &[u8] = b"session_candidate";

#[ephemeral]
#[program]
pub mod reactor {
    use super::*;

    pub fn initialize_path(
        ctx: Context<InitializePath>,
        max_transfer_lamports: u64,
        expires_at_slot: u64,
    ) -> Result<()> {
        require!(max_transfer_lamports > 0, ReactorError::InvalidPath);
        require!(expires_at_slot > Clock::get()?.slot, ReactorError::InvalidPath);
        let path = &mut ctx.accounts.path;
        path.authority = ctx.accounts.authority.key();
        path.max_transfer_lamports = max_transfer_lamports;
        path.expires_at_slot = expires_at_slot;
        path.bump = ctx.bumps.path;
        Ok(())
    }

    pub fn create_objective(
        ctx: Context<CreateObjective>,
        objective_seed: [u8; 32],
        target_exposure: i64,
        minimum_remaining_slots: u64,
        condition_keys: [Pubkey; CONDITION_COUNT],
    ) -> Result<()> {
        require!(target_exposure >= 0, ReactorError::InvalidExposure);
        require!(condition_keys.iter().all(|key| *key != Pubkey::default()), ReactorError::InvalidConditionSet);
        require!(
            condition_keys
                .iter()
                .enumerate()
                .all(|(i, key)| !condition_keys[..i].contains(key)),
            ReactorError::InvalidConditionSet
        );

        let objective = &mut ctx.accounts.objective;
        objective.authority = ctx.accounts.authority.key();
        objective.path = ctx.accounts.path.key();
        objective.objective_seed = objective_seed;
        objective.target_exposure = target_exposure;
        objective.minimum_remaining_slots = minimum_remaining_slots;
        objective.condition_keys = condition_keys;
        objective.bump = ctx.bumps.objective;
        Ok(())
    }

    pub fn initialize_vault(ctx: Context<InitializeVault>, initial_exposure: i64) -> Result<()> {
        require!(initial_exposure >= 0, ReactorError::InvalidExposure);
        let vault = &mut ctx.accounts.vault;
        vault.authority = ctx.accounts.authority.key();
        vault.objective = ctx.accounts.objective.key();
        vault.exposure = initial_exposure;
        vault.bump = ctx.bumps.vault;
        Ok(())
    }

    pub fn fund_vault(ctx: Context<FundVault>, lamports: u64) -> Result<()> {
        require!(lamports > 0, ReactorError::InvalidAmount);
        let cpi_accounts = Transfer {
            from: ctx.accounts.funder.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(ctx.accounts.system_program.to_account_info(), cpi_accounts);
        system_program::transfer(cpi_ctx, lamports)
    }

    pub fn initialize_condition(
        ctx: Context<InitializeCondition>,
        kind: u8,
        source: Pubkey,
    ) -> Result<()> {
        require!((kind as usize) < CONDITION_COUNT, ReactorError::InvalidConditionKind);
        require!(source != Pubkey::default(), ReactorError::InvalidConditionSource);
        let condition = &mut ctx.accounts.condition;
        condition.objective = ctx.accounts.objective.key();
        condition.source = source;
        condition.kind = kind;
        condition.sequence = 0;
        condition.value = 0;
        condition.predicate_result = false;
        condition.observed_slot = 0;
        condition.valid_until_slot = 0;
        condition.bump = ctx.bumps.condition;
        Ok(())
    }

    pub fn update_condition(
        ctx: Context<UpdateCondition>,
        sequence: u64,
        value: i64,
        predicate_result: bool,
        valid_until_slot: u64,
    ) -> Result<()> {
        let now = Clock::get()?.slot;
        let condition = &mut ctx.accounts.condition;
        require_keys_eq!(condition.source, ctx.accounts.source.key(), ReactorError::UnauthorizedConditionSource);
        require!(sequence > condition.sequence, ReactorError::StaleSequence);
        require!(valid_until_slot > now, ReactorError::ExpiredCondition);
        condition.sequence = sequence;
        condition.value = value;
        condition.predicate_result = predicate_result;
        condition.observed_slot = now;
        condition.valid_until_slot = valid_until_slot;
        Ok(())
    }

    pub fn update_condition_and_maybe_seal(
        ctx: Context<UpdateConditionAndMaybeSeal>,
        kind: u8,
        sequence: u64,
        value: i64,
        predicate_result: bool,
        valid_until_slot: u64,
    ) -> Result<()> {
        require!((kind as usize) < CONDITION_COUNT, ReactorError::InvalidConditionKind);
        let clock = Clock::get()?;
        let source_key = ctx.accounts.source.key();

        {
            let selected = match kind {
                0 => &mut ctx.accounts.condition_0,
                1 => &mut ctx.accounts.condition_1,
                2 => &mut ctx.accounts.condition_2,
                3 => &mut ctx.accounts.condition_3,
                4 => &mut ctx.accounts.condition_4,
                5 => &mut ctx.accounts.condition_5,
                _ => unreachable!(),
            };
            require_keys_eq!(
                ctx.accounts.session_candidate.condition_keys[kind as usize],
                selected.key(),
                ReactorError::ConditionKeyMismatch
            );
            require_keys_eq!(selected.objective, ctx.accounts.session_candidate.objective, ReactorError::ConditionObjectiveMismatch);
            require!(selected.kind == kind, ReactorError::ConditionOrderMismatch);
            require_keys_eq!(selected.source, source_key, ReactorError::UnauthorizedConditionSource);
            require!(sequence > selected.sequence, ReactorError::StaleSequence);
            require!(valid_until_slot > clock.slot, ReactorError::ExpiredCondition);
            selected.sequence = sequence;
            selected.value = value;
            selected.predicate_result = predicate_result;
            selected.observed_slot = clock.slot;
            selected.valid_until_slot = valid_until_slot;
        }

        let candidate = &mut ctx.accounts.session_candidate;
        let conditions = [
            &ctx.accounts.condition_0,
            &ctx.accounts.condition_1,
            &ctx.accounts.condition_2,
            &ctx.accounts.condition_3,
            &ctx.accounts.condition_4,
            &ctx.accounts.condition_5,
        ];

        for (i, condition) in conditions.iter().enumerate() {
            require_keys_eq!(candidate.condition_keys[i], condition.key(), ReactorError::ConditionKeyMismatch);
            require_keys_eq!(condition.objective, candidate.objective, ReactorError::ConditionObjectiveMismatch);
            require!(condition.kind as usize == i, ReactorError::ConditionOrderMismatch);
        }

        // A sealed candidate is immutable, but sources may continue advancing hot state.
        if candidate.ready {
            return Ok(());
        }

        let mut sequences = [0u64; CONDITION_COUNT];
        let mut values = [0i64; CONDITION_COUNT];
        let mut valid_until_slots = [0u64; CONDITION_COUNT];

        for (i, condition) in conditions.iter().enumerate() {
            // Not-yet-executable state is normal. Persist the authenticated source
            // transition without turning a false predicate/short validity into a
            // transaction failure that would roll back the new condition state.
            if !condition.predicate_result
                || condition.observed_slot > clock.slot
                || condition.valid_until_slot <= clock.slot
                || condition.valid_until_slot.saturating_sub(clock.slot) < candidate.minimum_remaining_slots
            {
                return Ok(());
            }
            sequences[i] = condition.sequence;
            values[i] = condition.value;
            valid_until_slots[i] = condition.valid_until_slot;
        }

        candidate.frozen_sequences = sequences;
        candidate.frozen_values = values;
        candidate.frozen_valid_until_slots = valid_until_slots;
        candidate.sealed_slot = clock.slot;
        candidate.ready = true;

        emit!(SessionCandidateSealedEvent {
            objective: candidate.objective,
            frozen_sequences: candidate.frozen_sequences,
            sealed_slot: candidate.sealed_slot,
        });
        Ok(())
    }

    pub fn initialize_session_candidate(
        ctx: Context<InitializeSessionCandidate>,
        recipient: Pubkey,
        transfer_lamports: u64,
        exposure_reduction: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let path = &ctx.accounts.path;
        let objective = &ctx.accounts.objective;
        let vault = &ctx.accounts.vault;

        require_keys_eq!(objective.path, path.key(), ReactorError::ObjectivePathMismatch);
        require_keys_eq!(vault.objective, objective.key(), ReactorError::VaultObjectiveMismatch);
        require!(clock.slot < path.expires_at_slot, ReactorError::PathExpired);
        require!(recipient != Pubkey::default(), ReactorError::InvalidRecipient);
        require!(transfer_lamports > 0 && transfer_lamports <= path.max_transfer_lamports, ReactorError::PathLimitExceeded);
        require!(exposure_reduction > 0, ReactorError::InvalidExposure);

        let predicted_exposure = vault.exposure
            .checked_sub(exposure_reduction)
            .ok_or(ReactorError::ArithmeticOverflow)?;
        require!(predicted_exposure >= 0, ReactorError::InvalidExposure);
        require!(predicted_exposure <= objective.target_exposure, ReactorError::PredictedPostconditionFailed);

        let candidate = &mut ctx.accounts.session_candidate;
        candidate.authority = objective.authority;
        candidate.path = path.key();
        candidate.objective = objective.key();
        candidate.vault = vault.key();
        candidate.recipient = recipient;
        candidate.condition_keys = objective.condition_keys;
        candidate.minimum_remaining_slots = objective.minimum_remaining_slots;
        candidate.transfer_lamports = transfer_lamports;
        candidate.exposure_baseline = vault.exposure;
        candidate.exposure_reduction = exposure_reduction;
        candidate.predicted_exposure = predicted_exposure;
        candidate.frozen_sequences = [0; CONDITION_COUNT];
        candidate.frozen_values = [0; CONDITION_COUNT];
        candidate.frozen_valid_until_slots = [0; CONDITION_COUNT];
        candidate.sealed_slot = 0;
        candidate.ready = false;
        candidate.bump = ctx.bumps.session_candidate;
        Ok(())
    }

    pub fn delegate_condition(ctx: Context<DelegateCondition>, kind: u8) -> Result<()> {
        require!((kind as usize) < CONDITION_COUNT, ReactorError::InvalidConditionKind);
        require_keys_eq!(*ctx.accounts.condition.owner, crate::ID, ReactorError::ConditionObjectiveMismatch);
        {
            let data = ctx.accounts.condition.try_borrow_data()?;
            let mut data_slice: &[u8] = &data;
            let condition = ConditionState::try_deserialize(&mut data_slice)?;
            require_keys_eq!(condition.objective, ctx.accounts.objective.key(), ReactorError::ConditionObjectiveMismatch);
            require!(condition.kind == kind, ReactorError::ConditionOrderMismatch);
        }
        let kind_seed = [kind];
        ctx.accounts.delegate_condition(
            &ctx.accounts.payer,
            &[CONDITION_SEED, ctx.accounts.objective.key().as_ref(), &kind_seed],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn delegate_session_candidate(ctx: Context<DelegateSessionCandidate>) -> Result<()> {
        require_keys_eq!(*ctx.accounts.session_candidate.owner, crate::ID, ReactorError::CandidateObjectiveMismatch);
        {
            let data = ctx.accounts.session_candidate.try_borrow_data()?;
            let mut data_slice: &[u8] = &data;
            let candidate = SessionCandidate::try_deserialize(&mut data_slice)?;
            require_keys_eq!(candidate.objective, ctx.accounts.objective.key(), ReactorError::CandidateObjectiveMismatch);
        }
        ctx.accounts.delegate_session_candidate(
            &ctx.accounts.payer,
            &[SESSION_CANDIDATE_SEED, ctx.accounts.objective.key().as_ref()],
            DelegateConfig {
                validator: ctx.remaining_accounts.first().map(|account| account.key()),
                ..Default::default()
            },
        )?;
        Ok(())
    }

    pub fn evaluate_session_candidate(
        ctx: Context<EvaluateSessionCandidate>,
        expected_sequences: [u64; CONDITION_COUNT],
    ) -> Result<()> {
        let clock = Clock::get()?;
        let candidate = &mut ctx.accounts.session_candidate;
        require!(!candidate.ready, ReactorError::CandidateAlreadySealed);

        let conditions = [
            &ctx.accounts.condition_0,
            &ctx.accounts.condition_1,
            &ctx.accounts.condition_2,
            &ctx.accounts.condition_3,
            &ctx.accounts.condition_4,
            &ctx.accounts.condition_5,
        ];
        let mut values = [0i64; CONDITION_COUNT];
        let mut valid_until_slots = [0u64; CONDITION_COUNT];

        for (i, condition) in conditions.iter().enumerate() {
            require_keys_eq!(candidate.condition_keys[i], condition.key(), ReactorError::ConditionKeyMismatch);
            require_keys_eq!(condition.objective, candidate.objective, ReactorError::ConditionObjectiveMismatch);
            require!(condition.kind as usize == i, ReactorError::ConditionOrderMismatch);
            require!(condition.sequence == expected_sequences[i], ReactorError::SequenceMismatch);
            require!(condition.predicate_result, ReactorError::PredicateFalse);
            require!(condition.observed_slot <= clock.slot, ReactorError::InvalidConditionSlot);
            require!(condition.valid_until_slot > clock.slot, ReactorError::ExpiredCondition);
            require!(
                condition.valid_until_slot.saturating_sub(clock.slot) >= candidate.minimum_remaining_slots,
                ReactorError::InsufficientValidityWindow
            );
            values[i] = condition.value;
            valid_until_slots[i] = condition.valid_until_slot;
        }

        candidate.frozen_sequences = expected_sequences;
        candidate.frozen_values = values;
        candidate.frozen_valid_until_slots = valid_until_slots;
        candidate.sealed_slot = clock.slot;
        candidate.ready = true;
        Ok(())
    }

    pub fn finalize_session_candidate(ctx: Context<FinalizeSessionCandidate>) -> Result<()> {
        require!(ctx.accounts.session_candidate.ready, ReactorError::CandidateNotReady);
        ctx.accounts.session_candidate.exit(&crate::ID)?;
        MagicIntentBundleBuilder::new(
            ctx.accounts.payer.to_account_info(),
            ctx.accounts.magic_context.to_account_info(),
            ctx.accounts.magic_program.to_account_info(),
        )
        .commit_and_undelegate(&[ctx.accounts.session_candidate.to_account_info()])
        .build_and_invoke()?;
        Ok(())
    }

    pub fn materialize_lock(ctx: Context<MaterializeLock>) -> Result<()> {
        let clock = Clock::get()?;
        let candidate = &ctx.accounts.session_candidate;
        let objective = &ctx.accounts.objective;
        let path = &ctx.accounts.path;
        let vault = &ctx.accounts.vault;

        require!(candidate.ready, ReactorError::CandidateNotReady);
        require_keys_eq!(candidate.authority, ctx.accounts.payer.key(), ReactorError::CandidateAuthorityMismatch);
        require_keys_eq!(candidate.path, path.key(), ReactorError::CandidatePathMismatch);
        require_keys_eq!(candidate.objective, objective.key(), ReactorError::CandidateObjectiveMismatch);
        require_keys_eq!(candidate.vault, vault.key(), ReactorError::CandidateVaultMismatch);
        require_keys_eq!(objective.path, path.key(), ReactorError::ObjectivePathMismatch);
        require_keys_eq!(vault.objective, objective.key(), ReactorError::VaultObjectiveMismatch);
        require!(candidate.condition_keys == objective.condition_keys, ReactorError::CandidateConditionSetMismatch);
        require!(clock.slot < path.expires_at_slot, ReactorError::PathExpired);
        require!(candidate.transfer_lamports > 0 && candidate.transfer_lamports <= path.max_transfer_lamports, ReactorError::PathLimitExceeded);
        require!(vault.exposure == candidate.exposure_baseline, ReactorError::CandidateVaultBaselineMismatch);

        let predicted_exposure = vault.exposure
            .checked_sub(candidate.exposure_reduction)
            .ok_or(ReactorError::ArithmeticOverflow)?;
        require!(predicted_exposure == candidate.predicted_exposure, ReactorError::CandidatePredictionMismatch);
        require!(predicted_exposure >= 0, ReactorError::InvalidExposure);
        require!(predicted_exposure <= objective.target_exposure, ReactorError::PredictedPostconditionFailed);

        let lock = &mut ctx.accounts.execution_lock;
        lock.objective = objective.key();
        lock.vault = vault.key();
        lock.recipient = candidate.recipient;
        lock.sequences = candidate.frozen_sequences;
        lock.values = candidate.frozen_values;
        lock.valid_until_slots = candidate.frozen_valid_until_slots;
        lock.locked_slot = candidate.sealed_slot;
        lock.transfer_lamports = candidate.transfer_lamports;
        lock.exposure_reduction = candidate.exposure_reduction;
        lock.predicted_exposure = candidate.predicted_exposure;
        lock.consumed = false;
        lock.bump = ctx.bumps.execution_lock;
        Ok(())
    }

    pub fn evaluate_and_lock(
        ctx: Context<EvaluateAndLock>,
        expected_sequences: [u64; CONDITION_COUNT],
        transfer_lamports: u64,
        exposure_reduction: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let objective = &ctx.accounts.objective;
        let path = &ctx.accounts.path;
        let vault = &ctx.accounts.vault;

        require_keys_eq!(objective.path, path.key(), ReactorError::ObjectivePathMismatch);
        require_keys_eq!(vault.objective, objective.key(), ReactorError::VaultObjectiveMismatch);
        require!(clock.slot < path.expires_at_slot, ReactorError::PathExpired);
        require!(
            transfer_lamports > 0 && transfer_lamports <= path.max_transfer_lamports,
            ReactorError::PathLimitExceeded
        );
        require!(exposure_reduction > 0, ReactorError::InvalidExposure);

        let predicted_exposure = vault
            .exposure
            .checked_sub(exposure_reduction)
            .ok_or(ReactorError::ArithmeticOverflow)?;
        require!(predicted_exposure >= 0, ReactorError::InvalidExposure);
        require!(predicted_exposure <= objective.target_exposure, ReactorError::PredictedPostconditionFailed);

        let conditions = [
            &ctx.accounts.condition_0,
            &ctx.accounts.condition_1,
            &ctx.accounts.condition_2,
            &ctx.accounts.condition_3,
            &ctx.accounts.condition_4,
            &ctx.accounts.condition_5,
        ];
        let mut values = [0i64; CONDITION_COUNT];
        let mut valid_until_slots = [0u64; CONDITION_COUNT];

        for (i, condition) in conditions.iter().enumerate() {
            require_keys_eq!(objective.condition_keys[i], condition.key(), ReactorError::ConditionKeyMismatch);
            require_keys_eq!(condition.objective, objective.key(), ReactorError::ConditionObjectiveMismatch);
            require!(condition.kind as usize == i, ReactorError::ConditionOrderMismatch);
            require!(condition.sequence == expected_sequences[i], ReactorError::SequenceMismatch);
            require!(condition.predicate_result, ReactorError::PredicateFalse);
            require!(condition.observed_slot <= clock.slot, ReactorError::InvalidConditionSlot);
            require!(condition.valid_until_slot > clock.slot, ReactorError::ExpiredCondition);
            require!(
                condition.valid_until_slot.saturating_sub(clock.slot) >= objective.minimum_remaining_slots,
                ReactorError::InsufficientValidityWindow
            );
            values[i] = condition.value;
            valid_until_slots[i] = condition.valid_until_slot;
        }

        let lock = &mut ctx.accounts.execution_lock;
        lock.objective = objective.key();
        lock.vault = vault.key();
        lock.recipient = ctx.accounts.recipient.key();
        lock.sequences = expected_sequences;
        lock.values = values;
        lock.valid_until_slots = valid_until_slots;
        lock.locked_slot = clock.slot;
        lock.transfer_lamports = transfer_lamports;
        lock.exposure_reduction = exposure_reduction;
        lock.predicted_exposure = predicted_exposure;
        lock.consumed = false;
        lock.bump = ctx.bumps.execution_lock;
        Ok(())
    }

    pub fn execute_locked(ctx: Context<ExecuteLocked>) -> Result<()> {
        let clock = Clock::get()?;
        let path = &ctx.accounts.path;
        let objective = &ctx.accounts.objective;
        let lock = &mut ctx.accounts.execution_lock;
        let vault = &mut ctx.accounts.vault;

        require_keys_eq!(objective.path, path.key(), ReactorError::ObjectivePathMismatch);
        require_keys_eq!(vault.objective, objective.key(), ReactorError::VaultObjectiveMismatch);
        require!(clock.slot < path.expires_at_slot, ReactorError::PathExpired);
        require!(!lock.consumed, ReactorError::LockAlreadyConsumed);
        require_keys_eq!(lock.objective, objective.key(), ReactorError::LockObjectiveMismatch);
        require_keys_eq!(lock.vault, vault.key(), ReactorError::LockVaultMismatch);
        require_keys_eq!(lock.recipient, ctx.accounts.recipient.key(), ReactorError::LockRecipientMismatch);

        let rent_floor = Rent::get()?.minimum_balance(Vault::SPACE);
        let vault_balance = vault.to_account_info().lamports();
        require!(
            vault_balance >= rent_floor.saturating_add(lock.transfer_lamports),
            ReactorError::InsufficientVaultBalance
        );

        let exposure_before = vault.exposure;
        let exposure_after = exposure_before
            .checked_sub(lock.exposure_reduction)
            .ok_or(ReactorError::ArithmeticOverflow)?;
        require!(exposure_after >= 0, ReactorError::InvalidExposure);
        require!(exposure_after == lock.predicted_exposure, ReactorError::VaultStateChangedAfterLock);
        require!(exposure_after <= objective.target_exposure, ReactorError::PostconditionFailed);

        **vault.to_account_info().try_borrow_mut_lamports()? -= lock.transfer_lamports;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += lock.transfer_lamports;
        vault.exposure = exposure_after;
        lock.consumed = true;

        let receipt = &mut ctx.accounts.receipt;
        receipt.objective = objective.key();
        receipt.execution_lock = lock.key();
        receipt.recipient = ctx.accounts.recipient.key();
        receipt.transfer_lamports = lock.transfer_lamports;
        receipt.exposure_before = exposure_before;
        receipt.exposure_after = exposure_after;
        receipt.executed_slot = clock.slot;
        receipt.verified = true;
        receipt.bump = ctx.bumps.receipt;

        emit!(ExecutionReceiptEvent {
            objective: objective.key(),
            execution_lock: lock.key(),
            recipient: ctx.accounts.recipient.key(),
            transfer_lamports: lock.transfer_lamports,
            exposure_before,
            exposure_after,
            verified: true,
            executed_slot: clock.slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePath<'info> {
    #[account(init, payer = authority, space = Path::SPACE, seeds = [b"path", authority.key().as_ref()], bump)]
    pub path: Account<'info, Path>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(objective_seed: [u8; 32])]
pub struct CreateObjective<'info> {
    #[account(
        init,
        payer = authority,
        space = Objective::SPACE,
        seeds = [b"objective", authority.key().as_ref(), objective_seed.as_ref()],
        bump
    )]
    pub objective: Account<'info, Objective>,
    #[account(has_one = authority)]
    pub path: Account<'info, Path>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(init, payer = authority, space = Vault::SPACE, seeds = [b"vault", objective.key().as_ref()], bump)]
    pub vault: Account<'info, Vault>,
    #[account(has_one = authority)]
    pub objective: Account<'info, Objective>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct FundVault<'info> {
    #[account(mut)]
    pub funder: Signer<'info>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct InitializeCondition<'info> {
    #[account(
        init,
        payer = authority,
        space = ConditionState::SPACE,
        seeds = [CONDITION_SEED, objective.key().as_ref(), &[kind]],
        bump
    )]
    pub condition: Account<'info, ConditionState>,
    #[account(has_one = authority)]
    pub objective: Account<'info, Objective>,
    #[account(mut)]
    pub authority: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateCondition<'info> {
    #[account(mut)]
    pub condition: Account<'info, ConditionState>,
    pub source: Signer<'info>,
}

#[derive(Accounts)]
pub struct UpdateConditionAndMaybeSeal<'info> {
    #[account(mut, seeds = [SESSION_CANDIDATE_SEED, session_candidate.objective.as_ref()], bump = session_candidate.bump)]
    pub session_candidate: Account<'info, SessionCandidate>,
    #[account(mut)]
    pub condition_0: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_1: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_2: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_3: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_4: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_5: Account<'info, ConditionState>,
    pub source: Signer<'info>,
}

#[derive(Accounts)]
pub struct InitializeSessionCandidate<'info> {
    #[account(
        init,
        payer = authority,
        space = SessionCandidate::SPACE,
        seeds = [SESSION_CANDIDATE_SEED, objective.key().as_ref()],
        bump
    )]
    pub session_candidate: Account<'info, SessionCandidate>,
    #[account(has_one = authority)]
    pub objective: Account<'info, Objective>,
    #[account(address = objective.path)]
    pub path: Account<'info, Path>,
    #[account(address = objective.authority)]
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(address = Pubkey::find_program_address(&[b"vault", objective.key().as_ref()], &crate::ID).0)]
    pub vault: Account<'info, Vault>,
    pub system_program: Program<'info, System>,
}

#[delegate]
#[derive(Accounts)]
#[instruction(kind: u8)]
pub struct DelegateCondition<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub objective: Account<'info, Objective>,
    /// CHECK: PDA seeds constrain this account. State is manually deserialized before delegation.
    #[account(
        mut,
        del,
        seeds = [CONDITION_SEED, objective.key().as_ref(), &[kind]],
        bump
    )]
    pub condition: UncheckedAccount<'info>,
}

#[delegate]
#[derive(Accounts)]
pub struct DelegateSessionCandidate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub objective: Account<'info, Objective>,
    /// CHECK: PDA seeds constrain this account. State is manually deserialized before delegation.
    #[account(
        mut,
        del,
        seeds = [SESSION_CANDIDATE_SEED, objective.key().as_ref()],
        bump
    )]
    pub session_candidate: UncheckedAccount<'info>,
}

#[derive(Accounts)]
pub struct EvaluateSessionCandidate<'info> {
    #[account(mut, seeds = [SESSION_CANDIDATE_SEED, session_candidate.objective.as_ref()], bump = session_candidate.bump)]
    pub session_candidate: Account<'info, SessionCandidate>,
    #[account(mut)]
    pub condition_0: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_1: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_2: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_3: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_4: Account<'info, ConditionState>,
    #[account(mut)]
    pub condition_5: Account<'info, ConditionState>,
}

#[commit]
#[derive(Accounts)]
pub struct FinalizeSessionCandidate<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    #[account(mut)]
    pub session_candidate: Account<'info, SessionCandidate>,
}

#[derive(Accounts)]
pub struct MaterializeLock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub path: Box<Account<'info, Path>>,
    pub objective: Box<Account<'info, Objective>>,
    pub vault: Box<Account<'info, Vault>>,
    #[account(
        seeds = [SESSION_CANDIDATE_SEED, objective.key().as_ref()],
        bump = session_candidate.bump,
        constraint = session_candidate.objective == objective.key() @ ReactorError::CandidateObjectiveMismatch
    )]
    pub session_candidate: Box<Account<'info, SessionCandidate>>,
    #[account(init, payer = payer, space = ExecutionLock::SPACE, seeds = [b"lock", objective.key().as_ref()], bump)]
    pub execution_lock: Account<'info, ExecutionLock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct EvaluateAndLock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub path: Account<'info, Path>,
    pub objective: Account<'info, Objective>,
    pub vault: Account<'info, Vault>,
    /// CHECK: recipient is frozen into the lock and checked again at execution.
    pub recipient: UncheckedAccount<'info>,
    pub condition_0: Account<'info, ConditionState>,
    pub condition_1: Account<'info, ConditionState>,
    pub condition_2: Account<'info, ConditionState>,
    pub condition_3: Account<'info, ConditionState>,
    pub condition_4: Account<'info, ConditionState>,
    pub condition_5: Account<'info, ConditionState>,
    #[account(init, payer = payer, space = ExecutionLock::SPACE, seeds = [b"lock", objective.key().as_ref()], bump)]
    pub execution_lock: Account<'info, ExecutionLock>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteLocked<'info> {
    pub path: Account<'info, Path>,
    pub objective: Account<'info, Objective>,
    #[account(mut)]
    pub vault: Account<'info, Vault>,
    #[account(mut)]
    pub execution_lock: Account<'info, ExecutionLock>,
    /// CHECK: key is checked against the immutable recipient in execution_lock.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    #[account(
        init,
        payer = payer,
        space = Receipt::SPACE,
        seeds = [b"receipt", execution_lock.key().as_ref()],
        bump
    )]
    pub receipt: Account<'info, Receipt>,
    #[account(mut)]
    pub payer: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[account]
pub struct Path {
    pub authority: Pubkey,
    pub max_transfer_lamports: u64,
    pub expires_at_slot: u64,
    pub bump: u8,
}
impl Path { pub const SPACE: usize = 8 + 32 + 8 + 8 + 1; }

#[account]
pub struct Objective {
    pub authority: Pubkey,
    pub path: Pubkey,
    pub objective_seed: [u8; 32],
    pub target_exposure: i64,
    pub minimum_remaining_slots: u64,
    pub condition_keys: [Pubkey; CONDITION_COUNT],
    pub bump: u8,
}
impl Objective { pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + (32 * CONDITION_COUNT) + 1; }

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub objective: Pubkey,
    pub exposure: i64,
    pub bump: u8,
}
impl Vault { pub const SPACE: usize = 8 + 32 + 32 + 8 + 1; }

#[account]
pub struct ConditionState {
    pub objective: Pubkey,
    pub source: Pubkey,
    pub kind: u8,
    pub sequence: u64,
    pub value: i64,
    pub predicate_result: bool,
    pub observed_slot: u64,
    pub valid_until_slot: u64,
    pub bump: u8,
}
impl ConditionState { pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 8 + 8 + 1; }

#[account]
pub struct SessionCandidate {
    pub authority: Pubkey,
    pub path: Pubkey,
    pub objective: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub condition_keys: [Pubkey; CONDITION_COUNT],
    pub minimum_remaining_slots: u64,
    pub transfer_lamports: u64,
    pub exposure_baseline: i64,
    pub exposure_reduction: i64,
    pub predicted_exposure: i64,
    pub frozen_sequences: [u64; CONDITION_COUNT],
    pub frozen_values: [i64; CONDITION_COUNT],
    pub frozen_valid_until_slots: [u64; CONDITION_COUNT],
    pub sealed_slot: u64,
    pub ready: bool,
    pub bump: u8,
}
impl SessionCandidate {
    pub const SPACE: usize = 8
        + (32 * 5)
        + (32 * CONDITION_COUNT)
        + (8 * 5)
        + (8 * CONDITION_COUNT * 3)
        + 8
        + 1
        + 1;
}

#[account]
pub struct ExecutionLock {
    pub objective: Pubkey,
    pub vault: Pubkey,
    pub recipient: Pubkey,
    pub sequences: [u64; CONDITION_COUNT],
    pub values: [i64; CONDITION_COUNT],
    pub valid_until_slots: [u64; CONDITION_COUNT],
    pub locked_slot: u64,
    pub transfer_lamports: u64,
    pub exposure_reduction: i64,
    pub predicted_exposure: i64,
    pub consumed: bool,
    pub bump: u8,
}
impl ExecutionLock { pub const SPACE: usize = 8 + 32 + 32 + 32 + (8 * CONDITION_COUNT * 3) + 8 + 8 + 8 + 8 + 1 + 1; }

#[account]
pub struct Receipt {
    pub objective: Pubkey,
    pub execution_lock: Pubkey,
    pub recipient: Pubkey,
    pub transfer_lamports: u64,
    pub exposure_before: i64,
    pub exposure_after: i64,
    pub executed_slot: u64,
    pub verified: bool,
    pub bump: u8,
}
impl Receipt { pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1; }

#[event]
pub struct SessionCandidateSealedEvent {
    pub objective: Pubkey,
    pub frozen_sequences: [u64; CONDITION_COUNT],
    pub sealed_slot: u64,
}

#[event]
pub struct ExecutionReceiptEvent {
    pub objective: Pubkey,
    pub execution_lock: Pubkey,
    pub recipient: Pubkey,
    pub transfer_lamports: u64,
    pub exposure_before: i64,
    pub exposure_after: i64,
    pub verified: bool,
    pub executed_slot: u64,
}

#[error_code]
pub enum ReactorError {
    #[msg("invalid Path parameters")] InvalidPath,
    #[msg("invalid condition set")] InvalidConditionSet,
    #[msg("invalid condition kind")] InvalidConditionKind,
    #[msg("invalid condition source")] InvalidConditionSource,
    #[msg("condition source is not authorized")] UnauthorizedConditionSource,
    #[msg("condition sequence is stale or replayed")] StaleSequence,
    #[msg("condition has expired")] ExpiredCondition,
    #[msg("Path has expired")] PathExpired,
    #[msg("execution exceeds Path limits")] PathLimitExceeded,
    #[msg("Objective does not belong to supplied Path")] ObjectivePathMismatch,
    #[msg("vault does not belong to supplied Objective")] VaultObjectiveMismatch,
    #[msg("condition account does not match Objective")] ConditionKeyMismatch,
    #[msg("condition belongs to a different Objective")] ConditionObjectiveMismatch,
    #[msg("condition accounts are not in canonical order")] ConditionOrderMismatch,
    #[msg("condition sequence does not match expected version")] SequenceMismatch,
    #[msg("required condition predicate is false")] PredicateFalse,
    #[msg("condition slot metadata is invalid")] InvalidConditionSlot,
    #[msg("not enough condition validity remains")] InsufficientValidityWindow,
    #[msg("predicted postcondition does not satisfy Objective")] PredictedPostconditionFailed,
    #[msg("invalid transfer amount")] InvalidAmount,
    #[msg("invalid recipient")] InvalidRecipient,
    #[msg("invalid exposure value")] InvalidExposure,
    #[msg("session candidate is already sealed")] CandidateAlreadySealed,
    #[msg("session candidate is not ready")] CandidateNotReady,
    #[msg("session candidate authority mismatch")] CandidateAuthorityMismatch,
    #[msg("session candidate Path mismatch")] CandidatePathMismatch,
    #[msg("session candidate Objective mismatch")] CandidateObjectiveMismatch,
    #[msg("session candidate Vault mismatch")] CandidateVaultMismatch,
    #[msg("session candidate condition set mismatch")] CandidateConditionSetMismatch,
    #[msg("Vault exposure no longer matches sealed candidate baseline")] CandidateVaultBaselineMismatch,
    #[msg("sealed candidate predicted exposure no longer matches base state")] CandidatePredictionMismatch,
    #[msg("lock has already been consumed")] LockAlreadyConsumed,
    #[msg("lock belongs to another Objective")] LockObjectiveMismatch,
    #[msg("lock belongs to another vault")] LockVaultMismatch,
    #[msg("recipient does not match immutable lock")] LockRecipientMismatch,
    #[msg("vault state changed after lock")] VaultStateChangedAfterLock,
    #[msg("verified postcondition was not reached")] PostconditionFailed,
    #[msg("vault does not have enough spendable lamports")] InsufficientVaultBalance,
    #[msg("arithmetic overflow")] ArithmeticOverflow,
}
