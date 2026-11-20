# Math Adventure 🚀

Aplikasi latihan matematika interaktif untuk anak dengan pendekatan gamifikasi, sistem reward bintang terintegrasi, dan dasbor kontrol orang tua.

---

## 🎯 Tujuan

**Math Adventure** dirancang untuk:
1. **Membangun Kelancaran Berhitung (Math Fluency):** Melatih operasi dasar aritmatika (penjumlahan, pengurangan, perkalian, pembagian) melalui latihan bertahap dan tantangan adaptif.
2. **Memberikan Motivasi Positif:** Menerapkan sistem tabungan reward bintang transparan dan terverifikasi yang dapat dikonversikan menjadi reward nyata bersama orang tua.
3. **Kemandirian Anak dengan Pengawasan Orang Tua:** Memungkinkan anak belajar secara mandiri di perangkat lokal, dengan batasan aman (*safe zone*) dan proteksi PIN untuk dasbor orang tua.

---

## ✨ Fitur Utama

- **🎮 Mode Latihan Biasa (Math Drill):**
  - Pilihan operasi hitung: Penjumlahan (`+`), Pengurangan (`-`), Perkalian (`×`), Pembagian (`÷`).
  - Berbagai pilihan level kesulitan bertingkat (Level 1 hingga level lanjutan).
  - Pilihan jumlah soal (10, 20, atau latihan panjang).
  - Opsi batas waktu: Tanpa batas waktu (santai) atau dengan countdown timer.

- **⚡ Mode Tantangan Campuran (Mixed Challenge):**
  - Soal campuran berbagai operasi dalam format ronde dinamis.
  - Pengali reward **1.5x** untuk perolehan bintang.
  - Bonus kecepatan (*Speed Bonus*) untuk penyelesaian cepat dengan akurasi tinggi.

- **⭐ Sistem Reward & Tabungan Bintang (Star Ledger):**
  - Buku kas reward (*ledger-backed*) yang aman dan konsisten untuk mencatat perolehan bintang.
  - Kartu apresiasi bintang visual pada layar akhir sesi latihan.
  - Halaman **Tukar Bintang** bagi anak untuk mengajukan penukaran hadiah.
  - Nilai kurs default: **1 Bintang = Rp500** (dapat disesuaikan di dasbor).

- **🔒 Dasbor Orang Tua (Parent Dashboard):**
  - Dilindungi otentikasi **Dual-Gate PIN** (verifikasi lokal dan server).
  - Manajemen saldo: menyetujui/mengonfirmasi penukaran hadiah anak atau melakukan koreksi saldo.
  - Konfigurasi aturan reward dan pengaturan tingkat kesulitan.

- **🖥️ Desktop Launcher On-Demand:**
  - Shortcut praktis sekali klik di Desktop Windows (`Math Adventure.lnk`).
  - Menyalakan backend API dan frontend Vite secara otomatis dan senyap (*background*) tanpa membebani memori saat startup PC.
  - Skrip penghenti server (`stop.vbs` / `stop.ps1`) untuk mematikan layanan secara bersih saat selesai bermain.

---

## 📜 Aturan Permainan & Sistem Reward

### 1. Kriteria Perolehan Bintang (Latihan Biasa)
Untuk mendapatkan bintang yang masuk ke tabungan, anak harus menyelesaikan **minimal 70% dari total soal**:
- **⭐⭐⭐ (3 Bintang):** Menyelesaikan 100% soal dengan akurasi jawaban ≥ 90%.
- **⭐⭐ (2 Bintang):** Menyelesaikan ≥ 70% soal dengan akurasi jawaban ≥ 70%.
- **⭐ (1 Bintang):** Menyelesaikan ≥ 70% soal dengan akurasi jawaban < 70%.
- **Belum Memenuhi Syarat (0 Bintang Tabungan):** Menyelesaikan < 70% soal (diberikan 1 bintang visual apresiasi motivasi, namun belum masuk ke tabungan saldo).

*Catatan: Semua level (termasuk Level 1) berhak mendapatkan reward bintang penuh sesuai kriteria di atas.*

### 2. Aturan Mode Tantangan (Mixed Challenge)
- **Pengali Tantangan:** Bintang yang diperoleh dikalikan **1.5x** (dibulatkan ke atas).
- **Bonus Kecepatan (+1 ⭐):** Diberikan jika sesi menggunakan timer, diselesaikan dengan sisa waktu ≥ 20%, dan akurasi ≥ 80%.

### 3. Penukaran Hadiah
1. Anak memilih jumlah bintang yang ingin ditukarkan pada menu **Tukar Bintang**.
2. Permintaan penukaran masuk ke antrean dengan status *Pending*.
3. Orang tua membuka **Dasbor Orang Tua**, memasukkan PIN rahasia, lalu mengonfirmasi penukaran setelah memberikan hadiah nyata kepada anak.

---

## 🛠️ Persyaratan Sistem & Instalasi

### Prasyarat
- **Node.js:** Versi 20+ atau versi portable yang disertakan (`v24.x`).
- **NPM:** Bawaan dari instalasi Node.js.
- **Git** (untuk clone dan update repository).
- **Sistem Operasi:** Windows 10/11 (didukung penuh untuk skrip launcher on-demand), macOS, atau Linux.

### Langkah Instalasi

1. **Clone Repository:**
   ```bash
   git clone https://github.com/dimzfrantic/mathadventure.git
   cd mathadventure
   ```

2. **Instal Dependensi:**
   ```bash
   npm install
   ```

3. **Inisialisasi Data Server (Jika Diperlukan):**
   Direktori `server/data/` digunakan untuk menyimpan ledger reward dan sesi secara lokal (tidak disertakan di git demi keamanan).
   Server akan membuat file konfigurasi awal secara otomatis saat pertama kali dijalankan.

---

## 🚀 Menjalankan Aplikasi

### Cara 1: Menggunakan Desktop Launcher (Khusus Windows)
Jika Anda menggunakan Windows dan ingin kemudahan sekali klik:
1. Jalankan skrip pembuatan shortcut:
   ```powershell
   powershell -ExecutionPolicy Bypass -File ./scripts/create-shortcut.ps1
   ```
2. Klik ganda ikon **Math Adventure** di Desktop Anda. Skrip akan otomatis mengaktifkan server di latar belakang dan membuka browser ke `http://localhost:5173`.
3. Untuk mematikan server setelah selesai, jalankan `scripts/stop.vbs` atau gunakan perintah:
   ```powershell
   powershell -ExecutionPolicy Bypass -File ./scripts/stop.ps1
   ```

### Cara 2: Menjalankan Secara Manual (Development Mode)
Jalankan kedua layanan (backend API dan frontend Vite):

```bash
# Menjalankan frontend dan backend secara bersamaan
npm run dev:all
```

Atau jalankan di dua terminal terpisah:
```bash
# Terminal 1: Backend API Server (Port 3001)
npm run dev:api

# Terminal 2: Frontend Vite (Port 5173)
npm run dev
```

Buka browser dan navigasikan ke:
```
http://localhost:5173
```

---

## 🧪 Pengujian & Verifikasi

Aplikasi dilengkapi dengan rangkaian unit test, integration test, dan verifikasi integritas ledger:

```bash
# Menjalankan seluruh test suite Vitest
npm test

# Menjalankan pengecekan tipe TypeScript
npm run typecheck

# Membangun bundle produksi
npm run build
```

---

## 📄 Lisensi

Dibuat untuk mendukung pembelajaran matematika anak yang menyenangkan dan bermakna.

