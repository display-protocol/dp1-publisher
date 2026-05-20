import { useRef, useState } from 'react'
import { Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { useToast } from '@/hooks/use-toast'

interface Props {
  value: string
  onChange: (next: string) => void
  rows?: number
  placeholder?: string
}

/**
 * JSON editing surface for the publisher's JSON tabs.
 *
 * Adds two affordances over a plain Textarea:
 * - "Upload .json" button (opens a native file picker)
 * - drag-and-drop a JSON file onto the textarea
 *
 * Both paths feed file contents through `onChange` exactly like a paste, so
 * existing parse / form-sync / publish logic doesn't need to know about uploads.
 */
export default function JsonFileDropZone({
  value,
  onChange,
  rows = 20,
  placeholder = 'Drop a .json file here or paste DP-1 JSON…',
}: Props) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [isDragging, setIsDragging] = useState(false)
  const { toast } = useToast()

  const loadFile = async (file: File) => {
    try {
      const text = await file.text()
      onChange(text)
      toast({
        title: 'Loaded',
        description: `${file.name} · ${(file.size / 1024).toFixed(1)} KB`,
      })
    } catch (err) {
      toast({
        title: 'Failed to read file',
        description: err instanceof Error ? err.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const handleDrop = (e: React.DragEvent<HTMLTextAreaElement>) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) loadFile(file)
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Paste DP-1 JSON, drop a file on the editor, or upload below.
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) loadFile(file)
            e.target.value = '' // allow re-uploading the same file
          }}
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="gap-2 rounded-full"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-3.5" aria-hidden />
          Upload .json
        </Button>
      </div>
      <Textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        placeholder={placeholder}
        onDragOver={(e) => {
          e.preventDefault()
          if (!isDragging) setIsDragging(true)
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        className={`font-mono text-[13px] leading-relaxed transition-colors ${
          isDragging ? 'border-primary bg-primary/5' : ''
        }`}
      />
    </div>
  )
}
