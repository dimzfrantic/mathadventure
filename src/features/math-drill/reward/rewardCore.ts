/**
 * Stage 7B-A2 — Canonical reward core (server-facing surface).
 *
 * The local backend must compute the authoritative balance and drive the
 * redemption state machine, but the reward ALGORITHM must exist exactly once.
 * This module is the single import surface the Node backend uses; every symbol
 * is re-exported from the existing, already-tested frontend implementation —
 * no algorithm is copied, forked or re-implemented here.
 *
 * The module graph below is deliberately loadable by BOTH:
 *   - Vite / Vitest (browser + tests), and
 *   - Node >= 22.18 / 23.6 with built-in type stripping (`process.features.typescript === 'strip'`),
 *     which is why the runtime imports in this subgraph carry explicit `.ts`
 *     extensions and the project sets `erasableSyntaxOnly`.
 */

export { computeAvailableBalance } from './redemption/balanceComputation.ts'
export type { AvailableBalanceResult } from './redemption/balanceComputation.ts'

export {
  submitRedemptionRequest,
  confirmRedemptionTransaction,
  cancelRedemptionTransaction,
} from './redemption/transactionOperations.ts'
export type {
  SubmitRedemptionResult,
  ConfirmRedemptionResult,
  CancelRedemptionResult,
} from './redemption/transactionOperations.ts'

export { validateRewardTransaction, validateRewardConfig } from './redemption/redemptionValidation.ts'
export { validateRewardCorrection } from './redemption/correctionTypes.ts'
export type { RewardCorrection } from './redemption/correctionTypes.ts'
export type { RewardConfig, RewardTransaction } from './redemption/redemptionTypes.ts'

export { validateCompletedSession, compareCompletionContent, classifyLegacySessionUnscorable } from '../persistence/completedSessionCodec.ts'
export type { CompletedSessionValidation, LegacySessionExclusion } from '../persistence/completedSessionCodec.ts'

export { aggregateRewardCollectionV1, evaluateCompletedSessionRewardV1 } from './rewardEngine.ts'
export type { RewardCollectionSummaryV1, SessionRewardEvaluation, ExcludedLegacySessionReward } from './rewardTypes.ts'
