# Architecture Decisions — Math Adventure

## Phase 1 baseline

- Architecture: modular monolith dengan React + TypeScript + Vite.
- Deployment target: local-first browser application.
- Persistence target: IndexedDB melalui abstraction layer; belum diimplementasikan pada Phase 1.
- Educational content: dipisahkan dari komponen UI melalui direktori `src/curriculum`; belum diimplementasikan pada Phase 1.
- Testing: Vitest + jsdom + React Testing Library untuk unit/smoke test.
- Styling: Tailwind CSS v4 melalui plugin resmi Vite.
- E2E: Playwright sengaja belum dipasang karena batasan Phase 1 dan dukungan Windows 10 native yang perlu keputusan lingkungan terpisah.
- PWA: sengaja belum dipasang; service worker dan strategi cache belum menjadi bagian Phase 1.

## Security-by-design baseline

- Tidak ada backend atau external API pada Phase 1.
- Tidak ada data anak yang disimpan oleh smoke test.
- Dependency dipasang tanpa `--force` dan tanpa `--legacy-peer-deps`.
- `package-lock.json` dipertahankan untuk reproducible installs.
- Validasi input, backup/import, parent PIN, dan batas keamanan lokal akan dirancang sebelum fitur terkait diimplementasikan.
- Local-only storage tidak dianggap sebagai perlindungan terhadap orang yang menguasai perangkat/browser developer tools.

## Scope boundary

Phase 1 hanya menyiapkan fondasi proyek, konfigurasi testing, tampilan placeholder, dan dokumentasi arsitektur. Tidak ada materi matematika, asesmen, mastery, rewards, parent dashboard, PWA, atau Playwright.
