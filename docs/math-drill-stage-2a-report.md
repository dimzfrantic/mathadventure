# Math Drill — Laporan Implementasi Tahap 2A

Tanggal verifikasi: 11 Oktober 2026  
Status: PASS untuk scope Tahap 2A (generator, scoring engine, tests, documentation).  
Cakupan: TypeScript domain murni; tidak ada UI, persistence, timer, backend, atau integrasi luar.

## 1. Executive Summary

Tahap 2A mengimplementasikan generator Math Drill yang membangun pool kandidat secara deterministik, mengambil soal tanpa pengembalian, menghindari pengulangan key dalam sesi, membuat empat pilihan jawaban valid, membagi sesi ke ronde, dan mencatat metadata kuota Level 2. Scoring engine pure TypeScript mengelola maksimal dua jawaban, validasi state, skor berbobot, metrik penyelesaian, dan rekap kesalahan berdasarkan skill tag.

Keputusan blocker Level 2 telah diterapkan: rasio 70:30 menjadi target fleksibel yang dibulatkan dengan `floor(0.7 * count + 0.5)`. Jika pool bridge lebih kecil dari target, semua bridge yang tersedia dipakai lalu kekurangan jumlah diisi reinforcement. Dalam mode mixed, jumlah tiap operasi tetap seimbang; target bridge dialokasikan proporsional dan sisa target yang tidak tertampung suatu operasi dialihkan ke pool bridge operasi lain yang masih tersedia.

Enumerasi Level 2 menghasilkan 100 fakta penjumlahan (20 bridge + 80 reinforcement) dan 190 fakta pengurangan (36 bridge + 154 reinforcement). Angka 28 dari implementasi sebelumnya bukan jumlah seluruh fakta penjumlahan Level 2: angka itu berasal dari batas rasio ketat `floor(min(20 / 0.7, 80 / 0.3)) = 28`, yang memperlakukan 70:30 sebagai syarat kapasitas mutlak. Dengan target pembulatan/fleksibel, 29 soal masih dapat memakai 20 bridge dan 9 reinforcement, dan seluruh pool 100 kini dapat digunakan.

Verifikasi akhir: `npm test` lulus 150/150 test dalam 14 file; `npm run typecheck`, `npm run lint`, dan `npm run build` lulus.

## 2. File Implementasi dan Perubahan

File domain Math Drill:

- `src/features/math-drill/domain/types.ts` — tipe soal, sesi, hasil validasi/generator, state scoring, metrik, dan error terstruktur.
- `src/features/math-drill/domain/random.ts` — PRNG seeded, pemilihan integer tanpa modulo bias, dan Fisher–Yates shuffle.
- `src/features/math-drill/domain/generator.ts` — enumerasi kandidat, canonical keys, kapasitas, kuota Level 2, sampling, distraktor, posisi jawaban, sesi, ronde, dan metadata.
- `src/features/math-drill/domain/scoring.ts` — state transition dan metrik scoring murni.
- `src/features/math-drill/domain/index.ts` — ekspor API domain untuk pemakai selanjutnya.

Pengujian di lokasi yang dijalankan oleh konfigurasi Vitest proyek:

- `tests/math-drill-generator.test.ts`
- `tests/math-drill-scoring.test.ts`
- `tests/math-drill-benchmark.test.ts`

Dua file test domain yang sudah berada di `src/features/math-drill/domain/` juga diselaraskan dengan kontrak Level 2 dan dikompilasi TypeScript. Konfigurasi Vitest yang ada hanya memasukkan `./tests/**/*.test.{ts,tsx}`, sehingga kedua file test di bawah `src/` tidak dihitung sebagai bagian dari 150 test yang dieksekusi; kontrak yang dijalankan berada di `tests/`.

Tidak ada dependency/package yang ditambahkan. Tidak ada file konfigurasi yang diubah. Implementasi tidak dihubungkan ke `App.tsx` atau aktivitas belajar konsep. Pemeriksaan Git sebelum penulisan laporan menunjukkan perubahan lokal lain yang sudah ada di workspace, termasuk `src/App.tsx`, `tests/foundation.test.tsx`, dan beberapa file aktivitas/dokumentasi. Perubahan tersebut tidak disentuh oleh implementasi Math Drill ini. `git diff --check` lulus; hanya menampilkan peringatan line-ending untuk dua file lokal tersebut.

## 3. Definisi Matematis yang Diimplementasikan

| Level | Definisi soal |
|---|---|
| 1 | Operand positif; tambah operand 1–10 dan hasil ≤10; kurang minuend 2–10, subtrahend 1 sampai minuend−1, hasil positif. Nol dan hasil nol tidak masuk. |
| 2 tambah | Operand positif 1–20, hasil ≤20. Bridge jika kedua operand 1–9 dan jumlah >10; hasil tepat 10 adalah reinforcement. Semua fakta tambah lain reinforcement. |
| 2 kurang | `a>b`, operand positif ≤20, hasil positif. Bridge jika minuend 11–19, subtrahend 2–9, hasil 1–9, dan digit satuan minuend lebih kecil dari subtrahend. Semua pengurangan Level 2 valid lain adalah reinforcement. |
| 3 | Kedua operand 10–99. Penjumlahan tidak membawa pada kolom mana pun dan hasil ≤99. Pengurangan positif tanpa borrow pada satuan; hasil ≤99. |
| 4 | Kedua operand dua digit. Penjumlahan memerlukan carry satuan dan hasil ≤99. Pengurangan positif memerlukan borrow satuan; hasil ≤99. Hasil 100 dikeluarkan. |
| 5 | Nilai-hilang satu langkah: `□ + k = s`, `□ − b = c`, atau `a − □ = c`, dengan angka diketahui dan nilai hilang 10–99, nilai persamaan ≤100, hasil positif. Tidak ada hasil-hilang biasa atau persamaan multi-langkah. |

Kanonisasi: key tambah memakai operand terurut naik; key kurang mempertahankan urutan minuend–subtrahend. Level 5 memasukkan operasi, bentuk blank, dan nilai diketahui yang membedakan persamaan. Setiap key hanya boleh muncul sekali di keseluruhan sesi, juga ketika sesi dibagi menjadi ronde.

## 4. Kapasitas Aktual Kandidat Unik

Kapasitas dihitung dengan enumerasi integer menyeluruh dari definisi di atas. Penjumlahan komutatif dihitung sekali, pengurangan mempertahankan urutan. Pool menghitung bentuk soal, bukan jumlah nilai jawaban yang berbeda.

| Level | Tambah | Kurang | Mixed balanced maksimum |
|---|---:|---:|---:|
| 1 | 25 | 45 | 51 |
| 2 | 100 | 190 | 201 |
| 3 | 1.000 | 2.385 | 2.001 |
| 4 | 640 | 1.620 | 1.281 |
| 5 | 3.321 | 8.010 | 6.643 |

Mixed genap memakai jumlah operasi sama. Untuk jumlah ganjil, selisih operasi maksimum satu; soal ganjil tambahan dialokasikan ke operasi dengan pool kapasitas lebih besar (jika sama, tambah). Karena kapasitas pengurangan lebih besar pada level-level ini, kapasitas mixed maksimum adalah `2 × min(tambah, kurang) + 1`. Angka kapasitas mixed maksimum mencakup kemungkinan jumlah ganjil tersebut.

Level 4 penjumlahan 640 mengecualikan soal yang hasilnya 100. Kapasitas sebelumnya 676 memasukkan hasil 100 dan tidak sesuai definisi final Tahap 2A. Level 3 penjumlahan memakai hasil maksimal 99.

## 5. Kuota Level 2

### Enumerasi kategori

| Operasi | Bridge | Reinforcement | Total |
|---|---:|---:|---:|
| Penjumlahan | 20 | 80 | 100 |
| Pengurangan | 36 | 154 | 190 |

Jumlah soal bridge diuji berdasarkan predicate final secara langsung. Hasil tepat 10 pada penjumlahan bukan bridge. Pada pengurangan, aturan digit satuan dipenuhi eksplisit.

### Target dan bridge yang dapat dipenuhi

Target sesi: `floor(0.7 * jumlahSoal + 0.5)`. Untuk sesi satu operasi, generator memilih bridge hingga target atau batas kandidat; sisa soal dipenuhi reinforcement. Untuk mixed, jumlah tambah/kurang seimbang dan target bridge dialokasikan menurut jumlah soal per operasi. Jika pool bridge satu operasi mentok, target yang belum tercapai dialihkan ke operasi lainnya selama masih ada bridge valid.

| Jumlah | Target bridge | Aktual tambah saja | Aktual kurang saja | Aktual mixed |
|---:|---:|---:|---:|---:|
| 1 | 1 | 1 | 1 | 1 |
| 2 | 1 | 1 | 1 | 1 |
| 3 | 2 | 2 | 2 | 2 |
| 10 | 7 | 7 | 7 | 7 |
| 20 | 14 | 14 | 14 | 14 |
| 50 | 35 | 20 | 35 | 35 |
| 100 | 70 | 20 | 36 | 56 |

Contoh fleksibilitas: 50 soal tambah memiliki target 35 bridge, tetapi hanya 20 bridge tersedia; generator memakai 20 bridge dan 30 reinforcement, bukan menolak sesi atau mengubah jumlah soal. Untuk 100 mixed, alokasi awal 35 bridge per operasi; penjumlahan hanya dapat memasok 20, dan sisa target dialihkan ke pengurangan sampai 36 tersedia. Hasilnya 56 bridge dan 44 reinforcement; metadata menyimpan target 70, aktual 56, proporsi aktual 0,56, serta target/aktual tiap operasi.

## 6. Algoritma, Keunikan, dan Distractor

Urutan kerja generator:

1. Validasi level, mode, jumlah 1–500, seed uint32, dan ukuran ronde 1–20.
2. Enumerasi kandidat valid sesuai level dan operasi; kandidat Level 2 diberi tag bridge atau basic/reinforcement.
3. Bentuk key canonical stabil dan deduplicate berdasarkan key.
4. Periksa kapasitas aktual termasuk keseimbangan mixed dan kuota bridge fleksibel.
5. Sampling tanpa pengembalian dengan seeded Fisher–Yates. Tidak ada loop retry collision tanpa batas.
6. Mixed diinterleave agar operasi bergantian jika pool memungkinkan; tidak mengganti operasi atau menaikkan level demi memenuhi jumlah.
7. Buat tepat empat pilihan integer berbeda dalam domain jawaban; tiga distractor dibangun dari off-by-one, kesalahan operasi/relasi, atau fakta dekat, lalu fallback deterministik ke nilai terdekat yang sah.
8. Bagikan posisi jawaban benar dengan shuffled bag posisi 0–3 agar frekuensi tiap posisi berbeda paling banyak satu untuk setiap sesi.
9. Bentuk ronde berukuran default 10 (maksimum 20); ronde terakhir boleh lebih pendek. Keunikan tetap berlaku lintas ronde.
10. Validasi jumlah, key unik, serta kelayakan pilihan. Over-capacity dan kegagalan pembuatan distractor menghasilkan error terstruktur, tanpa sesi parsial.

Seed yang sama, parameter dan versi kode yang sama menghasilkan sesi identik. PRNG ini untuk reproduksibilitas, bukan kriptografi. Semua state generator murni; tidak mengakses React, DOM, storage, jaringan, atau backend.

## 7. Struktur Sesi dan Ronde

`DrillSession` memuat id sesi, seed, level, mode, seluruh daftar soal, array ronde, ukuran ronde, serta metadata kuota Level 2 (bila relevan). Setiap soal memuat canonical key, prompt string (termasuk `□` untuk Level 5), operand untuk verifikasi, jawaban benar, pilihan, indeks benar, dan skill tag. Soal seluruh sesi dibuat sebelum sesi dikembalikan.

## 8. Scoring Engine dan Metrik

State scoring memetakan canonical question key ke status, indeks jawaban yang diterima, dan poin. Setiap pemanggilan mengembalikan state baru tanpa memutasi state asal. Soal di luar sesi, state sesi yang tidak cocok, indeks invalid, pengiriman pilihan identik berulang, dan soal selesai ditolak. Benar pertama menyelesaikan soal dengan bobot 1; salah pertama membuat status menunggu kesempatan kedua; benar kedua menyelesaikan dengan bobot 0,5; salah kedua menyelesaikan dengan bobot 0. Tidak ada kesempatan ketiga. Jawaban benar tetap ada pada data sesi untuk UI berikutnya menampilkannya setelah dua kesalahan; belum ada UI reveal pada Tahap 2A.

Metrik:

- `planned`: jumlah soal dalam sesi.
- `completed`: benar pada percobaan pertama/kedua atau salah dua kali.
- `firstTryCorrect`, `secondTryCorrect`, `wrongTwice`: jumlah status hasil sesuai kategori.
- `unanswered`: soal yang belum pernah mendapat jawaban.
- `inProgress`: soal sudah dijawab salah sekali dan menunggu percobaan kedua; dibedakan dari belum dikerjakan.
- `firstTryAccuracy = firstTryCorrect / attemptedQuestions × 100`; penyebut hanya soal yang sudah mendapat sekurangnya satu jawaban. Soal kosong tidak masuk penyebut. Jika belum ada soal dicoba, metrik bernilai 0.
- `successWithinTwoAttempts = (firstTryCorrect + secondTryCorrect) / planned × 100`; penyebut seluruh sesi, sehingga soal belum dikerjakan tidak dianggap sukses.
- `weightedScore = (firstTryCorrect + 0.5 × secondTryCorrect) / planned × 100`; soal belum selesai berbobot nol tetapi statusnya terpisah dari salah dua kali.
- `errorsBySkillTag`: jumlah jawaban salah per skill tag; salah pertama yang kemudian dibetulkan tetap tercatat sebagai satu kesalahan.

## 9. Daftar Test dan Hasil

Perintah suite resmi: `npm test` → **14 file lulus, 150 test lulus, 0 gagal**.

Math Drill tests memeriksa:

- Kapasitas tiap level/mode, termasuk kapasitas balanced mixed untuk jumlah ganjil.
- Kapasitas bridge/reinforcement Level 2 dengan enumerasi predicate.
- Kuota untuk jumlah 1, 2, 3, 10, 20, 50, dan 100 pada addition, subtraction, dan mixed.
- Pengalihan target yang tidak tercapai karena bridge addition habis; metadata target/aktual dan proporsi aktual.
- Mixed seimbang dan target proporsional lintas operasi.
- Jumlah custom 1, 10, 20, 30, 50, 100, 500 lintas level/mode, capacity−1/capacity/capacity+1 ketika berada dalam rentang teknis, dan error kapasitas.
- Seed deterministik, keunikan key, keunikan lintas ronde, 4 pilihan berbeda, satu jawaban benar, domain jawaban, persamaan, dan posisi jawaban seimbang.
- Invariant pada 100 seed tetap untuk sesi Level 4 mixed.
- Scoring benar pertama, benar kedua, dua kali salah, third attempt/repeat ditolak, soal tak diketahui, indeks invalid, state immutable, metrik dan denominator.
- Benchmark test memastikan sesi berhasil dengan ukuran sesuai; bukan test yang sekadar mencetak hasil.

Perintah test benchmark terpisah: `./node_modules/.bin/vitest run tests/math-drill-benchmark.test.ts --silent=false` → 1 test lulus. Waktu satu kali panggilan yang terukur pada sesi ini:

| Kombinasi | Durasi |
|---|---:|
| Level 2 addition, 10 soal | 2,869 ms |
| Level 2 addition, 50 soal | 0,933 ms |
| Level 2 addition, 100 soal | 1,078 ms |
| Level 5 mixed, 500 soal | 19,550 ms |

Ini microbenchmark sederhana satu pemanggilan per kombinasi pada lingkungan development, bukan benchmark perangkat Android atau jaminan performa produksi. Waktu 10 soal lebih tinggi daripada 50/100 karena noise/warm-up; jangan menafsirkan satu sampel sebagai kurva performa.

## 10. Hasil Typecheck, Lint, dan Build

- `npm run typecheck` → exit 0, `tsc -b --pretty false` tanpa diagnostic.
- `npm run lint` → exit 0, Oxlint tanpa warning.
- `npm run build` → exit 0; Vite 8.3.4 membangun client, 28 modules transformed. Bundel tercatat CSS 21,82 kB (gzip 5,79 kB), JavaScript 246,21 kB (gzip 75,40 kB).
- `git diff --check` → exit 0. Peringatan line-ending yang ditampilkan berasal dari file workspace yang telah berubah sebelumnya, bukan file feature Math Drill.

## 11. Contoh Sesi 10 Soal (Seed 20261011)

Sesi contoh berasal dari `generateSession({ level: 1, mode: 'mixed', count: 10, seed: 20261011 })`. Format: soal — pilihan `[... ]` — jawaban benar ditandai indeks 0-based.

| # | Soal | Pilihan | Indeks benar |
|---:|---|---|---:|
| 1 | 4 − 3 | 7, 1, 2, 3 | 1 |
| 2 | 1 + 9 | 7, 10, 8, 9 | 1 |
| 3 | 9 − 3 | 6, 4, 5, 7 | 0 |
| 4 | 1 + 3 | 4, 5, 2, 3 | 0 |
| 5 | 6 − 4 | 2, 3, 10, 1 | 0 |
| 6 | 2 + 6 | 7, 8, 6, 9 | 1 |
| 7 | 8 − 6 | 4, 1, 2, 3 | 2 |
| 8 | 4 + 4 | 4, 9, 7, 8 | 3 |
| 9 | 10 − 6 | 5, 2, 3, 4 | 3 |
| 10 | 2 + 7 | 10, 8, 9, 7 | 2 |

Semua sepuluh canonical key berbeda; operasi seimbang 5/5; frekuensi indeks benar 0:3, 1:3, 2:2, 3:2.

## 12. Contoh Perhitungan Scoring

Contoh sesi 4 soal: satu benar percobaan pertama, satu salah dahulu lalu benar, satu salah dua kali, dan satu belum dikerjakan.

- `planned=4`, `completed=3`, `firstTryCorrect=1`, `secondTryCorrect=1`, `wrongTwice=1`, `unanswered=1`, `inProgress=0`.
- `firstTryAccuracy = 1 / 3 attempted ×100 = 33,33%` (soal belum dikerjakan dikecualikan; salah dua kali dan benar-kedua tetap pernah dicoba).
- `successWithinTwoAttempts = (1+1) / 4 ×100 = 50%`.
- `weightedScore = (1 + 0.5×1) / 4 ×100 = 37,5%`.
- Kesalahan ditambahkan per jawaban salah dan diklasifikasikan ke setiap skill tag soal.

## 13. Keterbatasan dan Risiko yang Tersisa

- Level 5 membutuhkan uji keterpahaman anak pada tahap UI sebagaimana keputusan produk; simbol `□` belum diuji dengan anak.
- Distractor disusun secara aritmetis dan fallback domain; tidak ada studi empiris bahwa setiap distractor memetakan miskonsepsi anak tertentu.
- Seed deterministik mudah direproduksi dan dapat menghasilkan sesi identik bila seed/input sama; lintas sesi seed baru menjadi tanggung jawab pemanggil di tahap berikutnya.
- `firstTryAccuracy` adalah akurasi per soal yang telah dicoba, bukan angka penyelesaian sesi; UI harus menampilkan metrik terpisah dengan label yang jelas.
- Pada Level 2 dengan sesi besar, proporsi aktual dapat jauh di bawah target karena bridge pool finite; metadata memungkinkan UI/analitik lokal menjelaskan hal ini.
- Pool aktual bergantung pada kebijakan final angka nol dan predicate yang disetujui; perubahan definisi menuntut update kapasitas/test.
- Waktu benchmark tidak mengukur Android fisik, render UI, atau pengalaman anak.
- Files `src/features/math-drill/domain/*.test.ts` tidak dieksekusi package script saat ini karena glob Vitest proyek mengarah hanya ke `tests/`; test otoritatif feature yang dihitung/lulus ada di folder `tests/`. Tidak ada konfigurasi Vitest yang diubah karena scope melarangnya.

## 14. Rekomendasi Tahap 2B

Tahap 2A selesai pada domain logic. Sebelum implementasi UI Tahap 2B:

1. Uji keterpahaman prompt Level 5 (`□ + k = s`, `□ − b = c`, `a − □ = c`) dengan anak dan orang tua; jangan menganggap kelulusan generator sebagai validasi pedagogis.
2. Tentukan tampilan jawaban benar setelah dua kesalahan dan feedback yang tidak menghukum.
3. Rancang ronde 10 soal (maksimum 20) dengan pilihan keluar/jeda yang sesuai, tanpa mengubah aturan scoring.
4. Integrasikan UI melalui `domain/index.ts`; jaga state UI terpisah dari fungsi generator/scoring dan jangan menghubungkan ke learning evidence aktivitas konsep tanpa persetujuan terpisah.
5. Uji aksesibilitas/keyboard, Android viewport, keterbacaan, opsi jawaban, dan regression proyek sebelum menyatakan siap digunakan anak.

Tahap 2A berhenti di sini. Tidak ada implementasi UI, timer, PIN, hadiah, persistence, backend, cloud, deployment, commit, atau push.
