# Stage 7B — Laporan Inspeksi dan Rencana Implementasi

## Tanggal
Kamis, 23 Oktober 2026

---

## 1. Kondisi Awal Proyek

### 1.1 Status Git

```
On branch master
Changes not staged for commit:
  - package-lock.json (modified)
  - package.json (modified)
  - src/App.tsx (modified)
  - src/main.tsx (modified)
  - tests/foundation.test.tsx (modified)

Untracked files:
  - docs/phase-7b-parent-dashboard-ui-specification.md (specification file)
  - Various documentation files
```

### 1.2 File yang Sudah Ada

| File | Status | Keterangan |
|------|--------|------------|
| `ParentDashboard.tsx` | ✅ Ada | Implementasi dasar sudah ada |
| `parent-dashboard.css` | ✅ Ada | Styling sudah ada |
| `App.tsx` | ✅ Ada | Menu "Dashboard Orang Tua" sudah terintegrasi |

### 1.3 Implementasi ParentDashboard Saat Ini

**Yang sudah diimplementasikan:**
- Menu akses dari main navigation
- Unlock form dengan PIN
- Konfirmasi/batal transaction melalui controller
- Tampilkan transactions dan config
- Tampilkan riwayat sesi dari store
- Grafik dan statistik sesi

**Yang BELUM/TIDAK SESUAI spesifikasi:**
- PIN hardcoded sebagai default "1234" (line 53: `parentPin = '1234'`)
- Tidak ada setup PIN saat pertama kali (selalu meminta PIN yang sama)
- PIN tidak disimpan secara aman (hanya via prop, tidak persistent)
- Tidak ada Web Crypto API untuk verifikasi
- Tidak ada pembatasan percobaan (rate limiting)
- Tidak ada idle timeout locking (5 menit)
- Tidak ada tombol "Kunci Dashboard"
- Tidak ada form setup PIN terpisah

---

## 2. Rencana Implementasi

### 2.1 File yang Akan Diubah

1. **`ParentDashboard.tsx`**
   - Tambahkan state untuk PIN setup vs verification
   - Implementasi Web Crypto API untuk PIN verifier
   - Tambahkan rate limiting
   - Tambahkan idle timeout timer
   - Tambahkan tombol Kunci Dashboard

2. **`localStorage` untuk PIN verifier**
   - Simpan verifier PIN (bukan PIN itu sendiri)
   - Key: `math-adventure-parent-pin-verifier`

### 2.2 Komponen Baru yang Dibuat

1. **PinSetupForm** - Form untuk setup PIN pertama kali
2. **PinVerifyForm** - Form untuk verifikasi PIN
3. **ParentDashboardAuthenticated** - Dashboard yang sudah login
4. **IdleTimeoutHandler** - Hook untuk auto-lock

### 2.3 Fitur yang Diimplementasikan

| Fitur | Prioritas | Status |
|-------|-----------|--------|
| Setup PIN pertama kali | HIGH | BARU |
| Verifikasi PIN dengan Web Crypto | HIGH | BARU |
| Rate limiting (max 5 percobaan) | HIGH | BARU |
| Idle timeout 5 menit | HIGH | BARU |
| Tombol Kunci Dashboard | MEDIUM | BARU |
| Konfirmasi modal untuk actions | MEDIUM | ADA (perlu perbaiki) |
| Error handling yang jelas | MEDIUM | ADA |

### 2.4 Test yang Akan Ditambahkan/Dijalankan

1. Test PIN setup dan verifikasi
2. Test rate limiting
3. Test idle timeout
4. Test navigasi menu
5. Test regression reward (sudah ada di repo)

---

## 3. Perintah Testing yang Akan Dijalankan

```bash
# Full test suite
npx vitest run

# TypeScript check
npx tsc --noEmit

# Lint
npm run lint
```

---

## 4. Risiko dan Ketidaksesuaian

### 4.1 Ketidaksesuaian dengan Spesifikasi

1. **PIN hardcoded** - Akan diganti dengan setup aman
2. **Tidak ada setup awal** - Akan ditambahkan
3. **Tidak ada rate limiting** - Akan ditambahkan
4. **Tidak ada idle timeout** - Akan ditambahkan

### 4.2 Keterbatasan Teknis (Sudah Ada, Tidak Dapat Diubah)

1. **Sessions dibaca dari memory snapshot** - Bukan transaksi IndexedDB atomik
2. **Fake-indexeddb tidak membuktikan concurrency browser nyata**
3. **Tidak ada distributed locking untuk multi-instance**

---

## 5. Keputusan Desain

### 5.1 Mekanisme Penyimpanan PIN

Akan menggunakan Web Crypto API:
- Generate salt acak menggunakan `crypto.getRandomValues()`
- Gunakan PBKDF2 untuk derivasi key
- Simpan salt + verifier (bukan PIN itu sendiri)
- Gunakan saat verifikasi: derive key dari input PIN + salt tersimpan, bandingkan dengan verifier

### 5.2 Rate Limiting

- Max 5 percobaan berturut-turut
- Jeda 30 detik setelah 5 kegagalan
- Jeda meningkat 2x setiap kali threshold tercapai
- Reset counter setelah berhasil verifikasi

### 5.3 Idle Timeout

- 5 menit (300000ms) - konfigurasi terpusat
- Reset pada aktivitas: click, keypress, scroll
- Timer di-clear pada unmount dan lock

---

## 6. Kesimpulan

Proyek memiliki fondasi ParentDashboard yang sudah terintegrasi dengan reward system. Yang diperlukan adalah:
1. Mengganti PIN hardcoded dengan sistem aman
2. Menambahkan setup PIN pertama kali
3. Menambahkan rate limiting dan idle timeout
4. Menambahkan tombol Kunci Dashboard

Implementasi tidak akan mengubah:
- Aturan reward Phase 7A
- Data reward yang sudah ada
- Arsitektur persistence yang ada

**Menunggu persetujuan sebelum implementasi dimulai.**