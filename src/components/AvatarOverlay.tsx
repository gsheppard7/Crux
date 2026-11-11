import { SKELETON_BONES, skeletonAt, skeletonToNormalized, type JointName } from '../avatar/skeleton'
import type { Beta, PlannerContext } from '../planner/types'
import { normalizedToScreen, type Size, type ViewTransform } from '../model/coords'
import { themeForColor, type AvatarTheme } from '../ui/avatarTheme'

type Joint = JointName

export function AvatarOverlay({
  beta,
  ctx,
  time,
  transform,
  image,
  avatarColor,
}: {
  beta: Beta
  ctx: PlannerContext
  time: number
  transform: ViewTransform
  image: Size
  avatarColor: string
}) {
  const theme: AvatarTheme = themeForColor(avatarColor)
  const { skeleton, step } = skeletonAt(beta, ctx, time)
  const norm = skeletonToNormalized(skeleton, ctx)
  const pt = (key: Joint) => normalizedToScreen(transform, image, norm[key])
  const hot = new Set<Joint>()
  for (const l of skeleton.overstretched) {
    if (l === 'LH') hot.add('L_hand')
    if (l === 'RH') hot.add('R_hand')
    if (l === 'LF') hot.add('L_foot')
    if (l === 'RF') hot.add('R_foot')
  }
  const targetKey: Joint | null =
    step.limb === 'LH' ? 'L_hand' : step.limb === 'RH' ? 'R_hand' : step.limb === 'LF' ? 'L_foot' : step.limb === 'RF' ? 'R_foot' : null

  return (
    <g className="pointer-events-none" data-testid="avatar-overlay">
      {SKELETON_BONES.map(([a, b]) => {
        const pa = pt(a)
        const pb = pt(b)
        const stress = hot.has(a) || hot.has(b)
        return (
          <line
            key={`${a}-${b}`}
            x1={pa.x}
            y1={pa.y}
            x2={pb.x}
            y2={pb.y}
            stroke={stress ? theme.strokeHot : theme.bone}
            strokeWidth={stress ? 3.5 : 2.5}
            strokeLinecap="round"
            opacity={0.92}
          />
        )
      })}
      {(Object.keys(norm) as Joint[]).map((key) => {
        const p = pt(key)
        if (key === 'head') {
          return <circle key={key} cx={p.x} cy={p.y} r={7} fill={theme.bone} stroke={theme.stroke} strokeWidth={1} />
        }
        const r = key.includes('hand') || key.includes('foot') ? 4.5 : 3
        const isTarget = key === targetKey
        return (
          <circle
            key={key}
            cx={p.x}
            cy={p.y}
            r={isTarget ? r + 1.5 : r}
            fill={hot.has(key) ? theme.jointHot : isTarget ? theme.jointTarget : theme.joint}
            stroke={isTarget ? theme.strokeTarget : theme.stroke}
            strokeWidth={isTarget ? 2 : 1}
          />
        )
      })}
    </g>
  )
}
