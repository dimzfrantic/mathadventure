// Child-only reward API. The same-origin proxy supplies the device credential;
// this module never reads a parent token or a backend API key.
export interface ChildRewardSummary {
  readonly totalEarned: number
  readonly pendingStars: number
  readonly confirmedStars: number
  readonly availableStars: number
  readonly rupiahPerStar: number
  readonly minStarsPerRedemption: number
  readonly maxStarsPerRedemption: number
  readonly recentTransactions: readonly {
    readonly status: 'pending' | 'confirmed' | 'cancelled'
    readonly starsRedeemed: number
    readonly rupiahValue: number
    readonly requestedAt: number
  }[]
}

export async function getChildRewardSummary(): Promise<ChildRewardSummary> {
  const response = await fetch('/api/reward/child-summary')
  if (!response.ok) throw new Error('Layanan bintang belum tersedia. Coba lagi nanti.')
  const value = await response.json() as ChildRewardSummary
  if (!Number.isSafeInteger(value.availableStars) || !Number.isSafeInteger(value.totalEarned)
      || !Number.isSafeInteger(value.pendingStars) || !Number.isSafeInteger(value.confirmedStars)
      || !Number.isSafeInteger(value.rupiahPerStar) || value.rupiahPerStar <= 0
      || !Number.isSafeInteger(value.minStarsPerRedemption) || !Number.isSafeInteger(value.maxStarsPerRedemption)
      || !Array.isArray(value.recentTransactions)) {
    throw new Error('Data bintang tidak dapat dibaca. Coba lagi nanti.')
  }
  return value
}

export async function submitChildRewardRequest(starsRedeemed: number, requestKey: string): Promise<{ readonly status: 'success' | 'rejected' | 'uncertain'; readonly reason?: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10_000)
  try {
    const response = await fetch('/api/reward/child-requests', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ starsRedeemed, requestKey }),
      signal: controller.signal,
    })
    if (response.ok) return { status: 'success' }
    if (response.status === 400 || response.status === 409) return { status: 'rejected', reason: response.status === 409 ? 'Bintang yang bisa ditukar tidak cukup. Lihat saldo terbaru.' : 'Jumlah bintang tidak sesuai batas penukaran.' }
    return { status: 'uncertain' }
  } catch {
    return { status: 'uncertain' }
  } finally {
    clearTimeout(timer)
  }
}
