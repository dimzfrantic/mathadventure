import type { AnswerResult, DrillSession, QuestionResponse, ScoreMetrics, ScoreState } from './types'

type ScorableSession = Pick<DrillSession, 'id' | 'questions'>

export function createScoreState(session: ScorableSession): ScoreState {
  return { sessionId: session.id, responses: {} }
}

export function answerQuestion(state: ScoreState, session: ScorableSession, questionKey: string, choiceIndex: number): AnswerResult {
  if (state.sessionId !== session.id) return { ok: false, error: { code: 'SESSION_MISMATCH', message: 'State skor berasal dari sesi lain.' } }
  const question = session.questions.find(item => item.key === questionKey)
  if (!question) return { ok: false, error: { code: 'QUESTION_NOT_IN_SESSION', message: 'Soal tidak termasuk sesi ini.' } }
  if (!Number.isInteger(choiceIndex) || choiceIndex < 0 || choiceIndex >= question.choices.length) return { ok: false, error: { code: 'INVALID_CHOICE_INDEX', message: 'Indeks pilihan jawaban tidak valid.' } }
  const prior = state.responses[questionKey]
  if (prior?.status === 'completed') return { ok: false, error: { code: 'QUESTION_ALREADY_COMPLETED', message: 'Soal sudah selesai dan tidak dapat dijawab kembali.' } }
  if (prior && prior.attempts.length >= 2) return { ok: false, error: { code: 'NO_ATTEMPT_AVAILABLE', message: 'Tidak ada kesempatan menjawab yang tersisa.' } }
  if (prior?.attempts.includes(choiceIndex)) return { ok: false, error: { code: 'DUPLICATE_ANSWER', message: 'Pilihan yang sama sudah dikirim untuk soal ini.' } }

  const attempts = [...(prior?.attempts ?? []), choiceIndex]
  const correct = choiceIndex === question.correctChoiceIndex
  const completed = correct || attempts.length === 2
  const points: QuestionResponse['points'] = correct ? attempts.length === 1 ? 1 : 0.5 : 0
  const response: QuestionResponse = { status: completed ? 'completed' : 'awaiting-second-attempt', attempts, points }
  return { ok: true, state: { ...state, responses: { ...state.responses, [questionKey]: response } } }
}

export function getScoreMetrics(state: ScoreState, session: ScorableSession): ScoreMetrics {
  if (state.sessionId !== session.id) throw new Error('Score state does not belong to this session')
  let completed = 0
  let firstTryCorrect = 0
  let secondTryCorrect = 0
  let wrongTwice = 0
  let attempted = 0
  let succeeded = 0
  const errorsBySkillTag: Record<string, number> = {}

  for (const question of session.questions) {
    const response = state.responses[question.key]
    if (!response) continue
    attempted += 1
    if (response.status === 'completed') completed += 1
    if (response.points === 1) {
      firstTryCorrect += 1
      succeeded += 1
    } else if (response.points === 0.5) {
      secondTryCorrect += 1
      succeeded += 1
    } else if (response.status === 'completed') {
      wrongTwice += 1
    }
    for (const submittedChoice of response.attempts) {
      if (submittedChoice === question.correctChoiceIndex) continue
      for (const tag of question.skillTags) errorsBySkillTag[tag] = (errorsBySkillTag[tag] ?? 0) + 1
    }
  }

  const planned = session.questions.length
  const unanswered = planned - attempted
  const inProgress = attempted - completed
  const weightedPoints = firstTryCorrect + 0.5 * secondTryCorrect
  return {
    planned,
    completed,
    firstTryCorrect,
    secondTryCorrect,
    wrongTwice,
    unanswered,
    inProgress,
    // First-try accuracy denominator is questions attempted at least once; unanswered are excluded.
    firstTryAccuracy: attempted === 0 ? 0 : firstTryCorrect / attempted * 100,
    // Success rate is relative to all planned questions; unanswered are not successful.
    successWithinTwoAttempts: planned === 0 ? 0 : succeeded / planned * 100,
    weightedScore: planned === 0 ? 0 : weightedPoints / planned * 100,
    errorsBySkillTag,
  }
}
