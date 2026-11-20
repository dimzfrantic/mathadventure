/**
 * Stage 7B-A2 — Backend-backed completed-session history view.
 *
 * The ParentDashboard history list used to read the per-origin IndexedDB
 * history, so two origins could show different histories for the same child
 * while the reward balance came from the (now authoritative) backend. This
 * adapter implements the single method the dashboard needs (`list`) on top of
 * `/api/reward/completed-sessions`, so the report and the balance always
 * describe the same authoritative data set.
 *
 * It is read-only: it never writes, never repairs and never deletes. When the
 * backend is unreachable the dashboard keeps showing its existing honest
 * "history unavailable" state instead of a stale local copy.
 */

import type { CompletedSessionHistoryStore, HistoryListResult } from './completedSessionHistoryStore'
import type { CompletedSessionRecord } from './completedSessionTypes'
import { getRewardSessions } from '../api/rewardApi'

type HistoryListQuery = Parameters<CompletedSessionHistoryStore['list']>[0]

function compareRecent(left: CompletedSessionRecord, right: CompletedSessionRecord): number {
  if (left.recordedAt !== right.recordedAt) return right.recordedAt - left.recordedAt
  return right.instanceId.localeCompare(left.instanceId)
}

export function createBackendHistoryStore(
  api: { readonly getSessions: typeof getRewardSessions } = { getSessions: getRewardSessions },
): Pick<CompletedSessionHistoryStore, 'list'> {
  return {
    async list(options?: HistoryListQuery): Promise<HistoryListResult> {
      const response = await api.getSessions()
      if (!response.ok) return { status: 'storage-error', code: 'unavailable' }

      const sorted = [...(response.value.sessions as readonly CompletedSessionRecord[])].sort(compareRecent)
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
        invalidCount: response.value.invalidCount,
        ...(hasMore && last ? { nextCursor: { recordedAt: last.recordedAt, instanceId: last.instanceId } } : {}),
      }
    },
  }
}
