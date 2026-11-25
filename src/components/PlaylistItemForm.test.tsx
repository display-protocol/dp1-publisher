import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import PlaylistItemForm from './PlaylistItemForm'
import type { PlaylistItem } from '@/types/dp1'

// PR #30 review F5: the note handlers rebuild the object, so members the
// inputs do not show (title, author) must be carried through an edit.
describe('PlaylistItemForm — intermission note', () => {
  const item: PlaylistItem = {
    source: 'https://example.com/a.mp4',
    note: { text: 'Welcome', duration: 10, title: 'Opening', author: { name: 'Ana' } },
  }

  function open(onUpdate: (i: PlaylistItem) => void) {
    render(
      <PlaylistItemForm
        item={item}
        index={0}
        onUpdate={onUpdate}
        onRemove={() => {}}
        canRemove={false}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: /Advanced/i }))
  }

  it('keeps title and author when the text changes', () => {
    const onUpdate = vi.fn()
    open(onUpdate)
    fireEvent.change(screen.getByLabelText(/Note Text/i), { target: { value: 'Hello' } })
    expect(onUpdate.mock.calls[0][0].note).toEqual({
      text: 'Hello',
      duration: 10,
      title: 'Opening',
      author: { name: 'Ana' },
    })
  })

  it('keeps title and author when the duration changes', () => {
    const onUpdate = vi.fn()
    open(onUpdate)
    fireEvent.change(document.getElementById('item-note-duration-0') as HTMLElement, { target: { value: '30' } })
    expect(onUpdate.mock.calls[0][0].note).toMatchObject({
      text: 'Welcome',
      duration: 30,
      title: 'Opening',
      author: { name: 'Ana' },
    })
  })

  it('clearing the text still deletes the note', () => {
    const onUpdate = vi.fn()
    open(onUpdate)
    fireEvent.change(screen.getByLabelText(/Note Text/i), { target: { value: '' } })
    expect(onUpdate.mock.calls[0][0].note).toBeUndefined()
  })
})
