/**
 * Machine-local timings from the planner before contact patches and stances,
 * captured on this machine while developing the realism work. Not a pass/fail
 * oracle: later runs only have to stay inside the interactive budget.
 */
export const PRE_CHANGE_BASELINE: { name: string; ok: boolean; ms: number; expanded: number }[] = [
  { name: 'vertical', ok: true, ms: 166, expanded: 343 },
  { name: 'slab', ok: true, ms: 121, expanded: 343 },
  { name: 'overhang-30', ok: true, ms: 139, expanded: 340 },
  { name: 'sidepull-cluster', ok: true, ms: 21, expanded: 75 },
  { name: 'sloper-high', ok: false, ms: 12, expanded: 49 },
  { name: 'volume', ok: false, ms: 10, expanded: 36 },
]
