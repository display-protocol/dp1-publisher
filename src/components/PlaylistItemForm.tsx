import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { PlaylistItem } from '@/types/dp1'

interface Props {
  item: PlaylistItem
  index: number
  onUpdate: (item: PlaylistItem) => void
  onRemove: () => void
  canRemove: boolean
}

export default function PlaylistItemForm({ item, index, onUpdate, onRemove, canRemove }: Props) {
  return (
    <Card className="border-border/35 bg-muted/10 shadow-none">
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <span className="section-label">Item {index + 1}</span>
            {canRemove && (
              <Button
                variant="destructive"
                size="sm"
                className="rounded-full text-xs"
                onClick={onRemove}
              >
                Remove
              </Button>
            )}
          </div>

          <div>
            <Label htmlFor={`source-${index}`}>Source URI *</Label>
            <Input
              id={`source-${index}`}
              value={item.source}
              onChange={(e) => onUpdate({ ...item, source: e.target.value })}
              placeholder="https://… or ipfs://…"
            />
          </div>

          <div>
            <Label htmlFor={`item-title-${index}`}>Title</Label>
            <Input
              id={`item-title-${index}`}
              value={item.title || ''}
              onChange={(e) => onUpdate({ ...item, title: e.target.value })}
              placeholder="Artwork title"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor={`item-duration-${index}`}>Duration (seconds)</Label>
              <Input
                id={`item-duration-${index}`}
                type="number"
                value={item.duration || ''}
                onChange={(e) => onUpdate({
                  ...item,
                  duration: e.target.value ? parseFloat(e.target.value) : undefined
                })}
                placeholder="Inherit default"
              />
            </div>

            <div>
              <Label htmlFor={`item-license-${index}`}>License</Label>
              <Select
                value={item.license || 'inherit'}
                onValueChange={(v) => onUpdate({
                  ...item,
                  license: v === 'inherit' ? undefined : v as 'open' | 'token' | 'subscription'
                })}
              >
                <SelectTrigger id={`item-license-${index}`}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="inherit">Inherit default</SelectItem>
                  <SelectItem value="open">Open</SelectItem>
                  <SelectItem value="token">Token</SelectItem>
                  <SelectItem value="subscription">Subscription</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
