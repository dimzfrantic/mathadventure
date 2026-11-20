import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import '../index.css'
import './acceptance.css'
import { createSessionController } from '../features/math-drill/persistence/sessionController'
import { projectCompletedSession } from '../features/math-drill/persistence/completedSessionProjection'
import { createUnifiedIndexedDbSessionStore } from '../features/math-drill/persistence/completedSessionHistoryStore'
import { NativeIndexedDbSessionStore } from '../features/math-drill/persistence/indexedDbSessionStore'
import { generateSession } from '../features/math-drill/domain/generator'
import { generateChallengeSession } from '../features/math-drill/domain/challenge'
import type { ChallengeSession, DrillSession } from '../features/math-drill/domain'
import type { SessionControllerTimers } from '../features/math-drill/persistence/sessionController'
import type { SavedSessionMode } from '../features/math-drill/persistence/sessionTypes'
import type { SessionDurationMs } from '../features/math-drill/persistence/sessionTimer'
import type { IndexedDbSessionStore } from '../features/math-drill/persistence/indexedDbSessionStore'

const PREFIX = 'math-adventure-stage5b2c-stage5b2e-native-'
type Check = { name: string; status: 'PASS' | 'FAIL'; detail: string }
type Clock = { timers: SessionControllerTimers; now(): number; set(value: number): void; fire(): Promise<void> }
function assert(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message) }
function newClock(): Clock {
  let currentNow = 10_000, callback: (() => void | Promise<void>) | null = null, delay = 0, handle = 0
  const timers: SessionControllerTimers = { setTimeout(fn, ms) { callback = fn; delay = ms; handle += 1; return handle }, clearTimeout(token) { if (token === handle) callback = null } }
  return { timers, now: () => currentNow, set(value) { currentNow = value }, async fire() { const next = callback; assert(next, 'expected scheduled timer'); callback = null; currentNow += delay; await next() } }
}
function randomId(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16)); bytes[6] = (bytes[6] & 15) | 64; bytes[8] = (bytes[8] & 63) | 128
  const hex = [...bytes].map(value => value.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}
function regular(seed: number, count = 1): DrillSession {
  const result = generateSession({ level: 1, mode: 'mixed', count, seed, roundSize: count })
  assert(result.ok, `regular generation failed: ${result.ok ? '' : result.error.code}`); return result.session
}
function challenge(seed: number): ChallengeSession {
  const result = generateChallengeSession({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar'], mode: 'mixed', count: 10, seed, roundSize: 10 })
  assert(result.ok, `challenge generation failed: ${result.ok ? '' : result.error.code}`); return result.session
}
function makeStore(name: string) { return createUnifiedIndexedDbSessionStore({ databaseName: name }) }
function makeController(store: IndexedDbSessionStore, clock: Clock) { return createSessionController({ store, completionMode: 'atomic', now: clock.now, timers: clock.timers }) }
async function start(controller: ReturnType<typeof createSessionController>, mode: SavedSessionMode, session: DrillSession | ChallengeSession, durationMs?: SessionDurationMs) {
  const loaded = await controller.load(mode); assert(loaded.status === 'empty', `expected empty ${mode} slot, got ${loaded.status}`)
  const created = await controller.startSession(session, randomId(), durationMs); assert(created.status === 'ready' && created.snapshot.cursor.phase === 'answering', `start failed for ${mode}`)
}
async function readDatabaseMetadata(name: string): Promise<{ version: number; stores: string[] }> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('database metadata open failed'))
  })
  const metadata = { version: db.version, stores: [...db.objectStoreNames].sort() }
  db.close()
  return metadata
}
async function addRawHistory(name: string, record: unknown): Promise<void> {
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(name)
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('history seed open failed'))
  })
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction('completedSessions', 'readwrite')
    transaction.objectStore('completedSessions').add(record)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('history seed failed'))
    transaction.onabort = () => reject(transaction.error ?? new Error('history seed aborted'))
  }).finally(() => db.close())
}
async function answerRight(controller: ReturnType<typeof createSessionController>, clock: Clock) {
  const state = controller.getState(); assert(state.status === 'ready' && state.snapshot.cursor.phase === 'answering', 'controller not ready for answer')
  const question = state.snapshot.session.questions[state.snapshot.cursor.questionIndex]; assert(question, 'question missing')
  const result = await controller.submitAnswer(question.correctChoiceIndex); assert(result.status === 'ready', `answer save failed: ${result.status}`)
  if (result.snapshot.cursor.phase === 'auto-advance') await clock.fire()
  const after = controller.getState(); assert(after.status === 'ready', `advance failed: ${after.status}`)
  if (after.snapshot.cursor.phase === 'round') assert((await controller.continueRound()).status === 'ready', 'continue round failed')
}
async function finishRight(controller: ReturnType<typeof createSessionController>, clock: Clock, count: number) {
  for (let index = 0; index < count; index += 1) await answerRight(controller, clock)
  const result = controller.getState(); assert(result.status === 'ready' && result.snapshot.cursor.phase === 'result', 'session did not reach result'); return result.snapshot
}
async function reachManualFinal(controller: ReturnType<typeof createSessionController>, session: DrillSession) {
  const state = controller.getState(); assert(state.status === 'ready' && state.snapshot.cursor.phase === 'answering', 'session not ready for manual path')
  const question = session.questions[0], wrong = question.choices.findIndex((_, index) => index !== question.correctChoiceIndex); assert(wrong >= 0, 'no distractor available')
  let result = await controller.submitAnswer(wrong); assert(result.status === 'ready' && result.snapshot.cursor.phase === 'retry-prompt', 'first wrong answer did not ask retry')
  result = await controller.enableRetry(); assert(result.status === 'ready' && result.snapshot.cursor.phase === 'answering', 'retry was not enabled')
  const secondWrong = question.choices.findIndex((_, index) => index !== question.correctChoiceIndex && index !== wrong)
  result = await controller.submitAnswer(secondWrong); assert(result.status === 'ready' && result.snapshot.cursor.phase === 'manual-advance', 'second wrong answer did not reach manual advance')
}
async function deleteOwned(name: string) {
  assert(name.startsWith(PREFIX) && name !== 'math-adventure', `refusing cleanup of non-owned db ${name}`)
  if (!(await indexedDB.databases()).some(item => item.name === name)) return
  await new Promise<void>((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = () => resolve(); request.onerror = () => reject(request.error ?? new Error('delete failed')); request.onblocked = () => reject(new Error(`delete blocked: ${name}`)) })
}

async function runSuite(): Promise<Check[]> {
  const loopbackAutomation = window.location.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(window.location.hostname) && new URLSearchParams(window.location.search).get('loopback') === '1'
  assert(window.isSecureContext === false || loopbackAutomation, 'native check entry requires plain HTTP LAN or an explicitly flagged HTTP loopback test origin')
  assert(typeof crypto.getRandomValues === 'function', 'crypto.getRandomValues unavailable; secure session IDs/seeds cannot be generated')
  assert(typeof indexedDB !== 'undefined' && typeof indexedDB.databases === 'function', 'IndexedDB inventory API unavailable; cannot verify exact-owned cleanup')
  const names = new Set<string>(), stores: Array<{ close(): void }> = [], controllers: Array<{ dispose(): void }> = [], checks: Check[] = []
  let cleanupError: string | undefined
  const name = () => { let candidate = `${PREFIX}${Date.now()}-${names.size + 1}`; while (names.has(candidate)) candidate = `${PREFIX}${Date.now()}-${names.size + 1}-${names.size}`; names.add(candidate); return candidate }
  const createUnified = (db: string) => { assert(db.startsWith(PREFIX) && db !== 'math-adventure', 'unsafe DB'); const store = makeStore(db); stores.push(store); return store }
  const createController = (store: IndexedDbSessionStore, clock: Clock) => { const value = makeController(store, clock); controllers.push(value); return value }
  try {
    const baseline = await indexedDB.databases(); assert(!baseline.some(item => item.name === 'math-adventure'), 'live DB unexpectedly visible; suite will not access it')
    const migrationName = name(), legacy = new NativeIndexedDbSessionStore({ databaseName: migrationName }); stores.push(legacy)
    const legacyClock = newClock(), oldRegular = createSessionController({ store: legacy, now: legacyClock.now, timers: legacyClock.timers }); controllers.push(oldRegular)
    await start(oldRegular, 'regular', regular(2401)); await finishRight(oldRegular, legacyClock, 1)
    const savedRegular = await legacy.load('regular'); assert(savedRegular.status === 'valid' && savedRegular.value.cursor.phase === 'result', 'v1 result snapshot not persisted')
    const oldChallenge = createSessionController({ store: legacy, now: legacyClock.now, timers: legacyClock.timers }); controllers.push(oldChallenge)
    await start(oldChallenge, 'challenge', challenge(2402))
    const challengeState = oldChallenge.getState(); assert(challengeState.status === 'ready' && challengeState.snapshot.cursor.phase === 'answering', 'v1 challenge snapshot not persisted')
    await oldChallenge.submitAnswer(challengeState.snapshot.session.questions[0].correctChoiceIndex)
    const savedChallenge = await legacy.load('challenge'); assert(savedChallenge.status === 'valid', 'v1 challenge readback failed')
    const oldChallengeCopy = structuredClone(savedChallenge.value); oldRegular.dispose(); oldChallenge.dispose(); legacy.close()
    const upgraded = createUnified(migrationName); assert((await upgraded.open()).status === 'opened', 'v1-to-v2 upgrade failed')
    const migratedRegular = await upgraded.load('regular'), migratedChallenge = await upgraded.load('challenge')
    assert(migratedRegular.status === 'valid' && migratedRegular.value.cursor.phase === 'result', 'v1 completed snapshot lost during upgrade')
    assert(migratedChallenge.status === 'valid' && JSON.stringify(migratedChallenge.value) === JSON.stringify(oldChallengeCopy), 'v1 Challenge snapshot changed during upgrade')
    const preexistingHistory = await upgraded.list(); assert(preexistingHistory.status === 'success' && preexistingHistory.records.length === 0, 'v1 result was backfilled into immutable history')
    checks.push({ name: 'Native v1→v2 additive upgrade; both modes preserved; no history backfill', status: 'PASS', detail: 'regular result + unchanged Challenge snapshot; history=0' })

    const regularName = name(), regularStore = createUnified(regularName), regularClock = newClock(); assert((await regularStore.open()).status === 'opened', 'Regular v2 open failed')
    let duplicateStatus = 'not-run'; const regularProxy = Object.create(regularStore) as typeof regularStore
    regularProxy.commitResult = async (snapshot, expected, history) => { const first = await regularStore.commitResult(snapshot, expected, history); duplicateStatus = (await regularStore.commitResult(snapshot, expected, history)).status; return first }
    const dedupeController = createController(regularProxy, regularClock); await start(dedupeController, 'regular', regular(2501))
    const regularFinal = await finishRight(dedupeController, regularClock, 1)
    assert(duplicateStatus === 'already-exists-equivalent', `equivalent retry returned ${duplicateStatus}`)
    let regularHistory = await regularStore.list(); assert(regularHistory.status === 'success' && regularHistory.records.length === 1, 'Regular atomic result not archived exactly once')
    dedupeController.dispose(); regularStore.close()
    const regularReopen = createUnified(regularName); stores.push(regularReopen); assert((await regularReopen.open()).status === 'opened', 'Regular reopen failed')
    const resumeController = createController(regularReopen, newClock()), resumed = await resumeController.load('regular')
    regularHistory = await regularReopen.list(); assert(resumed.status === 'ready' && resumed.snapshot.cursor.phase === 'result', 'completed Regular session did not resume after reopen')
    assert(regularHistory.status === 'success' && regularHistory.records.length === 1, 'Regular history did not survive reopen')
    const replacement = await resumeController.replaceSession(regular(2502), randomId(), { instanceId: regularFinal.instanceId, sessionId: regularFinal.sessionId, revision: regularFinal.revision })
    assert(replacement.status === 'ready', 'replacement session creation failed')
    const afterReplacement = await regularReopen.list(); assert(afterReplacement.status === 'success' && afterReplacement.records.length === 1, 'new session erased earlier history')
    checks.push({ name: 'Regular atomic completion, equivalent retry, reopen/resume, history retention', status: 'PASS', detail: `retry=${duplicateStatus}; archive retained after replacement` })

    const challengeName = name(), challengeStore = createUnified(challengeName), challengeClock = newClock(); assert((await challengeStore.open()).status === 'opened', 'Challenge v2 open failed')
    const challengeController = createController(challengeStore, challengeClock); await start(challengeController, 'challenge', challenge(2601))
    const challengeFinal = await finishRight(challengeController, challengeClock, 10); assert(challengeFinal.mode === 'challenge' && challengeFinal.cursor.phase === 'result', 'Challenge completion snapshot invalid')
    let challengeHistory = await challengeStore.list(); assert(challengeHistory.status === 'success' && challengeHistory.records.length === 1 && challengeHistory.records[0].mode === 'challenge', 'Challenge history not committed')
    challengeController.dispose(); challengeStore.close()
    const challengeReopen = createUnified(challengeName); stores.push(challengeReopen); assert((await challengeReopen.open()).status === 'opened', 'Challenge reopen failed')
    const challengeResume = createController(challengeReopen, newClock()), challengeReadback = await challengeResume.load('challenge'); challengeHistory = await challengeReopen.list()
    assert(challengeReadback.status === 'ready' && challengeReadback.snapshot.cursor.phase === 'result', 'Challenge refresh/resume failed')
    assert(challengeHistory.status === 'success' && challengeHistory.records.length === 1, 'Challenge archive changed after reopen')
    checks.push({ name: 'Challenge mixed Level 1/5 completion and durable history', status: 'PASS', detail: '10 outcomes; archived result remains after reopen' })

    const timeoutName = name(), timeoutStore = createUnified(timeoutName), timeoutClock = newClock(); assert((await timeoutStore.open()).status === 'opened', 'timeout DB open failed')
    const timeoutController = createController(timeoutStore, timeoutClock)
    await start(timeoutController, 'regular', regular(2651, 4), 300_000)
    timeoutClock.set(310_000)
    await timeoutClock.fire()
    const zeroState = timeoutController.getState(), zeroHistory = await timeoutStore.list()
    assert(zeroState.status === 'ready' && zeroState.snapshot.cursor.phase === 'timeout', 'zero-answer Regular timeout not finalized')
    assert(zeroHistory.status === 'success' && zeroHistory.records.length === 1 && zeroHistory.records[0].historySchemaVersion === 2, 'zero-answer V2 history not committed once')
    assert(zeroHistory.records[0].endReason === 'timeout' && zeroHistory.records[0].plannedCount === 4 && zeroHistory.records[0].completedCount === 0 && zeroHistory.records[0].outcomes.length === 0, 'zero-answer history fabricated or miscounted outcomes')
    timeoutController.dispose(); timeoutStore.close()

    const reopenedTimeoutStore = createUnified(timeoutName); stores.push(reopenedTimeoutStore)
    assert((await reopenedTimeoutStore.open()).status === 'opened', 'timeout DB reopen failed')
    const timeoutResume = createController(reopenedTimeoutStore, newClock()), timeoutReload = await timeoutResume.load('regular')
    let timeoutHistory = await reopenedTimeoutStore.list()
    assert(timeoutReload.status === 'ready' && timeoutReload.snapshot.cursor.phase === 'timeout', 'timeout snapshot did not recover after reopen')
    assert(timeoutHistory.status === 'success' && timeoutHistory.records.length === 1, 'timeout reopen duplicated history')

    assert(savedRegular.status === 'valid', 'V1 source snapshot unavailable for mixed history check')
    const v1At = Date.now(), v1Projection = projectCompletedSession(savedRegular.value, { completedAt: v1At, recordedAt: v1At + 1, provenance: 'new-atomic' })
    assert(v1Projection.status === 'valid' && v1Projection.value.historySchemaVersion === 1, 'valid V1 history fixture projection failed')
    await addRawHistory(timeoutName, v1Projection.value)
    timeoutHistory = await reopenedTimeoutStore.list()
    assert(timeoutHistory.status === 'success' && timeoutHistory.records.length === 2 && timeoutHistory.records.some(record => record.historySchemaVersion === 1) && timeoutHistory.records.some(record => record.historySchemaVersion === 2), 'mixed V1/V2 history read failed')
    const metadata = await readDatabaseMetadata(timeoutName)
    assert(metadata.version === 2 && metadata.stores.join(',') === 'activeSessions,completedSessions', `database layout changed unexpectedly: v${metadata.version}/${metadata.stores.join(',')}`)
    timeoutResume.dispose(); reopenedTimeoutStore.close()
    checks.push({ name: 'Regular zero-answer timeout, reopen/idempotency, V1/V2 history coexistence, IndexedDB v2 layout', status: 'PASS', detail: 'partial counts=0/4; one timeout record after reopen; mixed schemas read; only existing stores at version 2' })

    const partialName = name(), partialStore = createUnified(partialName), partialClock = newClock(); assert((await partialStore.open()).status === 'opened', 'partial timeout DB open failed')
    const partialController = createController(partialStore, partialClock), partialSession = challenge(2652)
    await start(partialController, 'challenge', partialSession, 300_000)
    partialClock.set(309_999)
    await partialController.submitAnswer(partialSession.questions[0].correctChoiceIndex)
    partialClock.set(310_000)
    await partialClock.fire()
    const partialState = partialController.getState(), partialHistory = await partialStore.list()
    assert(partialState.status === 'ready' && partialState.snapshot.cursor.phase === 'timeout', 'Challenge partial timeout not finalized')
    assert(partialHistory.status === 'success' && partialHistory.records.length === 1, 'Challenge timeout history not committed exactly once')
    const partialRecord = partialHistory.records[0]
    assert(partialRecord.historySchemaVersion === 2 && partialRecord.endReason === 'timeout' && partialRecord.plannedCount === 10 && partialRecord.completedCount === 1 && partialRecord.outcomes.length === 1, 'Challenge partial result counts invalid')
    assert(partialRecord.outcomes[0].points === 1, 'Challenge partial earned score changed')
    partialController.dispose(); partialStore.close()
    checks.push({ name: 'Challenge partial timeout after answer near deadline', status: 'PASS', detail: 'one durably completed outcome retained; 9 unanswered questions omitted' })

    const customName = name(), customStore = createUnified(customName), customClock = newClock(); assert((await customStore.open()).status === 'opened', 'custom duration DB open failed')
    const customController = createController(customStore, customClock)
    await start(customController, 'regular', regular(2653, 4), 7 * 60_000)
    await customClock.fire()
    const customState = customController.getState(), customHistory = await customStore.list(), customActive = await customStore.load('regular')
    assert(customState.status === 'ready' && customState.snapshot.cursor.phase === 'timeout', 'custom duration timeout was not finalized')
    assert(customHistory.status === 'success' && customHistory.records.length === 1, 'custom duration history was not committed exactly once')
    const customRecord = customHistory.records[0]
    assert(customRecord.historySchemaVersion === 2 && customRecord.endReason === 'timeout' && customRecord.durationMs === 420_000 && customRecord.startedAt === 10_000 && customRecord.deadlineAt === 430_000 && customRecord.endedAt === 430_000 && customRecord.remainingMs === 0, 'custom duration history timing metadata mismatch')
    assert(customRecord.plannedCount === 4 && customRecord.completedCount === 0 && customRecord.outcomes.length === 0, 'custom timeout fabricated outcomes')
    assert(customActive.status === 'valid' && customActive.value.schemaVersion === 2 && customActive.value.timing.durationMs === 420_000 && customActive.value.timing.deadlineAt === 430_000 && customActive.value.cursor.phase === 'timeout', 'custom active snapshot did not preserve duration/deadline')
    const customMetadata = await readDatabaseMetadata(customName)
    assert(customMetadata.version === 2 && customMetadata.stores.join(',') === 'activeSessions,completedSessions', 'custom duration changed IndexedDB layout')
    customController.dispose(); customStore.close()
    checks.push({ name: 'Custom 7-minute timeout in native IndexedDB v2', status: 'PASS', detail: 'active snapshot and V2 timeout history retained 420000 ms/430000 deadline with no fabricated outcomes' })

    const rollbackName = name(), rollbackStore = createUnified(rollbackName), rollbackClock = newClock(); assert((await rollbackStore.open()).status === 'opened', 'rollback DB open failed')
    const rollbackController = createController(rollbackStore, rollbackClock), rollbackSession = regular(2701); await start(rollbackController, 'regular', rollbackSession); await reachManualFinal(rollbackController, rollbackSession)
    const originalAdd = IDBObjectStore.prototype.add; let injected = false
    IDBObjectStore.prototype.add = function (value: unknown, key?: IDBValidKey) { const request = originalAdd.call(this, value, key); if (!injected && this.transaction.db.name === rollbackName && this.name === 'completedSessions') { injected = true; originalAdd.call(this, structuredClone(value), key) } return request }
    let failedCompletion: Awaited<ReturnType<typeof rollbackController.advanceManual>>
    try { failedCompletion = await rollbackController.advanceManual() } finally { IDBObjectStore.prototype.add = originalAdd }
    assert(injected, 'history failure injection was not reached')
    assert(failedCompletion!.status === 'completion' && failedCompletion!.stage === 'failed', 'transaction failure not surfaced')
    const rolledSnapshot = await rollbackStore.load('regular'), rolledHistory = await rollbackStore.list()
    assert(rolledSnapshot.status === 'valid' && rolledSnapshot.value.cursor.phase === 'manual-advance', 'atomic failure did not roll back active snapshot')
    assert(rolledHistory.status === 'success' && rolledHistory.records.length === 0, 'atomic failure left partial history')
    checks.push({ name: 'Atomic rollback on history-store ConstraintError', status: 'PASS', detail: 'active slot stayed manual-advance; no partial history' })

    const uncertainName = name(), uncertainStore = createUnified(uncertainName), uncertainClock = newClock(); assert((await uncertainStore.open()).status === 'opened', 'uncertain DB open failed')
    const uncertainProxy = Object.create(uncertainStore) as typeof uncertainStore
    uncertainProxy.commitResult = async (snapshot, expected, history) => { await uncertainStore.commitResult(snapshot, expected, history); throw new Error('simulated-response-loss-after-commit') }
    const uncertainController = createController(uncertainProxy, uncertainClock), uncertainSession = regular(2801)
    await start(uncertainController, 'regular', uncertainSession); await reachManualFinal(uncertainController, uncertainSession)
    const uncertainState = await uncertainController.advanceManual(); assert(uncertainState.status === 'completion' && uncertainState.stage === 'uncertain', 'lost response not represented as uncertain')
    const recovered = await uncertainController.verifyPendingCompletion(), recoveredHistory = await uncertainStore.list()
    assert(recovered.status === 'ready' && recovered.snapshot.cursor.phase === 'result', 'readback recovery failed')
    assert(recoveredHistory.status === 'success' && recoveredHistory.records.length === 1, 'recovery duplicated or lost history')
    checks.push({ name: 'Lost response recovery/readback', status: 'PASS', detail: 'uncertain→verified result; exact history count=1' })

    const conflictName = name(), conflictStore = createUnified(conflictName), competitor = makeStore(conflictName), conflictClock = newClock()
    stores.push(competitor); assert((await conflictStore.open()).status === 'opened', 'conflict DB open failed'); assert((await competitor.open()).status === 'opened', 'competitor open failed')
    const conflictProxy = Object.create(conflictStore) as typeof conflictStore
    conflictProxy.commitResult = async (snapshot, expected, history) => {
      const active = await competitor.load('regular'); assert(active.status === 'valid', 'competitor could not read active snapshot')
      const bump = await competitor.save({ ...active.value, updatedAt: active.value.updatedAt + 1 }, { instanceId: active.value.instanceId, sessionId: active.value.sessionId, revision: active.value.revision })
      assert(bump.status === 'success', 'competitor revision bump failed'); return conflictStore.commitResult(snapshot, expected, history)
    }
    const conflictController = createController(conflictProxy, conflictClock), conflictSession = regular(2901)
    await start(conflictController, 'regular', conflictSession); await reachManualFinal(conflictController, conflictSession)
    const conflicted = await conflictController.advanceManual(); assert(conflicted.status === 'completion' && conflicted.stage === 'conflict', 'revision race not surfaced as conflict')
    const noPartialHistory = await conflictStore.list(); assert(noPartialHistory.status === 'success' && noPartialHistory.records.length === 0, 'conflict wrote history')
    const recoveryController = createController(conflictStore, newClock()), reloaded = await recoveryController.load('regular')
    assert(reloaded.status === 'ready' && reloaded.snapshot.cursor.phase === 'manual-advance', 'conflict recovery failed to reload active snapshot')
    const committed = await recoveryController.advanceManual(); assert(committed.status === 'ready' && committed.snapshot.cursor.phase === 'result', 'recovered completion failed')
    const finalHistory = await conflictStore.list(); assert(finalHistory.status === 'success' && finalHistory.records.length === 1, 'CAS recovery history not exactly one')
    checks.push({ name: 'CAS conflict and recovery', status: 'PASS', detail: 'stale write rejected with no partial history; reload then commit yielded one record' })

    const after = await indexedDB.databases(); assert(!after.some(item => item.name === 'math-adventure'), 'live DB appeared during suite')
    checks.push({ name: 'Live database isolation', status: 'PASS', detail: '`math-adventure` was never opened; all suite names use disposable prefix' })
  } finally {
    controllers.forEach(controller => controller.dispose()); stores.forEach(store => store.close())
    try {
      for (const dbName of names) await deleteOwned(dbName)
      const remaining = await indexedDB.databases(), leftovers = [...names].filter(dbName => remaining.some(item => item.name === dbName))
      if (leftovers.length) cleanupError = `owned disposable DB cleanup failed: ${leftovers.join(', ')}`
      else if (names.size > 0) checks.push({ name: 'Exact-owned disposable cleanup', status: 'PASS', detail: `${names.size} test-owned databases deleted and verified absent` })
    } catch (cause) { cleanupError = cause instanceof Error ? cause.message : String(cause) }
  }
  if (cleanupError) throw new Error(cleanupError)
  return checks
}

export default function NativeChecks() {
  const [running, setRunning] = useState(false), [checks, setChecks] = useState<Check[]>([]), [error, setError] = useState('')
  async function run() { setRunning(true); setChecks([]); setError(''); try { setChecks(await runSuite()) } catch (cause) { setError(cause instanceof Error ? cause.stack ?? cause.message : String(cause)) } finally { setRunning(false) } }
  return <main className="stage5b2e-shell"><header className="stage5b2e-banner">
    <p className="stage5b2e-warning">AUTOMATED NATIVE CHROMIUM CHECKS · TEST ONLY</p><h1>IndexedDB v2 acceptance matrix</h1>
    <p>Database fixtures are disposable and exact-owned; this runner requires native IndexedDB/CSPRNG and plain HTTP LAN or an explicitly flagged loopback test origin.</p>
    <p>Origin: <code>{location.origin}</code> · secure context: <strong>{String(window.isSecureContext)}</strong> · crypto.subtle: <strong>{String(typeof crypto.subtle !== 'undefined')}</strong> · crypto.getRandomValues: <strong>{String(typeof crypto.getRandomValues === 'function')}</strong> · IndexedDB: <strong>{String(typeof indexedDB !== 'undefined')}</strong></p>
    <button type="button" disabled={running} onClick={() => void run()}>{running ? 'Pengujian berjalan…' : 'Run native checks'}</button>
  </header>
  {error && <pre className="stage5b2e-blocked" role="alert">{error}</pre>}
  <ol>{checks.map(check => <li key={check.name}><strong>{check.status} — {check.name}</strong><p>{check.detail}</p></li>)}</ol>
  {checks.length > 0 && <output aria-live="polite">{checks.every(check => check.status === 'PASS') ? 'ALL PASS' : 'CHECKS FAILED'}</output>}</main>
}

createRoot(document.getElementById('root')!).render(<NativeChecks />)
