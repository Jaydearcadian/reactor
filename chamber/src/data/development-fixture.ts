import type { ChamberRun, ChamberTransition, SourceId } from './chamber-run'

const INITIAL_PREDICATES = [true, true, false, true, true, true]

export function createDevelopmentFixture(churnTransitions = 12): ChamberRun {
  const sequences = [1, 1, 1, 1, 1, 1]
  const transitions: ChamberTransition[] = []

  for (let index = 0; index < churnTransitions; index += 1) {
    const kind = index % 6
    sequences[kind] += 1
    transitions.push({
      ordinal: index + 1,
      sourceId: `C${kind}` as SourceId,
      sequence: sequences[kind],
      predicate: kind === 2 ? false : true,
      phase: 'churn',
      candidateReadyAfterTransition: false,
      submitToProcessedMs: 12 + ((index * 7) % 19),
    })
  }

  sequences[2] += 1
  const openingOrdinal = transitions.length + 1
  transitions.push({
    ordinal: openingOrdinal,
    sourceId: 'C2',
    sequence: sequences[2],
    predicate: true,
    phase: 'opening',
    candidateReadyAfterTransition: true,
    submitToProcessedMs: 18,
  })

  const frozenSequenceVector = [...sequences]
  sequences[0] += 1
  transitions.push({
    ordinal: openingOrdinal + 1,
    sourceId: 'C0',
    sequence: sequences[0],
    predicate: false,
    phase: 'probe',
    candidateReadyAfterTransition: true,
    submitToProcessedMs: 16,
  })

  return {
    schema: 'reactor.chamber.run.v1',
    id: 'm6-development-fixture',
    title: 'M6 / Essentiality — Development Fixture',
    evidenceMode: 'development-fixture',
    verdict: 'development',
    objective: {
      initialExposure: 700,
      targetExposure: 500,
      boundedTransferLamports: 100_000,
    },
    sources: INITIAL_PREDICATES.map((predicate, index) => ({
      id: `C${index}` as SourceId,
      label: `Condition ${index}`,
      initialSequence: 1,
      initialPredicate: predicate,
    })),
    transitions,
    candidate: {
      sealedAt: openingOrdinal,
      frozenSequenceVector,
    },
    comparison: {
      solanaCanonicalTx: null,
      magicblockCanonicalTx: null,
      reduction: null,
      threshold: 0.75,
    },
    gates: [],
    provenance: {
      runtime: 'development fixture — not benchmark evidence',
    },
  }
}
