import './pointer-drag.css'
import type { ActivePointerDrag } from './usePointerDrag'

export function PointerDragPreview({ drag }: { drag: ActivePointerDrag | null }) {
  if (!drag) return null
  const maxX = Math.max(8, window.innerWidth - 176)
  const maxY = Math.max(8, window.innerHeight - 72)
  return (
    <div
      className="pointer-drag-preview"
      data-testid="pointer-drag-preview"
      aria-hidden="true"
      style={{ left: Math.min(drag.x + 12, maxX), top: Math.min(drag.y + 12, maxY) }}
    >
      {drag.label}
    </div>
  )
}
