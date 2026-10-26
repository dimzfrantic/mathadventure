import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react'

export type ActivePointerDrag = Readonly<{
  sourceId: string
  label: string
  x: number
  y: number
  targetId: string | null
}>

type DragSession = {
  pointerId: number
  sourceId: string
  label: string
  startX: number
  startY: number
  x: number
  y: number
  targetId: string | null
  dragging: boolean
  source: HTMLElement
}

export function usePointerDrag(onDrop: (sourceId: string, targetId: string) => void) {
  const [activeDrag, setActiveDrag] = useState<ActivePointerDrag | null>(null)
  const session = useRef<DragSession | null>(null)
  const dropCallback = useRef(onDrop)
  const suppressClick = useRef(false)
  const suppressionTimer = useRef<number | undefined>(undefined)
  useLayoutEffect(() => {
    dropCallback.current = onDrop
  }, [onDrop])

  useEffect(() => () => {
    if (suppressionTimer.current !== undefined) window.clearTimeout(suppressionTimer.current)
  }, [])

  function clearSuppressionTimer() {
    if (suppressionTimer.current !== undefined) {
      window.clearTimeout(suppressionTimer.current)
      suppressionTimer.current = undefined
    }
  }

  function blockGeneratedClick() {
    clearSuppressionTimer()
    suppressClick.current = true
    suppressionTimer.current = window.setTimeout(() => {
      suppressClick.current = false
      suppressionTimer.current = undefined
    }, 0)
  }

  function targetAtPoint(event: ReactPointerEvent<HTMLElement>) {
    const hit = document.elementFromPoint?.(event.clientX, event.clientY)
    return hit instanceof Element
      ? hit.closest<HTMLElement>('[data-drop-target-id]')?.dataset.dropTargetId ?? null
      : null
  }

  function onPointerDown(sourceId: string, label: string, event: ReactPointerEvent<HTMLElement>) {
    if (event.isPrimary === false || event.button !== 0) return
    clearSuppressionTimer()
    suppressClick.current = false
    const source = event.currentTarget
    session.current = {
      pointerId: event.pointerId,
      sourceId,
      label,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      targetId: null,
      dragging: false,
      source,
    }
    setActiveDrag({
      sourceId,
      label,
      x: event.clientX,
      y: event.clientY,
      targetId: null,
    })
    try {
      source.setPointerCapture?.(event.pointerId)
    } catch {
      // A browser may reject capture after the pointer has already been cancelled.
    }
  }

  function onPointerMove(event: ReactPointerEvent<HTMLElement>) {
    const current = session.current
    if (!current || current.pointerId !== event.pointerId) return
    const distance = Math.hypot(event.clientX - current.startX, event.clientY - current.startY)
    if (!current.dragging && distance < 8) return

    current.dragging = true
    current.x = event.clientX
    current.y = event.clientY
    current.targetId = targetAtPoint(event)
    setActiveDrag({
      sourceId: current.sourceId,
      label: current.label,
      x: current.x,
      y: current.y,
      targetId: current.targetId,
    })
    event.preventDefault()
  }

  function finishPointer(event: ReactPointerEvent<HTMLElement>, cancelled: boolean) {
    const current = session.current
    if (!current || current.pointerId !== event.pointerId) return

    if (current.dragging) {
      blockGeneratedClick()
      const targetId = cancelled ? null : targetAtPoint(event)
      if (targetId) dropCallback.current(current.sourceId, targetId)
    } else {
      suppressClick.current = false
      clearSuppressionTimer()
    }

    session.current = null
    setActiveDrag(null)
    try {
      if (current.source.hasPointerCapture?.(current.pointerId)) {
        current.source.releasePointerCapture?.(current.pointerId)
      }
    } catch {
      // Pointer capture can already be released by the browser on cancellation.
    }
  }

  function onClickCapture(event: ReactMouseEvent<HTMLElement>) {
    if (!suppressClick.current || event.detail === 0) return
    event.preventDefault()
    event.stopPropagation()
    suppressClick.current = false
    clearSuppressionTimer()
  }

  function bindSource(sourceId: string, label: string) {
    return {
      onPointerDown: (event: ReactPointerEvent<HTMLElement>) => onPointerDown(sourceId, label, event),
      onPointerMove,
      onPointerUp: (event: ReactPointerEvent<HTMLElement>) => finishPointer(event, false),
      onPointerCancel: (event: ReactPointerEvent<HTMLElement>) => finishPointer(event, true),
      onLostPointerCapture: (event: ReactPointerEvent<HTMLElement>) => finishPointer(event, true),
    }
  }

  return { activeDrag, bindSource, onClickCapture }
}

