import type { Route } from '../model/schema'
import { parseRouteJson, serializeRoute } from '../model/serialize'

const DB_NAME = 'crux'
const DB_VERSION = 1
const CLIMBS_STORE = 'climbs'
const CLIMB_DATA_STORE = 'climbData'
const THUMB_WIDTH = 240
/** jsdom never fires Image load/error for data URLs; keep the race short in tests. */
const DECODE_MS = import.meta.env.MODE === 'test' ? 50 : 4000

export interface ClimbMeta {
  id: string
  name: string
  grade: string
  updatedAt: string
  holdCount: number
  angleDeg: number
  thumbDataUrl: string | null
  imageSignature: string
}

function imageSignature(image: Route['image']): string {
  return `${image.name}|${image.width}|${image.height}|${image.dataUrl?.length ?? 0}`
}

function decodeImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const fail = () => reject(new Error('Could not decode image for thumbnail.'))
    const timer = window.setTimeout(fail, DECODE_MS)
    img.onload = () => {
      window.clearTimeout(timer)
      resolve(img)
    }
    img.onerror = () => {
      window.clearTimeout(timer)
      fail()
    }
    img.src = src
  })
}

async function makeThumb(dataUrl: string): Promise<string | null> {
  try {
    const img = await decodeImage(dataUrl)
    const w0 = img.naturalWidth || img.width
    const h0 = img.naturalHeight || img.height
    if (!w0 || !h0) return null
    const width = Math.min(THUMB_WIDTH, w0)
    const height = Math.max(1, Math.round((h0 * width) / w0))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    ctx.drawImage(img, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.72)
  } catch {
    return null
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(CLIMBS_STORE)) {
        db.createObjectStore(CLIMBS_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(CLIMB_DATA_STORE)) {
        db.createObjectStore(CLIMB_DATA_STORE)
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB'))
  })
}

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'))
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'))
  })
}

async function getMeta(db: IDBDatabase, id: string): Promise<ClimbMeta | undefined> {
  return idbReq(db.transaction(CLIMBS_STORE, 'readonly').objectStore(CLIMBS_STORE).get(id))
}

export async function listClimbs(): Promise<ClimbMeta[]> {
  const db = await openDb()
  try {
    const rows = await idbReq<ClimbMeta[]>(db.transaction(CLIMBS_STORE, 'readonly').objectStore(CLIMBS_STORE).getAll())
    return rows.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0))
  } finally {
    db.close()
  }
}

export async function saveClimb(route: Route): Promise<ClimbMeta> {
  const db = await openDb()
  try {
    const sig = imageSignature(route.image)
    const prior = await getMeta(db, route.id)
    let thumbDataUrl: string | null = null
    if (prior && prior.imageSignature === sig) {
      thumbDataUrl = prior.thumbDataUrl
    } else if (route.image.dataUrl) {
      thumbDataUrl = await makeThumb(route.image.dataUrl)
    }

    const updatedAt = new Date().toISOString()
    const json = serializeRoute(route, { now: updatedAt })
    const meta: ClimbMeta = {
      id: route.id,
      name: route.name,
      grade: route.grade,
      updatedAt,
      holdCount: route.holds.length,
      angleDeg: route.wall.angleDeg,
      thumbDataUrl,
      imageSignature: sig,
    }

    const tx = db.transaction([CLIMBS_STORE, CLIMB_DATA_STORE], 'readwrite')
    tx.objectStore(CLIMBS_STORE).put(meta)
    tx.objectStore(CLIMB_DATA_STORE).put(json, route.id)
    await txDone(tx)
    return meta
  } finally {
    db.close()
  }
}

export async function loadClimb(id: string): Promise<Route> {
  const db = await openDb()
  try {
    const json = await idbReq<string | undefined>(
      db.transaction(CLIMB_DATA_STORE, 'readonly').objectStore(CLIMB_DATA_STORE).get(id),
    )
    if (typeof json !== 'string') throw new Error(`Climb “${id}” was not found in the library.`)
    const parsed = parseRouteJson(json)
    if (!parsed.ok) throw new Error(parsed.errors.join(' '))
    return parsed.route
  } finally {
    db.close()
  }
}

export async function deleteClimb(id: string): Promise<void> {
  const db = await openDb()
  try {
    const tx = db.transaction([CLIMBS_STORE, CLIMB_DATA_STORE], 'readwrite')
    tx.objectStore(CLIMBS_STORE).delete(id)
    tx.objectStore(CLIMB_DATA_STORE).delete(id)
    await txDone(tx)
  } finally {
    db.close()
  }
}
