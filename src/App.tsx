import { useMemo, useState } from 'react'
import MatchingApp from './MatchingApp'
import { DistributionApp } from './DistributionApp'
import MathDrillApp from './features/math-drill/MathDrillApp'
import { selectMathDrillPersistence } from './features/math-drill/persistence/historyActivation'
import type { MathHistoryActivation } from './features/math-drill/persistence/historyActivation'
import { createLiveUnifiedIndexedDbSessionStore } from './features/math-drill/persistence/completedSessionHistoryStore'
import type { UnifiedIndexedDbSessionStore } from './features/math-drill/persistence/completedSessionHistoryStore'
import { ParentDashboard } from './features/math-drill/ParentDashboard'
import './activity-navigation.css'

type ConceptId = '00.1-A' | '00.1-B'
type ActivityId = ConceptId | 'math-drill' | 'parent-dashboard'
type DashboardOrigin = ConceptId | 'math-drill'

export default function App({ historyActivation }: { readonly historyActivation?: MathHistoryActivation }) {
  const persistenceFactory = useMemo(() => selectMathDrillPersistence(historyActivation), [historyActivation])
  const dashboardStore = useMemo<UnifiedIndexedDbSessionStore | null>(() => historyActivation?.mode === 'live' ? createLiveUnifiedIndexedDbSessionStore() : null, [historyActivation])
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
        <MathDrillApp onExit={() => setActiveActivity(previousConcept)} persistenceFactory={persistenceFactory} />
      </div>}
      {activeActivity === 'parent-dashboard' && dashboardStore && <ParentDashboard store={dashboardStore} onBack={() => setActiveActivity(dashboardOrigin)} />}
    </div>
  )
}

