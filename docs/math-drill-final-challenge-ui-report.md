# Math Adventure — Final Challenge Stage 2: laporan UI

Status: implementasi UI selesai; menunggu review manusia. Tidak ada perubahan pada generator, scoring engine, kebijakan kuota, domain types, atau modul konsep.

## 1. Ringkasan implementasi

Math Drill kini menyediakan dua mode yang dipilih secara jelas: **Latihan Biasa** dan **Tantangan Campuran**. Layar konfigurasi challenge membolehkan orang tua memilih satu atau lebih level, operasi tambah/kurang/campuran, serta preset 10/20/30/50 soal. Ketika Level 5 dipilih, sublevel Dasar/Menengah/Lanjutan harus dipilih eksplisit.

Preview menggunakan `validateChallengeRequest` untuk menampilkan konfigurasi feasible/tidak feasible dan kuota aktual per level, sublevel, serta operasi. Tombol mulai dinonaktifkan jika domain menolak konfigurasi. Bila tidak feasible, UI menampilkan alasan dan pilihan jumlah feasible yang dapat dipilih manual; tidak mengganti nilai atau kategori secara otomatis.

Sesi menggunakan empat pilihan dan scoring domain yang sama (benar pertama 1, benar kedua 0,5, dua jawaban salah 0). Jawaban benar mengunci pilihan, menampilkan “Benar!” selama 700 ms, kemudian lanjut otomatis; jawaban salah pertama membuka kesempatan kedua, dan dua jawaban salah menampilkan jawaban benar dengan tombol “Lanjut”. Transisi akhir ronde dan konfirmasi keluar tersedia. Tidak ada timer pengerjaan, persistence, PIN, reward, ranking, atau diagnosis kemampuan.

Layar hasil menampilkan skor berbobot dengan numerator/denominator, akurasi percobaan pertama dengan numerator/denominator, soal selesai/belum dijawab, serta rekap per level, sublevel Level 5, dan operasi. Grup kosong ditampilkan sebagai N/A atau disembunyikan secara konsisten.

## 2. File yang diubah

- `src/features/math-drill/MathDrillApp.tsx` — pemilih mode; alur Latihan Biasa yang ada tetap dipertahankan.
- `src/features/math-drill/ChallengeApp.tsx` — UI konfigurasi, preview, pengerjaan, konfirmasi keluar, ronde, dan hasil yang memakai API domain Stage 1.
- `src/features/math-drill/math-drill.css` — styling mode, checklist, preview, alternatif manual, dan breakdown hasil; target sentuh dan blank responsif tetap memakai aturan yang ada.
- `tests/math-drill-challenge-ui.test.tsx` — tes UI challenge.
- `docs/math-drill-final-challenge-ui-report.md` — laporan ini.

Tidak ada dependency baru. Tidak ada commit atau push. File workspace yang sebelumnya berubah/tidak terlacak di luar scope tidak dibersihkan atau ditimpa.

## 3. Alur UI

1. Dari Math Drill pilih Latihan Biasa atau Tantangan Campuran. Tombol mode menggunakan `aria-pressed`.
2. Di challenge pilih level dan operasi. Jika Level 5 dicentang, pilih setidaknya satu sublevel secara eksplisit.
3. Pilih jumlah soal. Panel preview menampilkan pilihan saat ini dan kuota dari validasi domain.
4. Jika invalid, baca alasan, perbaiki pilihan secara manual atau pilih salah satu preset feasible. Tombol Mulai tetap nonaktif sampai valid.
5. Kerjakan satu soal tiap layar. Tombol pilihan terkunci selama feedback benar. Pada 10 soal, tombol Lanjut ronde muncul; setelah soal terakhir, layar hasil tampil.
6. Tombol Kembali pada sesi aktif meminta konfirmasi. Menyetujui keluar menghentikan sesi; callback auto-advance dibersihkan.
7. Hasil menampilkan rasio dan denominator eksplisit, kategori yang memiliki soal, dan N/A untuk sublevel kosong.

Aksesibilitas: kontrol native checkbox/select/button, fieldset/legend untuk grup pilihan, label input, status feedback `aria-live`, progress label, heading fokus setelah transisi, dan dialog keluar `alertdialog`.

## 4. Hasil pengujian

- `npm test`: **219/219 lulus**, 18 file.
- `npm run typecheck`: lulus.
- `npm run lint`: lulus.
- `npm run build`: lulus, 37 modul ditransformasi.
- `git diff --check`: lulus. Peringatan Git line-ending muncul pada file `src/App.tsx` dan `tests/foundation.test.tsx` yang sudah dirty sebelum pekerjaan ini; keduanya tidak diubah untuk Stage 2.
- Tes UI challenge mencakup navigasi mode, sublevel eksplisit dan invalid, alternatif count manual tanpa perubahan diam-diam, preview quota, empat pilihan, benar/salah, retry dan scoring 0,5, auto-advance, penguncian/double tap, ronde, hasil kategori, N/A, dan konfirmasi keluar/timer cleanup. Full suite juga mencakup regresi Math Drill dan modul konsep.
- Browser Chromium lokal: konfigurasi dan hasil challenge diperiksa pada 320, 360, dan 412 CSS px. `document.documentElement.scrollWidth` sama dengan lebar viewport pada masing-masing ukuran; pemeriksaan elemen di layar hasil tidak menemukan elemen melewati batas kanan viewport. Challenge default Level 1 diselesaikan melalui browser hingga layar hasil. Ini adalah emulasi Chromium, bukan validasi perangkat fisik.

## 5. Risiko dan keterbatasan

- Samsung Internet fisik belum tersedia untuk pengujian pada tahap ini. Jangan anggap hasil emulasi Chromium sebagai bukti kompatibilitas perangkat Samsung; lakukan checklist manual di bawah.
- Validasi kapasitas menghitung alokasi domain saat render. Tidak ditemukan masalah kinerja pada konfigurasi yang diperiksa, tetapi konfigurasi terberat (semua level/sublevel dan 50 soal) sebaiknya diuji pada ponsel Android kelas rendah.
- Hasil hanya muncul setelah semua soal challenge dijawab; sesi parsial yang ditinggalkan tetap tidak disimpan, sesuai larangan persistence.
- Domain Stage 1 memberi kapasitas feasible untuk preset tertentu; UI mengikuti hasil itu dan tidak mengubah alokasi domain. Perilaku quota tetap menjadi kontrak Stage 1.

## 6. Checklist pengujian manual PC dan Samsung Internet

### PC — Chrome/Chromium

- [ ] Masuk Math Drill; kedua mode tersedia dan tombol mode aktif ditandai.
- [ ] Latihan Biasa Level 1–5 masih dapat dikonfigurasi dan dikerjakan.
- [ ] Pada Tantangan Campuran, pilih kombinasi level 1–4 dan operasi tunggal/campuran; preview quota sesuai pilihan.
- [ ] Pilih Level 5 tanpa sublevel; Mulai nonaktif dan alasan mudah dipahami.
- [ ] Pilih satu atau lebih sublevel Level 5; preview per sublevel berubah berdasarkan validasi domain.
- [ ] Coba konfigurasi tak feasible; nilai pilihan tidak berubah sendiri dan alternatif count dapat dipilih manual.
- [ ] Jawaban benar (percobaan pertama dan kedua) memunculkan feedback dan maju setelah sekitar 700 ms; pilihan tidak dapat diklik ganda.
- [ ] Jawaban salah pertama memberi kesempatan kedua; jawaban salah kedua menampilkan jawaban dan menunggu Lanjut.
- [ ] Selesaikan ronde dan pastikan transisi berikutnya benar; selesaikan sesi dan periksa hasil denominator/N/A.
- [ ] Buka dialog keluar saat feedback/timer aktif; tetap latihan membatalkan keluar, konfirmasi keluar tidak memicu transisi tertunda.
- [ ] Gunakan Tab, Shift+Tab, Enter, dan Space untuk mengoperasikan kontrol dan konfirmasi.

### Android — Samsung Internet

- [ ] Ulangi konfigurasi, valid/invalid, preview, dan pemilihan alternatif di viewport perangkat nyata.
- [ ] Pastikan tidak ada scroll horizontal pada konfigurasi, soal Cari Angka, dialog keluar, ronde, dan seluruh bagian hasil.
- [ ] Periksa checkbox dan semua tombol nyaman disentuh; keyboard virtual tidak menutupi kontrol yang sedang digunakan.
- [ ] Periksa feedback/live announcement, fokus setelah pergantian soal, dan navigasi dengan screen reader bila tersedia.
- [ ] Uji auto-advance sekitar 700 ms, double tap, pause/resume tab, serta keluar saat timer berjalan.
- [ ] Catat model perangkat, versi Android, versi Samsung Internet, viewport, dan temuan sebelum menyatakan PASS.

STOP untuk review manusia. Tidak ada commit/push.