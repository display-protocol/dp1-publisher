import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { Dp1ExtensionsProvider, useDp1Extensions } from './Dp1ExtensionsContext'

function Probe() {
  return <div data-testid="state">{useDp1Extensions().extensionsState}</div>
}

function renderProbe() {
  render(
    <Dp1ExtensionsProvider>
      <Probe />
    </Dp1ExtensionsProvider>
  )
  return screen.getByTestId('state')
}

describe('Dp1ExtensionsProvider — extensionsState', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('stays unknown when the feed metadata cannot be read', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('fetch', fetchMock)
    const state = renderProbe()
    expect(state.textContent).toBe('unknown')
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await Promise.resolve()
    expect(state.textContent).toBe('unknown')
  })

  it.each([
    [false, 'off'],
    [true, 'on'],
  ])('is unknown while loading, then follows extensionsEnabled=%s', async (enabled, expected) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => ({ extensionsEnabled: enabled }) })
    )
    const state = renderProbe()
    expect(state.textContent).toBe('unknown')
    await waitFor(() => expect(state.textContent).toBe(expected))
  })
})
