import { useCallback, useEffect, useState } from 'react'

/**
 * Continuous playback clock over `stepCount` steps. Remount (via a React key)
 * when the sequence identity changes so the clock resets cleanly.
 */
export function usePlayback(stepCount: number, speed = 1) {
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)

  useEffect(() => {
    if (!playing || stepCount <= 0) return
    let raf = 0
    let last = performance.now()
    let t = time
    const tick = (now: number) => {
      const dt = ((now - last) / 1000) * speed
      last = now
      t += dt
      if (t >= stepCount - 1e-6) {
        setTime(stepCount - 1e-6)
        setPlaying(false)
      } else {
        setTime(t)
        raf = requestAnimationFrame(tick)
      }
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    // Intentionally omit `time`: we capture the start value when play begins.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, stepCount, speed])

  const stepIndex = Math.min(Math.max(0, stepCount - 1), Math.max(0, Math.floor(time)))
  const setStep = useCallback(
    (i: number) => {
      setPlaying(false)
      setTime(Math.min(Math.max(0, stepCount - 1), Math.max(0, i)))
    },
    [stepCount],
  )

  return {
    time,
    stepIndex,
    playing,
    setPlaying,
    setTime,
    setStep,
    play: () => setPlaying(true),
    pause: () => setPlaying(false),
    toggle: () => setPlaying((p) => !p),
    next: () => setStep(stepIndex + 1),
    prev: () => setStep(stepIndex - 1),
    first: () => setStep(0),
    last: () => setStep(stepCount - 1),
  }
}
