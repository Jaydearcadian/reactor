import { adaptM6Evidence } from './adapt-m6'
import { createDevelopmentFixture } from './development-fixture'
import type { ChamberRun } from './chamber-run'

export async function loadChamberRun(): Promise<ChamberRun> {
  try {
    const response = await fetch('/data/m6-essentiality-latest.json', { cache: 'no-store' })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return adaptM6Evidence(await response.json())
  } catch (error) {
    console.info('Reactor Chamber: local M6 evidence unavailable; using labelled development fixture.', error)
    return createDevelopmentFixture()
  }
}
