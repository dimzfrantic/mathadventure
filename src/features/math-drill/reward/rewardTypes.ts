export type RewardRuleTierV1 =
  | 'none'
  | 'partial-low-coverage'
  | 'passing-low-accuracy'
  | 'passing-good-accuracy'
  | 'perfect-high-accuracy'

export interface SessionRewardV1 {
  readonly sessionStars: 0 | 1 | 2 | 3
  readonly collectibleStars: 0 | 1 | 2 | 3
  readonly ruleTier: RewardRuleTierV1
  readonly coverageRatio: { readonly numerator: number; readonly denominator: number }
  readonly accuracyRatio: { readonly numerator: number; readonly denominator: number }
}

export interface SessionRewardInputV1 {
  readonly plannedCount: number
  readonly completedCount: number
  readonly totalPoints: number
}

// V2Extended types (re-exported from rewardRulesV2Extended for convenience)
export interface SessionRewardV2Extended extends SessionRewardV1 {
  readonly speedBonusApplied: boolean
  readonly challengeMultiplierApplied: boolean
  readonly finalStars: number
}

export type SessionRewardEvaluation =
  | {
      readonly status: 'valid'
      readonly instanceId: string
      readonly mode: string
      readonly reward: SessionRewardV1
    }
  | {
      readonly status: 'invalid'
      readonly instanceId?: string
      readonly issues: readonly string[]
    }
  | {
      readonly status: 'unsupported-version'
      readonly instanceId?: string
      readonly version: number
    }

export interface ConflictedSessionReward {
  readonly instanceId: string
  readonly reason: 'conflicting-content'
}

export interface ExcludedLegacySessionReward {
  readonly instanceId: string
  readonly reason: 'LEGACY_SESSION_UNSCORABLE'
}

export interface RewardCollectionSummaryV1 {
  readonly totalSessionStars: number
  readonly totalCollectibleStars: number
  readonly availableBalance: number
  readonly qualifyingSessionCount: number
  readonly totalValidSessions: number
  readonly duplicatesIgnoredCount: number
  readonly invalidRecordsCount: number
  readonly conflicts: readonly ConflictedSessionReward[]
  readonly excludedLegacySessionsCount: number
  readonly excludedLegacySessions: readonly ExcludedLegacySessionReward[]
}
