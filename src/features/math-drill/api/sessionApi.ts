/**
 * Math Adventure API Client
 * 
 * Frontend service for communicating with the local backend server.
 * Provides centralized session history persistence across localhost,
 * LAN, and ZeroTier access paths.
 */

import type { CompletedSessionRecord } from '../persistence/completedSessionTypes'

const API_BASE = '/api'

export interface ApiSession {
  readonly instanceId: string
  readonly sessionId: string
  readonly mode: 'regular' | 'challenge'
  readonly historySchemaVersion: 1 | 2
  readonly operationMode: string
  readonly endReason?: 'completed' | 'timeout'
  readonly plannedCount?: number
  readonly completedCount?: number
  readonly startedAt?: number
  readonly durationMs?: number | null
  readonly deadlineAt?: number | null
  readonly endedAt?: number
  readonly remainingMs?: number | null
  readonly recordedAt: number
  readonly outcomes: readonly {
    readonly level: number
    readonly operation: string
    readonly level5Sublevel?: string
    readonly points: 0 | 0.5 | 1
  }[]
}

export interface SessionsResponse {
  sessions: ApiSession[]
  total: number
  offset: number
  limit: number
}

export interface ApiConfig {
  rupiahPerStar: number
  minStarsPerRedemption: number
  maxStarsPerRedemption: number
}

// Parent session token — persisted to localStorage (Stage 7B-A2 Alternatif B)
// so it survives page reloads. Validated on every mount via GET /api/parent/session.
// Stage 7B-A2 Alternatif B: the backend parent-session token is persisted to
// localStorage so it survives page reloads. The token is a short-lived (15 min
// sliding) bearer credential for reward reads/writes only — it is never the
// local device PIN, and the local PIN is never sent to the backend.
//
// Security notes:
//  - The token is per-origin (localStorage), so a different device on the LAN
//    does not have it.
//  - The token is validated on every dashboard mount via GET /api/parent/session
//    before any reward operation; an expired/revoked token is removed.
//  - No PIN or token is ever logged.
const PARENT_SESSION_STORAGE_KEY = 'math-adventure-parent-session-token'

let activeParentSessionToken: string | null = null

export function getParentSessionToken(): string | null {
  return activeParentSessionToken
}

export function setParentSessionToken(token: string | null): void {
  activeParentSessionToken = token
  try {
    if (token) {
      localStorage.setItem(PARENT_SESSION_STORAGE_KEY, token)
    } else {
      localStorage.removeItem(PARENT_SESSION_STORAGE_KEY)
    }
  } catch {
    // localStorage may be unavailable (private mode, quota); the in-memory
    // token still works for the current session.
  }
}

export function clearParentSessionToken(): void {
  activeParentSessionToken = null
  try {
    localStorage.removeItem(PARENT_SESSION_STORAGE_KEY)
  } catch {
    // same as above
  }
}

/**
 * Restores a persisted parent-session token from localStorage into memory.
 * Returns the token if one was found (and set in memory), or null.
 *
 * The caller MUST validate the restored token via `checkParentSession()` before
 * using it for reward operations — a restored token may be expired or revoked.
 */
export function restoreParentSessionToken(): string | null {
  if (activeParentSessionToken) return activeParentSessionToken
  try {
    const stored = localStorage.getItem(PARENT_SESSION_STORAGE_KEY)
    if (stored) {
      activeParentSessionToken = stored
      return stored
    }
  } catch {
    // localStorage unavailable
  }
  return null
}

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<T> {
  const authHeaders: Record<string, string> = activeParentSessionToken 
    ? { 'X-Parent-Session': activeParentSessionToken } 
    : {}

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options?.headers,
    },
  })
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }))
    throw new Error(error.error || `HTTP ${response.status}`)
  }
  
  return response.json()
}

// Session APIs
export async function getSessions(options?: { mode?: string; limit?: number; offset?: number }): Promise<SessionsResponse> {
  const params = new URLSearchParams()
  if (options?.mode) params.set('mode', options.mode)
  if (options?.limit) params.set('limit', String(options.limit))
  if (options?.offset) params.set('offset', String(options.offset))
  
  const query = params.toString()
  return fetchApi<SessionsResponse>(`/sessions${query ? `?${query}` : ''}`)
}

export async function getSession(instanceId: string): Promise<ApiSession> {
  return fetchApi<ApiSession>(`/sessions/${encodeURIComponent(instanceId)}`)
}

export async function createSession(session: ApiSession): Promise<{ success: boolean; instanceId: string }> {
  return fetchApi<{ success: boolean; instanceId: string }>('/sessions', {
    method: 'POST',
    body: JSON.stringify(session),
  })
}

export async function updateSession(instanceId: string, session: Partial<ApiSession>): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/sessions/${encodeURIComponent(instanceId)}`, {
    method: 'PUT',
    body: JSON.stringify(session),
  })
}

export async function deleteSession(instanceId: string): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/sessions/${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  })
}

/**
 * Outcome of offering a completed session to the backend.
 *
 *  - `recorded`    the backend accepted and persisted the record (201)
 *  - `duplicate`   the backend already has this instanceId (409) — treated as
 *                  recorded, because the session identity is stable
 *  - `rejected`    the backend refused the record itself (4xx other than 409);
 *                  retrying the same payload cannot succeed
 *  - `unavailable` the backend could not be reached or failed internally
 *                  (network error, 5xx, 401/403/429); retryable
 */
export type RecordSessionOutcome =
  | { readonly status: 'recorded'; readonly httpStatus: number }
  | { readonly status: 'duplicate'; readonly httpStatus: number }
  | { readonly status: 'rejected'; readonly httpStatus: number; readonly reason: string }
  | { readonly status: 'unavailable'; readonly httpStatus: number; readonly reason: string }

const RECORD_TIMEOUT_MS = 10_000

/**
 * Sends ONE completed-session record to the authoritative backend.
 *
 * The record is posted VERBATIM (the same object the local commit produced), so
 * the server validates exactly what was committed — no re-projection, no
 * client-side reward math, no derived fields.
 *
 * This function never throws: every failure is reported as an outcome so the
 * caller can distinguish "recorded" from "not recorded yet" without exception
 * control flow around a user-facing completion event.
 */
export async function recordCompletedSession(record: CompletedSessionRecord): Promise<RecordSessionOutcome> {
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller ? setTimeout(() => controller.abort(), RECORD_TIMEOUT_MS) : null

  try {
    const response = await fetch(`${API_BASE}/sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(activeParentSessionToken ? { 'X-Parent-Session': activeParentSessionToken } : {}),
      },
      body: JSON.stringify(record),
      ...(controller ? { signal: controller.signal } : {}),
    })

    if (response.status === 201) return { status: 'recorded', httpStatus: 201 }
    if (response.status === 409) return { status: 'duplicate', httpStatus: 409 }

    let reason = `http-${response.status}`
    try {
      const payload = await response.json() as { error?: unknown }
      if (typeof payload?.error === 'string') reason = payload.error
    } catch {
      // non-JSON error body: keep the status-derived reason
    }

    // 5xx and auth/rate-limit failures are environmental, not payload problems:
    // the same record can still be accepted later.
    if (response.status >= 500 || response.status === 401 || response.status === 403 || response.status === 429) {
      return { status: 'unavailable', httpStatus: response.status, reason }
    }
    return { status: 'rejected', httpStatus: response.status, reason }
  } catch {
    return { status: 'unavailable', httpStatus: 0, reason: 'network-error' }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

// Config APIs
export async function getConfig(): Promise<ApiConfig> {
  return fetchApi<ApiConfig>('/api/config')
}

export async function updateConfig(config: Partial<ApiConfig>): Promise<ApiConfig> {
  return fetchApi<ApiConfig>('/api/config', {
    method: 'PUT',
    body: JSON.stringify(config),
  })
}

// Health check
export async function checkHealth(): Promise<{ status: string; sessions: number; timestamp: number }> {
  return fetchApi<{ status: string; sessions: number; timestamp: number }>('/health')
}

// Helper: Check if backend is available
export async function isBackendAvailable(): Promise<boolean> {
  try {
    await checkHealth()
    return true
  } catch {
    return false
  }
}

// Convert backend session to CompletedSessionRecord
export function toCompletedSessionRecord(apiSession: ApiSession): CompletedSessionRecord {
  if (apiSession.historySchemaVersion === 1) {
    return {
      historySchemaVersion: 1,
      instanceId: apiSession.instanceId,
      sessionId: apiSession.sessionId,
      mode: apiSession.mode,
      operationMode: apiSession.operationMode as any,
      completedAt: apiSession.endedAt ?? null,
      recordedAt: apiSession.recordedAt,
      provenance: 'new-atomic',
      outcomes: apiSession.outcomes as any,
    }
  }
  
  return {
    historySchemaVersion: 2,
    instanceId: apiSession.instanceId,
    sessionId: apiSession.sessionId,
    mode: apiSession.mode,
    operationMode: apiSession.operationMode as any,
    endReason: apiSession.endReason ?? 'completed',
    plannedCount: apiSession.plannedCount ?? apiSession.outcomes.length,
    completedCount: apiSession.completedCount ?? apiSession.outcomes.length,
    startedAt: apiSession.startedAt ?? apiSession.recordedAt,
    durationMs: apiSession.durationMs ?? null,
    deadlineAt: apiSession.deadlineAt ?? null,
    endedAt: apiSession.endedAt ?? apiSession.recordedAt,
    remainingMs: apiSession.remainingMs ?? null,
    recordedAt: apiSession.recordedAt,
    outcomes: apiSession.outcomes as any,
  }
}

// Convert CompletedSessionRecord to API session
export function fromCompletedSessionRecord(record: CompletedSessionRecord): ApiSession {
  const base = {
    instanceId: record.instanceId,
    sessionId: record.sessionId,
    mode: record.mode,
    historySchemaVersion: record.historySchemaVersion,
    operationMode: record.operationMode,
    recordedAt: record.recordedAt,
    outcomes: record.outcomes,
  }
  
  if (record.historySchemaVersion === 1) {
    return {
      ...base,
      completedAt: record.completedAt ?? undefined,
      endedAt: record.completedAt ?? undefined,
    } as ApiSession
  }
  
  return {
    ...base,
    endReason: record.endReason,
    plannedCount: record.plannedCount,
    completedCount: record.completedCount,
    startedAt: record.startedAt,
    durationMs: record.durationMs,
    deadlineAt: record.deadlineAt,
    endedAt: record.endedAt,
    remainingMs: record.remainingMs,
  } as ApiSession
}

// --- Parent Auth APIs ---

export interface ParentAuthStatus {
  readonly hasPin: boolean
  readonly isLockedOut: boolean
  readonly lockoutMessage: string | null
  readonly remainingMs: number | null
}

export interface ParentAuthResult {
  readonly success: boolean
  readonly sessionToken?: string
  readonly expiresAt?: number
  readonly error?: string
  readonly isLockedOut?: boolean
  readonly remainingMs?: number | null
}

export async function getParentAuthStatus(): Promise<ParentAuthStatus> {
  return fetchApi<ParentAuthStatus>('/parent/status')
}

export async function setupParentPin(pin: string, confirmPin: string): Promise<ParentAuthResult> {
  try {
    const result = await fetchApi<{ success: boolean; sessionToken: string; expiresAt: number }>('/parent/setup', {
      method: 'POST',
      body: JSON.stringify({ pin, confirmPin }),
    })
    if (result.success && result.sessionToken) {
      setParentSessionToken(result.sessionToken)
    }
    return result
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'Gagal menyimpan PIN.',
    }
  }
}

export async function verifyParentPin(pin: string): Promise<ParentAuthResult> {
  try {
    const result = await fetchApi<{ success: boolean; sessionToken: string; expiresAt: number }>('/parent/verify', {
      method: 'POST',
      body: JSON.stringify({ pin }),
    })
    if (result.success && result.sessionToken) {
      setParentSessionToken(result.sessionToken)
    }
    return result
  } catch (err: any) {
    return {
      success: false,
      error: err.message || 'PIN salah. Silakan coba lagi.',
    }
  }
}

export async function lockParentSession(): Promise<void> {
  try {
    if (activeParentSessionToken) {
      await fetchApi<{ success: boolean }>('/parent/lock', {
        method: 'POST',
      })
    }
  } catch {
    // Ignore network error on lock
  } finally {
    clearParentSessionToken()
  }
}

export async function checkParentSession(): Promise<{ valid: boolean; expiresAt?: number }> {
  if (!activeParentSessionToken) {
    return { valid: false }
  }
  try {
    return await fetchApi<{ valid: boolean; expiresAt: number }>('/parent/session')
  } catch {
    clearParentSessionToken()
    return { valid: false }
  }
}