import { fireEvent } from '@testing-library/react'

let hitTarget: Element | null = null
let originalElementFromPoint: Document['elementFromPoint'] | undefined

export function installPointerHitTest() {
  originalElementFromPoint = document.elementFromPoint
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => hitTarget,
  })
}

export function setPointerHitTarget(target: Element | null) {
  hitTarget = target
}

export function restorePointerHitTest() {
  hitTarget = null
  if (originalElementFromPoint) {
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: originalElementFromPoint,
    })
  } else {
    delete (document as Partial<Document>).elementFromPoint
  }
  originalElementFromPoint = undefined
}

export function dispatchPointer(
  target: Element,
  type: 'pointerdown' | 'pointermove' | 'pointerup' | 'pointercancel',
  options: { pointerId?: number; x?: number; y?: number; button?: number; pointerType?: string } = {},
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    button: options.button ?? 0,
    clientX: options.x ?? 0,
    clientY: options.y ?? 0,
  })
  Object.defineProperties(event, {
    pointerId: { value: options.pointerId ?? 1 },
    pointerType: { value: options.pointerType ?? 'touch' },
    isPrimary: { value: true },
  })
  fireEvent(target, event)
}
