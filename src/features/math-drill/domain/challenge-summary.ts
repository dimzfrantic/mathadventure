import type { ChallengeMetrics, ChallengeQuestion, ChallengeRate, ChallengeSession, ChallengeSummary } from './challenge-types'
import type { DrillLevel, Level5Sublevel, Operation, ScoreState } from './types'

function rate(numerator: number, denominator: number): ChallengeRate {
  return { numerator, denominator, value: denominator === 0 ? null : numerator / denominator * 100 }
}

function metrics(state: ScoreState, questions: readonly ChallengeQuestion[]): ChallengeMetrics {
  let attempted = 0
  let completed = 0
  let firstTryCorrect = 0
  let secondTryCorrect = 0
  let wrongTwice = 0
  for (const question of questions) {
    const response = state.responses[question.key]
    if (!response) continue
    attempted += 1
    if (response.status === 'completed') completed += 1
    if (response.points === 1) firstTryCorrect += 1
    else if (response.points === 0.5) secondTryCorrect += 1
    else if (response.status === 'completed') wrongTwice += 1
  }
  const planned = questions.length
  return {
    planned, attempted, completed, firstTryCorrect, secondTryCorrect, wrongTwice,
    unanswered: planned - attempted, inProgress: attempted - completed,
    firstTryAccuracy: rate(firstTryCorrect, attempted),
    weightedScore: rate(firstTryCorrect + 0.5 * secondTryCorrect, planned),
    successWithinTwoAttempts: rate(firstTryCorrect + secondTryCorrect, planned),
  }
}

export function getChallengeSummary(state: ScoreState, session: ChallengeSession): ChallengeSummary {
  if (state.sessionId !== session.id) throw new Error('Score state does not belong to this session')
  const levels = [1, 2, 3, 4, 5] as const
  const sublevels = ['dasar', 'menengah', 'lanjutan'] as const
  const operations = ['addition', 'subtraction'] as const
  const byLevel = Object.fromEntries(levels.map(level => [level, metrics(state, session.questions.filter(q => q.level === level))])) as Record<DrillLevel, ChallengeMetrics>
  const bySublevel = Object.fromEntries(sublevels.map(sublevel => [sublevel, metrics(state, session.questions.filter(q => q.level5Sublevel === sublevel))])) as Record<Level5Sublevel, ChallengeMetrics>
  const byOperation = Object.fromEntries(operations.map(operation => [operation, metrics(state, session.questions.filter(q => q.operation === operation))])) as Record<Operation, ChallengeMetrics>
  return { overall: metrics(state, session.questions), byLevel, bySublevel, byOperation }
}
