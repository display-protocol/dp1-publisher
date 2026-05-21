import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { DisplayPrefs, PlaylistItem } from '@/types/dp1'
import { updateItemDisplay } from '@/lib/dp1ItemDisplay'
import { useState } from 'react'

interface Props {
  item: PlaylistItem
  index: number
  /** When false, hides optional playlists-extension intermission note UI. */
  showIntermissionNote?: boolean
  onUpdate: (item: PlaylistItem) => void
  onRemove: () => void
  canRemove: boolean
}

type ScalingValue = NonNullable<DisplayPrefs['scaling']>
const SCALING_VALUES: ScalingValue[] = ['fit', 'fill', 'stretch', 'auto']

function isScalingValue(v: string): v is ScalingValue {
  return (SCALING_VALUES as string[]).includes(v)
}

function triStateValue(b: boolean | undefined): 'inherit' | 'true' | 'false' {
  if (b === undefined) return 'inherit'
  return b ? 'true' : 'false'
}

function triStateToBool(v: string): boolean | undefined {
  if (v === 'true') return true
  if (v === 'false') return false
  return undefined
}

export default function PlaylistItemForm({
  item,
  index,
  showIntermissionNote = true,
  onUpdate,
  onRemove,
  canRemove,
}: Props) {
  const [showAdvanced, setShowAdvanced] = useState(false)

  const background = typeof item.display?.background === 'string' ? item.display.background : ''

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

          {/* Advanced — per-item display overrides (core) + intermission note (extension) */}
          <div className="pt-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
              className="text-xs"
            >
              {showAdvanced ? '− Hide' : '+ Show'} advanced
            </Button>
          </div>

          {showAdvanced && (
            <div className="space-y-4 rounded-lg border border-border/30 bg-muted/20 p-4">
              {/* Display overrides — always shown (core DP-1) */}
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Per-item display overrides — each defaults to the playlist&apos;s default value
                </p>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor={`item-scaling-${index}`}>Scaling</Label>
                    <Select
                      value={item.display?.scaling ?? 'inherit'}
                      onValueChange={(v) =>
                        onUpdate(
                          updateItemDisplay(
                            item,
                            'scaling',
                            v === 'inherit' || !isScalingValue(v) ? undefined : v
                          )
                        )
                      }
                    >
                      <SelectTrigger id={`item-scaling-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit default</SelectItem>
                        <SelectItem value="fit">Fit</SelectItem>
                        <SelectItem value="fill">Fill</SelectItem>
                        <SelectItem value="stretch">Stretch</SelectItem>
                        <SelectItem value="auto">Auto</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`item-background-${index}`}>Background</Label>
                    <Input
                      id={`item-background-${index}`}
                      value={background}
                      onChange={(e) =>
                        onUpdate(
                          updateItemDisplay(item, 'background', e.target.value || undefined)
                        )
                      }
                      placeholder="Inherit (e.g. #000000)"
                    />
                  </div>
                  <div>
                    <Label htmlFor={`item-loop-${index}`}>Loop</Label>
                    <Select
                      value={triStateValue(item.display?.loop)}
                      onValueChange={(v) =>
                        onUpdate(updateItemDisplay(item, 'loop', triStateToBool(v)))
                      }
                    >
                      <SelectTrigger id={`item-loop-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit default</SelectItem>
                        <SelectItem value="true">On</SelectItem>
                        <SelectItem value="false">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label htmlFor={`item-autoplay-${index}`}>Autoplay</Label>
                    <Select
                      value={triStateValue(item.display?.autoplay)}
                      onValueChange={(v) =>
                        onUpdate(updateItemDisplay(item, 'autoplay', triStateToBool(v)))
                      }
                    >
                      <SelectTrigger id={`item-autoplay-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="inherit">Inherit default</SelectItem>
                        <SelectItem value="true">On</SelectItem>
                        <SelectItem value="false">Off</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>

              {/* Intermission note — playlists extension */}
              {showIntermissionNote && (
                <div className="space-y-3 border-t border-border/30 pt-4">
                  <p className="text-xs text-muted-foreground">
                    Optional intermission card shown after this item
                  </p>
                  <div>
                    <Label htmlFor={`item-note-text-${index}`}>Note Text</Label>
                    <Textarea
                      id={`item-note-text-${index}`}
                      value={item.note?.text || ''}
                      onChange={(e) =>
                        onUpdate({
                          ...item,
                          note: e.target.value
                            ? {
                                text: e.target.value,
                                duration: item.note?.duration,
                              }
                            : undefined,
                        })
                      }
                      placeholder="Short intermission message (max 500 characters)"
                      rows={2}
                      maxLength={500}
                    />
                    {item.note?.text && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.note.text.length}/500 characters
                      </p>
                    )}
                  </div>
                  <div>
                    <Label htmlFor={`item-note-duration-${index}`}>Duration (seconds)</Label>
                    <Input
                      id={`item-note-duration-${index}`}
                      type="number"
                      value={item.note?.duration || ''}
                      onChange={(e) => {
                        const duration = e.target.value ? parseFloat(e.target.value) : undefined
                        onUpdate({
                          ...item,
                          note: item.note?.text
                            ? {
                                text: item.note.text,
                                duration,
                              }
                            : undefined,
                        })
                      }}
                      placeholder="20 (default)"
                      disabled={!item.note?.text}
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      Defaults to 20 seconds if not specified
                    </p>
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </CardContent>
    </Card>
  )
}
