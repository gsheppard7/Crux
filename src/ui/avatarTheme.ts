const STORAGE_KEY = 'crux:avatar-color:v1'

export interface AvatarTheme {
  bone: string
  joint: string
  jointHot: string
  jointTarget: string
  stroke: string
  strokeHot: string
  strokeTarget: string
}

export const AVATAR_PRESETS: { id: string; label: string; color: string; theme: AvatarTheme }[] = [
  {
    id: 'amber',
    label: 'Amber',
    color: '#fbbf24',
    theme: {
      bone: '#fbbf24',
      joint: '#fef3c7',
      jointHot: '#f87171',
      jointTarget: '#fde68a',
      stroke: '#78350f',
      strokeHot: '#f87171',
      strokeTarget: '#f59e0b',
    },
  },
  {
    id: 'sky',
    label: 'Sky',
    color: '#38bdf8',
    theme: {
      bone: '#38bdf8',
      joint: '#e0f2fe',
      jointHot: '#fb7185',
      jointTarget: '#7dd3fc',
      stroke: '#0c4a6e',
      strokeHot: '#fb7185',
      strokeTarget: '#0284c7',
    },
  },
  {
    id: 'lime',
    label: 'Lime',
    color: '#a3e635',
    theme: {
      bone: '#a3e635',
      joint: '#ecfccb',
      jointHot: '#f87171',
      jointTarget: '#d9f99d',
      stroke: '#365314',
      strokeHot: '#f87171',
      strokeTarget: '#65a30d',
    },
  },
  {
    id: 'violet',
    label: 'Violet',
    color: '#a78bfa',
    theme: {
      bone: '#a78bfa',
      joint: '#ede9fe',
      jointHot: '#f472b6',
      jointTarget: '#c4b5fd',
      stroke: '#4c1d95',
      strokeHot: '#f472b6',
      strokeTarget: '#7c3aed',
    },
  },
  {
    id: 'rose',
    label: 'Rose',
    color: '#fb7185',
    theme: {
      bone: '#fb7185',
      joint: '#ffe4e6',
      jointHot: '#f43f5e',
      jointTarget: '#fda4af',
      stroke: '#881337',
      strokeHot: '#e11d48',
      strokeTarget: '#f43f5e',
    },
  },
  {
    id: 'stone',
    label: 'Stone',
    color: '#a8a29e',
    theme: {
      bone: '#d6d3d1',
      joint: '#fafaf9',
      jointHot: '#f87171',
      jointTarget: '#e7e5e4',
      stroke: '#44403c',
      strokeHot: '#f87171',
      strokeTarget: '#78716c',
    },
  },
]

export const DEFAULT_AVATAR_COLOR = AVATAR_PRESETS[0].color

export function themeForColor(hex: string): AvatarTheme {
  const preset = AVATAR_PRESETS.find((p) => p.color.toLowerCase() === hex.toLowerCase())
  if (preset) return preset.theme
  return {
    bone: hex,
    joint: hex,
    jointHot: '#f87171',
    jointTarget: hex,
    stroke: '#292524',
    strokeHot: '#f87171',
    strokeTarget: hex,
  }
}

export function loadAvatarColor(storage: Storage | undefined = globalThis.localStorage): string {
  try {
    const v = storage?.getItem(STORAGE_KEY)
    if (v && /^#[0-9a-f]{6}$/i.test(v)) return v
  } catch {
    /* ignore */
  }
  return DEFAULT_AVATAR_COLOR
}

export function saveAvatarColor(color: string, storage: Storage | undefined = globalThis.localStorage) {
  try {
    storage?.setItem(STORAGE_KEY, color)
  } catch {
    /* ignore */
  }
}
