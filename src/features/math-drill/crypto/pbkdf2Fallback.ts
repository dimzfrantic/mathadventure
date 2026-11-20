/**
 * PBKDF2-HMAC-SHA256 — pure JavaScript fallback.
 *
 * WHY THIS EXISTS
 * ---------------
 * The parent PIN gate derives its verifier with `crypto.subtle.deriveBits`
 * (PBKDF2, SHA-256, 100k iterations). `crypto.subtle` is only exposed in a
 * **secure context** — HTTPS, or `localhost` / `127.0.0.1`. When the built app
 * is opened over plain HTTP on a LAN address (e.g. `http://192.168.100.147:4180`,
 * a phone on the same Wi-Fi), `crypto.subtle` is `undefined` and the gate used
 * to dead-end with "Peramban tidak mendukung keamanan yang diperlukan".
 *
 * The owner's decision is explicit: the PIN is a **local speed bump** to keep a
 * child out of the reward settings, not a server-grade secret. So instead of
 * forcing HTTPS on every device, this module computes the *same* PBKDF2 output
 * in software when the Web Crypto primitive is unavailable.
 *
 * GUARANTEES
 * ----------
 * 1. Byte-identical output to `crypto.subtle` PBKDF2-HMAC-SHA256 (verified by
 *    tests against the platform implementation). The stored verifier format
 *    (salt / iterations / derived bits) is unchanged, so PINs created on
 *    `localhost` verify on a LAN origin and vice versa.
 * 2. No new dependency; no WASM; no network.
 * 3. Yields to the event loop periodically so the UI can paint its
 *    "memproses" state instead of freezing for the duration of 100k iterations.
 *
 * NOT A SECURITY REGRESSION, AND NOT A SECURITY UPGRADE: `crypto.subtle` is
 * still preferred whenever it exists. This path only runs when the platform
 * refuses to provide it.
 */

/** SHA-256 round constants. */
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

/** SHA-256 initial hash values. */
const IV = new Uint32Array([
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
  0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
])

/**
 * One SHA-256 compression over a single 64-byte block, mutating `state`.
 * `w` is a caller-owned 64-word scratch buffer to avoid per-call allocation.
 */
function compress(state: Uint32Array, block: Uint8Array, w: Uint32Array): void {
  for (let i = 0; i < 16; i += 1) {
    const o = i * 4
    w[i] = ((block[o] << 24) | (block[o + 1] << 16) | (block[o + 2] << 8) | block[o + 3]) | 0
  }
  for (let i = 16; i < 64; i += 1) {
    const x = w[i - 15]
    const y = w[i - 2]
    const s0 = ((x >>> 7) | (x << 25)) ^ ((x >>> 18) | (x << 14)) ^ (x >>> 3)
    const s1 = ((y >>> 17) | (y << 15)) ^ ((y >>> 19) | (y << 13)) ^ (y >>> 10)
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0
  }

  let a = state[0]
  let b = state[1]
  let c = state[2]
  let d = state[3]
  let e = state[4]
  let f = state[5]
  let g = state[6]
  let h = state[7]

  for (let i = 0; i < 64; i += 1) {
    const s1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7))
    const ch = (e & f) ^ (~e & g)
    const t1 = (h + s1 + ch + K[i] + w[i]) | 0
    const s0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10))
    const maj = (a & b) ^ (a & c) ^ (b & c)
    const t2 = (s0 + maj) | 0

    h = g
    g = f
    f = e
    e = (d + t1) | 0
    d = c
    c = b
    b = a
    a = (t1 + t2) | 0
  }

  state[0] = (state[0] + a) | 0
  state[1] = (state[1] + b) | 0
  state[2] = (state[2] + c) | 0
  state[3] = (state[3] + d) | 0
  state[4] = (state[4] + e) | 0
  state[5] = (state[5] + f) | 0
  state[6] = (state[6] + g) | 0
  state[7] = (state[7] + h) | 0
}

/** Write the 8-byte big-endian bit length into the tail of a padded block. */
function writeBitLength(block: Uint8Array, totalBytes: number): void {
  const totalBits = totalBytes * 8
  const hi = Math.floor(totalBits / 0x100000000)
  const lo = totalBits >>> 0
  block[56] = (hi >>> 24) & 0xff
  block[57] = (hi >>> 16) & 0xff
  block[58] = (hi >>> 8) & 0xff
  block[59] = hi & 0xff
  block[60] = (lo >>> 24) & 0xff
  block[61] = (lo >>> 16) & 0xff
  block[62] = (lo >>> 8) & 0xff
  block[63] = lo & 0xff
}

function stateToBytes(state: Uint32Array): Uint8Array {
  const out = new Uint8Array(32)
  for (let i = 0; i < 8; i += 1) {
    out[i * 4] = (state[i] >>> 24) & 0xff
    out[i * 4 + 1] = (state[i] >>> 16) & 0xff
    out[i * 4 + 2] = (state[i] >>> 8) & 0xff
    out[i * 4 + 3] = state[i] & 0xff
  }
  return out
}

/**
 * Precomputed HMAC-SHA256 state pair for a fixed key.
 *
 * HMAC pads the key into a full 64-byte block, so the compression of
 * `key ^ ipad` (and `key ^ opad`) is identical for every message. Computing it
 * once halves the work per PBKDF2 iteration.
 */
interface HmacKeyState {
  readonly inner: Uint32Array
  readonly outer: Uint32Array
}

function createHmacKeyState(key: Uint8Array): HmacKeyState {
  // Keys longer than one block are hashed first; PINs are 6 bytes, but stay correct.
  let normalized = key
  if (normalized.length > 64) {
    normalized = sha256(normalized)
  }
  const padded = new Uint8Array(64)
  padded.set(normalized)

  const ipad = new Uint8Array(64)
  const opad = new Uint8Array(64)
  for (let i = 0; i < 64; i += 1) {
    ipad[i] = padded[i] ^ 0x36
    opad[i] = padded[i] ^ 0x5c
  }

  const inner = new Uint32Array(IV)
  const outer = new Uint32Array(IV)
  const w = new Uint32Array(64)
  compress(inner, ipad, w)
  compress(outer, opad, w)
  return { inner, outer }
}

/**
 * HMAC-SHA256 with a precomputed key state, for messages shorter than 56 bytes
 * (PBKDF2 inputs are 20 or 32 bytes, so the message always fits in the second
 * and final block).
 */
function hmacWithKeyState(
  message: Uint8Array,
  keyState: HmacKeyState,
  scratchState: Uint32Array,
  scratchBlock: Uint8Array,
  scratchWords: Uint32Array,
): Uint8Array {
  const totalBytes = 64 + message.length
  if (message.length > 55) {
    throw new Error('hmacWithKeyState: message must be < 56 bytes')
  }

  // --- inner: SHA256((key ^ ipad) || message) ---
  scratchBlock.fill(0)
  scratchBlock.set(message)
  scratchBlock[message.length] = 0x80
  writeBitLength(scratchBlock, totalBytes)

  scratchState.set(keyState.inner)
  compress(scratchState, scratchBlock, scratchWords)
  const innerDigest = stateToBytes(scratchState)

  // --- outer: SHA256((key ^ opad) || innerDigest) ---
  scratchBlock.fill(0)
  scratchBlock.set(innerDigest)
  scratchBlock[32] = 0x80
  writeBitLength(scratchBlock, 96)

  scratchState.set(keyState.outer)
  compress(scratchState, scratchBlock, scratchWords)
  return stateToBytes(scratchState)
}

/** Plain SHA-256 of an arbitrary byte string. */
export function sha256(input: Uint8Array): Uint8Array {
  const w = new Uint32Array(64)
  const state = new Uint32Array(IV)

  const fullBlocks = Math.floor(input.length / 64)
  const block = new Uint8Array(64)
  for (let i = 0; i < fullBlocks; i += 1) {
    block.set(input.subarray(i * 64, i * 64 + 64))
    compress(state, block, w)
  }

  // Final block(s) with padding.
  const remainder = input.length - fullBlocks * 64
  const tail = new Uint8Array(remainder < 56 ? 64 : 128)
  tail.set(input.subarray(fullBlocks * 64))
  tail[remainder] = 0x80
  writeBitLength(tail, input.length)
  for (let i = 0; i < tail.length; i += 64) {
    block.set(tail.subarray(i, i + 64))
    compress(state, block, w)
  }

  return stateToBytes(state)
}

/** Yield to the event loop so the UI can repaint during long derivations. */
function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/** Iterations between event-loop yields. */
const YIELD_INTERVAL = 4000

/**
 * PBKDF2-HMAC-SHA256 producing `dkLen` bytes, matching the Web Crypto output.
 *
 * Only single-block output (dkLen <= 32) is needed by the PIN verifier, which
 * keeps this implementation small and auditable.
 */
export async function pbkdf2Sha256(
  password: Uint8Array,
  salt: Uint8Array,
  iterations: number,
  dkLen: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(iterations) || iterations < 1) {
    throw new Error('pbkdf2Sha256: iterations must be a positive integer')
  }
  if (!Number.isInteger(dkLen) || dkLen < 1 || dkLen > 32) {
    throw new Error('pbkdf2Sha256: dkLen must be between 1 and 32')
  }

  const keyState = createHmacKeyState(password)
  const scratchState = new Uint32Array(8)
  const scratchBlock = new Uint8Array(64)
  const scratchWords = new Uint32Array(64)

  // U1 = HMAC(password, salt || INT_32_BE(1)) — single output block.
  const seed = new Uint8Array(salt.length + 4)
  seed.set(salt)
  seed[salt.length] = 0x00
  seed[salt.length + 1] = 0x00
  seed[salt.length + 2] = 0x00
  seed[salt.length + 3] = 0x01

  let u = hmacWithKeyState(seed, keyState, scratchState, scratchBlock, scratchWords)
  const acc = new Uint8Array(u)

  for (let i = 1; i < iterations; i += 1) {
    u = hmacWithKeyState(u, keyState, scratchState, scratchBlock, scratchWords)
    for (let j = 0; j < acc.length; j += 1) {
      acc[j] ^= u[j]
    }
    if (i % YIELD_INTERVAL === 0) {
      // eslint-disable-next-line no-await-in-loop
      await yieldToEventLoop()
    }
  }

  return acc.slice(0, dkLen)
}
