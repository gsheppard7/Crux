import { Suspense, useState } from 'react'
import { Canvas } from '@react-three/fiber'
import { Html, OrbitControls, useTexture } from '@react-three/drei'
import { DoubleSide, SRGBColorSpace } from 'three'
import type { Hold, Route } from '../model/schema'
import { normalizedToWall, previewBaseHeight, radiusToImage, wallSize, wallToWorld } from '../model/coords'
import { holdRole } from '../model/route'
import { ROLE_COLORS } from '../ui/theme'

interface Props {
  route: Route
  selectedId: string | null
  onSelect: (id: string | null) => void
}

const WALL_THICKNESS = 0.05
/** Used when a hold has no depth estimate: protrusion as a fraction of its radius. */
const DEFAULT_DEPTH_RATIO = 0.45

/**
 * Approximate preview. Assumptions (also shown in the UI):
 *  - the photo is a frontal view of a single planar panel;
 *  - the photo's bottom edge is the panel's pivot line;
 *  - hold protrusion uses the user's depth estimate or a radius-based guess;
 *  - nothing here is physically simulated.
 */
export default function WallPreview3D({ route, selectedId, onSelect }: Props) {
  const { widthM, heightM } = wallSize(route.image, route.wall.metersPerPixel)
  const angle = route.wall.angleDeg
  const angleRad = (angle * Math.PI) / 180
  const baseY = previewBaseHeight(angle, heightM)
  const target = wallToWorld({ x: widthM / 2, y: heightM / 2, z: 0 }, angle, widthM, baseY)
  const dist = Math.max(5, Math.max(widthM, heightM) * 1.5)

  return (
    <div className="relative h-full w-full bg-stone-900" data-testid="wall-preview-3d">
      <Canvas
        camera={{ position: [widthM * 0.35, target[1] + 0.4, target[2] + dist], fov: 50, near: 0.05, far: 200 }}
        dpr={[1, 2]}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={['#1c1917']} />
        <hemisphereLight args={['#fafaf9', '#44403c', 0.9]} />
        <directionalLight position={[3, 7, 8]} intensity={1.4} />

        {/* Floor + crash pads */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.001, 0]}>
          <planeGeometry args={[30, 30]} />
          <meshStandardMaterial color="#292524" />
        </mesh>
        <mesh position={[0, 0.15, 1.2 + Math.max(0, heightM * Math.sin(angleRad)) / 2]}>
          <boxGeometry args={[widthM + 1, 0.3, 2.4 + Math.max(0, heightM * Math.sin(angleRad))]} />
          <meshStandardMaterial color="#1e3a8a" roughness={0.9} />
        </mesh>
        <gridHelper args={[30, 30, '#57534e', '#3f3a36']} position={[0, 0.002, 0]} />

        {baseY > 0 && (
          <mesh position={[0, baseY / 2, -WALL_THICKNESS / 2]}>
            <boxGeometry args={[widthM, baseY, WALL_THICKNESS]} />
            <meshStandardMaterial color="#57534e" />
          </mesh>
        )}

        {/* Wall-local frame: x right (centered), y up the wall, z out of the wall. */}
        <group position={[0, baseY, 0]} rotation={[angleRad, 0, 0]}>
          <mesh position={[0, heightM / 2, -WALL_THICKNESS / 2 - 0.004]}>
            <boxGeometry args={[widthM, heightM, WALL_THICKNESS]} />
            <meshStandardMaterial color="#44403c" />
          </mesh>
          <Suspense fallback={<PlainWall widthM={widthM} heightM={heightM} />}>
            {route.image.dataUrl ? (
              <TexturedWall url={route.image.dataUrl} widthM={widthM} heightM={heightM} />
            ) : (
              <PlainWall widthM={widthM} heightM={heightM} />
            )}
          </Suspense>
          {route.holds.map((hold) => (
            <HoldMesh key={hold.id} route={route} hold={hold} widthM={widthM} selected={hold.id === selectedId} onSelect={onSelect} />
          ))}
        </group>

        <ScaleFigure x={widthM / 2 + 0.6} z={0.8} />
        <OrbitControls target={target} makeDefault maxPolarAngle={Math.PI * 0.495} minDistance={1} maxDistance={40} />
      </Canvas>

      <div className="pointer-events-none absolute top-3 left-3 max-w-sm rounded-lg border border-amber-700/50 bg-stone-950/85 px-3 py-2 text-xs leading-relaxed text-amber-100">
        <b>Approximate preview.</b> Planar wall reconstructed from a single frontal photo at {angle}°. Hold depth is estimated, not measured. No physics or
        reachability is simulated.
      </div>
      <div className="pointer-events-none absolute right-3 bottom-3 rounded-lg bg-stone-950/85 px-3 py-1.5 text-xs text-stone-400">
        Drag to orbit · scroll to zoom · right-drag to pan · click a hold to select
      </div>
    </div>
  )
}

function TexturedWall({ url, widthM, heightM }: { url: string; widthM: number; heightM: number }) {
  const texture = useTexture(url, (t) => {
    t.colorSpace = SRGBColorSpace
    t.anisotropy = 4
  })
  return (
    <mesh position={[0, heightM / 2, 0]}>
      <planeGeometry args={[widthM, heightM]} />
      <meshStandardMaterial map={texture} side={DoubleSide} roughness={0.95} />
    </mesh>
  )
}

function PlainWall({ widthM, heightM }: { widthM: number; heightM: number }) {
  return (
    <mesh position={[0, heightM / 2, 0]}>
      <planeGeometry args={[widthM, heightM]} />
      <meshStandardMaterial color="#78716c" side={DoubleSide} />
    </mesh>
  )
}

function HoldMesh({
  route,
  hold,
  widthM,
  selected,
  onSelect,
}: {
  route: Route
  hold: Hold
  widthM: number
  selected: boolean
  onSelect: (id: string) => void
}) {
  const [hovered, setHovered] = useState(false)
  const mpp = route.wall.metersPerPixel
  const p = normalizedToWall(route.image, mpp, hold)
  const r = radiusToImage(route.image, hold.radius) * mpp
  const depth = hold.depthCm !== null ? Math.max(0.005, hold.depthCm / 100) : r * DEFAULT_DEPTH_RATIO
  const role = holdRole(route, hold)
  const color = ROLE_COLORS[role]
  const showLabel = selected || role === 'start' || role === 'finish' || role === 'start-finish'
  return (
    <group position={[p.x - widthM / 2, p.y, 0]}>
      <mesh
        scale={[r, r, depth]}
        onClick={(e) => {
          e.stopPropagation()
          onSelect(hold.id)
        }}
        onPointerOver={(e) => {
          e.stopPropagation()
          setHovered(true)
          document.body.style.cursor = 'pointer'
        }}
        onPointerOut={() => {
          setHovered(false)
          document.body.style.cursor = ''
        }}
      >
        <sphereGeometry args={[1, 28, 18]} />
        <meshStandardMaterial
          color={color}
          transparent={role === 'off-route'}
          opacity={role === 'off-route' ? 0.55 : 1}
          emissive={selected || hovered ? color : '#000000'}
          emissiveIntensity={selected ? 0.6 : hovered ? 0.3 : 0}
          roughness={0.6}
        />
      </mesh>
      {showLabel && (
        <Html position={[0, 0, depth + 0.02]} center distanceFactor={6} zIndexRange={[10, 0]}>
          <div
            className="pointer-events-none rounded px-1.5 py-0.5 text-[11px] font-bold whitespace-nowrap text-stone-950"
            style={{ background: color }}
          >
            {role === 'start' || role === 'start-finish' ? 'S ' : role === 'finish' ? 'F ' : ''}
            {hold.label}
          </div>
        </Html>
      )}
    </group>
  )
}

/** 1.75 m human-scale reference, not an avatar. */
function ScaleFigure({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 0, z]}>
      <mesh position={[0, 0.78, 0]}>
        <capsuleGeometry args={[0.16, 1.2, 6, 16]} />
        <meshStandardMaterial color="#a8a29e" transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, 1.64, 0]}>
        <sphereGeometry args={[0.11, 20, 14]} />
        <meshStandardMaterial color="#a8a29e" transparent opacity={0.6} />
      </mesh>
      <Html position={[0, 1.9, 0]} center distanceFactor={8}>
        <div className="pointer-events-none text-[11px] whitespace-nowrap text-stone-400">1.75 m ref.</div>
      </Html>
    </group>
  )
}
