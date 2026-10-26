# Math Drill — Laporan Implementasi Tahap 2B

Tanggal verifikasi: 12 Oktober 2026 (SEAST). Status: PASS untuk prototipe UI Tahap 2B; uji Android fisik masih **PENDING HUMAN DEVICE TEST**.

## 1. Ringkasan eksekutif

Prototipe Math Drill telah dihubungkan ke aplikasi melalui tombol navigasi khusus tanpa mengganti aktivitas konsep 00.1-A atau 00.1-B. Pengguna dapat memilih level, operasi, dan jumlah soal; menjawab satu soal per layar dengan empat pilihan; menggunakan maksimum dua kesempatan; berpindah ronde; serta melihat hasil. Perpindahan soal memakai tombol `Lanjut`, bukan timer otomatis. Scoring dan kapasitas tetap bersumber dari domain Tahap 2A, tanpa mengubah generator atau scoring engine.

## 2. File baru dan berubah

- Baru: `src/features/math-drill/MathDrillApp.tsx` — konfigurasi, alur sesi, interaksi jawaban, konfirmasi keluar, ronde, hasil.
- Baru: `src/features/math-drill/math-drill.css` — gaya responsif dan target sentuh khusus Math Drill; aturan kecil untuk merapikan tombol masuk ketiga pada navigasi mobile.
- Baru: `tests/math-drill-ui.test.tsx` — test interaksi UI dan integrasi navigasi.
- Baru: `docs/math-drill-stage-2b-report.md` — laporan ini.
- Diperbarui secara terbatas: `src/App.tsx` — satu opsi navigasi menuju Math Drill, menyimpan aktivitas konsep sebelumnya, serta kembali ke aktivitas tersebut. Diff lokal awal sudah diperiksa terlebih dahulu; isi navigasi 00.1-A/B yang sudah ada dipertahankan. Komponen konsep tetap mounted dan disembunyikan saat Math Drill aktif sehingga state mereka tidak sengaja direset.

Tidak ada perubahan pada `src/features/math-drill/domain/generator.ts`, `scoring.ts`, tipe/API domain, source modul konsep, test konsep, konfigurasi, atau dependency. Tidak ada commit/push/deployment.

## 3. Cara membuka prototipe

Di direktori `D:\Hermes Project\math-adventure`, jalankan `npm run dev`, lalu buka alamat localhost yang ditampilkan Vite pada browser PC dan klik `Math Drill · Latihan` di navigasi. Dalam verifikasi ini server hanya di-bind ke `127.0.0.1:5173`, dan `curl -fsSI http://127.0.0.1:5173/` mengembalikan HTTP 200.

Untuk mencoba dari Android fisik, perangkat harus berada di jaringan lokal tepercaya yang sama dengan PC. Jalankan Vite dengan `npm run dev -- --host <alamat-LAN-PC>` dan buka `http://<alamat-LAN-PC>:5173/` dari Samsung Internet. Ini server development tanpa autentikasi: gunakan hanya jaringan tepercaya dan **jangan forward port 5173 ke internet/public IP**. Pengujian perangkat fisik belum dilakukan oleh agent.

## 4. Alur konfigurasi hingga hasil

`Math Drill` → pilih Level 1–5, penjumlahan/pengurangan/campuran, preset 10/20/30/50/100 atau custom integer 1–500 → `Mulai latihan` → satu persamaan dan empat pilihan → feedback → `Lanjut` → bila ronde habis `Ronde selesai` dan `Lanjut ronde` → halaman hasil. Prototipe tidak memakai pengaturan orang tua final atau PIN.

Input diperiksa dengan `validateRequest({level, mode, count})` selama konfigurasi. Permintaan tak valid menampilkan alasan dan kapasitas aktual; tombol mulai disabled. Jika `generateSession` masih mengembalikan kegagalan, UI menampilkan error dan tidak menampilkan sesi parsial. Jumlah, level, dan operasi tidak diubah otomatis. Tiap mulai menggunakan seed uint32 baru dari `crypto.getRandomValues`; bila seed baru kebetulan sama dengan seed sebelumnya dalam instance yang sama, seed dinaikkan satu dengan pembungkus uint32. Seed tetap tidak dipakai sebagai default sesi baru.

## 5. Integrasi generator dan scoring engine

UI hanya mengimpor fungsi/type dari `src/features/math-drill/domain/index.ts`: `validateRequest`, `generateSession`, `createScoreState`, `answerQuestion`, dan `getScoreMetrics`. Semua soal dibuat sebelum layar soal pertama. `questionIndex` menunjuk ke daftar sesi; pilihan tidak diacak ulang saat percobaan kedua. State skor disimpan in-memory React dan ref sinkron; `answerQuestion` menjadi sumber kebenaran transisi, poin, dan penolakan jawaban tidak valid. Ref `inputLocked` menutup peluang dua tap/click sebelum render mengunci tombol. Pilihan yang salah sekali juga disabled pada kesempatan kedua, sesuai penolakan jawaban identik di engine.

## 6. Feedback dan dua kesempatan

Benar pertama: status `Benar!`, poin 1. Salah pertama: `Coba lagi. Kamu masih punya satu kesempatan.`, tanpa jawaban benar; pilihan tidak berubah dan anak menekan `Coba lagi` untuk membuka kesempatan kedua. Benar kedua: `Benar!`, poin 0,5. Salah kedua: `Jawaban yang benar: …`, poin 0. Kedua hasil selesai hanya pindah ketika anak menekan `Lanjut`; tidak ada timer/transisi otomatis. Saat feedback sedang aktif semua pilihan disabled. Setelah dua kesalahan, soal selesai dan tidak ada jalan UI untuk menjawab kali ketiga. Pesan disampaikan melalui live region `role=status`; warna bukan satu-satunya sinyal.

## 7. Ronde dan progres

UI memakai `session.questions`, `session.roundSize`, dan `session.rounds` dari generator. Default 10 soal per ronde (engine mendukung maksimal 20); indikator `Soal x / total` dan `Ronde y / total`, serta elemen `<progress>`. Setelah item kesepuluh selesai dan tombol `Lanjut` ditekan, tampil transisi ronde; `Lanjut ronde` baru membuka soal berikutnya. Soal tidak di-generate ulang antar ronde, sehingga key unik lintas seluruh sesi. Ronde terakhir dapat lebih pendek.

## 8. Keluar, mengulang, dan refresh

`Kembali` pada konfigurasi atau hasil menuju aktivitas konsep sebelumnya; `Kembali` saat sesi/ronde aktif menampilkan `alertdialog`: `Keluar dari latihan? Progres sesi ini tidak disimpan.` Pilihan `Tetap latihan` membatalkan; `Ya, keluar` kembali. Saat dialog terbuka, layar jawaban tidak dirender, sehingga tidak menerima input yang terselip. Pada hasil, `Latihan lagi` membuang session dan scoring state lama, lalu kembali ke konfigurasi. Tidak ada penyimpanan lokal; refresh browser menghapus progres. UI menyatakan keterbatasan ini di halaman konfigurasi.

## 9. Hasil automated tests

Perintah dan hasil aktual:

- `npm test -- tests/math-drill-ui.test.tsx` → 12/12 test lulus (1 file).
- `npm test` → **162/162 test lulus, 0 gagal (15 file)**; mencakup test generator, scoring, UI, dan aktivitas konsep.
- Test UI meliputi konfigurasi valid/over-capacity/noninteger, empat pilihan, benar pertama dan skor penuh, salah pertama tanpa bocor jawaban, benar kedua setengah skor, salah kedua menampilkan jawaban, tidak ada input ketiga, double click pada feedback, progres 11 soal/dua ronde tanpa duplikasi, hasil metrik campuran, reset, konfirmasi keluar, fokus keyboard, Level 5, serta navigasi 00.1-A/B. Test dengan 3 hasil berbeda menghasilkan skor berbobot 50% dan akurasi percobaan pertama 33% secara terpisah.
- Test runner saat ini hanya meliputi `tests/**/*.test.{ts,tsx}`. Dua file test lama `src/features/math-drill/domain/generator.test.ts` dan `scoring.test.ts` bersifat sebagian duplikat dan masih memuat assertion lama yang bertentangan dengan keputusan Level 2 fleksibel/definisi `unanswered`. Keduanya tidak dieksekusi oleh `npm test`; TypeScript tetap membaca/mengecek mereka. Keduanya belum dirapikan/dipindah/dihapus karena tidak diperlukan untuk UI dan konfigurasi test tidak boleh diubah. Test domain yang dijalankan dan dijadikan rujukan ada di `tests/math-drill-generator.test.ts` dan `tests/math-drill-scoring.test.ts`. Ini debt test yang perlu diputuskan sebelum mengaktifkan glob seluruh source.

## 10. Hasil typecheck, lint, build, dan diff

- `npm run typecheck` → exit 0, `tsc -b --pretty false` tanpa diagnostic.
- `npm run lint` → exit 0, `oxlint` tanpa warning.
- `npm run build` → exit 0; Vite 8.3.4, 34 modules transformed, CSS 26,58 kB (gzip 6,94 kB), JS 264,47 kB (gzip 80,93 kB), selesai 2,17 detik.
- `git diff --check` → exit 0. Git mengeluarkan peringatan line-ending pada `src/App.tsx` dan `tests/foundation.test.tsx` yang telah mengalami perubahan lokal sebelumnya; tidak ada error whitespace.

## 11. Status uji desktop dan Android

- Browser berbasis Chromium lewat browser harness/CDP lokal: konfigurasi, memulai sesi, menjawab, feedback, hasil 1/1 dan skor 100%, konfirmasi keluar, Level 5, serta kembali ke navigasi aktivitas konsep diamati langsung. `127.0.0.1:5173/` mengembalikan HTTP 200.
- Emulasi viewport mobile 320, 360, dan 412 CSS px: `document.documentElement.scrollWidth` tidak melebihi viewport pada layar yang diperiksa. Pada 320 px empat tombol jawaban masing-masing sekitar 118×70 px; preset setinggi 48 px dan tombol navigasi konsep setinggi sekitar 65 px. Simbol kotak Level 5 digambar jelas sekitar 25×25 px pada ukuran 320 CSS px, berdampingan dengan angka besar. Ini pemeriksaan browser emulasi, **bukan Samsung Internet/Android fisik**.
- Firefox/Chrome PC di perangkat manusia: **PENDING HUMAN BROWSER TEST** (harness CDP tidak menggantikan pengujian browser oleh orang tua).
- Samsung Internet di Android fisik: **PENDING HUMAN DEVICE TEST**. Tidak ada klaim berhasil pada perangkat yang tidak tersedia.

### Checklist orang tua untuk uji manual

Desktop (Chrome atau Firefox): buka prototipe, coba memilih level/operasi/jumlah termasuk angka di atas kapasitas, gunakan mouse dan Tab/Enter/Space untuk empat pilihan serta `Lanjut`, uji dua kali salah dan konfirmasi keluar, periksa tidak ada overflow horizontal. Android (Samsung Internet, portrait): periksa 320–412 CSS px bila tersedia, coba touch tiap pilihan, lihat apakah tombol dan `Lanjut` nyaman disentuh, pastikan feedback tidak tertutup dan tidak ada clipping, uji semua tiga bentuk `□` Level 5, pindah ronde dan kembali. Catat model perangkat, resolusi CSS, browser/versi, dan kesulitan membaca/menyentuh bila ditemukan.

## 12. Deskripsi tampilan

Tidak ada screenshot proyek yang disimpan. Layar konfigurasi berupa kartu putih dengan heading Math Drill, dua dropdown, preset dan input custom, tombol utama, serta catatan progres sementara. Layar soal menampilkan progres/ronde di atas, satu persamaan besar, empat tombol 2×2 berwarna biru muda, area feedback stabil, dan tombol tindakan eksplisit. Nilai hilang `□` diberi kotak visual tegas tanpa mengubah string persamaan pada data. Layar hasil menampilkan skor berbobot besar, rincian empat kategori pengerjaan, akurasi percobaan pertama dengan label terpisah, dan dua tombol `Latihan lagi`/`Kembali`.

## 13. Keterbatasan dan risiko

- Android fisik dan Samsung Internet belum diuji; emulasi viewport bukan bukti UX anak usia 8 tahun.
- Form konfigurasi sementara masih menampilkan semua level dan jumlah hingga 500; 500 merupakan batas teknis, bukan rekomendasi pedagogis. Pilihan orang tua/PIN belum ada.
- Tidak ada persistence; refresh/menutup tab menghapus latihan, termasuk skor.
- `crypto.getRandomValues` dipakai untuk seed baru, tetapi session data sendiri tetap in-memory dan tidak dimaksudkan untuk security/ranking.
- Test UI jsdom dan pemeriksaan browser CDP tidak menggantikan uji keyboard, screen reader, dan touch pada perangkat nyata.
- Dua test domain di bawah `src/` berisiko membingungkan karena glob Vitest saat ini tidak menjalankannya dan sebagian assertion sudah usang; rapikan melalui keputusan tahap terpisah tanpa mengubah konfigurasi diam-diam.
- `MathDrillApp` memakai CSS yang scoped `.drill-*` kecuali penyesuaian `.activity-switcher` untuk tiga tombol; cek layout aktivitas konsep lagi pada perangkat fisik.

## 14. Risiko regresi aktivitas konsep

Satu-satunya file existing yang diubah adalah `src/App.tsx`, sesudah membaca diff awalnya. Tombol dan komponen 00.1-A/B tetap dipertahankan, tidak ada perubahan aturan pembelajaran atau evidence. Keduanya tetap mounted ketika Math Drill dibuka lalu kembali ke activity asal. Seluruh regression suite (162 test) lulus. Namun uji visual manual untuk aktivitas konsep pada perangkat nyata masih perlu dilakukan; suite hijau tidak menjamin seluruh aspek layout/aksesibilitas.

## 15. Rekomendasi tahap berikutnya (belum dikerjakan)

Mintalah orang tua menguji browser desktop dan Android fisik terlebih dahulu, terutama keterbacaan tiga bentuk persamaan Level 5, kemudahan menyentuh pilihan/Lanjut, dan pengalaman jeda ronde. Tentukan nasib dua test domain usang sebelum perluasan test glob. Bila temuan anak/perangkat membutuhkan perubahan, ajukan revisi dengan scope baru; jangan lanjut ke PIN, timer, hadiah, persistence, backend, atau deployment tanpa persetujuan eksplisit.
