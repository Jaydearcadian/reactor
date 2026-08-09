import { useEffect, useMemo, useRef, useState } from 'react'
import { ChamberScene } from './scene/ChamberScene'
import { Instrument } from './instrument/Instrument'
import { deriveChamberState } from './data/derive-state'
import { loadChamberRun } from './data/load-run'
import { CHAMBER_STAGES } from './data/chamber-run'
import type { ChamberRun, ChamberStage, SourceId } from './data/chamber-run'

const INTRO_KEY = 'reactor.chamber.intro.v1'

function queryCursor(max: number): number | null {
  const raw = new URLSearchParams(window.location.search).get('t')
  if (raw === null) return null
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? Math.max(0, Math.min(Math.trunc(parsed), max)) : null
}

function queryStage(): ChamberStage | null {
  const raw = new URLSearchParams(window.location.search).get('stage')?.toLowerCase()
  return CHAMBER_STAGES.includes(raw as ChamberStage) ? raw as ChamberStage : null
}

export default function App() {
  const [run, setRun] = useState<ChamberRun | null>(null)
  const [cursor, setCursorState] = useState(0)
  const [selectedSource, setSelectedSource] = useState<SourceId>('C2')
  const [playing, setPlaying] = useState(false)
  const [stage, setStageState] = useState<ChamberStage>('observe')
  const lastStageWheelAt = useRef(0)

  useEffect(() => {
    let cancelled = false
    loadChamberRun().then((loaded) => {
      if (cancelled) return
      setRun(loaded)
      const max = loaded.transitions.at(-1)?.ordinal ?? 0
      const deepLink = queryCursor(max)
      const deepStage = queryStage()
      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const introSeen = window.localStorage.getItem(INTRO_KEY) === 'seen'
      const initialCursor = deepLink ?? (introSeen || reducedMotion ? max : 0)
      setCursorState(initialCursor)
      setStageState(deepStage ?? 'observe')
      setPlaying(deepLink === null && !introSeen && !reducedMotion)
    })
    return () => { cancelled = true }
  }, [])

  const state = useMemo(() => run ? deriveChamberState(run, cursor) : null, [run, cursor])

  useEffect(() => {
    if (!run || !state || !playing) return
    const intervalMs = Math.max(48, Math.min(300, Math.round(6400 / Math.max(1, state.maxCursor))))
    const timer = window.setInterval(() => {
      setCursorState((current) => {
        if (current >= state.maxCursor) {
          window.clearInterval(timer)
          setPlaying(false)
          window.localStorage.setItem(INTRO_KEY, 'seen')
          return current
        }
        return current + 1
      })
    }, intervalMs)
    return () => window.clearInterval(timer)
  }, [playing, run, state?.maxCursor])

  useEffect(() => {
    if (!run) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLButtonElement) return
      if (event.key === 'ArrowLeft') setCursorState((value) => Math.max(0, value - 1))
      if (event.key === 'ArrowRight') setCursorState((value) => Math.min(run.transitions.at(-1)?.ordinal ?? 0, value + 1))
      if (event.key === 'ArrowUp' || event.key === 'PageUp') {
        event.preventDefault()
        setStageState((current) => CHAMBER_STAGES[Math.max(0, CHAMBER_STAGES.indexOf(current) - 1)])
      }
      if (event.key === 'ArrowDown' || event.key === 'PageDown') {
        event.preventDefault()
        setStageState((current) => CHAMBER_STAGES[Math.min(CHAMBER_STAGES.length - 1, CHAMBER_STAGES.indexOf(current) + 1)])
      }
      if (event.key === ' ') {
        event.preventDefault()
        setPlaying((value) => !value)
      }
      if (/^[1-6]$/.test(event.key)) setSelectedSource(`C${Number(event.key) - 1}` as SourceId)
      if (event.key === '0') setSelectedSource('C2')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [run])

  useEffect(() => {
    const onWheel = (event: WheelEvent) => {
      const target = event.target as HTMLElement | null
      if (target?.closest('.timeline, .aperture')) return
      if (Math.abs(event.deltaY) < 18) return
      const now = performance.now()
      if (now - lastStageWheelAt.current < 460) return
      lastStageWheelAt.current = now
      const direction = event.deltaY > 0 ? 1 : -1
      setStageState((current) => {
        const next = Math.max(0, Math.min(CHAMBER_STAGES.length - 1, CHAMBER_STAGES.indexOf(current) + direction))
        return CHAMBER_STAGES[next]
      })
    }
    window.addEventListener('wheel', onWheel, { passive: true })
    return () => window.removeEventListener('wheel', onWheel)
  }, [])

  const setCursor = (next: number) => {
    setPlaying(false)
    setCursorState(next)
    const url = new URL(window.location.href)
    url.searchParams.set('t', String(next))
    window.history.replaceState(null, '', url)
  }

  const setStage = (next: ChamberStage) => {
    setStageState(next)
    const url = new URL(window.location.href)
    url.searchParams.set('stage', next)
    window.history.replaceState(null, '', url)
  }

  if (!run || !state) {
    return <main className="loading"><span>REACTOR / CHAMBER</span><i /></main>
  }

  return (
    <main className="chamber-shell" data-evidence={run.evidenceMode} data-stage={stage}>
      <div className="scene-layer" aria-hidden="true">
        <ChamberScene run={run} state={state} stage={stage} selectedSource={selectedSource} />
      </div>
      <Instrument
        run={run}
        state={state}
        stage={stage}
        setStage={setStage}
        selectedSource={selectedSource}
        setSelectedSource={setSelectedSource}
        setCursor={setCursor}
        playing={playing}
        setPlaying={setPlaying}
      />
    </main>
  )
}
