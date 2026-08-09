import { describe, expect, it } from 'vitest'
import { createDevelopmentFixture } from './development-fixture'
import { deriveChamberState } from './derive-state'

describe('deriveChamberState', () => {
  const run = createDevelopmentFixture(12)

  it('keeps the persistent blocker false throughout churn', () => {
    const state = deriveChamberState(run, 12)
    expect(state.sources[2].predicate).toBe(false)
    expect(state.candidateSealed).toBe(false)
  })

  it('seals the exact vector on the opening transition', () => {
    const state = deriveChamberState(run, 13)
    expect(state.currentJointAdmissible).toBe(true)
    expect(state.candidateSealed).toBe(true)
    expect(state.liveSequenceVector).toEqual(state.candidateFrozenVector)
  })

  it('preserves the frozen vector after the post-seal mutation', () => {
    const sealed = deriveChamberState(run, 13)
    const probed = deriveChamberState(run, 14)
    expect(probed.liveSequenceVector[0]).toBe(sealed.liveSequenceVector[0] + 1)
    expect(probed.candidateFrozenVector).toEqual(sealed.candidateFrozenVector)
    expect(probed.postSealDivergence).toBe(true)
  })
})
