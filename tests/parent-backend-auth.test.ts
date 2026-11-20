import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  getParentAuthStatus,
  setupParentPin,
  verifyParentPin,
  lockParentSession,
  getParentSessionToken,
  setParentSessionToken,
  clearParentSessionToken,
  restoreParentSessionToken,
  updateConfig,
  getConfig,
} from '../src/features/math-drill/api/sessionApi'

describe('Backend Parent Authentication & Authorization Tests', () => {
  beforeEach(() => {
    localStorage.clear()
    clearParentSessionToken()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    clearParentSessionToken()
  })

  it('1. persists the parent session token to localStorage and restores it (Alternatif B)', () => {
    expect(getParentSessionToken()).toBeNull()
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBeNull()

    // setParentSessionToken writes to both memory and localStorage
    setParentSessionToken('test-mem-token-123')
    expect(getParentSessionToken()).toBe('test-mem-token-123')
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBe('test-mem-token-123')
    // restoreParentSessionToken returns the in-memory token if already set
    expect(restoreParentSessionToken()).toBe('test-mem-token-123')

    // clearParentSessionToken removes from both memory and localStorage
    clearParentSessionToken()
    expect(getParentSessionToken()).toBeNull()
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBeNull()

    // Simulate a page reload: localStorage has a token but memory is empty.
    localStorage.setItem('math-adventure-parent-session-token', 'reload-token')
    expect(getParentSessionToken()).toBeNull()
    const restored = restoreParentSessionToken()
    expect(restored).toBe('reload-token')
    expect(getParentSessionToken()).toBe('reload-token')

    clearParentSessionToken()
    expect(getParentSessionToken()).toBeNull()
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBeNull()
  })

  it('2. checks parent auth status via API', async () => {
    const mockStatus = {
      hasPin: true,
      isLockedOut: false,
      lockoutMessage: null,
      remainingMs: null,
    }

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify(mockStatus), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const status = await getParentAuthStatus()
    expect(status.hasPin).toBe(true)
    expect(status.isLockedOut).toBe(false)
  })

  it('3. rejects setup when PIN format is invalid or confirmation mismatch', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'PIN harus tepat 6 digit angka',
    }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await setupParentPin('123', '123')
    expect(result.success).toBe(false)
    expect(result.error).toContain('6 digit')
    expect(getParentSessionToken()).toBeNull()
  })

  it('4. sets session token in memory upon successful PIN verification', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
      sessionToken: 'valid-parent-token-xyz',
      expiresAt: Date.now() + 900000,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await verifyParentPin('123456')
    expect(result.success).toBe(true)
    expect(getParentSessionToken()).toBe('valid-parent-token-xyz')
    // Alternatif B: the token is persisted to localStorage for reload survival.
    expect(localStorage.getItem('math-adventure-parent-session-token')).toBe('valid-parent-token-xyz')
  })

  it('5. handles wrong PIN and does not store token', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'PIN salah. Silakan coba lagi.',
      failedAttempts: 1,
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))

    const result = await verifyParentPin('999999')
    expect(result.success).toBe(false)
    expect(result.error).toContain('PIN salah')
    expect(getParentSessionToken()).toBeNull()
  })

  it('6. automatically includes X-Parent-Session header in requests when authenticated', async () => {
    setParentSessionToken('active-token-777')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      rupiahPerStar: 500,
      minStarsPerRedemption: 1,
      maxStarsPerRedemption: 100,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await updateConfig({ minStarsPerRedemption: 1 })

    expect(fetchSpy).toHaveBeenCalledOnce()
    const callHeaders = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>
    expect(callHeaders['X-Parent-Session']).toBe('active-token-777')
  })

  it('7. revokes session and clears token from memory on lockParentSession', async () => {
    setParentSessionToken('token-to-revoke')

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      success: true,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await lockParentSession()

    expect(fetchSpy).toHaveBeenCalledOnce()
    expect(getParentSessionToken()).toBeNull()
  })

  it('8. rejects sensitive operations when parent session is missing', async () => {
    clearParentSessionToken()

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response(JSON.stringify({
      error: 'Parent authorization required',
    }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(updateConfig({ minStarsPerRedemption: 2 })).rejects.toThrow('Parent authorization required')
  })
})
