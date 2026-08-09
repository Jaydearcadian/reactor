export type SourceId = `C${0 | 1 | 2 | 3 | 4 | 5}`
export type ChamberVerdict = 'development' | 'pass' | 'fail' | 'invalid'
export type EvidenceMode = 'development-fixture' | 'local-benchmark'
export type TransitionPhase = 'churn' | 'opening' | 'probe'
export type ChamberStage = 'observe' | 'align' | 'freeze' | 'commit' | 'verify'

export const CHAMBER_STAGES: ChamberStage[] = ['observe', 'align', 'freeze', 'commit', 'verify']

export interface ChamberSource {
  id: SourceId
  label: string
  initialSequence: number
  initialPredicate: boolean
}

export interface ChamberTransition {
  ordinal: number
  sourceId: SourceId
  sequence: number
  predicate: boolean
  phase: TransitionPhase
  candidateReadyAfterTransition: boolean
  signature?: string | null
  slot?: number | null
  submitToProcessedMs?: number | null
}

export interface ChamberGate {
  id: string
  description: string
  pass: boolean
  threshold: unknown
  observed: unknown
}

export interface ChamberRun {
  schema: 'reactor.chamber.run.v1'
  id: string
  title: string
  evidenceMode: EvidenceMode
  verdict: ChamberVerdict
  generatedAt?: string
  objective: {
    initialExposure: number
    targetExposure: number
    boundedTransferLamports: number
  }
  sources: ChamberSource[]
  transitions: ChamberTransition[]
  candidate: {
    sealedAt: number | null
    frozenSequenceVector: number[] | null
  }
  comparison: {
    solanaCanonicalTx: number | null
    magicblockCanonicalTx: number | null
    reduction: number | null
    threshold: number | null
  }
  gates: ChamberGate[]
  provenance: {
    programId?: string
    gitCommit?: string
    runtime?: string
  }
}

export interface DerivedSourceState {
  id: SourceId
  sequence: number
  predicate: boolean
  lastTransitionOrdinal: number
}

export interface ChamberState {
  cursor: number
  maxCursor: number
  activeTransition: ChamberTransition | null
  sources: DerivedSourceState[]
  liveSequenceVector: number[]
  currentJointAdmissible: boolean
  candidateSealed: boolean
  candidateFrozenVector: number[] | null
  sealOrdinal: number | null
  postSealDivergence: boolean
}
