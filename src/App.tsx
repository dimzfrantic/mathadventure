import './index.css'

function App() {
  return (
    <main className="foundation-shell">
      <section className="foundation-card" aria-labelledby="app-title">
        <p className="foundation-eyebrow">Project Foundation</p>
        <h1 id="app-title">Math Adventure</h1>
        <p className="foundation-copy">
          Fondasi aplikasi pembelajaran matematika lokal-first sudah siap.
        </p>
        <div className="foundation-status" role="status">
          <span className="status-dot" aria-hidden="true" />
          <span>Phase 1 — Project Foundation</span>
        </div>
      </section>
    </main>
  )
}

export default App

