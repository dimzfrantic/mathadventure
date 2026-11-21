import { calculateSessionRewardV1, calculateSessionRewardV2Extended } from './reward'

type SessionTimingLike = {
  readonly durationMs?: number | null
  readonly startedAt?: number | null
  readonly deadlineAt?: number | null
  readonly endedAt?: number | null
  readonly remainingMs?: number | null
}

type SnapshotLike = {
  readonly schemaVersion: number
  readonly timing?: SessionTimingLike | null
}

type Props = {
  readonly mode: 'regular' | 'challenge'
  readonly plannedCount: number
  readonly completedCount: number
  readonly totalPoints: number
  readonly isTimeout?: boolean
  readonly snapshot?: SnapshotLike | null
}

export function SessionRewardStars({
  mode,
  plannedCount,
  completedCount,
  totalPoints,
  isTimeout = false,
  snapshot,
}: Props) {
  if (plannedCount <= 0) return null

  const timing = snapshot?.schemaVersion === 2 ? snapshot.timing : null
  const remainingMs = timing
    ? (timing.endedAt !== null && timing.endedAt !== undefined
        ? (timing.remainingMs ?? null)
        : (timing.deadlineAt !== null && timing.deadlineAt !== undefined
            ? Math.max(0, timing.deadlineAt - Date.now())
            : null))
    : null

  const reward = (snapshot?.schemaVersion === 2 || mode === 'challenge')
    ? calculateSessionRewardV2Extended({
        mode,
        plannedCount,
        completedCount,
        totalPoints,
        endReason: isTimeout ? 'timeout' : 'completed',
        remainingMs,
        deadlineAt: timing?.deadlineAt ?? null,
        startedAt: timing?.startedAt ?? null,
      })
    : calculateSessionRewardV1({
        plannedCount,
        completedCount,
        totalPoints,
      })

  const earnedStars = ('finalStars' in reward ? Number(reward.finalStars) : reward.collectibleStars) as number
  const hasSpeedBonus = 'speedBonusApplied' in reward && Boolean(reward.speedBonusApplied)
  const hasMultiplier = 'challengeMultiplierApplied' in reward && Boolean(reward.challengeMultiplierApplied)

  return (
    <div className={`drill-reward-box ${earnedStars === 0 ? 'drill-reward-zero' : ''}`} data-testid="drill-reward-stars">
      <div className="drill-reward-stars-display" aria-label={`Mendapatkan ${earnedStars} bintang`}>
        {[1, 2, 3].map(starIndex => (
          <span
            key={starIndex}
            className={`drill-star ${starIndex <= earnedStars ? 'drill-star-earned' : 'drill-star-empty'}`}
            aria-hidden="true"
          >
            ⭐
          </span>
        ))}
      </div>
      <div className="drill-reward-label">
        {earnedStars > 0 ? (
          <>
            <strong className="drill-reward-count">+{earnedStars} Bintang Diperoleh!</strong>
            <span className="drill-reward-subtext">Bintang sudah otomatis masuk ke tabunganmu.</span>
          </>
        ) : (
          <>
            <strong className="drill-reward-count">Belum Mendapatkan Bintang</strong>
            <span className="drill-reward-subtext">
              Selesaikan minimal 70% soal di latihan berikutnya agar bintang masuk ke tabungan.
            </span>
          </>
        )}
      </div>
      {(hasSpeedBonus || hasMultiplier) && (
        <div className="drill-reward-badges">
          {hasSpeedBonus && <span className="drill-reward-badge">⚡ Bonus Kecepatan (+1 ⭐)</span>}
          {hasMultiplier && <span className="drill-reward-badge">🚀 Mode Tantangan (1.5x)</span>}
        </div>
      )}
    </div>
  )
}
