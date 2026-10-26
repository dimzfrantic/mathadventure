/**
 * Parent PIN Authentication Module
 * 
 * Uses Web Crypto API for secure PIN verification:
 * - PBKDF2 with SHA-256 for key derivation (100,000 iterations)
 * - Cryptographically secure random 16-byte salt per PIN
 * - Stored verifier (32-byte derived hash, never plaintext PIN)
 * - Rate limiting with progressive exponential backoff
 * 
 * Client-side authentication provides access control against accidental
 * or unauthorized child interaction, but is not intended as server-grade security.
 */

const PIN_STORAGE_KEY = 'math-adventure-parent-pin-verifier'
const STORAGE_ATTEMPT_KEY = 'math-adventure-parent-pin-attempts'

/** PIN verifier structure stored in localStorage */
export interface PinVerifier {
  readonly verifier: string // Base64 encoded PBKDF2 derived bits (32 bytes)
  readonly salt: string      // Base64 encoded random salt (16 bytes)
  readonly iterations: number
}

/** Attempt tracking for rate limiting */
export interface PinAttemptState {
  readonly failedAttempts: number
  readonly lastFailedAttempt: number | null
  readonly lockUntil: number | null
}

/** Centralized configuration constants */
export const PIN_CONFIG = {
  /** PIN must be exactly 6 digits */
  PIN_LENGTH: 6,
  
  /** Maximum failed attempts before lockout */
  MAX_ATTEMPTS: 5,
  
  /** Initial lockout duration in milliseconds (30 seconds) */
  INITIAL_LOCKOUT_MS: 30_000,
  
  /** Multiplier for progressive exponential backoff */
  LOCKOUT_MULTIPLIER: 2,
  
  /** Maximum lockout duration (15 minutes) */
  MAX_LOCKOUT_MS: 15 * 60 * 1000,
  
  /** Idle timeout in milliseconds (5 minutes) */
  IDLE_TIMEOUT_MS: 5 * 60 * 1000,
  
  /** PBKDF2 iterations for key derivation */
  PBKDF2_ITERATIONS: 100_000,
  
  /** Salt length in bytes */
  SALT_LENGTH: 16,
  
  /** Derived bit length (32 bytes = 256 bits) */
  HASH_BITS: 256,
} as const

/**
 * Check if a PIN verifier exists in storage
 */
export function hasPinVerifier(): boolean {
  try {
    const stored = localStorage.getItem(PIN_STORAGE_KEY)
    return stored !== null
  } catch {
    // localStorage not available
    return false
  }
}

/**
 * Get stored PIN verifier
 */
export function getPinVerifier(): PinVerifier | null {
  try {
    const stored = localStorage.getItem(PIN_STORAGE_KEY)
    if (!stored) return null
    const parsed = JSON.parse(stored)
    if (!parsed || typeof parsed.verifier !== 'string' || typeof parsed.salt !== 'string' || typeof parsed.iterations !== 'number') {
      return null
    }
    return parsed as PinVerifier
  } catch {
    return null
  }
}

/**
 * Save PIN verifier to storage
 */
export function savePinVerifier(verifier: PinVerifier): boolean {
  try {
    localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(verifier))
    // Reset attempts on successful setup
    resetAttemptState()
    return true
  } catch {
    return false
  }
}

/**
 * Get current attempt state
 */
export function getAttemptState(): PinAttemptState {
  try {
    const stored = localStorage.getItem(STORAGE_ATTEMPT_KEY)
    if (!stored) {
      return { failedAttempts: 0, lastFailedAttempt: null, lockUntil: null }
    }
    return JSON.parse(stored) as PinAttemptState
  } catch {
    return { failedAttempts: 0, lastFailedAttempt: null, lockUntil: null }
  }
}

/**
 * Save attempt state
 */
function saveAttemptState(state: PinAttemptState): void {
  try {
    localStorage.setItem(STORAGE_ATTEMPT_KEY, JSON.stringify(state))
  } catch {
    // Ignore storage errors
  }
}

/**
 * Reset attempt state (after successful verification)
 */
export function resetAttemptState(): void {
  saveAttemptState({
    failedAttempts: 0,
    lastFailedAttempt: null,
    lockUntil: null,
  })
}

/**
 * Record a failed attempt and calculate lockout if needed
 */
function recordFailedAttempt(): PinAttemptState {
  const current = getAttemptState()
  const now = Date.now()
  
  const newFailedAttempts = current.failedAttempts + 1
  let lockUntil = current.lockUntil
  
  // Check if currently locked
  if (lockUntil && now < lockUntil) {
    // Still locked, just update count but keep existing lock
    const updated: PinAttemptState = {
      ...current,
      failedAttempts: newFailedAttempts,
      lastFailedAttempt: now,
    }
    saveAttemptState(updated)
    return updated
  }
  
  // Check if we need to apply lockout
  if (newFailedAttempts >= PIN_CONFIG.MAX_ATTEMPTS) {
    // Calculate lockout duration with progressive exponential backoff
    const backoffExponent = newFailedAttempts - PIN_CONFIG.MAX_ATTEMPTS
    const calculatedDuration = PIN_CONFIG.INITIAL_LOCKOUT_MS * Math.pow(PIN_CONFIG.LOCKOUT_MULTIPLIER, backoffExponent)
    const lockoutDuration = Math.min(calculatedDuration, PIN_CONFIG.MAX_LOCKOUT_MS)
    lockUntil = now + lockoutDuration
  }
  
  const newState: PinAttemptState = {
    failedAttempts: newFailedAttempts,
    lastFailedAttempt: now,
    lockUntil,
  }
  
  saveAttemptState(newState)
  return newState
}

/**
 * Check if currently locked out
 */
export function isLockedOut(): { locked: boolean; remainingMs: number | null } {
  const state = getAttemptState()
  const now = Date.now()
  
  if (state.lockUntil && now < state.lockUntil) {
    return { locked: true, remainingMs: state.lockUntil - now }
  }
  
  return { locked: false, remainingMs: null }
}

/**
 * Get formatted lockout message
 */
export function getLockoutMessage(): string | null {
  const { locked, remainingMs } = isLockedOut()
  if (!locked || remainingMs === null) return null
  
  const seconds = Math.ceil(remainingMs / 1000)
  if (seconds >= 60) {
    const minutes = Math.ceil(seconds / 60)
    return `Terlalu banyak percobaan. Coba lagi dalam ${minutes} menit.`
  }
  return `Terlalu banyak percobaan. Coba lagi dalam ${seconds} detik.`
}

/**
 * Generate a random 16-byte salt
 */
async function generateSalt(): Promise<Uint8Array> {
  const salt = new Uint8Array(PIN_CONFIG.SALT_LENGTH)
  crypto.getRandomValues(salt)
  return salt
}

/**
 * Derive 256 bits (32 bytes) from PIN and salt using PBKDF2-HMAC-SHA256
 */
async function derivePinBits(pin: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const encoder = new TextEncoder()
  const pinBuffer = encoder.encode(pin)
  
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    pinBuffer,
    'PBKDF2',
    false,
    ['deriveBits']
  )
  
  const derivedBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: salt as unknown as Uint8Array<ArrayBuffer>,
      iterations,
      hash: 'SHA-256',
    },
    keyMaterial,
    PIN_CONFIG.HASH_BITS
  )
  
  return new Uint8Array(derivedBuffer)
}

/**
 * Create a verifier for a new PIN
 */
export async function createPinVerifier(pin: string): Promise<PinVerifier | null> {
  try {
    const format = validatePinFormat(pin)
    if (!format.valid) return null

    const salt = await generateSalt()
    const derivedBits = await derivePinBits(pin, salt, PIN_CONFIG.PBKDF2_ITERATIONS)
    
    // Convert to base64 strings for storage
    const verifier = btoa(String.fromCharCode(...derivedBits))
    const saltB64 = btoa(String.fromCharCode(...salt))
    
    return {
      verifier,
      salt: saltB64,
      iterations: PIN_CONFIG.PBKDF2_ITERATIONS,
    }
  } catch {
    return null
  }
}

/**
 * Constant-time byte array comparison
 */
function arraysEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  let mismatch = 0
  for (let i = 0; i < a.length; i++) {
    mismatch |= a[i] ^ b[i]
  }
  return mismatch === 0
}

/**
 * Verify PIN against stored verifier
 */
export async function verifyPin(pin: string): Promise<{ success: boolean; error?: string }> {
  // First check if locked out
  const lockout = isLockedOut()
  if (lockout.locked) {
    return { success: false, error: getLockoutMessage() || 'Terlalu banyak percobaan' }
  }
  
  // Get stored verifier
  const stored = getPinVerifier()
  if (!stored) {
    return { success: false, error: 'PIN belum diatur' }
  }
  
  try {
    const saltBytes = Uint8Array.from(atob(stored.salt), c => c.charCodeAt(0))
    const expectedBytes = Uint8Array.from(atob(stored.verifier), c => c.charCodeAt(0))
    
    const computedBytes = await derivePinBits(pin, saltBytes, stored.iterations)
    
    if (arraysEqual(computedBytes, expectedBytes)) {
      resetAttemptState()
      return { success: true }
    } else {
      recordFailedAttempt()
      const lockoutAfter = isLockedOut()
      if (lockoutAfter.locked) {
        return { success: false, error: getLockoutMessage() || 'Terlalu banyak percobaan' }
      }
      return { success: false, error: 'PIN salah. Silakan coba lagi.' }
    }
  } catch {
    recordFailedAttempt()
    return { success: false, error: 'PIN salah. Silakan coba lagi.' }
  }
}

/**
 * Validate PIN format (must be exactly 6 digits)
 */
export function validatePinFormat(pin: string): { valid: boolean; error?: string } {
  if (!pin) {
    return { valid: false, error: 'PIN tidak boleh kosong' }
  }
  
  if (!/^\d+$/.test(pin)) {
    return { valid: false, error: 'PIN harus berupa angka' }
  }
  
  if (pin.length !== PIN_CONFIG.PIN_LENGTH) {
    return { valid: false, error: `PIN harus tepat ${PIN_CONFIG.PIN_LENGTH} digit` }
  }
  
  return { valid: true }
}

/**
 * Check if Web Crypto API is available and functional
 */
export function isWebCryptoAvailable(): boolean {
  try {
    return typeof crypto !== 'undefined' &&
           typeof crypto.subtle !== 'undefined' &&
           typeof crypto.getRandomValues === 'function' &&
           typeof crypto.subtle.importKey === 'function' &&
           typeof crypto.subtle.deriveBits === 'function'
  } catch {
    return false
  }
}

/**
 * Remove PIN verifier (for testing/reset purposes only)
 * WARNING: This will lock out the parent until a new PIN is set
 */
export function clearPinVerifier(): void {
  try {
    localStorage.removeItem(PIN_STORAGE_KEY)
    resetAttemptState()
  } catch {
    // Ignore
  }
}