import { useEffect, useMemo, useState } from 'react'
import { ChamberScene } from './scene/ChamberScene'
import { deriveChamberState } from './data/derive-state'
import { loadChamberRun } from './data/load-run'
import { CHAMBER_STAGES } from './data/chamber-run'
import { EXPERIMENTS } from './data/experiment-lineage'
import type { ChamberRun, ChamberStage, SourceId } from './data/chamber-run'

const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`
const formatVector = (vector: number[] | null) => vector ? `[${vector.join(', ')}]` : '—'

export default function App() {
  const [run, setRun] = useState<ChamberRun | null>(null)
  const [cursor, setCursor] = useState(0)
  const [stage, setStage] = useState<ChamberStage>('observe')
  const [selectedSource, setSelectedSource] = useState<SourceId>('C2')

  useEffect(() => {
    let cancelled = false
    loadChamberRun().then((loaded) => {
      if (cancelled) return
      setRun(loaded)
      setCursor(loaded.transitions.at(-1)?.ordinal ?? 0)
    })
    return () => { cancelled = true }
  }, [])

  const state = useMemo(() => run ? deriveChamberState(run, cursor) : null, [run, cursor])

  if (!run || !state) {
    return <main className="research-loading">REACTOR / LOADING EXPERIMENT RECORD</main>
  }

  const evidenceLabel = run.evidenceMode === 'local-benchmark' ? 'LOCAL BENCHMARK EVIDENCE' : 'DEVELOPMENT FIXTURE'
  const verdict = run.verdict.toUpperCase()

  return (
    <div className="research-shell">
      <header className="research-topbar">
        <a className="brand" href="#overview">REACTOR</a>
        <nav aria-label="Research navigation">
          <a href="#overview">Overview</a>
          <a href="#experiments">Experiments</a>
          <a href="#m6-interactive">M6 Interactive</a>
          <a href="#method">Method</a>
          <a href="#evidence">Evidence</a>
        </nav>
        <span className="evidence-badge" data-mode={run.evidenceMode}>{evidenceLabel}</span>
      </header>

      <main>
        <section id="overview" className="hero-research section-block">
          <div className="section-kicker">OPEN-SOURCE SYSTEMS RESEARCH</div>
          <div className="hero-grid">
            <div>
              <h1>Persistent objective coordination for independently evolving authenticated state.</h1>
              <p className="hero-lede">
                Reactor asks when a dedicated hot-state coordination runtime is materially useful, what guarantees it preserves,
                and where simpler alternatives invalidate the architecture.
              </p>
              <div className="research-question">
                <span>Current research question</span>
                <strong>When does an Ephemeral Rollup become useful infrastructure rather than decorative infrastructure?</strong>
              </div>
            </div>
            <aside className="current-result" data-verdict={run.verdict}>
              <div className="eyebrow">CURRENT RESULT / M6</div>
              <strong className="result-verdict">{verdict}</strong>
              <div className="result-density">
                <span>121</span>
                <small>authenticated hot transitions</small>
                <i>→</i>
                <span>1</span>
                <small>verified objective completion</small>
              </div>
              <div className="tx-comparison compact">
                <div><span>SOLANA</span><strong>{run.comparison.solanaCanonicalTx ?? '—'}</strong><small>canonical tx</small></div>
                <i>→</i>
                <div><span>MAGICBLOCK</span><strong>{run.comparison.magicblockCanonicalTx ?? '—'}</strong><small>canonical tx</small></div>
              </div>
              <div className="reduction-summary">
                <span>canonical-work reduction</span>
                <strong>{percent(run.comparison.reduction)}</strong>
                <small>frozen gate ≥ {percent(run.comparison.threshold)}</small>
              </div>
            </aside>
          </div>
        </section>

        <section id="experiments" className="section-block experiments-section">
          <div className="section-heading">
            <div>
              <div className="section-kicker">EXPERIMENT PROGRAM</div>
              <h2>The thesis changed when the evidence changed.</h2>
            </div>
            <p>
              Reactor is not a sequence of benchmark wins. M4 removed the strongest capture-superiority claim. M5b falsified the naive concurrency scaling thesis. M6 changed the scaling dimension and passed a precommitted gate.
            </p>
          </div>

          <div className="experiment-index" aria-label="Experiment index">
            {EXPERIMENTS.map((experiment) => (
              <a key={experiment.id} href={`#${experiment.id}`} data-status={experiment.status}>
                <span>{experiment.id.toUpperCase()}</span>
                <strong>{experiment.title}</strong>
                <em>{experiment.status.toUpperCase()}</em>
              </a>
            ))}
          </div>

          <div className="experiment-records">
            {EXPERIMENTS.map((experiment) => (
              <article id={experiment.id} className="experiment-record" key={experiment.id} data-status={experiment.status}>
                <header>
                  <div>
                    <div className="experiment-id">{experiment.id.toUpperCase()}</div>
                    <h3>{experiment.title}</h3>
                  </div>
                  <span className="status-label">{experiment.status.toUpperCase()}</span>
                </header>
                <div className="experiment-question">
                  <span>QUESTION</span>
                  <p>{experiment.question}</p>
                </div>
                {experiment.hypothesis && (
                  <div className="experiment-hypothesis">
                    <span>HYPOTHESIS</span>
                    <p>{experiment.hypothesis}</p>
                  </div>
                )}
                <div className="experiment-columns">
                  <div>
                    <span className="column-label">FIXTURE</span>
                    <ul>{experiment.fixture.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                  <div>
                    <span className="column-label">OBSERVATION</span>
                    <ul>{experiment.observations.map((item) => <li key={item}>{item}</li>)}</ul>
                  </div>
                </div>
                <div className="experiment-conclusion">
                  <div><span>RESULT</span><strong>{experiment.result}</strong></div>
                  <div><span>WHAT CHANGED NEXT</span><p>{experiment.changedNext}</p></div>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section id="m6-interactive" className="section-block m6-section">
          <div className="section-heading">
            <div>
              <div className="section-kicker">M6 / INTERACTIVE RUN</div>
              <h2>Coordination density, reconstructed from benchmark state.</h2>
            </div>
            <p>
              Scrub the authenticated transitions, inspect each source, watch C2 remain the blocker, then inspect the exact-state seal and the ER → Solana authority boundary. The visualization is a projection of the loaded evidence, not the source of truth.
            </p>
          </div>

          <div className="m6-definition">
            <div><span>COORDINATION DENSITY</span><strong>authenticated hot-state transitions / canonical verified outcomes</strong></div>
            <div><span>FIXTURE</span><strong>120 churn + 1 opening → 1 verified completion</strong></div>
            <div><span>PERSISTENT BLOCKER</span><strong>C2 = false until the opening transition</strong></div>
          </div>

          <div className="interactive-frame">
            <div className="scene-panel" aria-label="M6 experiment reconstruction">
              <ChamberScene run={run} state={state} stage={stage} selectedSource={selectedSource} />
            </div>
            <aside className="interactive-notes">
              <div className="stage-tabs" aria-label="M6 reconstruction stage">
                {CHAMBER_STAGES.map((item, index) => (
                  <button key={item} type="button" aria-pressed={stage === item} onClick={() => setStage(item)}>
                    {String(index + 1).padStart(2, '0')} {item.toUpperCase()}
                  </button>
                ))}
              </div>
              <div className="source-tabs" aria-label="Condition source">
                {run.sources.map((source) => (
                  <button key={source.id} type="button" aria-pressed={selectedSource === source.id} onClick={() => setSelectedSource(source.id)}>{source.id}</button>
                ))}
              </div>

              <div className="state-readout">
                <div><span>transition</span><strong>{state.cursor} / {state.maxCursor}</strong></div>
                <div><span>phase</span><strong>{state.activeTransition?.phase ?? 'initial'}</strong></div>
                <div><span>selected source</span><strong>{selectedSource}</strong></div>
                <div><span>predicate</span><strong>{String(state.sources[Number(selectedSource.slice(1))].predicate)}</strong></div>
                <div><span>live vector</span><code>{formatVector(state.liveSequenceVector)}</code></div>
                <div><span>sealed vector</span><code>{formatVector(state.candidateFrozenVector)}</code></div>
              </div>

              <input
                className="m6-slider"
                aria-label="M6 transition"
                type="range"
                min={0}
                max={state.maxCursor}
                value={state.cursor}
                onChange={(event) => setCursor(Number(event.target.value))}
              />
              <div className="slider-labels"><span>0</span><span>opening {run.candidate.sealedAt ?? '—'}</span><span>{state.maxCursor}</span></div>
            </aside>
          </div>

          <div className="m6-result-table">
            <div className="table-head"><span>MEASURED M6 RESULT</span><span>SOLANA</span><span>MAGICBLOCK</span></div>
            <div><span>objective-relevant hot transitions</span><strong>121</strong><strong>121</strong></div>
            <div><span>verified completion</span><strong>✓</strong><strong>✓</strong></div>
            <div><span>false seals</span><strong>0</strong><strong>0</strong></div>
            <div><span>stale seals</span><strong>0</strong><strong>0</strong></div>
            <div><span>candidate immutable</span><strong>✓</strong><strong>✓</strong></div>
            <div className="table-emphasis"><span>canonical coordination tx</span><strong>{run.comparison.solanaCanonicalTx ?? '—'}</strong><strong>{run.comparison.magicblockCanonicalTx ?? '—'}</strong></div>
          </div>

          <div className="interpretation-grid">
            <div>
              <span>WHAT M6 SUPPORTS</span>
              <p>A high-coordination-density Reactor objective can absorb authenticated transient state in an ER while preserving canonical Solana authority and materially reducing canonical coordination transactions in this local fixture.</p>
            </div>
            <div>
              <span>WHAT M6 DOES NOT PROVE</span>
              <ul>
                <li>MagicBlock is always faster.</li>
                <li>Solana cannot implement Reactor.</li>
                <li>Every objective should use an ER.</li>
                <li>Production fee savings or public throughput superiority.</li>
                <li>Reactor beats a semantics-equivalent keeper.</li>
              </ul>
            </div>
          </div>
        </section>

        <section id="method" className="section-block method-section">
          <div className="section-heading">
            <div><div className="section-kicker">METHOD</div><h2>Precommit the gate. Preserve failed experiments. Separate correctness from performance.</h2></div>
            <p>Reactor distinguishes submitted, acknowledged, observed and verified states. A signature is not a verified objective completion, and a local timing signal is not a production superiority claim.</p>
          </div>
          <div className="method-grid">
            <div><span>01 / FROZEN GATES</span><p>Success criteria are written before result collection when the experiment is intended to support a thesis claim.</p></div>
            <div><span>02 / HARNESS FAILURES</span><p>Invalid blockhash, TTL and runtime-payer failures stay in the record as benchmark-design failures rather than being converted into runtime evidence.</p></div>
            <div><span>03 / SAME SEMANTICS</span><p>Primary runtime comparisons use the same Reactor instruction and exact objective semantics on both treatments.</p></div>
            <div><span>04 / BOUNDED CLAIMS</span><p>Every result records what it supports and what it explicitly does not establish.</p></div>
          </div>
        </section>

        <section id="evidence" className="section-block evidence-section">
          <div className="section-heading">
            <div><div className="section-kicker">EVIDENCE</div><h2>The benchmark record remains inspectable.</h2></div>
            <p>Chamber consumes the generated M6 JSON. The frozen protocol, result record, archived raw evidence, runner and M7 null baseline remain separate artifacts.</p>
          </div>
          <div className="evidence-files">
            <code>M6_ESSENTIALITY_BENCHMARK.md</code>
            <code>M6_ESSENTIALITY_RESULT.md</code>
            <code>experiment/results/m6-essentiality-latest.json</code>
            <code>chamber/data/m6-essentiality-latest.json</code>
            <code>scripts/run_m6_essentiality_local.mjs</code>
            <code>M7_KEEPER_EQUIVALENCE_BENCHMARK.md</code>
          </div>
          <div className="gate-grid">
            {run.gates.map((gate) => (
              <div key={gate.id} data-pass={gate.pass}>
                <span>{gate.id.replaceAll('_', ' ')}</span>
                <strong>{gate.pass ? 'PASS' : 'FAIL'}</strong>
                <small>observed {String(gate.observed)} · threshold {String(gate.threshold)}</small>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  )
}
