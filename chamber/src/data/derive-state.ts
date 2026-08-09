import type { ChamberRun, ChamberState, DerivedSourceState } from './chamber-run'

const vectorsEqual = (left: number[], right: number[]) =>
  left.length === right.length && left.every((value, index) => value === right[index])

export function deriveChamberState(run: ChamberRun, requestedCursor: number): ChamberState {
  const maxCursor = run.transitions.at(-1)?.ordinal ?? 0
  const cursor = Math.max(0, Math.min(Math.trunc(requestedCursor), maxCursor))
  const sources: DerivedSourceState[] = run.sources.map((source) => ({
    id: source.id,
    sequence: source.initialSequence,
    predicate: source.initialPredicate,
    lastTransitionOrdinal: 0,
  }))

  let activeTransition = null as ChamberState['activeTransition']
  for (const transition of run.transitions) {
    if (transition.ordinal > cursor) break
    const sourceIndex = Number(transition.sourceId.slice(1))
    const source = sources[sourceIndex]
    if (!source) throw new Error(`Unknown source ${transition.sourceId}`)
    source.sequence = transition.sequence
    source.predicate = transition.predicate
    source.lastTransitionOrdinal = transition.ordinal
    activeTransition = transition
  }

  const liveSequenceVector = sources.map((source) => source.sequence)
  const candidateSealed = run.candidate.sealedAt !== null && cursor >= run.candidate.sealedAt
  const candidateFrozenVector = candidateSealed ? run.candidate.frozenSequenceVector : null
  const currentJointAdmissible = sources.every((source) => source.predicate)
  const postSealDivergence = Boolean(
    candidateFrozenVector && !vectorsEqual(liveSequenceVector, candidateFrozenVector),
  )

  return {
    cursor,
    maxCursor,
    activeTransition,
    sources,
    liveSequenceVector,
    currentJointAdmissible,
    candidateSealed,
    candidateFrozenVector,
    sealOrdinal: run.candidate.sealedAt,
    postSealDivergence,
  }
}
