import { useEffect, useMemo, useState } from 'react'
import { ChamberScene } from './scene/ChamberScene'
import { deriveChamberState } from './data/derive-state'
import { loadChamberRun } from './data/load-run'
import { CHAMBER_STAGES } from './data/chamber-run'
import { EXPERIMENTS } from './data/experiment-lineage'
import type { ChamberRun, ChamberStage, SourceId } from './data/chamber-run'

const REPO = 'https://github.com/Jaydearcadian/reactor/blob/main'
const REPO_TREE = 'https://github.com/Jaydearcadian/reactor/tree/main'
const percent = (value: number | null) => value == null ? '—' : `${(value * 100).toFixed(2)}%`
const formatVector = (vector: number[] | null) => vector ? `[${vector.join(', ')}]` : '—'

const EVIDENCE = {
  productTruth: `${REPO}/PRODUCT_TRUTH.md`,
  stateMachine: `${REPO}/STATE_MACHINE.md`,
  m3: `${REPO}/M3_MAGICBLOCK.md`,
  m4: `${REPO}/README.md#L129-L181`,
  m5a: `${REPO}/M5_TRANSITION_COUPLED_RESULT.md`,
  m5b: `${REPO}/M5B_SMOKE_RESULT.md`,
  m6Protocol: `${REPO}/M6_ESSENTIALITY_BENCHMARK.md`,
  m6Result: `${REPO}/M6_ESSENTIALITY_RESULT.md`,
  m6Archive: `${REPO_TREE}/experiment/results/archive`,
  m6Runner: `${REPO}/scripts/run_m6_essentiality_local.mjs`,
  m7: `${REPO}/M7_KEEPER_EQUIVALENCE_BENCHMARK.md`,
}

function EvidenceLinks({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="evidence-links">
      {items.map(([label, href]) => (
        <a key={href} href={href} target="_blank" rel="noreferrer">{label} ↗</a>
      ))}
    </div>
  )
}

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

  if (!run || !state) return <main className="research-loading">REACTOR / LOADING EVIDENCE</main>

  const measured = run.evidenceMode === 'local-benchmark'
  const evidenceLabel = measured ? 'LOCAL BENCHMARK EVIDENCE' : 'DEVELOPMENT FIXTURE'
  const hotTransitions = Math.max(0, (run.candidate.sealedAt ?? state.maxCursor) || state.maxCursor)

  return (
    <div className="research-shell">
      <header className="research-topbar">
        <a className="brand" href="#overview">REACTOR</a>
        <nav aria-label="Submission navigation">
          <a href="#why">Why</a>
          <a href="#reactor">Reactor</a>
          <a href="#magicblock">MagicBlock</a>
          <a href="#m6-interactive">Demo</a>
          <a href="#evidence">Evidence</a>
          <a href="#experiments">Research</a>
        </nav>
        <span className="evidence-badge" data-mode={run.evidenceMode}>{evidenceLabel}</span>
      </header>

      <main>
        <section id="overview" className="hero-research section-block">
          <div className="section-kicker">PERSISTENT EXACT-STATE COORDINATION</div>
          <div className="hero-grid">
            <div>
              <h1>Retry objectives, not transactions.</h1>
              <p className="hero-lede">
                Reactor is a coordination runtime for persistent objectives in fast-moving onchain systems. It keeps an objective alive across independently changing authenticated state, freezes the exact joint state that authorizes execution, and carries that decision into bounded canonical settlement.
              </p>
              <div className="hero-actions">
                <a href="#m6-interactive">Explore the M6 run ↓</a>
                <a href="https://github.com/Jaydearcadian/reactor" target="_blank" rel="noreferrer">Open repository ↗</a>
              </div>
            </div>
            <aside className="current-result" data-verdict={run.verdict}>
              <div className="eyebrow">MEASURED MAGICBLOCK EDGE / M6</div>
              <div className="result-density">
                <span>{measured ? hotTransitions : '—'}</span>
                <small>authenticated hot transitions</small>
                <i>→</i>
                <span>{measured ? '1' : '—'}</span>
                <small>verified completion</small>
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
              <EvidenceLinks items={[["M6 result", EVIDENCE.m6Result], ["Raw archive", EVIDENCE.m6Archive]]} />
            </aside>
          </div>
        </section>

        <section id="why" className="section-block qa-section">
          <div className="section-kicker">WHY NOW?</div>
          <div className="qa-grid">
            <div>
              <h2>What happens when chains become faster than applications can safely coordinate around changing state?</h2>
            </div>
            <div className="answer-block">
              <span>ANSWER</span>
              <p>Execution speed stops being the only bottleneck. Faster state change creates more stale observations, more concurrent actors and more automation competing over shared state. Reactor explores the coordination layer between an objective and the transaction that eventually executes it.</p>
              <div className="speed-sequence">
                <code>t=0ms&nbsp;&nbsp;&nbsp;price ✓ · liquidity ✓ · risk ✓ · authority ✓</code>
                <code>t=30ms&nbsp;&nbsp;inventory changes</code>
                <code>t=55ms&nbsp;&nbsp;another actor consumes liquidity</code>
                <code>t=80ms&nbsp;&nbsp;price moves</code>
              </div>
              <strong className="thesis-line">Fast execution without exact-state binding can become fast stale execution.</strong>
            </div>
          </div>
          <div className="layer-stack">
            <div><span>OBJECTIVE</span><strong>What outcome should become true?</strong></div>
            <div className="reactor-layer"><span>REACTOR / COORDINATION</span><strong>When is it safely executable, and under which exact state?</strong></div>
            <div><span>EXECUTION</span><strong>Land the bounded action.</strong></div>
            <div><span>VERIFICATION</span><strong>Did the intended outcome actually occur?</strong></div>
          </div>
        </section>

        <section id="reactor" className="section-block qa-section">
          <div className="section-kicker">WHAT IS REACTOR?</div>
          <div className="qa-grid">
            <div><h2>How should a system pursue an objective when the state required for safe execution keeps changing?</h2></div>
            <div className="answer-block">
              <span>ANSWER</span>
              <p>Reactor makes the objective persistent. Authenticated state sources can keep evolving; when their exact current versions become jointly admissible, Reactor freezes that configuration into an immutable candidate, revalidates it against canonical authority, executes a bounded action, and records a verified outcome.</p>
              <EvidenceLinks items={[["Product truth", EVIDENCE.productTruth], ["State machine", EVIDENCE.stateMachine], ["M3 lifecycle proof", EVIDENCE.m3]]} />
            </div>
          </div>
          <div className="lifecycle-strip">
            <span>Persistent objective</span><i>→</i><span>Authenticated state</span><i>→</i><span>Exact alignment</span><i>→</i><span>Frozen candidate</span><i>→</i><span>ExecutionLock</span><i>→</i><span>Receipt</span>
          </div>
        </section>

        <section id="users" className="section-block audience-section">
          <div className="section-heading">
            <div><div className="section-kicker">WHO IS IT FOR?</div><h2>Systems whose objectives outlive individual transactions.</h2></div>
            <p>Reactor is not agent-only infrastructure. The useful boundary is persistent objectives + independently changing state + exact-state authorization + bounded execution.</p>
          </div>
          <div className="audience-grid">
            <article><span>AUTONOMOUS TREASURIES</span><p>Maintain leverage, exposure, liquidity or collateral health while oracle, route and policy state change.</p></article>
            <article><span>PROTOCOL RISK SYSTEMS</span><p>Coordinate risk actions across independently controlled feeds, positions, reserves and policy state.</p></article>
            <article><span>KEEPERS / AUTOMATION</span><p>Pursue a verified target state instead of replaying transaction bytes derived from stale observations.</p></article>
            <article><span>MULTI-PARTY SYSTEMS</span><p>Coordinate when no single actor controls every transition and the relevant state cannot simply be co-bundled by one authority.</p></article>
            <article><span>AI AGENTS</span><p>Keep high-frequency deterministic coordination outside expensive reasoning loops and invoke inference when a meaningful state transition warrants it.</p></article>
          </div>
          <div className="forward-note"><span>FORWARD RESEARCH / INFERENCE COST</span><p>Reactor has not yet benchmarked model-call savings. A future axis is inference amplification: model calls, tokens and inference spend per verified objective completion when deterministic state churn is handled by Reactor versus a naïve agent re-evaluation loop.</p></div>
        </section>

        <section id="magicblock" className="section-block qa-section magicblock-section">
          <div className="section-kicker">WHY MAGICBLOCK?</div>
          <div className="qa-grid">
            <div><h2>Should every intermediate coordination transition become canonical Solana work?</h2></div>
            <div className="answer-block">
              <span>ANSWER</span>
              <p>No. Reactor delegates its rapidly changing <code>ConditionState</code> and <code>SessionCandidate</code> accounts into a MagicBlock Ephemeral Rollup. Solana retains the <code>Path</code>, <code>Objective</code>, <code>Vault</code>, canonical <code>ExecutionLock</code>, settlement and <code>Receipt</code>.</p>
              <p className="thesis-line">MagicBlock is the hot coordination substrate. Solana remains the canonical economic authority.</p>
              <EvidenceLinks items={[["M3 MagicBlock integration", EVIDENCE.m3]]} />
            </div>
          </div>
          <div className="authority-split">
            <div><span>MAGICBLOCK ER / HOT</span><strong>ConditionState × N</strong><strong>SessionCandidate</strong><small>authenticated transitions · exact evaluation · candidate sealing</small></div>
            <i>candidate commit →</i>
            <div><span>SOLANA / CANONICAL</span><strong>Path · Objective · Vault</strong><strong>ExecutionLock · Settlement · Receipt</strong><small>authority · economic state · verified outcome</small></div>
          </div>
        </section>

        <section id="edge" className="section-block qa-section edge-section">
          <div className="section-kicker">DID THE ER CREATE AN EDGE?</div>
          <div className="qa-grid">
            <div><h2>Does moving hot coordination into the ER materially improve Reactor without weakening correctness?</h2></div>
            <div className="answer-block">
              <span>ANSWER</span>
              <p><strong>Yes, in the measured high-coordination-density M6 fixture.</strong> Both treatments reached the same verified objective completion with zero false or stale seals and an immutable candidate, while canonical coordination fell from 123 transactions to 10.</p>
              <EvidenceLinks items={[["Frozen M6 protocol", EVIDENCE.m6Protocol], ["M6 PASS result", EVIDENCE.m6Result], ["Immutable JSON archive", EVIDENCE.m6Archive], ["Runner", EVIDENCE.m6Runner]]} />
            </div>
          </div>
          <div className="edge-metrics">
            <div><span>SOLANA CANONICAL</span><strong>{run.comparison.solanaCanonicalTx ?? '—'}</strong><small>coordination tx</small></div>
            <div><span>MAGICBLOCK PATH</span><strong>{run.comparison.magicblockCanonicalTx ?? '—'}</strong><small>coordination tx incl. delegation</small></div>
            <div><span>REDUCTION</span><strong>{percent(run.comparison.reduction)}</strong><small>frozen threshold {percent(run.comparison.threshold)}</small></div>
          </div>
          <div className="secondary-evidence">
            <div><span>M4 / CAPTURE</span><p>MagicBlock reactive reached 99% exact capture while ordinary reactive Solana reached 2.33%. Aggressive speculative Solana also reached 99%, but required 1,506 attempts for 297 captures, exposing coordination amplification rather than a fundamental capability gap.</p><a href={EVIDENCE.m4} target="_blank" rel="noreferrer">View M4 record ↗</a></div>
            <div><span>M5a / LOCAL HOT PATH</span><p>The same transition-coupled instruction completed 10/10 correctly on both runtimes. Local mean submit→processed was 386.274ms on Solana and 29.369ms on the ER for that transaction shape. M5b later showed this is not a generic scaling claim.</p><a href={EVIDENCE.m5a} target="_blank" rel="noreferrer">View M5a evidence ↗</a></div>
          </div>
        </section>

        <section id="m6-interactive" className="section-block m6-section">
          <div className="section-heading">
            <div><div className="section-kicker">LIVE EVIDENCE / M6 RECONSTRUCTION</div><h2>One objective. Many authenticated transitions. One canonical outcome.</h2></div>
            <p>Scrub the run, isolate any source, watch the persistent blocker open, inspect the frozen sequence vector, and move through the hot-state → canonical-authority handoff.</p>
          </div>
          <div className="m6-definition">
            <div><span>COORDINATION DENSITY</span><strong>authenticated hot-state transitions / canonical verified outcomes</strong></div>
            <div><span>FIXTURE</span><strong>{measured ? `${Math.max(0, hotTransitions - 1)} churn + 1 opening → 1 verified completion` : 'development fixture'}</strong></div>
            <div><span>PERSISTENT BLOCKER</span><strong>C2 = false until the opening transition</strong></div>
          </div>
          <div className="interactive-frame">
            <div className="scene-panel" aria-label="M6 experiment reconstruction"><ChamberScene run={run} state={state} stage={stage} selectedSource={selectedSource} /></div>
            <aside className="interactive-notes">
              <div className="stage-tabs" aria-label="M6 reconstruction stage">
                {CHAMBER_STAGES.map((item, index) => <button key={item} type="button" aria-pressed={stage === item} onClick={() => setStage(item)}>{String(index + 1).padStart(2, '0')} {item.toUpperCase()}</button>)}
              </div>
              <div className="source-tabs" aria-label="Condition source">
                {run.sources.map((source) => <button key={source.id} type="button" aria-pressed={selectedSource === source.id} onClick={() => setSelectedSource(source.id)}>{source.id}</button>)}
              </div>
              <div className="state-readout">
                <div><span>transition</span><strong>{state.cursor} / {state.maxCursor}</strong></div>
                <div><span>phase</span><strong>{state.activeTransition?.phase ?? 'initial'}</strong></div>
                <div><span>selected source</span><strong>{selectedSource}</strong></div>
                <div><span>predicate</span><strong>{String(state.sources[Number(selectedSource.slice(1))].predicate)}</strong></div>
                <div><span>live vector</span><code>{formatVector(state.liveSequenceVector)}</code></div>
                <div><span>sealed vector</span><code>{formatVector(state.candidateFrozenVector)}</code></div>
              </div>
              <input className="m6-slider" aria-label="M6 transition" type="range" min={0} max={state.maxCursor} value={state.cursor} onChange={(event) => setCursor(Number(event.target.value))} />
              <div className="slider-labels"><span>0</span><span>opening {run.candidate.sealedAt ?? '—'}</span><span>{state.maxCursor}</span></div>
            </aside>
          </div>
          <div className="m6-result-table">
            <div className="table-head"><span>MEASURED M6 RESULT</span><span>SOLANA</span><span>MAGICBLOCK</span></div>
            <div><span>objective-relevant hot transitions</span><strong>{measured ? hotTransitions : '—'}</strong><strong>{measured ? hotTransitions : '—'}</strong></div>
            <div><span>verified completion</span><strong>{measured ? '✓' : '—'}</strong><strong>{measured ? '✓' : '—'}</strong></div>
            <div><span>false / stale seals</span><strong>{measured ? '0 / 0' : '—'}</strong><strong>{measured ? '0 / 0' : '—'}</strong></div>
            <div><span>candidate immutable</span><strong>{measured ? '✓' : '—'}</strong><strong>{measured ? '✓' : '—'}</strong></div>
            <div className="table-emphasis"><span>canonical coordination tx</span><strong>{run.comparison.solanaCanonicalTx ?? '—'}</strong><strong>{run.comparison.magicblockCanonicalTx ?? '—'}</strong></div>
          </div>
        </section>

        <section id="evidence" className="section-block evidence-section">
          <div className="section-heading">
            <div><div className="section-kicker">EVIDENCE</div><h2>Every submission claim points back to the repository.</h2></div>
            <p>The benchmark protocol, result, runner and immutable raw evidence are separate artifacts so a narrative page cannot silently rewrite the experiment.</p>
          </div>
          <div className="evidence-files">
            <a href={EVIDENCE.m3} target="_blank" rel="noreferrer"><code>M3_MAGICBLOCK.md</code><span>ER → Solana lifecycle proof ↗</span></a>
            <a href={EVIDENCE.m6Protocol} target="_blank" rel="noreferrer"><code>M6_ESSENTIALITY_BENCHMARK.md</code><span>frozen pre-result protocol ↗</span></a>
            <a href={EVIDENCE.m6Result} target="_blank" rel="noreferrer"><code>M6_ESSENTIALITY_RESULT.md</code><span>bounded PASS interpretation ↗</span></a>
            <a href={EVIDENCE.m6Archive} target="_blank" rel="noreferrer"><code>experiment/results/archive/</code><span>immutable generated evidence ↗</span></a>
            <a href={EVIDENCE.m6Runner} target="_blank" rel="noreferrer"><code>scripts/run_m6_essentiality_local.mjs</code><span>benchmark implementation ↗</span></a>
            <a href={EVIDENCE.m7} target="_blank" rel="noreferrer"><code>M7_KEEPER_EQUIVALENCE_BENCHMARK.md</code><span>next falsification target ↗</span></a>
          </div>
          <div className="gate-grid">
            {run.gates.map((gate) => <div key={gate.id} data-pass={gate.pass}><span>{gate.id.replaceAll('_', ' ')}</span><strong>{gate.pass ? 'PASS' : 'FAIL'}</strong><small>observed {String(gate.observed)} · threshold {String(gate.threshold)}</small></div>)}
          </div>
        </section>

        <section id="experiments" className="section-block experiments-section">
          <div className="section-heading">
            <div><div className="section-kicker">HOW WE CHALLENGED THE ARCHITECTURE</div><h2>The experiments support Reactor. They are not Reactor.</h2></div>
            <p>M4 removed the strongest capability-superiority claim. M5b falsified naïve horizontal scaling. M6 found a workload where the hot-state split materially compressed canonical coordination. M7 remains the next adversarial test.</p>
          </div>
          <div className="experiment-index" aria-label="Experiment index">
            {EXPERIMENTS.map((experiment) => <a key={experiment.id} href={`#${experiment.id}`} data-status={experiment.status}><span>{experiment.id.toUpperCase()}</span><strong>{experiment.title}</strong><em>{experiment.status.toUpperCase()}</em></a>)}
          </div>
          <div className="experiment-records">
            {EXPERIMENTS.map((experiment) => (
              <article id={experiment.id} className="experiment-record" key={experiment.id} data-status={experiment.status}>
                <header><div><div className="experiment-id">{experiment.id.toUpperCase()}</div><h3>{experiment.title}</h3></div><span className="status-label">{experiment.status.toUpperCase()}</span></header>
                <div className="experiment-question"><span>QUESTION</span><p>{experiment.question}</p></div>
                {experiment.hypothesis && <div className="experiment-hypothesis"><span>HYPOTHESIS</span><p>{experiment.hypothesis}</p></div>}
                <div className="experiment-columns"><div><span className="column-label">FIXTURE</span><ul>{experiment.fixture.map((item) => <li key={item}>{item}</li>)}</ul></div><div><span className="column-label">OBSERVATION</span><ul>{experiment.observations.map((item) => <li key={item}>{item}</li>)}</ul></div></div>
                <div className="experiment-conclusion"><div><span>RESULT</span><strong>{experiment.result}</strong></div><div><span>WHAT CHANGED NEXT</span><p>{experiment.changedNext}</p></div></div>
              </article>
            ))}
          </div>
        </section>

        <footer className="submission-footer">
          <strong>REACTOR</strong>
          <p>Keep the objective persistent. Keep coordination hot. Keep economic authority canonical.</p>
          <a href="https://github.com/Jaydearcadian/reactor" target="_blank" rel="noreferrer">github.com/Jaydearcadian/reactor ↗</a>
        </footer>
      </main>
    </div>
  )
}
