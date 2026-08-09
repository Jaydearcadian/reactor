import { Canvas, useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ChamberRun, ChamberStage, ChamberState, SourceId } from '../data/chamber-run'

const PALETTE = {
  void: '#070808',
  line: '#a4ada6',
  dim: '#505854',
  white: '#eef2ee',
  mint: '#b9e6cc',
  amber: '#cda869',
  violet: '#777fa6',
  red: '#e66c56',
}

const SOURCE_X = [-3, -1.8, -0.6, 0.6, 1.8, 3]
const STAGE_CAMERA: Record<ChamberStage, { position: [number, number, number]; target: [number, number, number]; fov: number }> = {
  observe: { position: [0, 2.45, 6.5], target: [0, -0.05, -1.8], fov: 43 },
  align: { position: [0, 1.7, 5.3], target: [0, -0.05, -1.5], fov: 39 },
  freeze: { position: [0, 1.05, 4.15], target: [0, 0.08, -0.2], fov: 34 },
  commit: { position: [0.4, 2.15, 7.2], target: [0, 0.05, 0.65], fov: 42 },
  verify: { position: [0, 4.8, 0.15], target: [0, 0, 0.15], fov: 31 },
}

function InstrumentCamera({ stage }: { stage: ChamberStage }) {
  useFrame(({ camera, pointer }, delta) => {
    const preset = STAGE_CAMERA[stage]
    const parallax = stage === 'verify' ? 0 : 0.12
    camera.position.x = THREE.MathUtils.damp(camera.position.x, preset.position[0] + pointer.x * parallax, 3.4, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, preset.position[1] + pointer.y * parallax * 0.45, 3.4, delta)
    camera.position.z = THREE.MathUtils.damp(camera.position.z, preset.position[2], 3.4, delta)
    const perspective = camera as THREE.PerspectiveCamera
    perspective.fov = THREE.MathUtils.damp(perspective.fov, preset.fov, 3.2, delta)
    perspective.updateProjectionMatrix()
    camera.lookAt(...preset.target)
  })
  return null
}

function StatePlane({ stage, state }: { stage: ChamberStage; state: ChamberState }) {
  const ticks = useMemo(() => SOURCE_X, [])
  const emphasis = stage === 'align' || stage === 'freeze' ? 0.58 : stage === 'verify' ? 0.32 : 0.22
  const exact = state.currentJointAdmissible || state.candidateSealed
  return (
    <group position={[0, 0, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[8.3, 7.1]} />
        <meshBasicMaterial color={exact ? PALETTE.mint : PALETTE.white} transparent opacity={exact ? 0.034 : 0.018} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {ticks.map((x, index) => (
        <group key={x}>
          <Line points={[[x, 0.006, -5.2], [x, 0.006, 0.85]]} color={PALETTE.dim} transparent opacity={emphasis * 0.36} lineWidth={0.55} />
          <Line points={[[x - 0.12, 0.012, 0], [x + 0.12, 0.012, 0]]} color={PALETTE.white} transparent opacity={emphasis} lineWidth={0.7} />
          <mesh position={[x, 0.015, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.045, 0.063, 18]} />
            <meshBasicMaterial color={state.sources[index].predicate ? PALETTE.mint : PALETTE.dim} transparent opacity={state.sources[index].predicate ? emphasis : 0.12} side={THREE.DoubleSide} />
          </mesh>
        </group>
      ))}
      <Line points={[[-3.55, 0.014, 0], [3.55, 0.014, 0]]} color={exact ? PALETTE.mint : PALETTE.white} transparent opacity={emphasis} lineWidth={0.95} />
    </group>
  )
}

function Objective({ state, stage }: { state: ChamberState; stage: ChamberStage }) {
  const color = state.candidateSealed ? PALETTE.mint : state.currentJointAdmissible ? PALETTE.mint : PALETTE.white
  const opacity = stage === 'verify' ? 0.28 : 1
  return (
    <group position={[3.65, 0.72, 0.35]}>
      <mesh rotation={[0.2, 0.5, Math.PI / 4]}>
        <octahedronGeometry args={[0.17, 0]} />
        <meshStandardMaterial color={color} roughness={0.62} metalness={0.12} emissive={color} emissiveIntensity={state.currentJointAdmissible ? 0.1 : 0.01} transparent opacity={opacity} />
      </mesh>
      <Line points={[[-0.5, -0.72, -0.35], [0, -0.12, 0]]} color={PALETTE.dim} transparent opacity={0.22 * opacity} lineWidth={0.65} />
    </group>
  )
}

function CandidateFingerprint({ state, stage }: { state: ChamberState; stage: ChamberStage }) {
  if (!state.candidateSealed || !state.candidateFrozenVector) return null
  const points = state.candidateFrozenVector.map((_, index) => [SOURCE_X[index], 0.3, 0.52] as [number, number, number])
  const canonical = stage === 'commit' || stage === 'verify'
  const color = canonical ? PALETTE.white : PALETTE.mint
  return (
    <group>
      <Line points={points} color={color} transparent opacity={0.86} lineWidth={1.15} />
      {points.map((point, index) => (
        <mesh key={index} position={point}>
          <octahedronGeometry args={[0.074, 0]} />
          <meshStandardMaterial color={color} roughness={canonical ? 0.28 : 0.38} metalness={canonical ? 0.52 : 0.24} emissive={color} emissiveIntensity={canonical ? 0.025 : 0.08} />
        </mesh>
      ))}
    </group>
  )
}

function ConditionTrajectory({
  run,
  state,
  sourceId,
  selected,
  stage,
}: {
  run: ChamberRun
  state: ChamberState
  sourceId: SourceId
  selected: boolean
  stage: ChamberStage
}) {
  const sourceIndex = Number(sourceId.slice(1))
  const current = state.sources[sourceIndex]
  const relevant = run.transitions.filter((transition) => transition.sourceId === sourceId && transition.ordinal <= state.cursor)
  const history = [
    { ordinal: 0, predicate: run.sources[sourceIndex].initialPredicate, sequence: run.sources[sourceIndex].initialSequence },
    ...relevant,
  ]
  const points = history.map((entry, index) => {
    const depth = -0.31 * (history.length - 1 - index)
    const y = entry.predicate ? 0 : -0.82
    return [SOURCE_X[sourceIndex], y, depth] as [number, number, number]
  })
  const active = points.at(-1) ?? [SOURCE_X[sourceIndex], current.predicate ? 0 : -0.82, 0]
  const activeColor = current.predicate ? PALETTE.mint : PALETTE.amber
  const historyOpacity = stage === 'freeze' || stage === 'commit' ? 0.16 : stage === 'verify' ? 0.08 : selected ? 0.58 : 0.31
  const activeScale = selected ? 1.18 : 1

  return (
    <group>
      {points.length > 1 && <Line points={points} color={selected ? PALETTE.white : PALETTE.line} transparent opacity={historyOpacity} lineWidth={selected ? 1.15 : 0.8} />}
      {points.slice(0, -1).map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[selected ? 0.034 : 0.026, 8, 8]} />
          <meshBasicMaterial color={PALETTE.dim} transparent opacity={selected ? 0.42 : 0.2} />
        </mesh>
      ))}
      <mesh position={active} scale={activeScale}>
        <sphereGeometry args={[0.075, 16, 16]} />
        <meshStandardMaterial color={activeColor} emissive={activeColor} emissiveIntensity={selected ? 0.2 : 0.08} roughness={0.48} />
      </mesh>
      {!current.predicate && (
        <>
          <Line points={[[active[0], active[1], active[2]], [active[0], 0, active[2]]]} color={PALETTE.amber} transparent opacity={selected ? 0.9 : 0.58} lineWidth={0.78} />
          <mesh position={[active[0], 0.008, active[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.065, 0.095, 22]} />
            <meshBasicMaterial color={PALETTE.amber} transparent opacity={0.62} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
    </group>
  )
}

function RuntimeBoundary({ stage, state }: { stage: ChamberStage; state: ChamberState }) {
  if (stage !== 'commit' && stage !== 'verify') return null
  const opacity = stage === 'commit' ? 1 : 0.46
  return (
    <group>
      <mesh position={[0, 0.1, -2.1]}>
        <boxGeometry args={[7.7, 2.2, 5.8]} />
        <meshBasicMaterial color={PALETTE.violet} transparent opacity={0.025 * opacity} wireframe depthWrite={false} />
      </mesh>
      <Line points={[[-3.85, -1.0, 0.95], [3.85, -1.0, 0.95]]} color={PALETTE.violet} transparent opacity={0.36 * opacity} lineWidth={0.8} />
      <Line points={[[-3.85, 1.18, 0.95], [3.85, 1.18, 0.95]]} color={PALETTE.violet} transparent opacity={0.22 * opacity} lineWidth={0.65} />
      <mesh position={[0, 0.1, 1.38]} rotation={[0, 0, 0]}>
        <planeGeometry args={[7.9, 2.45]} />
        <meshBasicMaterial color={PALETTE.white} transparent opacity={0.032 * opacity} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <Line points={[[-3.9, 0.1, 1.39], [3.9, 0.1, 1.39]]} color={PALETTE.white} transparent opacity={0.66 * opacity} lineWidth={1.05} />
      {state.candidateSealed && (
        <Line points={[[0, 0.3, 0.58], [0, 0.3, 1.38]]} color={PALETTE.white} transparent opacity={0.7 * opacity} lineWidth={0.9} />
      )}
    </group>
  )
}

function CanonicalArtifacts({ stage, state }: { stage: ChamberStage; state: ChamberState }) {
  if (stage !== 'verify' || !state.candidateSealed) return null
  const nodes: [number, number, number][] = [
    [-2.25, 0.04, 1.75],
    [0, 0.04, 1.75],
    [2.25, 0.04, 1.75],
  ]
  return (
    <group>
      <Line points={nodes} color={PALETTE.white} transparent opacity={0.72} lineWidth={1.0} />
      {nodes.map((position, index) => (
        <mesh key={index} position={position}>
          <boxGeometry args={[index === 1 ? 0.46 : 0.3, 0.12, 0.3]} />
          <meshStandardMaterial color={index === 2 ? PALETTE.mint : PALETTE.white} roughness={0.32} metalness={0.48} />
        </mesh>
      ))}
    </group>
  )
}

function SceneWorld({
  run,
  state,
  stage,
  selectedSource,
}: {
  run: ChamberRun
  state: ChamberState
  stage: ChamberStage
  selectedSource: SourceId
}) {
  return (
    <>
      <color attach="background" args={[PALETTE.void]} />
      <fog attach="fog" args={[PALETTE.void, stage === 'verify' ? 8 : 6.5, 13]} />
      <ambientLight intensity={0.28} />
      <directionalLight position={[3, 5, 4]} intensity={stage === 'verify' ? 1.8 : 1.32} color={PALETTE.white} />
      <pointLight position={[SOURCE_X[2], 0.7, -0.5]} intensity={state.sources[2].predicate ? 0.18 : 0.24} color={state.sources[2].predicate ? PALETTE.mint : PALETTE.amber} distance={4} />
      <StatePlane stage={stage} state={state} />
      {run.sources.map((source) => (
        <ConditionTrajectory
          key={source.id}
          run={run}
          state={state}
          sourceId={source.id}
          selected={selectedSource === source.id}
          stage={stage}
        />
      ))}
      <CandidateFingerprint state={state} stage={stage} />
      <RuntimeBoundary stage={stage} state={state} />
      <CanonicalArtifacts stage={stage} state={state} />
      <Objective state={state} stage={stage} />
      <InstrumentCamera stage={stage} />
    </>
  )
}

export function ChamberScene({
  run,
  state,
  stage,
  selectedSource,
}: {
  run: ChamberRun
  state: ChamberState
  stage: ChamberStage
  selectedSource: SourceId
}) {
  return (
    <Canvas
      dpr={[1, 1.65]}
      camera={{ position: STAGE_CAMERA.observe.position, fov: STAGE_CAMERA.observe.fov, near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <SceneWorld run={run} state={state} stage={stage} selectedSource={selectedSource} />
    </Canvas>
  )
}
