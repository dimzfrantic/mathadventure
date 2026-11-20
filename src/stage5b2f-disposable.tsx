import { createRoot } from 'react-dom/client'
import App from './App'
import { selectMathDrillPersistence } from './features/math-drill/persistence/historyActivation'
import { createSessionController } from './features/math-drill/persistence/sessionController'
import type { SessionController, SessionControllerTimers } from './features/math-drill/persistence/sessionController'
import { NativeIndexedDbSessionStore } from './features/math-drill/persistence/indexedDbSessionStore'
import type { UnifiedIndexedDbSessionStore } from './features/math-drill/persistence/completedSessionHistoryStore'
import { generateSession } from './features/math-drill/domain/generator'
import { generateChallengeSession } from './features/math-drill/domain/challenge'
import './index.css'

const prefix = 'math-adventure-stage5b2c-stage5b2f-'
const priorRunId = sessionStorage.getItem('stage5b2f-run-id')
const runId = priorRunId && /^[a-f0-9-]{36}$/.test(priorRunId) ? priorRunId : crypto.randomUUID()
sessionStorage.setItem('stage5b2f-run-id', runId)
const uiName = `${prefix}normal-ui-${runId}`
const owned = new Set<string>([uiName])
const stores: Array<{ close(): void }> = []
const controllers: SessionController[] = []
const checks: string[] = []
function check(condition: unknown, message: string): asserts condition { if (!condition) throw Error(message) }
function name(suffix: string) { const value = `${prefix}${suffix}-${runId}`; owned.add(value); return value }
function chosen(dbName: string): UnifiedIndexedDbSessionStore {
  check(dbName.startsWith(prefix), 'disposable prefix required')
  const selected = selectMathDrillPersistence({ mode: 'disposable', databaseName: dbName })
  check(selected, 'normal App ON selection missing')
  const options = selected()
  check(options.completionMode === 'atomic', 'completion not atomic')
  const store = options.store as UnifiedIndexedDbSessionStore
  stores.push(store)
  return store
}
function clock() {
  let callback: (() => void | Promise<void>) | undefined
  let currentNow = Date.now(), pendingDelay = 0
  const timers: SessionControllerTimers = { setTimeout(fn, delay) { callback = fn; pendingDelay = delay; return 1 }, clearTimeout() { callback = undefined } }
  return { timers, now: () => currentNow, async fire() { const next = callback; check(next, 'auto-advance not scheduled'); callback = undefined; currentNow += pendingDelay; await next() } }
}
function control(store: ReturnType<typeof chosen> | NativeIndexedDbSessionStore, timer: ReturnType<typeof clock>, atomic = true) {
  const controller = createSessionController({ store, ...(atomic ? { completionMode: 'atomic' as const } : {}), now: timer.now, timers: timer.timers })
  controllers.push(controller)
  return controller
}
function regular(seed: number) {
  const result = generateSession({ level: 1, mode: 'mixed', count: 1, seed, roundSize: 1 })
  check(result.ok, 'regular generator failed')
  return result.session
}
function challenge(seed: number) {
  const result = generateChallengeSession({ selectedLevels: [1, 5], selectedLevel5Sublevels: ['dasar'], mode: 'mixed', count: 10, seed, roundSize: 10 })
  check(result.ok, 'challenge generator failed')
  return result.session
}
async function start(controller: SessionController, mode: 'regular' | 'challenge', session: ReturnType<typeof regular> | ReturnType<typeof challenge>) {
  check((await controller.load(mode)).status === 'empty', `expected empty ${mode}`)
  check((await controller.startSession(session, crypto.randomUUID())).status === 'ready', `start ${mode} failed`)
}
async function answer(controller: SessionController, timer: ReturnType<typeof clock>) {
  const state = controller.getState(); check(state.status === 'ready' && state.snapshot.cursor.phase === 'answering', 'answer state invalid')
  const q = state.snapshot.session.questions[state.snapshot.cursor.questionIndex]
  const after = await controller.submitAnswer(q.correctChoiceIndex)
  check(after.status === 'ready', `answer failed: ${after.status}`)
  if (after.snapshot.cursor.phase === 'auto-advance') await timer.fire()
  const next = controller.getState()
  if (next.status === 'ready' && next.snapshot.cursor.phase === 'round') check((await controller.continueRound()).status === 'ready', 'round continue failed')
}
async function finish(controller: SessionController, timer: ReturnType<typeof clock>, count: number) {
  for (let index = 0; index < count; index++) await answer(controller, timer)
  const state = controller.getState()
  check(state.status === 'ready' && state.snapshot.cursor.phase === 'result', `result not reached: ${state.status}${state.status === 'ready' ? '/' + state.snapshot.cursor.phase : ''}`)
  return state.snapshot
}
async function deleteOwned(dbName: string) {
  check(owned.has(dbName) && dbName.startsWith(prefix), 'refusing non-owned cleanup')
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(dbName)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
    req.onblocked = () => reject(Error(`cleanup blocked for ${dbName}`))
  })
}
async function run() {
  check(location.hostname === '127.0.0.1', 'loopback-only native checks')
  check(typeof indexedDB?.databases === 'function', 'native IndexedDB inventory unavailable')
  checks.length = 0
  let blocker: IDBDatabase | null = null
  try {
    const fresh = chosen(name('fresh'))
    check((await fresh.open()).status === 'opened', 'fresh v2 open failed')
    const empty = await fresh.list(); check(empty.status === 'success' && empty.records.length === 0, 'fresh history not empty')
    checks.push('fresh v2 startup')

    const upgradeName = name('upgrade'), legacy = new NativeIndexedDbSessionStore({ databaseName: upgradeName })
    stores.push(legacy)
    const oldTimer = clock(), oldR = control(legacy, oldTimer, false)
    await start(oldR, 'regular', regular(3201))
    const legacyResult = await finish(oldR, oldTimer, 1)
    const oldC = control(legacy, oldTimer, false)
    await start(oldC, 'challenge', challenge(3202)); await answer(oldC, oldTimer)
    const oldChallenge = await legacy.load('challenge'); check(oldChallenge.status === 'valid', 'v1 challenge unreadable')
    const previousChallenge = JSON.stringify(oldChallenge.value)
    oldR.dispose(); oldC.dispose(); legacy.close()
    const migrated = chosen(upgradeName); check((await migrated.open()).status === 'opened', 'v1->v2 failed')
    const result = await migrated.load('regular'), resumed = await migrated.load('challenge')
    check(result.status === 'valid' && result.value.cursor.phase === 'result' && JSON.stringify(result.value) === JSON.stringify(legacyResult), 'legacy result changed')
    check(resumed.status === 'valid' && JSON.stringify(resumed.value) === previousChallenge, 'legacy Challenge changed')
    const noBackfill = await migrated.list(); check(noBackfill.status === 'success' && noBackfill.records.length === 0, 'legacy result backfilled')
    const resumedController = control(migrated, clock())
    check((await resumedController.load('challenge')).status === 'ready', 'interrupted Challenge cannot resume')
    checks.push('v1 Regular completed + Challenge interrupted preserve, no backfill, resume')

    const otherName = name('opposite'), otherLegacy = new NativeIndexedDbSessionStore({ databaseName: otherName })
    stores.push(otherLegacy)
    const otherTimer = clock(), oldInterrupted = control(otherLegacy, otherTimer, false)
    await start(oldInterrupted, 'regular', regular(3301))
    const prevRegular = await otherLegacy.load('regular'); check(prevRegular.status === 'valid', 'v1 interrupted Regular invalid')
    const oldCompleted = control(otherLegacy, otherTimer, false)
    await start(oldCompleted, 'challenge', challenge(3302)); const prevChallenge = await finish(oldCompleted, otherTimer, 10)
    oldInterrupted.dispose(); oldCompleted.dispose(); otherLegacy.close()
    const other = chosen(otherName); check((await other.open()).status === 'opened', 'opposite upgrade failed')
    const newRegular = await other.load('regular'), newChallenge = await other.load('challenge')
    check(newRegular.status === 'valid' && JSON.stringify(newRegular.value) === JSON.stringify(prevRegular.value), 'Regular interrupted changed')
    check(newChallenge.status === 'valid' && JSON.stringify(newChallenge.value) === JSON.stringify(prevChallenge), 'Challenge result changed')
    check((await control(other, clock()).load('regular')).status === 'ready', 'Regular resume failed')
    const otherHistory = await other.list(); check(otherHistory.status === 'success' && otherHistory.records.length === 0, 'Challenge result backfilled')
    checks.push('v1 Regular interrupted + Challenge completed preserve and resume')

    const finishName = name('atomic'), active = chosen(finishName), timer = clock()
    const first = control(active, timer); await start(first, 'regular', regular(3401))
    const completedR = await finish(first, timer, 1)
    const c = control(active, timer); await start(c, 'challenge', challenge(3402)); const completedC = await finish(c, timer, 10)
    let history = await active.list()
    check(history.status === 'success' && history.records.length === 2, 'two unique completions missing')
    check(new Set(history.records.map(row => row.instanceId)).size === 2 && history.records.some(row => row.mode === 'regular') && history.records.some(row => row.mode === 'challenge'), 'per-mode history incorrect')
    first.dispose(); c.dispose(); active.close()
    const reopened = chosen(finishName); history = await reopened.list()
    check(history.status === 'success' && history.records.length === 2, 'restart lost history')
    check((await reopened.load('regular')).status === 'valid' && (await reopened.load('challenge')).status === 'valid', 'reload lost snapshots')
    const replacementController = control(reopened, clock())
    check((await replacementController.load('regular')).status === 'ready', 'restart Regular load failed')
    const replacement = await replacementController.replaceSession(regular(3403), crypto.randomUUID(), { instanceId: completedR.instanceId, sessionId: completedR.sessionId, revision: completedR.revision })
    check(replacement.status === 'ready', 'new Regular session failed')
    history = await reopened.list(); check(history.status === 'success' && history.records.length === 2, 'new session erased history')
    check(completedC.cursor.phase === 'result', 'Challenge result changed')
    checks.push('normal selector atomic Regular/Challenge, restart, reload, history retention')

    const retryName = name('equivalent-retry'), retryStore = chosen(retryName), retryTimer = clock()
    const retryProxy = Object.create(retryStore) as UnifiedIndexedDbSessionStore
    let retryStatus = ''
    retryProxy.commitResult = async (snapshot, expected, record) => {
      const firstCommit = await retryStore.commitResult(snapshot, expected, record)
      retryStatus = (await retryStore.commitResult(snapshot, expected, record)).status
      return firstCommit
    }
    const retryController = control(retryProxy, retryTimer)
    await start(retryController, 'regular', regular(3501)); await finish(retryController, retryTimer, 1)
    const retryHistory = await retryStore.list()
    check(retryStatus === 'already-exists-equivalent' && retryHistory.status === 'success' && retryHistory.records.length === 1, 'equivalent retry duplicated history')
    checks.push('equivalent atomic retry returns existing and keeps one history row')

    const conflictName = name('cas-conflict'), conflictStore = chosen(conflictName), competitor = chosen(conflictName), conflictTimer = clock()
    const conflictProxy = Object.create(conflictStore) as UnifiedIndexedDbSessionStore
    let newerRevision = 0
    conflictProxy.commitResult = async (snapshot, expected, record) => {
      const before = await competitor.load('regular'); check(before.status === 'valid', 'competitor cannot read')
      const saved = await competitor.save({ ...before.value, updatedAt: before.value.updatedAt + 1 }, { instanceId: before.value.instanceId, sessionId: before.value.sessionId, revision: before.value.revision })
      check(saved.status === 'success', 'newer revision was not saved')
      newerRevision = saved.value.revision
      return conflictStore.commitResult(snapshot, expected, record)
    }
    const conflictController = control(conflictProxy, conflictTimer)
    await start(conflictController, 'regular', regular(3601))
    await answer(conflictController, conflictTimer)
    const conflictState = conflictController.getState(), durable = await competitor.load('regular'), conflictHistory = await competitor.list()
    check(conflictState.status === 'completion' && conflictState.stage === 'conflict', 'CAS conflict not surfaced')
    check(durable.status === 'valid' && durable.value.revision === newerRevision && durable.value.cursor.phase !== 'result', 'stale completion overwrote newer snapshot')
    check(conflictHistory.status === 'success' && conflictHistory.records.length === 0, 'CAS conflict wrote partial history')
    checks.push('CAS conflict preserves newer active revision; no partial history')

    const blockedName = name('blocked')
    blocker = await new Promise<IDBDatabase>((resolve, reject) => { const req = indexedDB.open(blockedName, 1); req.onupgradeneeded = () => { req.result.createObjectStore('activeSessions', { keyPath: 'mode' }) }; req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error) })
    blocker.onversionchange = () => { /* Simulated stale tab refuses to close. */ }
    const blocked = chosen(blockedName)
    const blockedResult = await blocked.open()
    check(blockedResult.status === 'storage-error' && blockedResult.code === 'blocked', 'upgrade should fail closed while v1 tab remains open')
    blocker.close(); blocker = null
    checks.push('blocked v1 upgrade fails closed; old connection unchanged')

    const highName = name('unsupported'), highStore = chosen(highName)
    check((await highStore.open()).status === 'opened', 'v2 setup failed')
    highStore.close()
    const oldVersion = new NativeIndexedDbSessionStore({ databaseName: highName }); stores.push(oldVersion)
    const unsupported = await oldVersion.load('regular')
    check(unsupported.status === 'storage-error' && unsupported.code === 'unsupported-database-version', 'v1 tab did not get safe VersionError')
    const illegal = new NativeIndexedDbSessionStore({ databaseName: name('illegal') }, 3); stores.push(illegal)
    const noV3 = await illegal.load('regular')
    check(noV3.status === 'storage-error' && noV3.code === 'unsupported-database-version', 'v3 was not refused')
    checks.push('old v1 tab VersionError; v3 request rejected before IDB open')
    return { status: 'PASS', checks: [...checks], uiName, regularInstanceId: completedR.instanceId, challengeInstanceId: completedC.instanceId }
  } finally {
    blocker?.close()
    controllers.forEach(item => item.dispose())
    stores.forEach(item => item.close())
    // Keep the App UI fixture until browser UI tests finish; never delete other origin data.
    for (const dbName of owned) if (dbName !== uiName) await deleteOwned(dbName)
    const remaining = await indexedDB.databases()
    check(![...owned].filter(value => value !== uiName).some(value => remaining.some(entry => entry.name === value)), 'owned cleanup incomplete')
  }
}

declare global { interface Window { __stage5b2f: { readonly uiName: string; run: typeof run; cleanupUi(): Promise<void> } } }
window.__stage5b2f = { uiName, run, async cleanupUi() { check(uiName.startsWith(prefix), 'not owned'); appRoot.unmount(); await deleteOwned(uiName); check(!(await indexedDB.databases()).some(item => item.name === uiName), 'UI fixture cleanup failed'); sessionStorage.removeItem('stage5b2f-run-id') } }
const root = document.getElementById('root'); check(root, 'test root missing')
const header = document.createElement('aside'); header.textContent = `ISOLATED STAGE 5B.2F DISPOSABLE UI — ${uiName}`; root.append(header)
const mount = document.createElement('main'); root.append(mount)
const appRoot = createRoot(mount)
appRoot.render(<App historyActivation={{ mode: 'disposable', databaseName: uiName }} />)
