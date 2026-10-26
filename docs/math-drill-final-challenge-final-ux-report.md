# Math Adventure — Final UX Refinement: hasil Tantangan Campuran

Status: implementasi selesai; berhenti untuk review manusia. Perubahan dibatasi pada presentasi hasil dan CSS. Domain engine, generator, scoring, kuota, dan struktur data hasil tidak diubah.

## 1. Ringkasan perubahan

- Menghapus kicker kecil “TANTANGAN SELESAI”; halaman hasil sekarang hanya memiliki satu judul utama “Tantangan Selesai!”. Kalimat berikutnya memakai `summary.overall.completed` agar jumlah soal berasal dari sesi, bukan konstanta.
- Mengganti label kartu skor menjadi “Nilai latihan”. Persentase dan poin masih diformat dari `getChallengeSummary` (`weightedScore.value`, numerator, denominator), dengan pembulatan `Math.round` seperti UI sebelumnya dan format angka Indonesia.
- Mengubah dua statistik utama menjadi kartu bernilai besar di atas label, rata tengah, dua kolom, tinggi minimum sama, dan teks yang membungkus pada lebar sempit.
- Mengganti tabel statistik orang tua dengan kartu-kartu ringkas yang berisi nilai berbobot, progress bar, serta jumlah benar pada percobaan pertama dari numerator/denominator metrik domain.
- Hanya menampilkan level dan sublevel yang memiliki soal. Bagian Cari Angka hanya ada saat Level 5 berisi soal. Bagian per jenis soal hanya ada untuk sesi Campuran dan mengambil jenis operasi dari metadata soal sesi.
- Menampilkan penjelasan scoring satu kali di akhir rincian orang tua.
- Disclosure native `<details>/<summary>` tetap tertutup secara default; ukuran summary minimal 48 CSS px dan fokus keyboard terlihat.

## 2. Daftar file yang diubah

- `src/features/math-drill/ChallengeApp.tsx` — presentasi hasil, kartu statistik/rincian, progress yang bersumber dari metrik domain, dan label operasi.
- `src/features/math-drill/math-drill.css` — geometri kartu, tata letak responsif, progress bar, dan disclosure.
- `tests/math-drill-challenge-ui.test.tsx` — tes judul/statistik, poin setengah, kartu per level/sublevel/operasi, progress, disclosure, dan kategori yang kosong.
- `docs/math-drill-final-challenge-final-ux-report.md` — laporan ini.

Tidak ada dependency baru. Tidak ada file di luar scope yang saya ubah dalam tugas ini. Tidak ada commit atau push.

## 3. Struktur UI hasil yang baru

1. Judul utama “Tantangan Selesai!” dan kalimat jumlah soal selesai dari ringkasan domain.
2. Kartu “Nilai latihan” dengan persentase berbobot besar dan teks poin, misalnya `9,5 dari 10 poin`.
3. Dua kartu statistik seimbang: angka `Benar langsung` dan format `selesai/direncanakan` untuk `Soal selesai`; angka serta label ditengahkan.
4. Pesan motivasi singkat tanpa klaim kemampuan.
5. Disclosure “Rincian untuk orang tua”, tertutup default. Isinya kartu per level, opsional kartu per sublevel Cari Angka, dan opsional kartu per jenis soal (Penjumlahan/Pengurangan). Kartu menunjukkan “Nilai latihan” dalam teks dan progress bar berlabel aksesibel.
6. Satu catatan scoring di bagian bawah rincian.

`getChallengeSummary` tetap menjadi satu-satunya sumber skor, akurasi percobaan pertama, dan denominator. Nilai progress memakai persentase domain sebelum pembulatan presentasi; hanya teks persentasenya yang dibulatkan. Kategori tanpa soal tidak dirender.

## 4. Hasil pengujian otomatis

- `npm test`: **220/220 lulus**, 18 file.
- `npm run typecheck`: lulus.
- `npm run lint`: lulus.
- `npm run build`: lulus; Vite mentransformasi 37 modul.
- `git diff --check`: exit code 0. Git memberi peringatan line ending CRLF untuk `src/App.tsx` dan `tests/foundation.test.tsx`; keduanya berada di luar scope refinement ini.
- Tes UI menguji bahwa nilai setengah tampil sebagai `9,5 dari 10 poin` dan 95%; kartu Level 1 memakai numerator percobaan pertama `9 dari 10`, progress `95/100`, dan label aksesibel `95%`. Tes juga memverifikasi kartu sublevel kosong tidak muncul, sesi tambah saja menyembunyikan bagian jenis soal, sesi Campuran menunjukkan kedua jenis, disclosure dapat dibuka dan ditutup, serta navigasi Latihan Biasa tetap tersedia.

## 5. Hasil pemeriksaan responsivitas Chromium

Disclosure dibuka untuk pemeriksaan visual/layout. Tidak ditemukan horizontal overflow atau elemen hasil/progress yang melewati tepi pada viewport yang diuji.

- **320 CSS px:** dokumen 320 px; kartu statistik masing-masing 119 × 128 px; kartu rincian 230 px; progress 202 px.
- **360 CSS px:** dokumen 360 px; kartu statistik masing-masing 139 × 128 px; kartu rincian 270 px; progress 242 px.
- **412 CSS px:** dokumen 412 px; kartu statistik masing-masing 165 × 136 px; kartu rincian 310 px; progress 276 px.
- **Desktop 1280 CSS px:** tidak overflow; kartu statistik masing-masing 335 × 136 px; kartu rincian per level mengisi area yang tersedia dan dua kartu operasi tersusun berdampingan.

Chromium juga menguji Enter pada summary disclosure untuk menutupnya dan simulasi event sentuh untuk membukanya kembali. Ini bukti browser emulasi, bukan pengujian perangkat fisik.

## 6. Risiko atau keterbatasan

- Samsung Internet Android pada perangkat fisik belum diuji ulang. Rendering progress, font scaling, screen reader/TalkBack, dan sentuhan harus dikonfirmasi di perangkat target.
- Pemeriksaan desktop adalah Chromium dengan viewport desktop, bukan pengujian lintas-browser.
- Working tree sudah memiliki banyak file modified/untracked sebelum perubahan refinement ini. Folder `src/features/` dan sejumlah laporan/test yang terkait proyek juga berstatus untracked, sehingga Git tidak memiliki baseline tracked untuk menampilkan diff sumber tersebut. Saya tidak membersihkan atau mengubah file di luar scope; review perlu memeriksa file scope langsung.

## 7. Checklist pengujian manual Samsung Internet

Belum dijalankan pada perangkat fisik; tandai setelah verifikasi:

- [ ] Buka hasil sesi Campuran pada Samsung Internet Android dan pastikan hanya ada satu judul hasil.
- [ ] Verifikasi persentase/poin setelah jawaban benar pertama, benar kedua, dan salah dua kali; cek koma desimal, misalnya `9,5`.
- [ ] Pastikan dua kartu statistik sejajar, sama tinggi, angka di atas label, dan konten tidak terpotong pada 320, 360, dan 412 CSS px.
- [ ] Buka/tutup “Rincian untuk orang tua” dengan sentuhan; pastikan target mudah disentuh dan konten tetap dapat discroll.
- [ ] Jika tersedia keyboard eksternal, buka/tutup disclosure dengan Enter/Space dan periksa indikator fokus.
- [ ] Pastikan kartu per level/sublevel menunjukkan data dan denominator yang tepat; kategori tanpa soal tidak muncul sebagai 0%.
- [ ] Pastikan progress bar konsisten dengan persentase teks dan tidak menjadi satu-satunya penyampai nilai.
- [ ] Uji portrait/landscape, pembesaran teks, dan screen reader/TalkBack; pastikan tidak ada overflow atau informasi yang hilang.

STOP untuk review manusia. Tidak ada commit atau push.