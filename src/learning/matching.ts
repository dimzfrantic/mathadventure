export type Side = 'astronaut' | 'rocket' | 'none'
export type Outcome = 'independent' | 'guided' | 'interpretable_incorrect' | 'inconclusive'
export type Pair = Readonly<{ astronaut: string; rocket: string }>
export type Task = Readonly<{ taskId: string; variantId: string; astronauts: readonly string[]; rockets: readonly string[] }>
type Snapshot = Readonly<{ pairs: readonly Pair[]; answer: Side | null }>
export type MatchState = Readonly<{
  task: Task
  pairs: readonly Pair[]
  answer: Side | null
  selectedAstronaut: string | null
  hintLevel: 0 | 1 | 2
  hintHistoryLevel: 0 | 1 | 2
  highlightedAstronaut: string | null
  history: readonly Snapshot[]
  repeatedVariant: boolean
}>
export type Action =
  | { type: 'select'; astronaut: string }
  | { type: 'clear-selection' }
  | { type: 'pair'; astronaut: string; rocket: string }
  | { type: 'answer'; side: Side }
  | { type: 'undo' }
  | { type: 'retry' }
  | { type: 'hint' }

export function createTask(id: string, astronauts: number, rockets: number): Task {
  if (!id || !Number.isInteger(astronauts) || !Number.isInteger(rockets) ||
      astronauts < 1 || rockets < 1 || astronauts > 8 || rockets > 8) {
    throw new Error('Task memerlukan id dan 1–8 objek pada setiap sisi.')
  }
  return {
    taskId: '00.1-A',
    variantId: id,
    astronauts: Array.from({ length: astronauts }, (_, i) => `a${i + 1}`),
    rockets: Array.from({ length: rockets }, (_, i) => `r${i + 1}`),
  }
}

export function initialState(task: Task): MatchState {
  return { task, pairs: [], answer: null, selectedAstronaut: null,
    hintLevel: 0, hintHistoryLevel: 0, highlightedAstronaut: null, history: [], repeatedVariant: false }
}

function nextUnpairedAstronaut(state: MatchState, pairs = state.pairs): string | null {
  return state.task.astronauts.find(id => !pairs.some(pair => pair.astronaut === id)) ?? null
}

export function reduceMatch(state: MatchState, action: Action): MatchState {
  switch (action.type) {
    case 'select':
      if (!state.task.astronauts.includes(action.astronaut) ||
          state.pairs.some(pair => pair.astronaut === action.astronaut)) return state
      return { ...state, selectedAstronaut: action.astronaut }
    case 'clear-selection':
      return state.selectedAstronaut ? { ...state, selectedAstronaut: null } : state
    case 'pair': {
      if (!state.task.astronauts.includes(action.astronaut) ||
          !state.task.rockets.includes(action.rocket) ||
          state.pairs.some(pair => pair.astronaut === action.astronaut || pair.rocket === action.rocket)) return state
      const pairs = [...state.pairs, { astronaut: action.astronaut, rocket: action.rocket }]
      return { ...state, pairs, answer: null, selectedAstronaut: null,
        highlightedAstronaut: state.hintLevel === 2 ? nextUnpairedAstronaut(state, pairs) : null,
        history: [...state.history, { pairs: state.pairs, answer: state.answer }] }
    }
    case 'answer':
      if (state.answer === action.side) return state
      return { ...state, answer: action.side,
        history: [...state.history, { pairs: state.pairs, answer: state.answer }] }
    case 'undo': {
      const last = state.history.at(-1)
      if (!last) return state
      return { ...state, pairs: last.pairs, answer: last.answer, selectedAstronaut: null,
        highlightedAstronaut: state.hintLevel === 2 ? nextUnpairedAstronaut(state, last.pairs) : null,
        history: state.history.slice(0, -1) }
    }
    case 'retry':
  return { ...state, pairs: [], answer: null, selectedAstronaut: null,
    hintLevel: 0, hintHistoryLevel: state.hintHistoryLevel, repeatedVariant: true,
    highlightedAstronaut: null, history: [] }
    case 'hint': {
      const hintLevel = Math.min(2, state.hintLevel + 1) as 1 | 2
      return { ...state, hintLevel, hintHistoryLevel: Math.max(state.hintHistoryLevel, hintLevel) as 1 | 2,
        highlightedAstronaut: hintLevel === 2 ? nextUnpairedAstronaut(state) : null }
    }
  }
}

export function remainingSide(state: MatchState): Side {
  const astronauts = state.task.astronauts.length - state.pairs.length
  const rockets = state.task.rockets.length - state.pairs.length
  if (astronauts === rockets) return 'none'
  return astronauts > rockets ? 'astronaut' : 'rocket'
}

export function isValidCompletion(state: MatchState): boolean {
  return state.pairs.length === Math.min(state.task.astronauts.length, state.task.rockets.length) &&
    state.answer === remainingSide(state)
}

export function evaluateAttempt(state: MatchState, interactionUsable: boolean): Readonly<{
  taskId: string; variantId: string; outcome: Outcome; valid: boolean | null
  hintLevel: 0 | 1 | 2; hintHistoryLevel: 0 | 1 | 2;
  pairCount: number; identifiedRemainder: Side | null; repeatedVariant: boolean
  countsAsFreshIndependent: boolean
}> {
  const completionValid = isValidCompletion(state)
  const outcome = !interactionUsable || state.answer === null ||
    state.pairs.length < Math.min(state.task.astronauts.length, state.task.rockets.length)
    ? 'inconclusive' : !completionValid ? 'interpretable_incorrect'
      : state.hintLevel > 0 ? 'guided' : 'independent'
  const valid = outcome === 'inconclusive' ? null : completionValid
  return {
    taskId: state.task.taskId,
    variantId: state.task.variantId,
    outcome,
    valid,
    hintLevel: state.hintLevel,
    hintHistoryLevel: state.hintHistoryLevel,
    pairCount: state.pairs.length,
    identifiedRemainder: state.answer,
    repeatedVariant: state.repeatedVariant,
    countsAsFreshIndependent: !state.repeatedVariant && valid === true && state.hintHistoryLevel === 0 && interactionUsable,
  }
}
