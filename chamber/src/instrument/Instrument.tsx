import { CHAMBER_STAGES } from '../data/chamber-run'
import type { ChamberRun, ChamberStage, ChamberState, SourceId } from '../data/chamber-run'

const formatVector = (vector: number[] | null) => vector ? `[ ${vector.map((value) => String(value).padStart(2, '0')).join('  ')} ]` : '—'
const compact = (value?: string) => value ? `${value.slice(0, 5)}…${value.slice(-4)}` : '—'
const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`

const STAGE_COPY: Record<ChamberStage, { index: string; title: string; detail: string }> = {
  observe: { index: '01', title: 'OBSERVE', detail: 'One persistent objective. Six independently authenticated histories.' },
  align: { index: '02', title: 'ALIGN', detail: 'Inspect exact joint state without collapsing source lineage.' },
  freeze: { index: '03', title: 'FREEZE', detail: 'The executable sequence fingerprint becomes immutable.' },
  commit: { index: '04', title: 'COMMIT', detail: 'Hot state yields one bounded candidate back to canonical Solana.' },
  verify: { index: '05', title: 'VERIFY', detail: 'Compare canonical work only after correctness is established.' },
}

export function Instrument({
  run,
  state,
  stage,
  setStage,
  selectedSource,
  setSelectedSource,
  setCursor,
  playing,
  setPlaying,
}: {
  run: ChamberRun
  state: ChamberState
  stage: ChamberStage
  setStage: (stage: ChamberStage) => void
  selectedSource: SourceId
  setSelectedSource: (source: SourceId) => void
  setCursor: (cursor: number) => void
  playing: boolean
  setPlaying: (playing: boolean) => void
}) {
  const source = state.sources[Number(selectedSource.slice(1))]
  const active = state.activeTransition
  const evidenceLabel = run.evidenceMode === 'local-benchmark' ? 'LOCAL BENCHMARK EVIDENCE' : 'DEVELOPMENT FIXTURE'
  const stageCopy = STAGE_COPY[stage]
  const sealAvailable = run.candidate.sealedAt != null
  const canJumpToSeal = sealAvailable && !state.candidateSealed

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
        <div className="objective-status" data-ready={state.currentJointAdmissible} data-sealed={state.candidateSealed}>
          <span className="status-dot" />
          {state.candidateSealed ? 'EXACT STATE SEALED' : state.currentJointAdmissible ? 'EXACT JOINT STATE' : 'WAITING FOR ALIGNMENT'}
        </div>
      </section>

      <section className="stage-readout" aria-live="polite">
        <div className="stage-number">{stageCopy.index}</div>
        <div>
          <div className="eyebrow">CONCEPTUAL DEPTH</div>
          <strong>{stageCopy.title}</strong>
          <p>{stageCopy.detail}</p>
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
        {canJumpToSeal && (stage === 'freeze' || stage === 'commit' || stage === 'verify') && (
          <button className="jump-seal" type="button" onClick={() => setCursor(run.candidate.sealedAt!)}>
            JUMP TO SEAL →
          </button>
        )}
      </section>

      <aside className="aperture" aria-label={`${selectedSource} evidence`} data-stage={stage}>
        <div className="aperture-rule" />
        {stage === 'verify' ? (
          <VerifyEvidence run={run} />
        ) : stage === 'commit' ? (
          <CommitEvidence run={run} state={state} />
        ) : (
          <>
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
              <div><dt>runtime</dt><dd>{run.evidenceMode === 'local-benchmark' ? 'ER hot state' : 'fixture'}</dd></div>
              <div><dt>signature</dt><dd>{compact(active?.signature ?? undefined)}</dd></div>
              <div><dt>latency</dt><dd>{active?.submitToProcessedMs != null ? `${active.submitToProcessedMs.toFixed(1)} ms` : '—'}</dd></div>
            </dl>
            {stage === 'freeze' && (
              <div className="freeze-proof">
                <span>CANDIDATE</span>
                <strong>{state.candidateSealed ? 'SEALED' : 'NOT YET SEALED'}</strong>
                <code>{formatVector(state.candidateFrozenVector)}</code>
              </div>
            )}
          </>
        )}

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

      <footer className="stage-index" aria-label="Conceptual depth">
        {CHAMBER_STAGES.map((item, index) => (
          <button
            type="button"
            key={item}
            className={stage === item ? 'active' : ''}
            aria-pressed={stage === item}
            onClick={() => setStage(item)}
          >
            {String(index + 1).padStart(2, '0')} {item.toUpperCase()}
          </button>
        ))}
      </footer>
    </div>
  )
}

function CommitEvidence({ run, state }: { run: ChamberRun; state: ChamberState }) {
  return (
    <div className="commit-evidence">
      <div className="aperture-head">
        <div><span>AUTHORITY</span><small>RUNTIME BOUNDARY</small></div>
        <strong data-valid={state.candidateSealed}>{state.candidateSealed ? 'BOUND' : 'PENDING'}</strong>
      </div>
      <div className="authority-path">
        <div><span>HOT STATE</span><strong>MagicBlock ER</strong><small>conditions + candidate</small></div>
        <i />
        <div><span>CANONICAL</span><strong>Solana</strong><small>Path · Objective · Vault</small></div>
      </div>
      <dl>
        <div><dt>candidate sealed</dt><dd>{String(state.candidateSealed)}</dd></div>
        <div><dt>canonical vault authority in ER</dt><dd>false</dd></div>
        <div><dt>candidate commitment</dt><dd>{state.candidateSealed ? 'required' : 'not available'}</dd></div>
        <div><dt>bounded transfer</dt><dd>{run.objective.boundedTransferLamports.toLocaleString()} lamports</dd></div>
      </dl>
    </div>
  )
}

function VerifyEvidence({ run }: { run: ChamberRun }) {
  const verdict = run.verdict.toUpperCase()
  return (
    <div className="verify-evidence">
      <div className="aperture-head">
        <div><span>{verdict}</span><small>M6 / FROZEN GATE</small></div>
        <strong data-valid={run.verdict === 'pass'}>{run.evidenceMode === 'local-benchmark' ? 'MEASURED' : 'FIXTURE'}</strong>
      </div>
      <div className="comparison-readout">
        <div><span>SOLANA</span><strong>{run.comparison.solanaCanonicalTx ?? '—'}</strong><small>canonical tx</small></div>
        <i>→</i>
        <div><span>MAGICBLOCK</span><strong>{run.comparison.magicblockCanonicalTx ?? '—'}</strong><small>canonical tx</small></div>
      </div>
      <div className="reduction-readout">
        <span>CANONICAL WORK REDUCTION</span>
        <strong>{percent(run.comparison.reduction)}</strong>
        <small>frozen threshold {percent(run.comparison.threshold)}</small>
      </div>
      <div className="gate-list">
        {run.gates.map((gate) => (
          <div key={gate.id} data-pass={gate.pass}>
            <i />
            <span>{gate.id.replaceAll('_', ' ')}</span>
            <strong>{gate.pass ? 'PASS' : 'FAIL'}</strong>
          </div>
        ))}
      </div>
    </div>
  )
}
