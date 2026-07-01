import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import type { PlaylistItem } from '@/types/dp1'
import PlaylistItemForm from './PlaylistItemForm'

interface ManualItemsSectionProps {
  items: PlaylistItem[]
  showIntermissionNote?: boolean
  onAddItem: () => void
  onUpdateItem: (index: number, item: PlaylistItem) => void
  onRemoveItem: (index: number) => void
}

export default function ManualItemsSection({
  items,
  showIntermissionNote = true,
  onAddItem,
  onUpdateItem,
  onRemoveItem,
}: ManualItemsSectionProps) {
  const [collapsed, setCollapsed] = useState(false)

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <CardTitle className="text-lg">Add items manually</CardTitle>
            <CardDescription>
              Enter a source URI, title, and optional display settings for each playlist item one at a
              time.
            </CardDescription>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0 px-2"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? 'Expand manual items' : 'Collapse manual items'}
          >
            {collapsed ? <ChevronDown className="size-4" /> : <ChevronUp className="size-4" />}
          </Button>
        </div>
      </CardHeader>

      {!collapsed && (
        <CardContent className="space-y-3">
          {items.map((item, index) => (
            <PlaylistItemForm
              key={index}
              item={item}
              index={index}
              showIntermissionNote={showIntermissionNote}
              onUpdate={(updated) => onUpdateItem(index, updated)}
              onRemove={() => onRemoveItem(index)}
              canRemove={items.length > 1}
            />
          ))}
          <div className="flex justify-end pt-1">
            <Button type="button" variant="outline" size="sm" className="rounded-full" onClick={onAddItem}>
              Add item
            </Button>
          </div>
        </CardContent>
      )}
    </Card>
  )
}
