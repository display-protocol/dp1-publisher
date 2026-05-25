import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import JsonFileDropZone from '@/components/JsonFileDropZone'

/**
 * Build a File whose `.text()` is externally resolvable, so we can interleave
 * reads in tests. Without this we can't reproduce the stale-read race the
 * monotonic load-token guards against.
 */
function deferredJsonFile(name: string, content: string) {
  let resolveText!: (value: string) => void
  let rejectText!: (err: unknown) => void
  const textPromise = new Promise<string>((resolve, reject) => {
    resolveText = resolve
    rejectText = reject
  })
  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(file, 'text', {
    value: () => textPromise,
    writable: false,
    configurable: true,
  })
  return {
    file,
    resolve: () => resolveText(content),
    reject: (err: unknown) => rejectText(err),
  }
}

function dropFiles(target: HTMLElement, files: File[]) {
  fireEvent.drop(target, {
    dataTransfer: { files, types: ['Files'] },
    preventDefault: () => undefined,
  })
}

describe('JsonFileDropZone', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('rejects a non-JSON dropped file without calling onChange', async () => {
    const onChange = vi.fn()
    render(<JsonFileDropZone value="" onChange={onChange} />)
    const editor = screen.getByPlaceholderText(/drop a \.json file/i)

    const png = new File(['fake png bytes'], 'cover.png', { type: 'image/png' })
    dropFiles(editor, [png])

    // Give any pending microtasks a chance to run.
    await new Promise((r) => setTimeout(r, 0))
    expect(onChange).not.toHaveBeenCalled()
  })

  it('applies a valid dropped .json file via onChange', async () => {
    const onChange = vi.fn()
    render(<JsonFileDropZone value="" onChange={onChange} />)
    const editor = screen.getByPlaceholderText(/drop a \.json file/i)

    const a = deferredJsonFile('a.json', '{"a":1}')
    dropFiles(editor, [a.file])
    a.resolve()

    await waitFor(() => expect(onChange).toHaveBeenCalledWith('{"a":1}'))
  })

  it('applies only the latest load when two reads overlap (stale read dropped)', async () => {
    const onChange = vi.fn()
    render(<JsonFileDropZone value="" onChange={onChange} />)
    const editor = screen.getByPlaceholderText(/drop a \.json file/i)

    const first = deferredJsonFile('first.json', '{"first":true}')
    const second = deferredJsonFile('second.json', '{"second":true}')

    // Start both reads; neither has resolved yet.
    dropFiles(editor, [first.file])
    dropFiles(editor, [second.file])

    // Resolve the LATER drop first — this should be applied.
    second.resolve()
    await waitFor(() => expect(onChange).toHaveBeenCalledWith('{"second":true}'))

    // Now the earlier (stale) read finishes — its result must be dropped.
    first.resolve()
    await new Promise((r) => setTimeout(r, 0))

    expect(onChange).toHaveBeenCalledTimes(1)
    expect(onChange).toHaveBeenLastCalledWith('{"second":true}')
  })
})
