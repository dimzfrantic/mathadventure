import { useMemo, useState } from 'react'
import MatchingApp from './MatchingApp'
import { DistributionApp } from './DistributionApp'
import MathDrillApp from './features/math-drill/MathDrillApp'
import { selectMathDrillPersistence } from './features/math-drill/persistence/historyActivation'
import type { MathHistoryActivation } from './features/math-drill/persistence/historyActivation'
import { createLiveUnifiedIndexedDbSessionStore } from './features/math-drill/persistence/completedSessionHistoryStore'
import type { UnifiedIndexedDbSessionStore } from './features/math-drill/persistence/completedSessionHistoryStore'
import { ParentDashboard } from './features/math-drill/ParentDashboard'
import { createRewardWiring } from './features/math-drill/rewardWiring'
import { ChildRedemption } from './features/math-drill/ChildRedemption'
import './activity-navigation.css'

type ConceptId = '00.1-A' | '00.1-B'
type ActivityId = ConceptId | 'math-drill' | 'parent-dashboard'
type DashboardOrigin = ConceptId | 'math-drill'

export default function App({ historyActivation }: { readonly historyActivation?: MathHistoryActivation }) {
  const persistenceFactory = useMemo(() => selectMathDrillPersistence(historyActivation), [historyActivation])
  const dashboardStore = useMemo<UnifiedIndexedDbSessionStore | null>(() => historyActivation?.mode === 'live' ? createLiveUnifiedIndexedDbSessionStore() : null, [historyActivation])
  // Stage 7B-A2 (P0-2): the reward controller is created once per application
  // instance and wired into the dashboard. It talks to the authoritative
  // backend, holds no listeners/timers, and reads the parent session token per
  // request, so re-renders never recreate it and nothing leaks on unmount.
  const rewardWiring = useMemo(() => createRewardWiring(), [])
  const [activeActivity, setActiveActivity] = useState<ActivityId>('00.1-A')
  const [previousConcept, setPreviousConcept] = useState<ConceptId>('00.1-A')
  const [dashboardOrigin, setDashboardOrigin] = useState<DashboardOrigin>('00.1-A')
  const keepMathDrillMounted = activeActivity === 'math-drill' || (activeActivity === 'parent-dashboard' && dashboardOrigin === 'math-drill')

  return (
    <div className="activity-shell">
      {activeActivity === 'math-drill'
        ? dashboardStore && <nav className="activity-switcher" aria-label="Pilih aktivitas">
          <button type="button" onClick={() => { setDashboardOrigin('math-drill'); setActiveActivity('parent-dashboard') }}>
            Dashboard Orang Tua
          </button>
        </nav>
        : <nav className="activity-switcher" aria-label="Pilih aktivitas">
          <button type="button" aria-pressed={activeActivity === '00.1-A'} onClick={() => setActiveActivity('00.1-A')}>
            00.1-A · Memasangkan
          </button>
          <button type="button" aria-pressed={activeActivity === '00.1-B'} onClick={() => setActiveActivity('00.1-B')}>
            00.1-B · Membagikan
          </button>
          <button type="button" className="drill-entry" onClick={() => { setPreviousConcept(activeActivity === '00.1-B' ? '00.1-B' : '00.1-A'); setActiveActivity('math-drill') }}>
            Math Drill · Latihan
          </button>
          {dashboardStore && <button type="button" aria-pressed={activeActivity === 'parent-dashboard'} onClick={() => { if (activeActivity === '00.1-A' || activeActivity === '00.1-B') setDashboardOrigin(activeActivity); setActiveActivity('parent-dashboard') }}>
            Dashboard Orang Tua
          </button>}
        </nav>}
      <div hidden={activeActivity !== '00.1-A'}>
        <MatchingApp />
      </div>
      <div hidden={activeActivity !== '00.1-B'}>
        <DistributionApp />
      </div>
      {keepMathDrillMounted && <div hidden={activeActivity !== 'math-drill'}>
        {activeActivity === 'math-drill' && <div className="drill-shell child-reward-placement"><ChildRedemption /></div>}
        <MathDrillApp onExit={() => setActiveActivity(previousConcept)} persistenceFactory={persistenceFactory} />
      </div>}
      {activeActivity === 'parent-dashboard' && dashboardStore && <ParentDashboard
        store={rewardWiring.historyStore}
        controller={rewardWiring.controller}
        onBack={() => setActiveActivity(dashboardOrigin)}
      />}
    </div>
  )
}

