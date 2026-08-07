use anchor_lang::prelude::*;
use anchor_lang::system_program::{self, Transfer};

declare_id!("9FKmHB6A6WUPpnvEaXfYekHgDvS9cBYY2yA3P4CEaEeD");

pub const CONDITION_COUNT: usize = 6;

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
        require!(condition_keys.iter().all(|key| *key != Pubkey::default()), ReactorError::InvalidConditionSet);
        require!(condition_keys.iter().enumerate().all(|(i, key)| !condition_keys[..i].contains(key)), ReactorError::InvalidConditionSet);

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

    pub fn evaluate_and_lock(
        ctx: Context<EvaluateAndLock>,
        expected_sequences: [u64; CONDITION_COUNT],
        transfer_lamports: u64,
        exposure_reduction: i64,
    ) -> Result<()> {
        let clock = Clock::get()?;
        let objective = &ctx.accounts.objective;
        let path = &ctx.accounts.path;

        require!(clock.slot < path.expires_at_slot, ReactorError::PathExpired);
        require!(transfer_lamports > 0 && transfer_lamports <= path.max_transfer_lamports, ReactorError::PathLimitExceeded);
        require!(exposure_reduction > 0, ReactorError::InvalidExposure);

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
        lock.vault = ctx.accounts.vault.key();
        lock.recipient = ctx.accounts.recipient.key();
        lock.sequences = expected_sequences;
        lock.values = values;
        lock.valid_until_slots = valid_until_slots;
        lock.locked_slot = clock.slot;
        lock.transfer_lamports = transfer_lamports;
        lock.exposure_reduction = exposure_reduction;
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

        **vault.to_account_info().try_borrow_mut_lamports()? -= lock.transfer_lamports;
        **ctx.accounts.recipient.to_account_info().try_borrow_mut_lamports()? += lock.transfer_lamports;
        vault.exposure = exposure_after;
        lock.consumed = true;

        let verified = exposure_after <= objective.target_exposure;
        let receipt = &mut ctx.accounts.receipt;
        receipt.objective = objective.key();
        receipt.execution_lock = lock.key();
        receipt.recipient = ctx.accounts.recipient.key();
        receipt.transfer_lamports = lock.transfer_lamports;
        receipt.exposure_before = exposure_before;
        receipt.exposure_after = exposure_after;
        receipt.executed_slot = clock.slot;
        receipt.verified = verified;
        receipt.bump = ctx.bumps.receipt;

        emit!(ExecutionReceiptEvent {
            objective: objective.key(),
            execution_lock: lock.key(),
            recipient: ctx.accounts.recipient.key(),
            transfer_lamports: lock.transfer_lamports,
            exposure_before,
            exposure_after,
            verified,
            executed_slot: clock.slot,
        });
        Ok(())
    }
}

#[derive(Accounts)]
pub struct InitializePath<'info> {
    #[account(
        init,
        payer = authority,
        space = Path::SPACE,
        seeds = [b"path", authority.key().as_ref()],
        bump
    )]
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
    #[account(
        init,
        payer = authority,
        space = Vault::SPACE,
        seeds = [b"vault", objective.key().as_ref()],
        bump
    )]
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
        seeds = [b"condition", objective.key().as_ref(), &[kind]],
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
pub struct EvaluateAndLock<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,
    pub path: Account<'info, Path>,
    pub objective: Account<'info, Objective>,
    pub vault: Account<'info, Vault>,
    /// CHECK: recipient is bound into the immutable lock and checked again at execution.
    pub recipient: UncheckedAccount<'info>,
    pub condition_0: Account<'info, ConditionState>,
    pub condition_1: Account<'info, ConditionState>,
    pub condition_2: Account<'info, ConditionState>,
    pub condition_3: Account<'info, ConditionState>,
    pub condition_4: Account<'info, ConditionState>,
    pub condition_5: Account<'info, ConditionState>,
    #[account(
        init,
        payer = payer,
        space = ExecutionLock::SPACE,
        seeds = [b"lock", objective.key().as_ref()],
        bump
    )]
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
    /// CHECK: key is checked against the address frozen into execution_lock.
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
impl Path {
    pub const SPACE: usize = 8 + 32 + 8 + 8 + 1;
}

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
impl Objective {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + (32 * CONDITION_COUNT) + 1;
}

#[account]
pub struct Vault {
    pub authority: Pubkey,
    pub objective: Pubkey,
    pub exposure: i64,
    pub bump: u8,
}
impl Vault {
    pub const SPACE: usize = 8 + 32 + 32 + 8 + 1;
}

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
impl ConditionState {
    pub const SPACE: usize = 8 + 32 + 32 + 1 + 8 + 8 + 1 + 8 + 8 + 1;
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
    pub consumed: bool,
    pub bump: u8,
}
impl ExecutionLock {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + (8 * CONDITION_COUNT * 3) + 8 + 8 + 8 + 1 + 1;
}

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
impl Receipt {
    pub const SPACE: usize = 8 + 32 + 32 + 32 + 8 + 8 + 8 + 8 + 1 + 1;
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
    #[msg("invalid Path parameters")]
    InvalidPath,
    #[msg("invalid condition set")]
    InvalidConditionSet,
    #[msg("invalid condition kind")]
    InvalidConditionKind,
    #[msg("invalid condition source")]
    InvalidConditionSource,
    #[msg("condition source is not authorized")]
    UnauthorizedConditionSource,
    #[msg("condition sequence is stale or replayed")]
    StaleSequence,
    #[msg("condition has expired")]
    ExpiredCondition,
    #[msg("Path has expired")]
    PathExpired,
    #[msg("execution exceeds Path limits")]
    PathLimitExceeded,
    #[msg("condition account does not match Objective")]
    ConditionKeyMismatch,
    #[msg("condition belongs to a different Objective")]
    ConditionObjectiveMismatch,
    #[msg("condition accounts are not in canonical order")]
    ConditionOrderMismatch,
    #[msg("condition sequence does not match expected version")]
    SequenceMismatch,
    #[msg("required condition predicate is false")]
    PredicateFalse,
    #[msg("condition slot metadata is invalid")]
    InvalidConditionSlot,
    #[msg("not enough condition validity remains")]
    InsufficientValidityWindow,
    #[msg("invalid transfer amount")]
    InvalidAmount,
    #[msg("invalid exposure value")]
    InvalidExposure,
    #[msg("lock has already been consumed")]
    LockAlreadyConsumed,
    #[msg("lock belongs to another Objective")]
    LockObjectiveMismatch,
    #[msg("lock belongs to another vault")]
    LockVaultMismatch,
    #[msg("recipient does not match immutable lock")]
    LockRecipientMismatch,
    #[msg("vault does not have enough spendable lamports")]
    InsufficientVaultBalance,
    #[msg("arithmetic overflow")]
    ArithmeticOverflow,
}
