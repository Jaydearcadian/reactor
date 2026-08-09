import type {
  ChamberGate,
  ChamberRun,
  ChamberTransition,
  ChamberVerdict,
  SourceId,
} from './chamber-run'

type JsonRecord = Record<string, any>

const numberOrNull = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const verdictOf = (value: unknown): ChamberVerdict => {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === 'pass' || normalized === 'fail' || normalized === 'invalid') return normalized
  return 'development'
}

export function adaptM6Evidence(raw: JsonRecord): ChamberRun {
  if (raw?.schema !== 'reactor.m6-essentiality.v1') {
    throw new Error(`Unsupported M6 evidence schema: ${String(raw?.schema ?? 'missing')}`)
  }

  const fixture = raw.fixture ?? {}
  const treatment = raw.treatments?.magicblock
  const hotState = treatment?.hotState
  const samples = Array.isArray(hotState?.transitionSamples) ? hotState.transitionSamples : []
  if (!treatment || !hotState || samples.length === 0) {
    throw new Error('M6 evidence is missing MagicBlock transition samples')
  }

  const initialPredicates = Array.isArray(fixture.initialConditionState)
    ? fixture.initialConditionState.map(Boolean)
    : [true, true, false, true, true, true]

  const transitions: ChamberTransition[] = samples.map((sample: JsonRecord, index: number) => ({
    ordinal: index + 1,
    sourceId: `C${Number(sample.kind)}` as SourceId,
    sequence: Number(sample.sequence),
    predicate: sample.predicate === true,
    phase: sample.phase === 'opening' ? 'opening' : 'churn',
    candidateReadyAfterTransition: sample.candidateReadyAfterTransition === true,
    signature: typeof sample.signature === 'string' ? sample.signature : null,
    slot: numberOrNull(sample.slot),
    submitToProcessedMs: numberOrNull(sample.submitToProcessedMs),
  }))

  const frozenVector = Array.isArray(hotState.frozenSequenceVector)
    ? hotState.frozenSequenceVector.map(Number)
    : null
  const finalVector = Array.isArray(hotState.finalSourceSequenceVectorAfterProbe)
    ? hotState.finalSourceSequenceVectorAfterProbe.map(Number)
    : null
  const probe = hotState.immutabilityProbe

  if (probe?.succeeded === true && frozenVector && finalVector && finalVector[0] !== frozenVector[0]) {
    transitions.push({
      ordinal: transitions.length + 1,
      sourceId: 'C0',
      sequence: finalVector[0],
      predicate: false,
      phase: 'probe',
      candidateReadyAfterTransition: true,
      signature: typeof probe.signature === 'string' ? probe.signature : null,
      slot: numberOrNull(probe.slot),
      submitToProcessedMs: numberOrNull(probe.submitToProcessedMs),
    })
  }

  const sealedTransition = transitions.find((transition) => transition.candidateReadyAfterTransition)
  const gates: ChamberGate[] = Array.isArray(raw.gates)
    ? raw.gates.map((gate: JsonRecord) => ({
        id: String(gate.id ?? 'unknown'),
        description: String(gate.description ?? ''),
        pass: gate.pass === true,
        threshold: gate.threshold,
        observed: gate.observed,
      }))
    : []

  return {
    schema: 'reactor.chamber.run.v1',
    id: `m6-${String(raw.generatedAt ?? 'local')}`,
    title: String(raw.benchmark ?? 'M6 / Essentiality'),
    evidenceMode: 'local-benchmark',
    verdict: verdictOf(raw.verdict),
    generatedAt: typeof raw.generatedAt === 'string' ? raw.generatedAt : undefined,
    objective: {
      initialExposure: Number(fixture.initialExposure ?? 700),
      targetExposure: Number(fixture.targetExposure ?? 500),
      boundedTransferLamports: Number(fixture.boundedTransferLamports ?? 100_000),
    },
    sources: Array.from({ length: 6 }, (_, index) => ({
      id: `C${index}` as SourceId,
      label: `Condition ${index}`,
      initialSequence: 1,
      initialPredicate: initialPredicates[index] === true,
    })),
    transitions,
    candidate: {
      sealedAt: sealedTransition?.ordinal ?? null,
      frozenSequenceVector: frozenVector,
    },
    comparison: {
      solanaCanonicalTx: numberOrNull(raw.primaryComparison?.solanaCanonicalCoordinationTransactions),
      magicblockCanonicalTx: numberOrNull(raw.primaryComparison?.magicblockCanonicalCoordinationTransactions),
      reduction: numberOrNull(raw.primaryComparison?.canonicalWorkReduction),
      threshold: numberOrNull(raw.primaryComparison?.threshold),
    },
    gates,
    provenance: {
      programId: typeof raw.provenance?.programId === 'string' ? raw.provenance.programId : undefined,
      gitCommit: typeof raw.provenance?.gitCommit === 'string' ? raw.provenance.gitCommit : undefined,
      runtime: 'MagicBlock ER hot state → canonical Solana',
    },
  }
}
