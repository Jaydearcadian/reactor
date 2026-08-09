import { Canvas, useFrame } from '@react-three/fiber'
import { Line } from '@react-three/drei'
import { useMemo } from 'react'
import * as THREE from 'three'
import type { ChamberRun, ChamberState } from '../data/chamber-run'

const PALETTE = {
  void: '#070808',
  line: '#a4ada6',
  dim: '#505854',
  white: '#eef2ee',
  mint: '#b9e6cc',
  amber: '#cda869',
}

function InstrumentCamera() {
  useFrame(({ camera, pointer }, delta) => {
    const targetX = pointer.x * 0.18
    const targetY = 2.15 + pointer.y * 0.08
    camera.position.x = THREE.MathUtils.damp(camera.position.x, targetX, 3.5, delta)
    camera.position.y = THREE.MathUtils.damp(camera.position.y, targetY, 3.5, delta)
    camera.lookAt(0, 0, -1.1)
  })
  return null
}

function StatePlane() {
  const ticks = useMemo(() => Array.from({ length: 13 }, (_, index) => -4.8 + index * 0.8), [])
  return (
    <group position={[0, 0, -1.2]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[10.5, 7]} />
        <meshBasicMaterial color={PALETTE.white} transparent opacity={0.024} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      {ticks.map((x) => (
        <Line key={x} points={[[x, 0.002, -3.3], [x, 0.002, 3.3]]} color={PALETTE.dim} transparent opacity={0.12} lineWidth={0.55} />
      ))}
      <Line points={[[-5.1, 0.008, 0], [5.1, 0.008, 0]]} color={PALETTE.white} transparent opacity={0.36} lineWidth={0.9} />
    </group>
  )
}

function Objective({ state }: { state: ChamberState }) {
  const color = state.currentJointAdmissible ? PALETTE.mint : PALETTE.white
  return (
    <group position={[3.45, 0.78, -0.4]}>
      <mesh rotation={[0.2, 0.5, Math.PI / 4]}>
        <octahedronGeometry args={[0.18, 0]} />
        <meshStandardMaterial color={color} roughness={0.58} metalness={0.12} emissive={color} emissiveIntensity={state.currentJointAdmissible ? 0.12 : 0.015} />
      </mesh>
      <Line points={[[-0.42, -0.78, -0.8], [0, -0.12, 0]]} color={PALETTE.dim} transparent opacity={0.28} lineWidth={0.7} />
    </group>
  )
}

function CandidateFingerprint({ state }: { state: ChamberState }) {
  if (!state.candidateSealed || !state.candidateFrozenVector) return null
  const points = state.candidateFrozenVector.map((_, index) => [(-2.5 + index), 0.28, 0.55] as [number, number, number])
  return (
    <group>
      <Line points={points} color={PALETTE.mint} transparent opacity={0.76} lineWidth={1.1} />
      {points.map((point, index) => (
        <mesh key={index} position={point}>
          <octahedronGeometry args={[0.065, 0]} />
          <meshStandardMaterial color={PALETTE.mint} roughness={0.34} metalness={0.24} />
        </mesh>
      ))}
    </group>
  )
}

function ConditionTrajectory({ run, state }: { run: ChamberRun; state: ChamberState }) {
  const c2 = state.sources[2]
  const relevant = run.transitions.filter((transition) => transition.sourceId === 'C2' && transition.ordinal <= state.cursor)
  const history = [
    { ordinal: 0, predicate: run.sources[2].initialPredicate, sequence: run.sources[2].initialSequence },
    ...relevant,
  ]
  const points = history.map((entry, index) => {
    const depth = -0.36 * (history.length - 1 - index)
    const y = entry.predicate ? 0 : -1.05
    return [-1.0, y, depth] as [number, number, number]
  })
  const active = points.at(-1) ?? [-1.0, -1.05, 0]
  const activeColor = c2.predicate ? PALETTE.mint : PALETTE.amber

  return (
    <group>
      {points.length > 1 && <Line points={points} color={PALETTE.line} transparent opacity={0.42} lineWidth={1.05} />}
      {points.slice(0, -1).map((point, index) => (
        <mesh key={index} position={point}>
          <sphereGeometry args={[0.035, 10, 10]} />
          <meshBasicMaterial color={PALETTE.dim} transparent opacity={0.34} />
        </mesh>
      ))}
      <mesh position={active}>
        <sphereGeometry args={[0.085, 18, 18]} />
        <meshStandardMaterial color={activeColor} emissive={activeColor} emissiveIntensity={0.16} roughness={0.46} />
      </mesh>
      {!c2.predicate && (
        <>
          <Line points={[[active[0], active[1], active[2]], [active[0], 0, active[2]]]} color={PALETTE.amber} transparent opacity={0.78} lineWidth={0.8} />
          <mesh position={[active[0], 0, active[2]]} rotation={[-Math.PI / 2, 0, 0]}>
            <ringGeometry args={[0.07, 0.105, 24]} />
            <meshBasicMaterial color={PALETTE.amber} transparent opacity={0.62} side={THREE.DoubleSide} />
          </mesh>
        </>
      )}
      <Line points={[[-1, 0, -5.2], [-1, 0, 0.25]]} color={PALETTE.white} transparent opacity={0.16} lineWidth={0.65} />
    </group>
  )
}

function SceneWorld({ run, state }: { run: ChamberRun; state: ChamberState }) {
  return (
    <>
      <color attach="background" args={[PALETTE.void]} />
      <fog attach="fog" args={[PALETTE.void, 5.5, 12]} />
      <ambientLight intensity={0.32} />
      <directionalLight position={[3, 5, 4]} intensity={1.45} color={PALETTE.white} />
      <pointLight position={[-2.5, 0.7, -1]} intensity={state.sources[2].predicate ? 0.32 : 0.2} color={state.sources[2].predicate ? PALETTE.mint : PALETTE.amber} distance={4} />
      <StatePlane />
      <ConditionTrajectory run={run} state={state} />
      <CandidateFingerprint state={state} />
      <Objective state={state} />
      <InstrumentCamera />
    </>
  )
}

export function ChamberScene({ run, state }: { run: ChamberRun; state: ChamberState }) {
  return (
    <Canvas
      dpr={[1, 1.65]}
      camera={{ position: [0, 2.15, 5.2], fov: 42, near: 0.1, far: 40 }}
      gl={{ antialias: true, alpha: false, powerPreference: 'high-performance' }}
    >
      <SceneWorld run={run} state={state} />
    </Canvas>
  )
}
