/**
 * Stage 7B-A2 — Device-authenticated completed-session history view.
 *
 * WHY THIS EXISTS
 * ---------------
 * The dashboard history used to be read from `/api/reward/completed-sessions`,
 * which requires a **backend parent session** (`X-Parent-Session`). That token
 * can only be minted by `POST /api/parent/verify` with the *backend* PIN — but
 * the owner's decision is that the parent PIN is a purely local device gate and
 * must never be transmitted as backend authentication. The two secrets can
 * therefore diverge, and when they did, a parent who had correctly unlocked the
 * device saw "Penyimpanan riwayat tidak tersedia" even though the session was
 * stored on the backend.
 *
 * History is not a ledger operation: it is a read of the sessions this device
 * already writes to the backend with its device credential (`X-API-KEY`, added
 * server-side by the reverse proxy). So this adapter reads `GET /api/sessions`
 * instead. The authoritative **balance** is untouched and still comes from the
 * reward ledger behind parent authentication.
 *
 * Guarantees:
 *  - read-only: never writes, repairs or deletes;
 *  - a non-2xx / unreachable backend yields the honest `storage-error`
 *    (`unavailable`) state, never an empty list that would look like "no
 *    history";
 *  - records the backend cannot map are counted as `invalidCount` so the
 *    dashboard keeps its "sebagian riwayat rusak" warning instead of silently
 *    dropping them.
 */

import type { CompletedSessionHistoryStore, HistoryListResult } from './completedSessionHistoryStore'
import type { CompletedSessionRecord } from './completedSessionTypes'
import { getSessions, toCompletedSessionRecord } from '../api/sessionApi'

type HistoryListQuery = Parameters<CompletedSessionHistoryStore['list']>[0]

/** Page size for the backend read. */
const PAGE_SIZE = 500
/** Defensive bound so a misbehaving backend cannot loop us forever. */
const MAX_PAGES = 20

function compareRecent(left: CompletedSessionRecord, right: CompletedSessionRecord): number {
  if (left.recordedAt !== right.recordedAt) return right.recordedAt - left.recordedAt
  return right.instanceId.localeCompare(left.instanceId)
}

export function createDeviceHistoryStore(
  api: { readonly getSessions: typeof getSessions } = { getSessions },
): Pick<CompletedSessionHistoryStore, 'list'> {
  return {
    async list(options?: HistoryListQuery): Promise<HistoryListResult> {
      const records: CompletedSessionRecord[] = []
      let invalidCount = 0

      try {
        for (let page = 0; page < MAX_PAGES; page += 1) {
          const response = await api.getSessions({ limit: PAGE_SIZE, offset: page * PAGE_SIZE })
          const sessions = response?.sessions ?? []

          for (const session of sessions) {
            try {
              // Legacy rows written before the history schema carried outcomes
              // cannot be projected; count them instead of crashing the list.
              if (!Array.isArray((session as { outcomes?: unknown }).outcomes)) {
                invalidCount += 1
                continue
              }
              records.push(toCompletedSessionRecord(session))
            } catch {
              invalidCount += 1
            }
          }

          const total = typeof response?.total === 'number' ? response.total : null
          const fetched = (page + 1) * PAGE_SIZE
          if (sessions.length < PAGE_SIZE) break
          if (total !== null && fetched >= total) break
        }
      } catch {
        // Unreachable backend, 401 from a missing device credential, 5xx, or a
        // corrupt sessions.json (which the server answers with 500 on purpose).
        return { status: 'storage-error', code: 'unavailable' }
      }

      const sorted = [...records].sort(compareRecent)
      const cursor = options?.cursor
      const afterCursor = cursor
        ? sorted.filter(record => compareRecent(record, { recordedAt: cursor.recordedAt, instanceId: cursor.instanceId } as CompletedSessionRecord) > 0)
        : sorted

      const limit = options?.limit ?? 500
      const page = afterCursor.slice(0, limit)
      const hasMore = afterCursor.length > page.length
      const last = page[page.length - 1]

      return {
        status: 'success',
        records: page,
        invalidCount,
        ...(hasMore && last ? { nextCursor: { recordedAt: last.recordedAt, instanceId: last.instanceId } } : {}),
      }
    },
  }
}
