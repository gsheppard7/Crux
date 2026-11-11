import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import App from './App'
import { sampleRoutes } from './samples/sampleRoutes'
import { parseRouteJson } from './model/serialize'
import { DRAFT_STORAGE_KEY } from './state/useRouteEditor'
import { fitView, normalizedToScreen, viewTransform } from './model/coords'

const sample = () => sampleRoutes[0].load()

function holdRows() {
  return within(screen.getByRole('list', { name: 'Hold list' })).getAllByRole('button', { name: /^(?!Toggle)/ })
}

describe('App', () => {
  it('loads the curated sample without a user photo', () => {
    render(<App initialRoute={sample} />)
    expect(screen.getByAltText('Wall photo')).toHaveAttribute('src', expect.stringMatching(/^data:image\/svg\+xml/))
    expect(screen.getByText(/Holds \(12\)/)).toBeInTheDocument()
    expect(screen.getByText('Route looks complete')).toBeInTheDocument()
  })

  it('selects a hold, edits roles, and undoes', async () => {
    const user = userEvent.setup()
    render(<App initialRoute={sample} />)
    const first = holdRows()[0]
    await user.click(first)
    const startBtn = screen.getByRole('button', { name: /Start$/, pressed: false })
    await user.click(startBtn)
    expect(screen.getByRole('button', { name: /✓ Start/ })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /Undo/ }))
    expect(screen.queryByRole('button', { name: /✓ Start/ })).not.toBeInTheDocument()
  })

  it('adds a hold with the Add tool and deletes it with the keyboard', async () => {
    const user = userEvent.setup()
    render(<App initialRoute={sample} />)
    await user.click(screen.getByRole('button', { name: '+ Add hold' }))
    const canvas = screen.getByRole('application', { name: 'Hold annotation canvas' })
    fireEvent.pointerDown(canvas, { clientX: 400, clientY: 300, button: 0, pointerId: 1 })
    fireEvent.pointerUp(canvas, { clientX: 400, clientY: 300, button: 0, pointerId: 1 })
    expect(screen.getByText(/Holds \(13\)/)).toBeInTheDocument()
    expect(screen.getByLabelText('Label')).toHaveValue('12')
    await user.keyboard('{Delete}')
    expect(screen.getByText(/Holds \(12\)/)).toBeInTheDocument()
  })

  it('drags a hold (one undo step) and resizes it with the handle', async () => {
    const route = sample()
    const hold = route.holds[2]
    render(<App initialRoute={() => route} />)
    // jsdom has no layout, so the canvas uses its 800×600 fallback size.
    const t = viewTransform({ width: 800, height: 600 }, route.image, fitView(route.image))
    const start = normalizedToScreen(t, route.image, hold)
    const canvas = screen.getByRole('application', { name: 'Hold annotation canvas' })
    const g = screen.getByTestId(`hold-${hold.id}`)

    fireEvent.pointerDown(g.querySelector('circle')!, { clientX: start.x, clientY: start.y, button: 0, pointerId: 7 })
    for (let i = 1; i <= 5; i++) {
      fireEvent.pointerMove(canvas, { clientX: start.x + i * 10, clientY: start.y - i * 4, pointerId: 7 })
    }
    fireEvent.pointerUp(canvas, { clientX: start.x + 50, clientY: start.y - 20, pointerId: 7 })

    const u = screen.getByLabelText('u (0–1)') as HTMLInputElement
    const v = screen.getByLabelText('v (0–1)') as HTMLInputElement
    expect(Number(u.value)).toBeCloseTo(hold.u + 50 / t.scale / route.image.width, 3)
    expect(Number(v.value)).toBeCloseTo(hold.v - 20 / t.scale / route.image.height, 3)

    const handle = screen.getByTestId('resize-handle')
    const r0 = hold.radius * route.image.width * t.scale
    fireEvent.pointerDown(handle, { clientX: start.x + 50 + r0, clientY: start.y - 20, button: 0, pointerId: 8 })
    fireEvent.pointerMove(canvas, { clientX: start.x + 50 + r0 * 2, clientY: start.y - 20, pointerId: 8 })
    fireEvent.pointerUp(canvas, { pointerId: 8 })
    expect(Number((screen.getByLabelText(/^Size/) as HTMLInputElement).value)).toBeCloseTo(hold.radius * 2, 6)

    // Undo resize, then the whole drag in one step.
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    fireEvent.click(screen.getByRole('button', { name: /Undo/ }))
    expect(Number(u.value)).toBeCloseTo(hold.u, 4)
    expect(screen.getByRole('button', { name: /Undo/ })).toBeDisabled()
  })

  it('exports JSON that re-imports without coordinate drift', async () => {
    const user = userEvent.setup()
    let exported: Blob | null = null
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((b) => {
      exported = b as Blob
      return 'blob:test'
    })
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {})
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    render(<App initialRoute={sample} />)
    const angle = screen.getByLabelText('Wall angle degrees')
    await user.clear(angle)
    await user.type(angle, '35')
    await user.click(screen.getByRole('button', { name: /Export JSON/ }))
    await user.click(screen.getByRole('button', { name: /Without photo/ }))
    expect(click).toHaveBeenCalled()
    const text = await exported!.text()
    const parsed = parseRouteJson(text)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.route.wall.angleDeg).toBe(35)
    expect(parsed.route.holds).toEqual(sample().holds)

    // Re-import into a fresh app.
    const file = new File([text], 'route.crux.json', { type: 'application/json' })
    await user.upload(screen.getByTestId('json-input'), file)
    expect(await screen.findByText(/Imported “Tangerine Ladder”/)).toBeInTheDocument()
    expect(screen.getByText(/Photo not embedded/)).toBeInTheDocument()

    create.mockRestore()
    revoke.mockRestore()
    click.mockRestore()
  })

  it('shows readable errors for an invalid route file and keeps the current route', async () => {
    const user = userEvent.setup()
    render(<App initialRoute={sample} />)
    const bad = new File(['{"format":"crux.route","schemaVersion":1}'], 'bad.json', { type: 'application/json' })
    await user.upload(screen.getByTestId('json-input'), bad)
    const dialog = await screen.findByRole('dialog', { name: "Couldn't import route" })
    expect(within(dialog).getByText(/current route is unchanged/)).toBeInTheDocument()
    expect(within(dialog).getAllByRole('listitem').length).toBeGreaterThan(0)
    expect(screen.getByText(/Holds \(12\)/)).toBeInTheDocument()
  })

  it('autosaves a draft and restores it on reload', async () => {
    vi.useFakeTimers()
    const { unmount } = render(<App initialRoute={sample} />)
    fireEvent.click(holdRows()[0])
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    vi.useRealTimers()
    expect(localStorage.getItem(DRAFT_STORAGE_KEY)).toBeTruthy()
    unmount()
    render(<App />)
    expect(screen.getByText(/Holds \(11\)/)).toBeInTheDocument()
  })
})
