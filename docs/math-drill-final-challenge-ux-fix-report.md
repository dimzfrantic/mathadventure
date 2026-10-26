# Math Adventure — Final Challenge Stage 2: koreksi UX

Status: koreksi UX selesai; menunggu review manusia. Domain engine, generator, scoring, metadata, dan kebijakan kuota tidak diubah.

## Perubahan

### Pesan konfigurasi tidak valid

- Pesan validasi mentah domain tidak lagi ditampilkan kepada pengguna. UI memetakan kesalahan konfigurasi ke arahan singkat berbahasa Indonesia, termasuk pilihan level kosong dan sublevel Cari Angka yang belum dipilih.
- Untuk konfigurasi kapasitas/alokasi yang tidak dapat dijalankan, UI memakai `getChallengeCapacity(...).feasibleCounts` untuk mencari jumlah preset berikutnya yang dapat dijalankan. Bila tidak ada jumlah lebih tinggi, UI menyarankan jumlah feasible tertinggi yang lebih rendah. Angka rekomendasi tidak ditentukan statis.
- Rekomendasi berupa tombol pilihan manual. Nilai jumlah tetap tidak berubah sampai pengguna menekannya. Tombol Mulai tetap nonaktif selama validasi gagal.
- Istilah internal seperti `UNSATISFIABLE_ALLOCATION`, “feasible”, “kuota level”, dan “bottleneck” tidak muncul di pesan UI.

### Layar hasil

- Bagian utama dipersingkat menjadi “Tantangan Selesai!”, jumlah soal selesai, skor berbobot dalam persen, poin berbobot, jumlah benar langsung, soal selesai, dan kalimat motivasi.
- Penghitungan dan pembulatan persen menggunakan `getChallengeSummary`; pembulatan tetap `Math.round`, konsisten dengan hasil sebelumnya. Poin memakai numerator dan denominator dari metrik domain, dengan format angka Indonesia.
- Rekap berulang “Keseluruhan” dihapus. Rincian untuk orang tua memakai elemen disclosure native `<details>/<summary>` yang tertutup secara default.
- Rincian orang tua berisi tabel per level. Jika Level 5 digunakan, tabel sublevel menampilkan Dasar, Menengah, dan Lanjutan; kategori tanpa soal bernilai N/A, bukan 0%. Tabel operasi hanya ditampilkan untuk sesi Campuran dan barisnya mengikuti operasi yang benar-benar ada pada metadata soal sesi. Untuk operasi tunggal, tabel operasi disembunyikan.

## File yang diubah

- `src/features/math-drill/ChallengeApp.tsx` — pesan validasi ramah, saran preset dinamis, ringkasan anak, dan rincian orang tua.
- `src/features/math-drill/math-drill.css` — tata letak ringkasan, disclosure, tabel responsif, dan fokus keyboard.
- `tests/math-drill-challenge-ui.test.tsx` — tes copy invalid, saran, ringkasan, disclosure, N/A, sublevel, dan operasi.
- `docs/math-drill-final-challenge-ux-fix-report.md` — laporan ini.

Tidak ada perubahan domain atau file di luar scope. Tidak ada dependency baru, persistence, commit, atau push.

## Hasil pengujian

- `npm test`: **219/219 lulus**, 18 file.
- `npm run typecheck`: lulus.
- `npm run lint`: lulus.
- `npm run build`: lulus; Vite mentransformasi 37 modul.
- `git diff --check`: lulus untuk diff tracked. Laporan baru juga diperiksa terpisah dengan `git diff --no-index --check /dev/null ...`; tidak ada masalah whitespace. Catatan penting: working tree sudah berisi banyak file project lain yang modified/untracked, dan berkas sumber Final Challenge sendiri berstatus untracked sehingga `git diff` tidak menyediakan baseline tracked untuk menampilkan diff-nya. Saya tidak mengubah file di luar scope UX ini pada giliran ini; sebelum review, periksa working tree tersebut dan telaah file scope langsung. Peringatan CRLF Git muncul pada `src/App.tsx`, `tests/foundation.test.tsx`, dan laporan baru.
- Tes UI memastikan rekomendasi berasal dari preset feasible yang tersedia untuk konfigurasi (fixture multi-level mengusulkan 20 soal), jumlah tidak berubah sebelum tombol rekomendasi dipilih, dan Mulai tetap nonaktif saat konfigurasi invalid.
- Tes hasil memastikan disclosure tertutup secara default dan dapat dibuka/ditutup, tidak ada ringkasan “Keseluruhan” yang berulang, tabel per level/sublevel benar, kategori kosong N/A tanpa 0%, operasi tunggal tidak memunculkan breakdown operasi, dan sesi Campuran menampilkan operasi sesuai metadata soal.
- Browser Chromium: alur invalid dan rekomendasi diuji, sesi diselesaikan hingga hasil, disclosure dibuka menggunakan Enter keyboard, dan diukur pada 320, 360, serta 412 CSS px. Setelah viewport 320 stabil, lebar dokumen 320 px dan tidak ada elemen rincian yang melewati tepi; di 360/412 juga tidak ditemukan overflow. Target sentuh summary disclosure terukur 48 px. Ini emulasi Chromium, bukan uji perangkat fisik.

## Risiko yang tersisa

- Samsung Internet pada perangkat fisik belum diuji ulang setelah koreksi. Emulasi Chromium tidak membuktikan perilaku browser/perangkat Samsung.
- Screen reader dan sentuhan fisik belum diuji pada perangkat. Disclosure menggunakan kontrol HTML native; checklist manual tetap perlu dilakukan sebelum menandai kompatibilitas Samsung Internet lulus.
- Hasil parsial tetap tidak tersedia bila sesi ditinggalkan, sesuai batasan tanpa persistence.

STOP untuk review manusia. Tidak ada commit/push.