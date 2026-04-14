import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import type { Entity } from '@/types/dp1'

interface Props {
  curators: Entity[]
  onChange: (curators: Entity[]) => void
}

export default function CuratorList({ curators, onChange }: Props) {
  const handleUpdateCurator = (index: number, field: keyof Entity, value: string) => {
    const newCurators = [...curators]
    newCurators[index] = { ...newCurators[index], [field]: value }
    onChange(newCurators)
  }

  const handleAddCurator = () => {
    onChange([...curators, { name: '', key: '', url: '' }])
  }

  const handleRemoveCurator = (index: number) => {
    if (index > 0) { // Can't remove first curator (wallet user)
      onChange(curators.filter((_, i) => i !== index))
    }
  }

  return (
    <div className="space-y-5">
      <h3 className="section-label">Curators</h3>

      {curators.map((curator, index) => (
        <Card key={index} className="border-border/40 bg-muted/15 shadow-none">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="font-sans text-base font-medium tracking-normal">
                {index === 0 ? 'Curator 1 (You)' : `Curator ${index + 1}`}
              </CardTitle>
              {index > 0 && (
                <Button
                  variant="destructive"
                  size="sm"
                  className="rounded-full text-xs"
                  onClick={() => handleRemoveCurator(index)}
                >
                  Remove
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {index === 0 ? (
              <div>
                <Label>Key (from connected wallet)</Label>
                <div className="mt-1.5 rounded-xl border border-border/50 bg-background/80 px-3 py-2 font-mono text-xs leading-relaxed text-muted-foreground">
                  {curator.key}
                </div>
              </div>
            ) : (
              <div>
                <Label htmlFor={`curator-key-${index}`}>Key (DID:PKH) *</Label>
                <Input
                  id={`curator-key-${index}`}
                  value={curator.key}
                  onChange={(e) => handleUpdateCurator(index, 'key', e.target.value)}
                  placeholder="did:pkh:eip155:1:0x..."
                />
              </div>
            )}

            <div>
              <Label htmlFor={`curator-name-${index}`}>Name</Label>
              <Input
                id={`curator-name-${index}`}
                value={curator.name}
                onChange={(e) => handleUpdateCurator(index, 'name', e.target.value)}
                placeholder="Curator name (optional)"
              />
            </div>

            <div>
              <Label htmlFor={`curator-url-${index}`}>URL</Label>
              <Input
                id={`curator-url-${index}`}
                value={curator.url || ''}
                onChange={(e) => handleUpdateCurator(index, 'url', e.target.value)}
                placeholder="https://... (optional)"
              />
            </div>
          </CardContent>
        </Card>
      ))}

      <Button onClick={handleAddCurator} variant="outline" className="w-full rounded-full border-dashed">
        Add curator
      </Button>
    </div>
  )
}
