/**
 * Stage 7B-A2 — Reward API client (authoritative backend).
 *
 * The local backend owns the reward ledger and the completed sessions that
 * feed it. This client is deliberately thin and status-aware: it never throws,
 * it never computes a balance, and it never decides that a mutation succeeded
 * — only the server response does.
 *
 * Authorization reuses the existing parent session token (`X-Parent-Session`)
 * held in memory by `sessionApi.ts`. No token is ever persisted or logged.
 */

import type { AvailableBalanceResult } from '../reward/redemption/balanceComputation'
import type { RewardCorrection } from '../reward/redemption/correctionTypes'
import type { RewardConfig, RewardTransaction } from '../reward/redemption/redemptionTypes'
import type { CompletedSessionRecord } from '../persistence/completedSessionTypes'
import { getParentSessionToken } from './sessionApi'

const API_BASE = '/api'
const REQUEST_TIMEOUT_MS = 10_000

export type RewardApiFailure = {
  readonly status: 'error'
  readonly reason: string
  readonly httpStatus: number
}

export type RewardStateResponse = {
  readonly config: RewardConfig
  readonly configValid: boolean
  readonly transactions: readonly RewardTransaction[]
  readonly corrections: readonly RewardCorrection[]
  readonly balance: AvailableBalanceResult
  readonly completedSessionsCount: number
}

export type RewardApiResult<T> =
  | { readonly ok: true; readonly httpStatus: number; readonly value: T }
  | { readonly ok: false; readonly httpStatus: number; readonly failure: RewardApiFailure }

async function request<T>(
  pathname: string,
  options: { readonly method?: string; readonly body?: unknown } = {},
): Promise<RewardApiResult<T>> {
  const token = getParentSessionToken()
  if (!token) {
    return { ok: false, httpStatus: 0, failure: { status: 'error', reason: 'unauthorized', httpStatus: 0 } }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${pathname}`, {
      method: options.method ?? 'GET',
      headers: {
        'Content-Type': 'application/json',
        'X-Parent-Session': token,
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    })

    let payload: unknown = null
    try { payload = await response.json() } catch { payload = null }

    if (response.ok) return { ok: true, httpStatus: response.status, value: payload as T }

    const reason = typeof (payload as { reason?: unknown })?.reason === 'string'
      ? (payload as { reason: string }).reason
      : response.status === 401
        ? 'unauthorized'
        : `http-${response.status}`
    return { ok: false, httpStatus: response.status, failure: { status: 'error', reason, httpStatus: response.status } }
  } catch {
    return { ok: false, httpStatus: 0, failure: { status: 'error', reason: 'network-error', httpStatus: 0 } }
  } finally {
    clearTimeout(timer)
  }
}

/** Deduplicates concurrent identical reads without caching stale data. */
let stateInFlight: Promise<RewardApiResult<RewardStateResponse>> | null = null

export function getRewardState(): Promise<RewardApiResult<RewardStateResponse>> {
  if (stateInFlight) return stateInFlight
  stateInFlight = request<RewardStateResponse>('/reward/state').finally(() => { stateInFlight = null })
  return stateInFlight
}

export function getRewardSessions(): Promise<RewardApiResult<{ sessions: readonly CompletedSessionRecord[]; total: number; invalidCount: number }>> {
  return request('/reward/completed-sessions')
}

export function submitRewardTransaction(params: { readonly transactionId: string; readonly starsRedeemed: number }) {
  return request<{ status: string; transaction?: RewardTransaction }>('/reward/transactions', {
    method: 'POST',
    body: params,
  })
}

export function confirmRewardTransaction(transactionId: string) {
  return request<{ status: string; transaction?: RewardTransaction }>(
    `/reward/transactions/${encodeURIComponent(transactionId)}/confirm`,
    { method: 'POST' },
  )
}

export function cancelRewardTransaction(transactionId: string) {
  return request<{ status: string; transaction?: RewardTransaction }>(
    `/reward/transactions/${encodeURIComponent(transactionId)}/cancel`,
    { method: 'POST' },
  )
}

export function updateRewardConfig(updates: {
  readonly rupiahPerStar?: number
  readonly minStarsPerRedemption?: number
  readonly maxStarsPerRedemption?: number
}) {
  return request<{ status: string; config?: RewardConfig }>('/reward/config', { method: 'PUT', body: updates })
}

export function createRewardCorrection(params: {
  readonly correctionId: string
  readonly originalTransactionId: string
  readonly parentId?: string
  readonly starsDelta: number
  readonly reason: string
}) {
  return request<{ status: string; correction?: RewardCorrection }>('/reward/corrections', { method: 'POST', body: params })
}
