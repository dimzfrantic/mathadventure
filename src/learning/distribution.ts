export type DistributionOutcome = 'independent' | 'guided' | 'interpretable_incorrect' | 'inconclusive'

export type DistributionTask = Readonly<{
  taskId: '00.1-B'
  variantId: 'sufficient'
  recipients: readonly string[]
  items: readonly string[]
}>

type DistributionSnapshot = Readonly<{
  stock: readonly string[]
  allocations: Readonly<Record<string, readonly string[]>>
}>

export type DistributionState = Readonly<{
  task: DistributionTask
  stock: readonly string[]
  allocations: Readonly<Record<string, readonly string[]>>
  selectedItemId: string | null
  hintLevel: 0 | 1 | 2
  hintHistoryLevel: 0 | 1 | 2
  repeatedVariant: boolean
  history: readonly DistributionSnapshot[]
}>

export type DistributionAction =
  | { type: 'select-item'; itemId: string }
  | { type: 'assign'; recipientId: string }
  | { type: 'return-item'; itemId: string }
  | { type: 'undo' }
  | { type: 'hint' }
  | { type: 'mark-repeated' }
  | { type: 'retry' }

export type DistributionAttemptDraft = Readonly<{
  taskId: '00.1-B'
  variantId: 'sufficient'
  outcome: DistributionOutcome
  valid: boolean | null
  hintLevel: 0 | 1 | 2
  hintHistoryLevel: 0 | 1 | 2
  recipientCount: number
  itemCount: number
  recipientsExactlyOne: number
  recipientsNeedingAdjustment: number
  hasUnallocatedItems: boolean
  distributionValid: boolean | null
  repeatedVariant: boolean
  countsAsFreshIndependent: boolean
}>

export function createDistributionTask(): DistributionTask {
  return {
    taskId: '00.1-B',
    variantId: 'sufficient',
    recipients: Array.from({ length: 5 }, (_, index) => `recipient-${index + 1}`),
    items: Array.from({ length: 5 }, (_, index) => `item-${index + 1}`),
  }
}

export function initialDistributionState(task: DistributionTask): DistributionState {
  return {
    task,
    stock: [...task.items],
    allocations: Object.fromEntries(task.recipients.map(recipientId => [recipientId, []])),
    selectedItemId: null,
    hintLevel: 0,
    hintHistoryLevel: 0,
    repeatedVariant: false,
    history: [],
  }
}

function snapshot(state: DistributionState): DistributionSnapshot {
  return {
    stock: [...state.stock],
    allocations: Object.fromEntries(Object.entries(state.allocations).map(([id, items]) => [id, [...items]])),
  }
}

function withSnapshot(state: DistributionState): Pick<DistributionState, 'history'> {
  return { history: [...state.history, snapshot(state)] }
}

export function reduceDistribution(state: DistributionState, action: DistributionAction): DistributionState {
  switch (action.type) {
    case 'select-item': {
      if (!state.stock.includes(action.itemId)) return state
      return { ...state, selectedItemId: state.selectedItemId === action.itemId ? null : action.itemId }
    }
    case 'assign': {
      if (!state.selectedItemId || !state.task.recipients.includes(action.recipientId) ||
          !state.stock.includes(state.selectedItemId)) return state
      const itemId = state.selectedItemId
      return {
        ...state,
        stock: state.stock.filter(id => id !== itemId),
        allocations: {
          ...state.allocations,
          [action.recipientId]: [...state.allocations[action.recipientId], itemId],
        },
        selectedItemId: null,
        ...withSnapshot(state),
      }
    }
    case 'return-item': {
      if (!state.task.items.includes(action.itemId) || state.stock.includes(action.itemId)) return state
      const owner = state.task.recipients.find(id => state.allocations[id].includes(action.itemId))
      if (!owner) return state
      return {
        ...state,
        stock: [...state.stock, action.itemId],
        allocations: { ...state.allocations, [owner]: state.allocations[owner].filter(id => id !== action.itemId) },
        selectedItemId: null,
        ...withSnapshot(state),
      }
    }
    case 'undo': {
      const previous = state.history.at(-1)
      if (!previous) return state
      return {
        ...state,
        stock: [...previous.stock],
        allocations: Object.fromEntries(Object.entries(previous.allocations).map(([id, items]) => [id, [...items]])),
        selectedItemId: null,
        history: state.history.slice(0, -1),
      }
    }
    case 'hint': {
      const hintLevel = Math.min(2, state.hintLevel + 1) as 1 | 2
      if (hintLevel === state.hintLevel) return state
      return { ...state, hintLevel, hintHistoryLevel: Math.max(state.hintHistoryLevel, hintLevel) as 1 | 2 }
    }
    case 'mark-repeated':
      return { ...state, repeatedVariant: true }
    case 'retry':
      return {
        ...initialDistributionState(state.task),
        hintHistoryLevel: state.hintHistoryLevel,
        repeatedVariant: true,
      }
  }
}

export function evaluateDistributionAttempt(state: DistributionState, interactionUsable = true): DistributionAttemptDraft {
  const recipientCounts = state.task.recipients.map(id => state.allocations[id].length)
  const needsAdjustment = recipientCounts.filter(count => count !== 1)
  const recipientsExactlyOne = recipientCounts.filter(count => count === 1).length
  const distributionValid = state.task.variantId === 'sufficient' && recipientCounts.every(count => count === 1) && state.stock.length === 0
  const valid = interactionUsable ? distributionValid : null
  const outcome: DistributionOutcome = !interactionUsable ? 'inconclusive'
    : !valid ? 'interpretable_incorrect'
      : state.hintHistoryLevel > 0 || state.repeatedVariant ? 'guided' : 'independent'

  return {
    taskId: state.task.taskId,
    variantId: state.task.variantId,
    outcome,
    valid,
    hintLevel: state.hintLevel,
    hintHistoryLevel: state.hintHistoryLevel,
    recipientCount: state.task.recipients.length,
    itemCount: state.task.items.length,
    recipientsExactlyOne,
    recipientsNeedingAdjustment: needsAdjustment.length,
    hasUnallocatedItems: state.stock.length > 0,
    distributionValid: interactionUsable ? distributionValid : null,
    repeatedVariant: state.repeatedVariant,
    countsAsFreshIndependent: valid === true && !state.repeatedVariant && state.hintHistoryLevel === 0,
  }
}
