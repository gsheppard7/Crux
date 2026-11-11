import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Route, RouteImage } from './model/schema'
import { fitView, type ViewState } from './model/coords'
import {
  aspectRatioMismatch,
  createEmptyRoute,
  getHold,
  removeHold,
  replaceImage,
  toggleFinish,
  toggleInRoute,
  toggleStart,
  updateHold,
  validateRoute,
} from './model/route'
import { parseRouteJson, routeFileName, serializeRoute } from './model/serialize'
import { sampleRoutes } from './samples/sampleRoutes'
import { useRouteEditor } from './state/useRouteEditor'
import { downloadText, readImageFile } from './lib/imageFile'
import { EditorCanvas, type Tool } from './components/EditorCanvas'
import { HoldInspector, Kbd } from './components/HoldInspector'
import { RoutePanel } from './components/RoutePanel'
import { HoldList } from './components/HoldList'
import { IssuesPanel } from './components/IssuesPanel'
import { Modal } from './components/Modal'
import { Button } from './components/form'
import { ErrorBoundary } from './components/ErrorBoundary'

const WallPreview3D = lazy(() => import('./components/WallPreview3D'))

type Layout = '2d' | 'split' | '3d'
type Toast = { message: string; tone: 'ok' | 'warn' | 'error' }

const isTypingTarget = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))

const baseName = (name: string) => name.replace(/\.[^.]+$/, '') || 'Untitled route'

export default function App({ initialRoute }: { initialRoute?: () => Route }) {
  const editor = useRouteEditor(initialRoute)
  const { route, apply, replace } = editor
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tool, setTool] = useState<Tool>('select')
  const [layout, setLayout] = useState<Layout>('2d')
  const [pendingImage, setPendingImage] = useState<RouteImage | null>(null)
  const [importErrors, setImportErrors] = useState<string[] | null>(null)
  const [helpOpen, setHelpOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [toast, setToast] = useState<Toast | null>(null)
  const imageInput = useRef<HTMLInputElement>(null)
  const jsonInput = useRef<HTMLInputElement>(null)

  const selected = getHold(route, selectedId)
  const issues = useMemo(() => validateRoute(route), [route])

  // View resets to "fit" whenever the image (or route) changes.
  const imageKey = `${route.id}|${route.image.width}x${route.image.height}`
  const [viewEntry, setViewEntry] = useState<{ key: string; view: ViewState }>(() => ({ key: imageKey, view: fitView(route.image) }))
  const view = viewEntry.key === imageKey ? viewEntry.view : fitView(route.image)
  const setView = useCallback((v: ViewState) => setViewEntry({ key: imageKey, view: v }), [imageKey])

  useEffect(() => {
    if (!toast) return
    const id = window.setTimeout(() => setToast(null), toast.tone === 'error' ? 6000 : 3500)
    return () => window.clearTimeout(id)
  }, [toast])

  const loadRoute = useCallback(
    (next: Route, message: string) => {
      replace(next)
      setSelectedId(null)
      setToast({ message, tone: 'ok' })
    },
    [replace],
  )

  const handleImageFile = useCallback(
    async (file: File) => {
      try {
        const image = await readImageFile(file)
        if (route.holds.length === 0) {
          apply((r) => ({ ...replaceImage(r, image, false), name: r.name === 'Untitled route' ? baseName(file.name) : r.name }))
          setToast({ message: `Loaded photo ${image.width}×${image.height}`, tone: 'ok' })
        } else {
          setPendingImage(image)
        }
      } catch (e) {
        setToast({ message: (e as Error).message, tone: 'error' })
      }
    },
    [apply, route.holds.length],
  )

  const handleJsonFile = useCallback(
    async (file: File) => {
      const text = await file.text()
      const result = parseRouteJson(text)
      if (!result.ok) {
        setImportErrors(result.errors)
        return
      }
      const warnings = result.issues.filter((i) => i.level === 'warning').length
      loadRoute(
        result.route,
        `Imported “${result.route.name}” (${result.route.holds.length} holds)${warnings ? ` — ${warnings} warning${warnings > 1 ? 's' : ''}` : ''}${
          result.route.image.dataUrl ? '' : ' — photo not embedded'
        }`,
      )
    },
    [loadRoute],
  )

  const handleFile = useCallback(
    (file: File) => {
      if (file.type.startsWith('image/')) void handleImageFile(file)
      else if (file.name.endsWith('.json') || file.type === 'application/json') void handleJsonFile(file)
      else setToast({ message: `Unsupported file “${file.name}”. Drop a photo or a .json route.`, tone: 'error' })
    },
    [handleImageFile, handleJsonFile],
  )

  const exportRoute = (embedImage: boolean) => {
    downloadText(routeFileName(route), serializeRoute(route, { embedImage }))
    setExportOpen(false)
    setToast({ message: `Exported ${routeFileName(route)}${embedImage ? '' : ' (without photo)'}`, tone: 'ok' })
  }

  // Keyboard shortcuts.
  const latest = useRef({ selectedId, route })
  useEffect(() => {
    latest.current = { selectedId, route }
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return
      const mod = e.metaKey || e.ctrlKey
      const { selectedId, route } = latest.current
      const sel = getHold(route, selectedId)
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) editor.redo()
        else editor.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        editor.redo()
        return
      }
      if (mod || e.altKey) return
      switch (e.key) {
        case 'v':
        case 'V':
          setTool('select')
          return
        case 'a':
        case 'A':
          setTool('add')
          return
        case '0':
          setView(fitView(route.image))
          return
        case 'Escape':
          setSelectedId(null)
          setTool('select')
          return
        case '?':
          setHelpOpen(true)
          return
      }
      if (!sel) return
      const id = sel.id
      switch (e.key) {
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          apply((r) => removeHold(r, id))
          setSelectedId(null)
          return
        case 's':
        case 'S':
          apply((r) => toggleStart(r, id))
          return
        case 'f':
        case 'F':
          apply((r) => toggleFinish(r, id))
          return
        case 'r':
        case 'R':
          apply((r) => toggleInRoute(r, id))
          return
        case '[':
        case ']': {
          const k = e.key === ']' ? 1.1 : 1 / 1.1
          apply((r) => updateHold(r, id, { radius: sel.radius * k }), { coalesceKey: `edit:${id}:radius` })
          return
        }
        case 'ArrowUp':
        case 'ArrowDown':
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const px = e.shiftKey ? 10 : 1
          const du = e.key === 'ArrowLeft' ? -px : e.key === 'ArrowRight' ? px : 0
          const dv = e.key === 'ArrowUp' ? -px : e.key === 'ArrowDown' ? px : 0
          apply((r) => updateHold(r, id, { u: sel.u + du / r.image.width, v: sel.v + dv / r.image.height }), {
            coalesceKey: `nudge:${id}`,
          })
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apply, editor, setView])

  const mismatch = pendingImage ? aspectRatioMismatch(route.image, pendingImage) : 0
  const showEditor = layout !== '3d'
  const show3D = layout !== '2d'

  return (
    <div
      className="flex h-dvh flex-col bg-stone-950 text-stone-100"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault()
        const file = e.dataTransfer.files[0]
        if (file) handleFile(file)
      }}
    >
      <header className="flex flex-wrap items-center gap-2 border-b border-stone-800 bg-stone-900 px-3 py-2">
        <div className="mr-2 flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          <div className="leading-tight">
            <div className="text-sm font-bold tracking-wide">Crux</div>
            <div className="max-w-48 truncate text-xs text-stone-400" title={route.name}>
              {route.name}
              {route.grade ? ` · ${route.grade}` : ''}
            </div>
          </div>
        </div>

        <select
          aria-label="Load sample route"
          className="rounded-md border border-stone-700 bg-stone-800 px-2 py-1.5 text-sm"
          value=""
          onChange={(e) => {
            const sample = sampleRoutes.find((s) => s.id === e.target.value)
            if (sample) loadRoute(sample.load(), `Loaded sample “${sample.name}”`)
          }}
        >
          <option value="" disabled>
            Load sample…
          </option>
          {sampleRoutes.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} ({s.grade})
            </option>
          ))}
        </select>

        <Button variant="primary" onClick={() => imageInput.current?.click()} title="Upload a wall photo (or drop one anywhere)">
          {route.image.dataUrl ? 'Upload photo' : 'Attach photo'}
        </Button>
        <Button onClick={() => jsonInput.current?.click()} title="Open a .crux.json route file">
          Import JSON
        </Button>
        <div className="relative">
          <Button onClick={() => setExportOpen(!exportOpen)} title="Save the route as JSON">
            Export JSON ▾
          </Button>
          {exportOpen && (
            <div className="absolute top-full left-0 z-40 mt-1 w-64 rounded-lg border border-stone-700 bg-stone-900 p-1 shadow-xl">
              <MenuItem onClick={() => exportRoute(true)} title="With photo" detail="Portable single file; larger." disabled={!route.image.dataUrl} />
              <MenuItem onClick={() => exportRoute(false)} title="Without photo" detail="Small file; re-attach the photo after import." />
            </div>
          )}
        </div>

        <div className="mx-1 h-6 w-px bg-stone-700" />
        <Button variant="ghost" onClick={editor.undo} disabled={!editor.canUndo} title="Undo (⌘Z)">
          ↶ Undo
        </Button>
        <Button variant="ghost" onClick={editor.redo} disabled={!editor.canRedo} title="Redo (⇧⌘Z)">
          ↷ Redo
        </Button>
        <Button
          variant="ghost"
          disabled={route.holds.length === 0}
          onClick={() => {
            apply((r) => ({ ...r, holds: [], startHoldIds: [], finishHoldIds: [] }))
            setSelectedId(null)
            setToast({ message: 'Cleared all holds (undo to restore)', tone: 'warn' })
          }}
          title="Remove all holds from this route (undoable)"
        >
          Clear holds
        </Button>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-xs text-stone-500 md:inline" title="Drafts are stored in this browser's localStorage">
            {editor.draftStatus === 'saved'
              ? 'Draft autosaved'
              : editor.draftStatus === 'saved-without-image'
                ? 'Draft autosaved (photo too large to keep locally)'
                : editor.draftStatus === 'failed'
                  ? 'Autosave failed — export to keep your work'
                  : ''}
          </span>
          <div role="radiogroup" aria-label="Layout" className="flex rounded-md border border-stone-700 p-0.5">
            {(['2d', 'split', '3d'] as const).map((l) => (
              <button
                key={l}
                type="button"
                role="radio"
                aria-checked={layout === l}
                onClick={() => setLayout(l)}
                className={`rounded px-2.5 py-1 text-xs font-semibold uppercase ${layout === l ? 'bg-stone-700 text-white' : 'text-stone-400 hover:text-stone-200'}`}
              >
                {l === 'split' ? '2D + 3D' : l}
              </button>
            ))}
          </div>
          <Button variant="ghost" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)">
            ?
          </Button>
        </div>

        <input
          ref={imageInput}
          type="file"
          accept="image/*"
          hidden
          data-testid="image-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleImageFile(f)
            e.target.value = ''
          }}
        />
        <input
          ref={jsonInput}
          type="file"
          accept=".json,application/json"
          hidden
          data-testid="json-input"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) void handleJsonFile(f)
            e.target.value = ''
          }}
        />
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto md:flex-row md:overflow-hidden">
        <main className={`flex min-h-[60vh] min-w-0 flex-1 md:min-h-0 ${layout === 'split' ? 'flex-col xl:flex-row' : ''}`}>
          {showEditor && (
            <div className="relative min-h-0 min-w-0 flex-1">
              <EditorCanvas
                route={route}
                selectedId={selected?.id ?? null}
                onSelect={setSelectedId}
                tool={tool}
                onToolChange={setTool}
                view={view}
                onViewChange={setView}
                apply={apply}
              />
            </div>
          )}
          {show3D && (
            <div className={`relative min-h-0 min-w-0 flex-1 ${layout === 'split' ? 'border-t border-stone-800 xl:border-t-0 xl:border-l' : ''}`}>
              <ErrorBoundary
                fallback={(err) => (
                  <div className="flex h-full items-center justify-center p-6 text-center text-sm text-stone-400">
                    3D preview unavailable ({err.message}). WebGL may be disabled in this browser.
                  </div>
                )}
              >
                <Suspense fallback={<div className="flex h-full items-center justify-center text-sm text-stone-500">Loading 3D preview…</div>}>
                  <WallPreview3D key={route.id} route={route} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
                </Suspense>
              </ErrorBoundary>
            </div>
          )}
        </main>

        <aside
          className="w-full shrink-0 border-t border-stone-800 bg-stone-900/60 md:w-80 md:overflow-y-auto md:border-t-0 md:border-l xl:w-[360px]"
          aria-label="Inspector"
        >
          <HoldInspector route={route} hold={selected} apply={apply} onSelect={setSelectedId} />
          <HoldList route={route} selectedId={selected?.id ?? null} onSelect={setSelectedId} apply={apply} />
          <RoutePanel route={route} selected={selected} apply={apply} />
          <IssuesPanel issues={issues} onSelect={setSelectedId} />
        </aside>
      </div>

      {toast && (
        <div
          role="status"
          className={`fixed bottom-4 left-1/2 z-50 max-w-xl -translate-x-1/2 rounded-lg border px-4 py-2 text-sm shadow-xl ${
            toast.tone === 'error'
              ? 'border-rose-700 bg-rose-950 text-rose-100'
              : toast.tone === 'warn'
                ? 'border-amber-700 bg-amber-950 text-amber-100'
                : 'border-emerald-800 bg-emerald-950 text-emerald-100'
          }`}
        >
          {toast.message}
        </div>
      )}

      {pendingImage && (
        <Modal
          title="Use this photo how?"
          onClose={() => setPendingImage(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setPendingImage(null)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  const img = pendingImage
                  apply((r) => replaceImage(r, img, true))
                  setPendingImage(null)
                  setToast({ message: 'Photo replaced; holds kept', tone: mismatch > 0.02 ? 'warn' : 'ok' })
                }}
              >
                Keep {route.holds.length} holds
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  const img = pendingImage
                  loadRoute(createEmptyRoute({ image: img, name: baseName(img.name) }), 'New route started from photo')
                  setPendingImage(null)
                }}
              >
                New route from photo
              </Button>
            </>
          }
        >
          <p>
            The current route has {route.holds.length} holds. Start a fresh route on <b>{pendingImage.name}</b>, or keep the holds (useful when re-attaching the
            original photo)?
          </p>
          <p className="text-stone-400">
            New photo: {pendingImage.width}×{pendingImage.height}. Current: {route.image.width}×{route.image.height}.
          </p>
          {mismatch > 0.02 && (
            <p className="rounded-md border border-amber-700 bg-amber-950/60 p-2 text-amber-100">
              Aspect ratios differ by {(mismatch * 100).toFixed(0)}%. Kept holds will stay in the same relative positions but will likely be misaligned with this
              photo.
            </p>
          )}
          <p className="text-stone-500">Either choice can be undone.</p>
        </Modal>
      )}

      {importErrors && (
        <Modal title="Couldn't import route" onClose={() => setImportErrors(null)} footer={<Button onClick={() => setImportErrors(null)}>OK</Button>}>
          <p>The file was not loaded, and your current route is unchanged.</p>
          <ul className="list-disc space-y-1 pl-5 font-mono text-xs text-rose-200">
            {importErrors.map((err, i) => (
              <li key={i}>{err}</li>
            ))}
          </ul>
        </Modal>
      )}

      {helpOpen && (
        <Modal title="Shortcuts & gestures" onClose={() => setHelpOpen(false)}>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
            <Shortcut k="A / V">Add-hold tool / select tool</Shortcut>
            <Shortcut k="Click">Add tool: place a hold (drag to adjust)</Shortcut>
            <Shortcut k="Double-click">Select tool: add a hold</Shortcut>
            <Shortcut k="Drag hold">Move it · drag the white handle to resize</Shortcut>
            <Shortcut k="Drag photo">Pan (or hold Space / middle mouse)</Shortcut>
            <Shortcut k="Wheel / pinch">Zoom at cursor · 0 to fit</Shortcut>
            <Shortcut k="S / F / R">Toggle start / finish / in-route</Shortcut>
            <Shortcut k="Arrows">Nudge 1 px (Shift: 10 px)</Shortcut>
            <Shortcut k="[ / ]">Shrink / grow selected hold</Shortcut>
            <Shortcut k="Del">Delete selected hold</Shortcut>
            <Shortcut k="⌘Z / ⇧⌘Z">Undo / redo</Shortcut>
            <Shortcut k="Esc">Deselect</Shortcut>
          </dl>
          <p className="text-stone-500">Drop a photo or a .crux.json file anywhere to open it.</p>
        </Modal>
      )}
    </div>
  )
}

function MenuItem({ onClick, title, detail, disabled }: { onClick: () => void; title: string; detail: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="block w-full rounded-md px-3 py-2 text-left hover:bg-stone-800 disabled:opacity-40"
    >
      <div className="text-sm font-medium">{title}</div>
      <div className="text-xs text-stone-400">{detail}</div>
    </button>
  )
}

function Shortcut({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <>
      <dt>
        <Kbd>{k}</Kbd>
      </dt>
      <dd className="text-stone-300">{children}</dd>
    </>
  )
}
