import type { ChamberRun, ChamberState, SourceId } from '../data/chamber-run'

const formatVector = (vector: number[] | null) => vector ? `[ ${vector.map((value) => String(value).padStart(2, '0')).join('  ')} ]` : '—'
const compact = (value?: string) => value ? `${value.slice(0, 5)}…${value.slice(-4)}` : '—'

export function Instrument({
  run,
  state,
  selectedSource,
  setSelectedSource,
  setCursor,
  playing,
  setPlaying,
}: {
  run: ChamberRun
  state: ChamberState
  selectedSource: SourceId
  setSelectedSource: (source: SourceId) => void
  setCursor: (cursor: number) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
}) {
  const source = state.sources[Number(selectedSource.slice(1))]
  const active = state.activeTransition
  const evidenceLabel = run.evidenceMode === 'local-benchmark' ? 'LOCAL BENCHMARK EVIDENCE' : 'DEVELOPMENT FIXTURE'

  return (
    <div className="instrument">
      <header className="topbar">
        <div>
          <div className="eyebrow">REACTOR / CHAMBER</div>
          <div className="evidence-state" data-mode={run.evidenceMode}>{evidenceLabel}</div>
        </div>
        <nav aria-label="Chamber views">
          <span aria-current="page">CHAMBER</span>
          <span>METHOD</span>
        </nav>
      </header>

      <section className="objective-readout" aria-label="Objective status">
        <div className="eyebrow">OBJECTIVE 001</div>
        <h1>Reduce exposure</h1>
        <div className="exposure-line">
          <span>{run.objective.initialExposure}</span>
          <i aria-hidden="true" />
          <span>≤ {run.objective.targetExposure}</span>
        </div>
        <div className="objective-status" data-ready={state.currentJointAdmissible}>
          <span className="status-dot" />
          {state.currentJointAdmissible ? 'EXACT JOINT STATE' : 'WAITING FOR ALIGNMENT'}
        </div>
      </section>

      <section className="sequence-readout" aria-live="polite">
        <div className="eyebrow">LIVE SEQUENCE</div>
        <div className="sequence-vector">{formatVector(state.liveSequenceVector)}</div>
        {state.candidateSealed && (
          <div className="frozen-vector">
            <span>SEALED</span>
            <strong>{formatVector(state.candidateFrozenVector)}</strong>
            {state.postSealDivergence && <em>immutable / live state diverged</em>}
          </div>
        )}
      </section>

      <aside className="aperture" aria-label={`${selectedSource} evidence`}>
        <div className="aperture-rule" />
        <div className="aperture-head">
          <div>
            <span>{selectedSource}</span>
            <small>CONDITION STATE</small>
          </div>
          <strong data-valid={source.predicate}>{source.predicate ? 'VALID' : 'BLOCKING'}</strong>
        </div>
        <dl>
          <div><dt>sequence</dt><dd>{source.sequence}</dd></div>
          <div><dt>predicate</dt><dd>{String(source.predicate)}</dd></div>
          <div><dt>last transition</dt><dd>{String(source.lastTransitionOrdinal).padStart(3, '0')}</dd></div>
          <div><dt>runtime</dt><dd>{run.evidenceMode === 'local-benchmark' ? 'ER' : 'fixture'}</dd></div>
          <div><dt>signature</dt><dd>{compact(active?.signature ?? undefined)}</dd></div>
          <div><dt>latency</dt><dd>{active?.submitToProcessedMs != null ? `${active.submitToProcessedMs.toFixed(1)} ms` : '—'}</dd></div>
        </dl>
        <div className="source-switch" aria-label="Condition source">
          {run.sources.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={selectedSource === item.id}
              onClick={() => setSelectedSource(item.id)}
            >
              {item.id}
            </button>
          ))}
        </div>
      </aside>

      <section className="timeline" aria-label="Authenticated transition timeline">
        <div className="timeline-meta">
          <button type="button" className="play" onClick={() => setPlaying(!playing)}>{playing ? 'PAUSE' : 'PLAY'}</button>
          <span>{String(state.cursor).padStart(3, '0')}</span>
          <span className="phase">{active?.phase?.toUpperCase() ?? 'INITIAL'}</span>
          <span>{String(state.maxCursor).padStart(3, '0')}</span>
        </div>
        <input
          aria-label="Transition"
          type="range"
          min={0}
          max={state.maxCursor}
          value={state.cursor}
          onChange={(event) => setCursor(Number(event.target.value))}
        />
        <div className="timeline-events" aria-hidden="true">
          {run.transitions.map((transition) => (
            <i
              key={transition.ordinal}
              className={transition.phase}
              style={{ left: `${(transition.ordinal / state.maxCursor) * 100}%` }}
            />
          ))}
        </div>
      </section>

      <footer className="stage-index">
        <span className="active">01 OBSERVE</span>
        <span>02 ALIGN</span>
        <span>03 FREEZE</span>
        <span>04 COMMIT</span>
        <span>05 VERIFY</span>
      </footer>
    </div>
  )
}
