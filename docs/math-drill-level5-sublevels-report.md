# Laporan implementasi Level 5 bertingkat — Math Drill

Status: implementasi selesai untuk review manusia. Cakupan hanya latihan Level 5; tidak ada Final Challenge, persistence, PIN, timer pengerjaan, hadiah, atau perubahan modul konsep.

## Ringkasan implementasi

Level 5 “Cari Angka” memiliki pilihan Dasar (seluruh angka persamaan 1–10), Menengah (1–20), dan Lanjutan (kontrak Level 5 Tahap 2A). UI menampilkan pemilih sublevel hanya ketika Level 5 dipilih, dengan default Dasar setiap kali Level 5 baru dipilih. Pilihan disalin ke request dan sesi saat mulai; kontrol konfigurasi tidak tersedia selama sesi. `Latihan lagi` mengembalikan sublevel ke Dasar sebagai default sesi baru. Soal tetap satu per layar dengan empat pilihan, dua kesempatan, dan auto-advance 700 ms setelah jawaban benar; dua jawaban salah tetap memerlukan tombol Lanjut. Rendering kotak kosong dan CSS-nya tidak diubah.

## File yang diubah

- `src/features/math-drill/domain/types.ts`: tipe sublevel opsional pada request/sesi.
- `src/features/math-drill/domain/index.ts`: ekspor tipe sublevel.
- `src/features/math-drill/domain/generator.ts`: pool Dasar/Menengah, pemilihan sublevel dan kapasitas, validasi, metadata sesi, serta legacy Lanjutan.
- `src/features/math-drill/MathDrillApp.tsx`: kontrol sublevel kondisional, default, validasi dan pengiriman pilihan.
- `tests/math-drill-level5-sublevels.test.ts` (baru): domain, batas, pilihan, seed, kompatibilitas.
- `tests/math-drill-ui.test.tsx`: pemilih sublevel, validasi kapasitas, auto-advance dan setengah kredit.
- `docs/math-drill-level5-sublevels-report.md` (baru): laporan ini.

Tidak ada perubahan pada scoring engine, `random.ts`, CSS Math Drill, Level 1–4, modul konsep, dependency, atau konfigurasi test/build. Tidak ada commit/push; file workspace lain yang sudah berubah/tidak terlacak dibiarkan.

## Kontrak domain dan API

Tipe baru `Level5Sublevel = 'dasar' | 'menengah' | 'lanjutan'`. `generateSession({level:5, level5Sublevel?, mode, count, seed, roundSize?})`, `validateRequest({level:5, level5Sublevel?, mode, count})`, dan `getCapacity(5, mode, level5Sublevel?)` menerima parameter opsional. Tanpa parameter, Level 5 tetap memakai Lanjutan persis seperti API lama. Request eksplisit menyimpan `session.level5Sublevel`; request lama mempertahankan bentuk sesi lama. ID sesi Dasar/Menengah diberi suffix sublevel sehingga tidak berbagi ID dengan Lanjutan/legacy pada seed, mode dan jumlah yang sama. Key soal dan prompt Lanjutan lama tidak diubah; deduplikasi key/prompt berlaku dalam satu sesi. Level 1–4 tetap melewati algoritme lama.

Dasar/Menengah memakai integer positif: untuk `□ + b = c`, `x+b=c≤N`; untuk `□ − b = c` dan `a − □ = c`, `1≤b<a≤N` serta `c=a−b≥1` (N=10/20). Pilihan jawaban adalah empat integer berbeda dalam 1–N dan tepat satu benar. Distractor tidak diwajibkan menghasilkan persamaan valid saat disubstitusi. Lanjutan tetap mengikuti pool lama: tambah `10≤missing,known≤99`, jumlah `≤100`; kurang `10≤subtrahend<minuend≤99`, selisih positif termasuk satu digit; opsi 10–99. Mode mixed mempertahankan keseimbangan operasi yang sudah ada. `count` tetap 1–500; kapasitas di bawah adalah ukuran pool matematis, bukan izin meminta lebih dari 500 soal.

## Kapasitas hasil pengujian

| Sublevel | Tambah | Kurang (`□−b` + `a−□`) | Total pool | Kapasitas mixed seimbang |
|---|---:|---:|---:|---:|
| Dasar | 45 | 90 (45+45) | 135 | 91 |
| Menengah | 190 | 380 (190+190) | 570 | 381 |
| Lanjutan | 3.321 | 8.010 (4.005+4.005) | 11.331 | 6.643 |

Tes mengunci nilai `getCapacity` setiap operasi/sublevel; sesi penuh Dasar/Menengah pada tambah dan kurang diverifikasi untuk batas, prompt unik, dan tiga bentuk. Untuk pool besar, pembuatan sesi dibatasi maksimum 500 sesuai kontrak request. Dasar addition 45 valid dan 46 ditolak; subtraction 90 valid dan 91 ditolak; mixed 91 valid (45 tambah, 46 kurang) dan 92 ditolak. Menengah addition 190 valid dan 191 ditolak; subtraction 380 valid dan 381 ditolak. Permintaan di atas 500 ditolak oleh batas global `INVALID_COUNT`, meskipun ukuran pool lebih besar.

## Verifikasi

- `npm test`: 16 file, 192/192 tes lulus.
- `npm run typecheck`: lulus.
- `npm run lint`: lulus tanpa temuan.
- `npm run build`: lulus.
- `git diff --check`: lulus. Karena file Math Drill belum terlacak dalam repositori awal, keenam file kode/test terkait juga diperiksa dengan `git diff --no-index --check` terhadap `/dev/null`.
- Browser Chromium lokal: konfigurasi Level 5 dan sembilan kombinasi sublevel × mode diperiksa pada viewport 320, 360, 412 CSS px (27 pengukuran soal). `documentElement.scrollWidth` sama dengan lebar viewport di semua kombinasi; empat pilihan dan label accessible “kotak kosong” ada. Lebar visual kotak ±31,64 px pada 320/360 dan ±34,11 px pada 412. Screenshot konfigurasi dan soal pada 320 px diperiksa. Pengukuran ini bukan uji perangkat fisik Samsung Internet.

## Risiko dan keterbatasan

- Uji fisik Samsung Internet/Android untuk pemilih baru masih perlu dilakukan orang tua. Emulasi Chromium tidak membuktikan rendering native Samsung Internet.
- Kapasitas besar Lanjutan adalah kapasitas enumerasi pool; satu sesi aplikasi dibatasi 500 soal. Tes session 500 dan regresi legacy ada, tetapi tidak ada sesi >500 yang dijalankan karena validator memang menolaknya.
- Label Lanjutan tidak mengklaim bahwa semua angka persamaannya 10–99: jumlah penjumlahan dapat 100 dan selisih pengurangan dapat satu digit, sesuai kontrak lama.
- Tidak ada penyeimbangan eksplisit antara dua bentuk pengurangan atau progres pedagogis otomatis. Kedua bentuk dihasilkan dari pool yang sama seperti kebijakan generator yang ada.

## Checklist uji manual orang tua

- [ ] Pada PC, pilih Level 5; pastikan sublevel default Dasar dan dropdown Dasar/Menengah/Lanjutan dapat dipilih.
- [ ] Ganti Level 5 → level lain → Level 5; pastikan kembali default Dasar. Pastikan sublevel tidak muncul di level lain.
- [ ] Pilih Dasar, tambah, jumlah custom 46; pastikan ditolak dengan kapasitas 45. Ubah ke Menengah; pastikan jumlah 46 dapat dimulai.
- [ ] Di masing-masing sublevel, coba mode tambah, kurang, dan campuran; periksa kotak tetap sejajar, empat opsi terbaca, dan angka Dasar/Menengah tidak melampaui batasnya.
- [ ] Jawab benar pada percobaan pertama dan kedua: feedback “Benar!” tanpa tombol Lanjut, perpindahan otomatis sekitar 700 ms; skor percobaan kedua tetap 0,5.
- [ ] Jawab salah dua kali: jawaban benar tampil dan tombol Lanjut diperlukan.
- [ ] Cek sesi terakhir, ronde, kembali/konfirmasi keluar, serta `Latihan lagi`; sublevel tidak dapat berubah di tengah sesi.
- [ ] Ulangi pada Samsung Internet fisik dalam portrait/landscape dan layar sempit: tidak ada scroll horizontal, select dapat diketuk, target jawaban tidak terpotong, dan fokus/label kotak kosong terbaca bila memakai pembaca layar.

STOP untuk review manusia.
