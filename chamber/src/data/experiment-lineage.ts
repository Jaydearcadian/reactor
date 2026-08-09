export type ExperimentStatus = 'pass' | 'falsified' | 'next' | 'demonstrated'

export interface ExperimentRecord {
  id: string
  title: string
  status: ExperimentStatus
  question: string
  hypothesis?: string
  fixture: string[]
  observations: string[]
  result: string
  changedNext: string
}

export const EXPERIMENTS: ExperimentRecord[] = [
  {
    id: 'm3',
    title: 'MagicBlock → Solana lifecycle',
    status: 'pass',
    question: 'Can hot authenticated state live in MagicBlock and return to Solana without losing the exact state that authorized execution?',
    fixture: [
      '6 independently authenticated condition states',
      '1 delegated SessionCandidate',
      'canonical Path / Objective / Vault on Solana',
      '100,000 lamport bounded settlement',
    ],
    observations: [
      'stale exact state rejected in the ER',
      'false predicates rejected in the ER',
      'candidate remained immutable after a later source mutation',
      'candidate commitment was observed on Solana',
      'ExecutionLock materialized, Receipt verified, replay rejected',
    ],
    result: 'Exact-state authorization survived the ER → Solana authority boundary end to end.',
    changedNext: 'Once lifecycle correctness was demonstrated, the next question became whether the ER was actually necessary or merely convenient.',
  },
  {
    id: 'm4',
    title: 'Coordination baseline',
    status: 'falsified',
    question: 'Can MagicBlock capture exact executable configurations that an aggressive Solana strategy fundamentally cannot?',
    hypothesis: 'Reactive ER coordination should have a unique capture advantage over base-layer execution.',
    fixture: [
      '300 randomized cycles / 900 strategy observations',
      'three source-emission regimes: ~10ms, ~50ms, ~150ms',
      'Solana reactive vs MagicBlock reactive vs Solana speculative',
    ],
    observations: [
      'MagicBlock reactive: 99% exact capture overall',
      'aggressive Solana speculative: 99% exact capture overall',
      'Solana speculative required 1,506 attempts for 297 captures',
      '1,209 speculative attempts landed failed or stale',
      'zero false locks across all 900 observations',
    ],
    result: 'The capability-superiority thesis was falsified. Solana could reproduce the same capture reliability through speculation.',
    changedNext: 'Reactor moved from “capture possibility” to “coordination efficiency”: how much canonical work is required to preserve the same guarantees?',
  },
  {
    id: 'm5a',
    title: 'Transition-coupled sealing',
    status: 'pass',
    question: 'Can exact-state authorization happen inside the authenticated source transition itself?',
    fixture: [
      'same update_condition_and_maybe_seal(...) instruction on both runtimes',
      '10 trials per runtime',
      'post-seal mutation included in every trial',
      'no WebSocket callback and no second seal transaction in the correctness path',
    ],
    observations: [
      'Solana exact captures: 10/10',
      'MagicBlock exact captures: 10/10',
      'false locks: 0 on both',
      'post-seal immutable: 10/10 on both',
      'local submit→processed mean: 386.274ms Solana / 29.369ms ER',
    ],
    result: 'Reactor semantics became transition-coupled and portable across both runtimes.',
    changedNext: 'Single-objective latency was not enough. The next test increased concurrent persistent objectives.',
  },
  {
    id: 'm5b',
    title: 'Concurrent persistent objectives',
    status: 'falsified',
    question: 'Does the ER advantage increase as the number of simultaneously active Reactor objectives rises?',
    hypothesis: 'A dedicated hot-state runtime should preserve exactness while sustaining more objective transitions with lower latency and less backlog as concurrency grows.',
    fixture: [
      'corrected 10-objective and 50-objective local smoke runs',
      'distinct measured fee payer per objective',
      'non-binding condition TTL',
      'same transition-coupled Reactor instruction on both runtimes',
    ],
    observations: [
      '10 objectives: 10/10 exact captures on both runtimes',
      '10 objectives: ER 21.820 exact captures/s vs Solana 8.723',
      '50 objectives: 50/50 exact captures on both runtimes',
      '50 objectives: Solana 61.478 exact captures/s vs ER 30.254',
      '50-objective p95: 768.322ms Solana vs 1301.019ms ER',
    ],
    result: 'The naive “more objectives makes the ER increasingly advantageous” thesis did not survive the corrected 50-objective smoke.',
    changedNext: 'Horizontal objective count was the wrong scaling dimension. M6 moved to temporal coordination density inside one persistent objective.',
  },
  {
    id: 'm6',
    title: 'Coordination density spike',
    status: 'pass',
    question: 'Does an ER become materially useful when one persistent objective absorbs many authenticated state changes but produces only one canonical economic outcome?',
    fixture: [
      '1 persistent objective',
      '120 non-executable churn transitions',
      '1 opening transition',
      '6 independent authenticated sources',
      'C2 remains the blocker until the final transition',
      '1 verified completion',
    ],
    observations: [
      '121 objective-relevant hot transitions processed by both treatments',
      'false seals: 0',
      'stale seals: 0',
      'candidate immutable after post-seal mutation',
      'Solana canonical coordination: 123 tx',
      'MagicBlock canonical coordination: 10 tx',
      'canonical-work reduction: 91.87%',
    ],
    result: 'PASS. The frozen ≥75% canonical-work reduction gate was cleared while preserving equivalent correctness.',
    changedNext: 'The remaining threat to Reactor essentiality is a simpler semantics-equivalent keeper. That is M7.',
  },
  {
    id: 'm7',
    title: 'Keeper equivalence',
    status: 'next',
    question: 'Can a simpler offchain keeper provide the same guarantees with less complexity and equal or lower canonical work?',
    fixture: [
      'offchain keeper + direct Solana',
      'Reactor on Solana',
      'Reactor with delegated ER hot state',
      'same objective and same required guarantee matrix',
    ],
    observations: [
      'authenticated source transitions',
      'shared replayable objective state',
      'exact-state authorization',
      'bounded authority',
      'verified outcome evidence',
      'canonical coordination work',
    ],
    result: 'NEXT FALSIFICATION GATE — no result yet.',
    changedNext: 'If the keeper matches Reactor guarantees at lower complexity, the abstraction thesis weakens materially.',
  },
]
