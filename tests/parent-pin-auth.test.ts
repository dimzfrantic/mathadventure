import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  isWebCryptoAvailable,
  createPinVerifier,
  savePinVerifier,
  getPinVerifier,
  hasPinVerifier,
  verifyPin,
  validatePinFormat,
  getAttemptState,
  resetAttemptState,
  isLockedOut,
  getLockoutMessage,
  clearPinVerifier,
  PIN_CONFIG,
} from '../src/features/math-drill/parentPinAuth'

describe('parentPinAuth module', () => {
  beforeEach(() => {
    localStorage.clear()
    clearPinVerifier()
    resetAttemptState()
    vi.restoreAllMocks()
  })

  it('detects Web Crypto API availability accurately', () => {
    expect(isWebCryptoAvailable()).toBe(true)
  })

  it('validates PIN format strictly (only 6 digits)', () => {
    expect(validatePinFormat('').valid).toBe(false)
    expect(validatePinFormat('12345').valid).toBe(false)
    expect(validatePinFormat('1234567').valid).toBe(false)
    expect(validatePinFormat('12a456').valid).toBe(false)
    expect(validatePinFormat('abcdef').valid).toBe(false)
    expect(validatePinFormat('123456').valid).toBe(true)
  })

  it('creates verifier with random salt and 100000 PBKDF2 iterations without plaintext', async () => {
    const verifier1 = await createPinVerifier('123456')
    const verifier2 = await createPinVerifier('123456')

    expect(verifier1).not.toBeNull()
    expect(verifier2).not.toBeNull()

    // Random salt ensures verifier is different for identical PIN
    expect(verifier1!.salt).not.toBe(verifier2!.salt)
    expect(verifier1!.verifier).not.toBe(verifier2!.verifier)
    expect(verifier1!.iterations).toBe(100_000)

    // Salt and verifier should be base64 strings
    expect(verifier1!.salt).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(verifier1!.verifier).toMatch(/^[A-Za-z0-9+/=]+$/)
    expect(atob(verifier1!.salt).length).toBe(16) // 16 bytes salt
    expect(atob(verifier1!.verifier).length).toBe(32) // 32 bytes (256 bits) hash
  })

  it('saves and retrieves PIN verifier, and checks existence', async () => {
    expect(hasPinVerifier()).toBe(false)
    expect(getPinVerifier()).toBeNull()

    const verifier = await createPinVerifier('987654')
    expect(verifier).not.toBeNull()

    const saved = savePinVerifier(verifier!)
    expect(saved).toBe(true)
    expect(hasPinVerifier()).toBe(true)

    const retrieved = getPinVerifier()
    expect(retrieved).toEqual(verifier)
  })

  it('fails safely if storage is corrupted', () => {
    localStorage.setItem('math-adventure-parent-pin-verifier', '{invalid-json}')
    expect(getPinVerifier()).toBeNull()
  })

  it('verifies correct PIN successfully and resets attempt state', async () => {
    const verifier = await createPinVerifier('654321')
    savePinVerifier(verifier!)

    const result = await verifyPin('654321')
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(getAttemptState().failedAttempts).toBe(0)
  })

  it('rejects wrong PIN and records failed attempts', async () => {
    const verifier = await createPinVerifier('654321')
    savePinVerifier(verifier!)

    const result = await verifyPin('111111')
    expect(result.success).toBe(false)
    expect(result.error).toContain('PIN salah')
    expect(getAttemptState().failedAttempts).toBe(1)
  })

  it('locks out after 5 failed attempts with progressive exponential backoff', async () => {
    const verifier = await createPinVerifier('654321')
    savePinVerifier(verifier!)

    const now = 1000000000000
    vi.spyOn(Date, 'now').mockReturnValue(now)

    // First 4 attempts: not locked out yet
    for (let i = 1; i <= 4; i++) {
      const res = await verifyPin('000000')
      expect(res.success).toBe(false)
      expect(isLockedOut().locked).toBe(false)
      expect(getAttemptState().failedAttempts).toBe(i)
    }

    // 5th attempt: triggers initial 30-second lockout
    const fifth = await verifyPin('000000')
    expect(fifth.success).toBe(false)
    expect(fifth.error).toContain('Terlalu banyak percobaan')
    expect(isLockedOut().locked).toBe(true)
    expect(isLockedOut().remainingMs).toBe(PIN_CONFIG.INITIAL_LOCKOUT_MS)
    expect(getLockoutMessage()).toContain('30 detik')

    // While locked out, any further attempt is blocked immediately
    const blocked = await verifyPin('654321') // Even correct PIN is blocked
    expect(blocked.success).toBe(false)
    expect(blocked.error).toContain('Terlalu banyak percobaan')

    // Advance time past the 30-second lockout
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000)
    expect(isLockedOut().locked).toBe(false)

    // 6th attempt (1st attempt after lockout) fails again -> triggers progressive backoff (60s = 1 menit)
    const sixth = await verifyPin('000000')
    expect(sixth.success).toBe(false)
    expect(isLockedOut().locked).toBe(true)
    expect(isLockedOut().remainingMs).toBe(60_000)
    expect(getLockoutMessage()).toContain('1 menit')

    // Advance time past 60s
    vi.spyOn(Date, 'now').mockReturnValue(now + 31_000 + 61_000)
    expect(isLockedOut().locked).toBe(false)

    // 7th attempt fails -> triggers 120s backoff (2 minutes)
    const seventh = await verifyPin('000000')
    expect(seventh.success).toBe(false)
    expect(isLockedOut().locked).toBe(true)
    expect(isLockedOut().remainingMs).toBe(120_000)
    expect(getLockoutMessage()).toContain('2 menit')
  })

  it('fails safely when PIN is not set', async () => {
    const result = await verifyPin('123456')
    expect(result.success).toBe(false)
    expect(result.error).toBe('PIN belum diatur')
  })
})
