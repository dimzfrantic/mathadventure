import '@testing-library/jest-dom/vitest'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { pbkdf2Sha256, sha256 } from '../src/features/math-drill/crypto/pbkdf2Fallback'
import {
  createPinVerifier,
  savePinVerifier,
  verifyPin,
  isPinGateSupported,
  isWebCryptoAvailable,
  getPinVerifier,
  resetAttemptState,
  getAttemptState,
  PIN_CONFIG,
} from '../src/features/math-drill/parentPinAuth'

/**
 * Stage 7B-A2 — pure-JS PBKDF2 fallback for non-secure contexts.
 *
 * WHY: `crypto.subtle` only exists in a secure context (HTTPS or localhost).
 * Opening the built app on `http://<lan-ip>:4180` used to dead-end the parent
 * PIN gate. The fallback must produce byte-identical PBKDF2 output so the
 * stored verifier format stays unchanged and PINs stay interoperable.
 */

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

function utf8(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

/** Web Crypto reference implementation (available in Node/vitest). */
async function webCryptoPbkdf2(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', password as unknown as Uint8Array<ArrayBuffer>, 'PBKDF2', false, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as Uint8Array<ArrayBuffer>, iterations, hash: 'SHA-256' },
    key,
    dkLen * 8,
  )
  return new Uint8Array(bits)
}

const REAL_GET_RANDOM_VALUES = globalThis.crypto.getRandomValues.bind(globalThis.crypto)

/** Simulate a non-secure context: `crypto.subtle` is simply absent. */
function hideSubtle(): void {
  vi.stubGlobal('crypto', { getRandomValues: REAL_GET_RANDOM_VALUES })
}

beforeEach(() => {
  localStorage.clear()
  resetAttemptState()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('PBKDF2-HMAC-SHA256 pure-JS fallback', () => {
  it('1. matches Web Crypto byte-for-byte across iteration counts and salts', async () => {
    const cases: Array<{ pin: string; salt: Uint8Array; iterations: number }> = [
      { pin: '135790', salt: utf8('0123456789abcdef'), iterations: 1 },
      { pin: '135790', salt: utf8('fedcba9876543210'), iterations: 2 },
      { pin: '000000', salt: new Uint8Array(16), iterations: 1000 },
      { pin: '999999', salt: utf8('a1b2c3d4e5f60718'), iterations: 5000 },
      { pin: '246810', salt: utf8('0123456789abcdef'), iterations: PIN_CONFIG.PBKDF2_ITERATIONS },
    ]

    for (const c of cases) {
      const js = await pbkdf2Sha256(utf8(c.pin), c.salt, c.iterations, 32)
      const ref = await webCryptoPbkdf2(utf8(c.pin), c.salt, c.iterations, 32)
      expect(hex(js)).toBe(hex(ref))
      expect(js.length).toBe(32)
    }
  }, 60_000)

  it('2. produces the RFC 7914 / known PBKDF2-HMAC-SHA256 test vector', async () => {
    // P="password", S="salt", c=1, dkLen=32
    const out = await pbkdf2Sha256(utf8('password'), utf8('salt'), 1, 32)
    expect(hex(out)).toBe('120fb6cffcf8b32c43e7225256c4f837a86548c92ccc35480805987cb70be17b')

    // c=2
    const out2 = await pbkdf2Sha256(utf8('password'), utf8('salt'), 2, 32)
    expect(hex(out2)).toBe('ae4d0c95af6b46d32d0adff928f06dd02a303f8ef3c251dfd6e2d85a95474c43')
  })

  it('3. sha256 matches known vectors', () => {
    expect(hex(sha256(new Uint8Array(0)))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256(utf8('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    // > 55 bytes forces a two-block tail.
    expect(hex(sha256(utf8('a'.repeat(64))))).toBe(
      'ffe054fe7ae0cb6dc65c3af9b61d5209f439851db43d0ba5997337df154668eb',
    )
  })
})

describe('Parent PIN gate on a non-secure origin (no crypto.subtle)', () => {
  it('4. reports the gate as supported even without crypto.subtle', () => {
    hideSubtle()
    expect(isWebCryptoAvailable()).toBe(false)
    // getRandomValues exists in every modern browser, secure context or not.
    expect(isPinGateSupported()).toBe(true)
  })

  it('5. creates a verifier with the fallback and verifies the correct PIN', async () => {
    hideSubtle()

    const verifier = await createPinVerifier('135790')
    expect(verifier).not.toBeNull()
    expect(verifier!.iterations).toBe(PIN_CONFIG.PBKDF2_ITERATIONS)
    expect(savePinVerifier(verifier!)).toBe(true)

    const stored = getPinVerifier()
    expect(stored?.verifier).toBe(verifier!.verifier)

    expect(await verifyPin('135790')).toEqual({ success: true })
  }, 60_000)

  it('6. rejects a wrong PIN on the fallback path and never unlocks', async () => {
    hideSubtle()
    savePinVerifier((await createPinVerifier('135790'))!)

    const result = await verifyPin('999999')
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/pin salah/i)
    expect(getAttemptState().failedAttempts).toBe(1)
  }, 60_000)

  it('7. a verifier created with Web Crypto still verifies without it (interoperable)', async () => {
    // Created while crypto.subtle exists.
    expect(isWebCryptoAvailable()).toBe(true)
    const created = await createPinVerifier('246810')
    expect(created).not.toBeNull()
    expect(savePinVerifier(created!)).toBe(true)

    // Same device, now opened on a LAN origin where subtle is absent.
    hideSubtle()
    expect(await verifyPin('246810')).toEqual({ success: true })
  }, 60_000)

  it('8. a verifier created with the fallback verifies with Web Crypto (reverse direction)', async () => {
    hideSubtle()
    const created = await createPinVerifier('482913')
    expect(created).not.toBeNull()
    expect(savePinVerifier(created!)).toBe(true)

    vi.unstubAllGlobals()
    expect(isWebCryptoAvailable()).toBe(true)
    expect(await verifyPin('482913')).toEqual({ success: true })
  }, 60_000)

  it('9. lockout after 5 wrong attempts is preserved on the fallback path', async () => {
    hideSubtle()
    savePinVerifier((await createPinVerifier('135790'))!)

    for (let i = 0; i < PIN_CONFIG.MAX_ATTEMPTS; i += 1) {
      const r = await verifyPin('111111')
      expect(r.success).toBe(false)
    }

    const state = getAttemptState()
    expect(state.failedAttempts).toBe(PIN_CONFIG.MAX_ATTEMPTS)
    expect(state.lockUntil).not.toBeNull()

    // Locked out: even the correct PIN is refused while the lockout holds.
    const locked = await verifyPin('135790')
    expect(locked.success).toBe(false)
    expect(locked.error).toMatch(/terlalu banyak percobaan/i)
  }, 120_000)
})
