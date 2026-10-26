/**
 * Stage 7B — Reward Redemption Domain Types
 *
 * These types represent the redemption configuration and transaction ledger.
 * They are pure domain types — no I/O, no IndexedDB, no storage concerns.
 *
 * NOTE: Stage 7A reward calculation types remain unchanged in ../rewardTypes.ts.
 * This file only adds the redemption layer on top of the earned-stars foundation.
 */

// ---------------------------------------------------------------------------
// Reward Configuration
// ---------------------------------------------------------------------------

/**
 * Snapshot of the reward configuration values relevant to a single redemption
 * transaction. Stored inside the transaction record so audits survive config changes.
 */
export interface RewardConfigSnapshot {
  /** Rupiah value per one collectible star. Must be a positive integer. */
  readonly rupiahPerStar: number
}

/**
 * Active reward configuration set by the parent.
 * Only one "active" configuration exists at a time; `configId` is always `'active'`.
 *
 * This type is suitable for in-memory use and future persistence (IndexedDB).
 * Stage 7B Phase 1 does NOT persist this — see STAGE-7B-PHASE-1-RESULTS.md.
 */
export interface RewardConfig {
  readonly configId: 'active'
  /** Monotonically increasing integer, incremented on every save. Starts at 1. */
  readonly version: number
  /** Client-clock timestamp of the last update. */
  readonly updatedAt: number
  /** Rupiah value per one collectible star. Must be a positive integer. */
  readonly rupiahPerStar: number
  /**
   * Minimum number of stars the child can request per redemption.
   * Must be a positive integer, at least 1.
   */
  readonly minStarsPerRedemption: number
  /**
   * Maximum number of stars the child can request per redemption.
   * Must be >= minStarsPerRedemption and a positive integer.
   *
   * Note: this is an absolute cap on a single redemption request, separate from
   * the available balance. A request is still rejected if it exceeds the balance
   * even when within this cap.
   *
   * Per MVP policy, parent sets this freely; "not exceeding current balance" is
   * enforced at redemption time, not here.
   */
  readonly maxStarsPerRedemption: number
}

/** The default "out of the box" reward configuration (Rp500 per star). */
export const DEFAULT_REWARD_CONFIG: RewardConfig = {
  configId: 'active',
  version: 1,
  updatedAt: 0,
  rupiahPerStar: 500,
  minStarsPerRedemption: 1,
  maxStarsPerRedemption: 100,
} as const

// ---------------------------------------------------------------------------
// Reward Transaction
// ---------------------------------------------------------------------------

/**
 * A pending redemption request that has been submitted by the child but not
 * yet confirmed or cancelled by the parent.
 *
 * Stars in pending transactions are reserved (subtracted from available balance)
 * but not yet permanently spent.
 */
export interface PendingRewardTransaction {
  readonly transactionId: string
  readonly status: 'pending'
  readonly requestedAt: number
  /** Number of collectible stars to redeem. Must be a positive integer. */
  readonly starsRedeemed: number
  /** Rupiah equivalent computed at time of request using ruleSnapshot. */
  readonly rupiahValue: number
  /** Config version used when computing rupiahValue. */
  readonly ruleSnapshotVersion: number
  /** Snapshot of config values at time of request. */
  readonly ruleSnapshot: RewardConfigSnapshot
  readonly confirmedAt: null
  readonly cancelledAt: null
}

/**
 * A redemption that has been confirmed by the parent.
 * Stars are permanently deducted from the available balance.
 */
export interface ConfirmedRewardTransaction {
  readonly transactionId: string
  readonly status: 'confirmed'
  readonly requestedAt: number
  readonly starsRedeemed: number
  readonly rupiahValue: number
  readonly ruleSnapshotVersion: number
  readonly ruleSnapshot: RewardConfigSnapshot
  /** Timestamp of parent confirmation. Must be >= requestedAt. */
  readonly confirmedAt: number
  readonly cancelledAt: null
}

/**
 * A redemption that was cancelled (either by the child before confirmation, or
 * by the parent upon rejection).
 * Stars are NOT deducted from the available balance.
 */
export interface CancelledRewardTransaction {
  readonly transactionId: string
  readonly status: 'cancelled'
  readonly requestedAt: number
  readonly starsRedeemed: number
  readonly rupiahValue: number
  readonly ruleSnapshotVersion: number
  readonly ruleSnapshot: RewardConfigSnapshot
  readonly confirmedAt: null
  /** Timestamp of cancellation. Must be >= requestedAt. */
  readonly cancelledAt: number
}

/** Discriminated union of all possible transaction states. */
export type RewardTransaction =
  | PendingRewardTransaction
  | ConfirmedRewardTransaction
  | CancelledRewardTransaction
