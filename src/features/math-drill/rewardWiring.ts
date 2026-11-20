/**
 * Stage 7B-A2 — Reward wiring for the application shell.
 *
 * One place that builds the reward controller and the dashboard history view
 * against the authoritative backend, so `App.tsx` stays declarative and tests
 * can build the exact same objects with an injected API.
 *
 * Created once per application instance (memoized by the caller). The objects
 * are stateless with respect to React: the controller holds its own snapshot,
 * the store reads the parent session token per request, and nothing registers
 * listeners or timers, so there is no cleanup to leak on unmount.
 */

import { createRewardController, type RewardController } from './reward/redemption/rewardController'
import { createRemoteCompletedSessionSource, createRemoteRewardStore } from './reward/remoteRewardStore'
import { createDeviceHistoryStore } from './persistence/deviceHistoryStore'
import type { CompletedSessionHistoryStore } from './persistence/completedSessionHistoryStore'
import * as rewardApi from './api/rewardApi'
import * as sessionApi from './api/sessionApi'

export interface BackendRewardApi {
  readonly getState: typeof rewardApi.getRewardState
  readonly getSessions: typeof rewardApi.getRewardSessions
  readonly submit: typeof rewardApi.submitRewardTransaction
  readonly confirm: typeof rewardApi.confirmRewardTransaction
  readonly cancel: typeof rewardApi.cancelRewardTransaction
  readonly updateConfig: typeof rewardApi.updateRewardConfig
  readonly createCorrection: typeof rewardApi.createRewardCorrection
}

export const defaultRewardApi: BackendRewardApi = {
  getState: rewardApi.getRewardState,
  getSessions: rewardApi.getRewardSessions,
  submit: rewardApi.submitRewardTransaction,
  confirm: rewardApi.confirmRewardTransaction,
  cancel: rewardApi.cancelRewardTransaction,
  updateConfig: rewardApi.updateRewardConfig,
  createCorrection: rewardApi.createRewardCorrection,
}

export interface RewardWiring {
  readonly controller: RewardController
  readonly historyStore: Pick<CompletedSessionHistoryStore, 'list'>
}

export interface RewardWiringOptions {
  readonly api?: BackendRewardApi
  readonly now?: () => number
  /**
   * Session read used by the dashboard history. Defaults to the device-
   * authenticated `GET /api/sessions`; injectable so tests can build the same
   * object the shell builds.
   */
  readonly historyApi?: { readonly getSessions: typeof sessionApi.getSessions }
}

export function createRewardWiring(options: RewardWiringOptions = {}): RewardWiring {
  const api = options.api ?? defaultRewardApi
  return {
    controller: createRewardController({
      store: createRemoteRewardStore({ api }),
      completedSessions: createRemoteCompletedSessionSource({ getSessions: api.getSessions }),
      ...(options.now ? { now: options.now } : {}),
    }),
    // History is a device-credentialed read: the local parent PIN must never be
    // sent to the backend as authentication. The balance above stays behind the
    // authoritative reward ledger and its parent session.
    historyStore: createDeviceHistoryStore(options.historyApi ?? { getSessions: sessionApi.getSessions }),
  }
}
