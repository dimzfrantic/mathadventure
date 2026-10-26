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

// In-memory Parent session token (NEVER persisted to localStorage/sessionStorage/cookies)
let activeParentSessionToken: string | null = null

export function getParentSessionToken(): string | null {
  return activeParentSessionToken
}

export function setParentSessionToken(token: string | null): void {
  activeParentSessionToken = token
}

export function clearParentSessionToken(): void {
  activeParentSessionToken = null
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
  return fetchApi<SessionsResponse>(`/api/sessions${query ? `?${query}` : ''}`)
}

export async function getSession(instanceId: string): Promise<ApiSession> {
  return fetchApi<ApiSession>(`/api/sessions/${encodeURIComponent(instanceId)}`)
}

export async function createSession(session: ApiSession): Promise<{ success: boolean; instanceId: string }> {
  return fetchApi<{ success: boolean; instanceId: string }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(session),
  })
}

export async function updateSession(instanceId: string, session: Partial<ApiSession>): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/api/sessions/${encodeURIComponent(instanceId)}`, {
    method: 'PUT',
    body: JSON.stringify(session),
  })
}

export async function deleteSession(instanceId: string): Promise<{ success: boolean }> {
  return fetchApi<{ success: boolean }>(`/api/sessions/${encodeURIComponent(instanceId)}`, {
    method: 'DELETE',
  })
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