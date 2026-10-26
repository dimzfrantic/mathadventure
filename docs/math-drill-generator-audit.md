# Math Drill — Audit Matematika & Kapasitas Generator Soal

Tanggal audit: 11 Oktober 2026
Status: ANALYSIS & DOCUMENTATION ONLY — belum disetujui untuk implementasi
Cakupan: definisi lima level, kapasitas soal unik, rancangan generator, dan rancangan test.
Sumber konteks proyek: `docs/learning-design-specification.md`, `docs/learning-interaction-specification.md`, dan `docs/educational-references.md`.

## 1. Executive Summary

Temuan utama:

1. Level 4 dan Level 5 saat ini belum berbeda secara matematis. `46 + 37` dan `83 - 48` memenuhi definisi Level 4 karena memerlukan carry/borrow; contoh itu sendiri tidak membuat Level 5 menjadi tantangan yang berbeda.
2. Untuk menghitung kapasitas secara reproduksibel, audit ini menetapkan satu domain eksplisit per level. Kapasitas dasar mengecualikan operand nol dan jawaban nol, menganggap penjumlahan komutatif, dan mempertahankan urutan operand pada pengurangan.
3. Dengan definisi tersebut, kapasitas penjumlahan terkecil adalah 25 soal (Level 1); kapasitas satu operasi terbesar adalah 8.010 soal (pengurangan Level 5 usulan). Campuran tanpa batas keseimbangan memiliki maksimum 11.331; campuran yang menjaga jumlah tambah dan kurang seimbang untuk jumlah soal genap memiliki maksimum 6.642.
4. Level 1 tidak memiliki cukup kandidat untuk 100 soal dalam mode mana pun. Level 1 dan Level 2 tidak memiliki cukup kandidat untuk 500 soal. Level 3–5 memiliki kapasitas matematika untuk 500 soal pada definisi audit ini, tetapi 500 soal tetap diklasifikasikan LIMITED sebagai satu sesi anak, bukan rekomendasi sesi.
5. Rekomendasi pembedaan Level 5: tetap satu langkah dan tetap dalam rentang 100, tetapi gunakan soal nilai-hilang yang menilai hubungan invers, misalnya `□ + 27 = 63`, `□ - 27 = 35`, atau `82 - □ = 46`. Ini mengubah keterampilan yang diuji tanpa menaikkan bilangan atau menambah langkah. Pilihan ini lebih abstrak dan memerlukan persetujuan serta uji keterpahaman anak sebelum menjadi keputusan produk.
6. Rekomendasi MVP: enumerasi kandidat lengkap yang kecil, beri tag keterampilan, lalu sampling tanpa pengembalian. Generator harus menolak permintaan di atas kapasitas sebelum sesi dimulai; jangan mencoba mengisi sesi melalui retry acak tanpa batas.

Status angka kapasitas: hasil enumerasi integer menyeluruh sesuai aturan yang dinyatakan pada laporan ini, bukan estimasi. Angka tersebut bersyarat pada definisi level yang masih membutuhkan persetujuan produk.

## 2. Temuan pada Definisi Level

### Level 1 — Dasar sampai 10

“Dasar sampai 10” belum menyatakan apakah operand nol, hasil nol, atau fakta identitas seperti `8 + 0` dan `8 - 0` termasuk. Memasukkan seluruh fakta nol menambah kapasitas, tetapi dapat membuat latihan didominasi soal identitas yang sangat mudah.

### Level 2 — Sampai 20

“Operasi melewati 10” belum menyatakan apakah setiap soal harus melintasi 10 atau hanya sebagian sesi. `8 + 7` adalah bridge-over-10; `10 + 5` bukan transisi yang sama. Pengurangan teen menuju satu digit, seperti `15 - 8`, menguji lintasan keterampilan lain. Level ini membutuhkan kuota/tag subketerampilan, bukan hanya batas angka.

### Level 3 — Dua digit tanpa menyimpan/meminjam

Istilah “dua digit” ditafsirkan sebagai kedua operand berada pada 10–99. Jika operand satu digit juga diizinkan, kapasitas meningkat substansial. “Tanpa menyimpan” juga perlu diuji per kolom: jumlah satuan tidak boleh mencapai 10 dan jumlah angka puluhan tidak boleh mencapai 10.

### Level 4 — Dua digit dengan menyimpan/meminjam

Level ini perlu menyatakan apakah hasil tepat 100 diperbolehkan. Sebanyak 36 soal penjumlahan valid dalam domain Level 4 audit menghasilkan 100 dan melibatkan carry dari satuan serta carry berikutnya ke ratusan. Jika yang diinginkan hanya satu regroup dari satuan ke puluhan dan hasil harus di bawah 100, kapasitas penjumlahan turun dari 676 menjadi 640.

### Level 5 — Tantangan sampai 100

Definisi saat ini tidak membatasi keterampilan baru. Jika Level 5 hanya mengulang dua digit dengan carry/borrow, kapasitasnya sama dengan Level 4 bila kandidatnya sama; angka yang lebih “sulit” bukan pembedaan pedagogis yang cukup.

### Nol dan soal trivial

Nol bukan otomatis tidak bernilai secara matematika. Namun, `0 + 0`, `a + 0`, `a - 0`, dan `a - a` dapat menjadi soal identitas atau hasil nol yang jauh lebih mudah daripada target latihan lainnya. Rekomendasi kapasitas dasar memisahkannya dari soal nontrivial. Jika orang tua menghendaki latihan nol, masukkan sebagai subketerampilan bertag dengan kuota eksplisit, bukan biarkan sampling acak memilihnya tanpa batas.

## 3. Rekomendasi Definisi Matematis untuk Ditinjau

Definisi berikut dipakai untuk menghitung tabel dasar. Ini rekomendasi audit yang menunggu persetujuan produk, bukan perubahan source maupun kebijakan final.

| Level | Domain operand dan hasil | Syarat keterampilan | Aturan nol/trivial pada kapasitas dasar |
|---|---|---|---|
| 1 | Tambah: operand bilangan bulat 1–10, hasil 2–10. Kurang: minuend 2–10, subtrahend 1 sampai minuend−1, hasil 1–9. | Fakta dasar di dalam 10. | Operand nol dan hasil nol dikecualikan. Penjumlahan tidak berurutan secara canonical; pengurangan berurutan. |
| 2 | Tambah: operand 1–20, hasil 2–20. Kurang: minuend 2–20, subtrahend 1 sampai minuend−1, hasil 1–19. | Pool mencakup fakta non-bridge serta bridge-over-10 untuk tambah dan teen-minus-satu-digit menuju satu digit untuk kurang. Tag/kuota memastikan subketerampilan penting muncul. | Nol dan hasil nol dikecualikan; tidak semua soal diwajibkan melintasi 10. |
| 3 | Kedua operand 10–99. Tambah: hasil ≤99, digit satuan tidak carry dan digit puluhan tidak carry. Kurang: minuend > subtrahend, hasil 1–89, digit satuan minuend ≥ satuan subtrahend sehingga tidak ada borrow. | Tidak ada regroup di kolom mana pun. | Operand nol tidak mungkin; hasil nol dikecualikan. |
| 4 | Kedua operand tambah 10–99, hasil ≤100; untuk kurang, minuend 10–99 dan subtrahend 10–98, hasil positif. | Tambah memerlukan carry satuan (`satuanA + satuanB ≥ 10`). Kurang memerlukan borrow (`satuan minuend < satuan subtrahend`). Hasil 100 diizinkan pada hitungan dasar; tag terpisah diperlukan untuk carry kedua ke ratusan. | Nol operand dan hasil nol tidak masuk pool. Hasil negatif selalu dilarang. |
| 5 (usulan) | Nilai yang dicari dan bilangan yang diketahui tetap pada 10–99; semua nilai persamaan ≤100. Tambah: `□ + k = s`, kedua addend 10–99, `s ≤ 100`. Kurang: `□ − b = c` atau `a − □ = c`, `10 ≤ b < a ≤ 99`, `c = a−b` dan `c ≥ 1`. | Satu langkah dengan nilai hilang; fokus pada relasi invers, bukan bilangan yang lebih besar atau multi-langkah. Posisi “hasil hilang” tidak dimasukkan karena itu bentuk langsung Level 3/4. | Persamaan dengan jawaban nol, operand nol, atau hasil negatif dikecualikan. Tampilan simbol/kalimat harus disetujui untuk anak. |

Kanonisasi:

- Soal tambah langsung memakai key `(level, add, min(a,b), max(a,b))`; jadi `7 + 5` dan `5 + 7` satu soal.
- Soal kurang langsung memakai key `(level, subtract, minuend, subtrahend)`; jadi `12 − 5` berbeda dari `12 − 7`.
- Soal nilai-hilang Level 5 memakai key yang memuat operasi, posisi blank, nilai yang diketahui, dan nilai total/hasil. Posisi blank yang berbeda adalah bentuk soal berbeda; posisi operand tambah yang hanya dibalik tidak menciptakan duplikat.
- Jawaban sama pada dua soal tidak menjadikan keduanya duplikat. Contoh: `8 + 2` dan `7 + 3` tetap dua soal.

### Alternatif yang mengubah kapasitas

| Pilihan definisi | Level/operasi | Kapasitas alternatif | Konsekuensi |
|---|---:|---:|---|
| Operand nol boleh, tetapi `0+0`, hasil nol, dan `0−0` tetap dikecualikan | L1 tambah/kurang | 35 / 55 | Bertambah dari 25/45 karena fakta `0+n` dan `n−0` masuk. |
| Operand nol boleh, termasuk hasil nol dan `0+0`/`0−0` | L1 tambah/kurang | 36 / 66 | Kapasitas naik, tetapi pool memuat soal identitas dan nol yang sangat trivial. |
| Operand nol boleh, tetapi hasil nol dikecualikan | L2 tambah/kurang | 120 / 210 | Bertambah dari 100/190. |
| Operand nol boleh termasuk hasil nol dan `0+0`/`0−0` | L2 tambah/kurang | 121 / 231 | Memasukkan seluruh fakta nol/identitas. |
| Level 3 juga menerima operand satu digit, tetapi syarat no-carry/no-borrow tetap berlaku | L3 tambah/kurang | 1.425 / 2.826 | Berbeda dari definisi “kedua operand dua digit”; level berisiko mencampur subketerampilan yang sudah ada di Level 1/2. |
| Level 4 hanya menerima hasil tambah di bawah 100 (tepat satu regroup ke puluhan) | L4 tambah | 640, bukan 676 | Mengeluarkan 36 soal yang hasilnya tepat 100 dan memerlukan carry ke ratusan. |
| Level 5 hanya mengulang operasi langsung Level 4 | L5 tambah/kurang | 676 / 1.620 | Tidak menciptakan pembedaan keterampilan atau kapasitas baru; hanya mengganti label. |

Jika Level 2 kelak menjadikan “melewati 10” kewajiban, kapasitas harus dihitung ulang untuk pool yang dibatasi pada skill tersebut. Pada subset audit ini terdapat 5 fakta tambah yang jumlahnya tepat 10, 20 fakta tambah unordered dengan jumlah >10 dan kedua operand satu digit, serta 36 fakta teen-minus-one-digit yang menghasilkan satu digit. Angka itu hanya subset dengan kriteria tag eksplisit di sini, bukan batas total Level 2.

## 4. Metodologi Perhitungan Kapasitas

Enumerasi dilakukan atas bilangan bulat dalam batas tertutup yang ditetapkan di bagian 3. Tidak ada sampling acak pada perhitungan kapasitas. Tidak ada file skrip sementara atau source proyek yang dibuat/diubah untuk audit ini; enumerasi dijalankan di lingkungan perhitungan sementara.

Rumus inti:

- Level 1/2 tambah: enumerasi semua pasangan `1 ≤ a ≤ b ≤ N` dengan `a+b ≤ N`. Batas `a ≤ b` menghapus pembalikan operand.
- Level 1/2 kurang: enumerasi semua pasangan `1 ≤ b < a ≤ N`; setiap pasangan ordered adalah satu soal.
- Level 3 tambah: enumerasi `10 ≤ a ≤ b ≤ 99`, `a+b ≤100`, `(a mod 10)+(b mod 10) <10`, dan `floor(a/10)+floor(b/10)<10`.
- Level 3 kurang: enumerasi `10 ≤ b < a ≤99` dengan satuan minuend ≥ satuan subtrahend; relasi puluhan juga tidak memerlukan borrow.
- Level 4 tambah: enumerasi `10 ≤ a ≤ b ≤99`, `a+b ≤100`, dan jumlah digit satuan ≥10.
- Level 4 kurang: enumerasi `10 ≤ b < a ≤99` dengan satuan minuend < satuan subtrahend.
- Level 5 tambah: untuk nilai diketahui `k=10..90`, enumerasi nilai hilang `x=10..100−k`; jumlahnya `Σ(k=10..90)(91−k)=1+2+…+81=3.321`.
- Level 5 kurang: ada `C(90,2)=4.005` pasangan dua-digit `a>b` dari 10–99; tiap fakta menghasilkan dua prompt unik, blank pada minuend atau subtrahend, sehingga `2 × 4.005 = 8.010`.
- Campuran: untuk jumlah soal genap dengan operasi yang berbeda paling banyak satu, kapasitas balanced maksimum `2 × min(kapasitas tambah, kapasitas kurang)`. Semua jumlah yang diminta (10, 20, 30, 50, 100, 500) genap.

Enumerasi melewati pemeriksaan assertion atas jumlah kandidat dan batas domain; semua assertion audit lulus. Kapasitas adalah jumlah bentuk soal yang berbeda menurut key di atas, bukan jumlah kemungkinan pilihan jawaban dan bukan klaim mengenai jumlah variasi yang dirasakan anak.

## 5. Tabel Kapasitas Soal Unik

“Campuran total” menjumlahkan pool tambah dan kurang tanpa batas keseimbangan. “Campuran balanced” adalah batas yang digunakan untuk validasi generator: untuk jumlah soal genap, jumlah tambah dan kurang sama.

| Level | Penjumlahan saja | Pengurangan saja | Campuran total | Campuran balanced maksimum |
|---|---:|---:|---:|---:|
| 1 | 25 | 45 | 70 | 50 |
| 2 | 100 | 190 | 290 | 200 |
| 3 | 1.000 | 2.385 | 3.385 | 2.000 |
| 4 | 676 | 1.620 | 2.296 | 1.352 |
| 5 — usulan nilai-hilang | 3.321 | 8.010 | 11.331 | 6.642 |

Pemeriksaan formula untuk Level 1/2:

- L1 tambah: `Σ floor(s/2)` untuk hasil `s=2..10` = 25 pasangan unordered.
- L1 kurang: `C(10,2)=45` pasangan bilangan positif berbeda.
- L2 tambah: `Σ floor(s/2)` untuk hasil `s=2..20` = 100 pasangan unordered.
- L2 kurang: `C(20,2)=190` pasangan bilangan positif berbeda.

Level 3/4 dihitung dengan enumerasi tiap pasangan sesuai aturan digit per kolom. Contoh batas yang masuk: L3 `49+50=99`, `12−10=2`; L4 `27+18=45`, `20−11=9`. Contoh batas yang ditolak: L3 `28+13` karena carry, `42−18` karena borrow; L4 `20+11` karena tidak carry dan `20−10` karena tidak borrow.

Level 5 menghindari duplikasi pengurangan dengan hanya memasukkan dua bentuk nilai-hilang, bukan bentuk `a−b=□` yang telah tercakup sebagai soal operasi langsung. Kunci key blank dan operand diketahui penting untuk menjaga jumlah tersebut.

## 6. Matriks Kelayakan 10–500 Soal

Definisi klasifikasi operasional audit (heuristik produk, bukan hasil studi anak):

- **UNSUPPORTED** jika jumlah yang diminta melampaui pool valid. Pada campuran, pool valid adalah kapasitas balanced.
- **SUPPORTED** jika jumlah tidak lebih dari 50 dan menggunakan ≤60% pool. Batas 50 menjaga ukuran satu sesi tetap pendek; batas 60% menyisakan pool untuk variasi dan ronde/sesi berikutnya.
- **LIMITED** jika secara matematis jumlahnya dapat dibentuk, tetapi melewati batas 50 soal atau menghabiskan terlalu banyak pool sehingga risiko sesi panjang/monoton tinggi.

Batas 50 dan 60% adalah kriteria audit eksplisit agar klasifikasi dapat direproduksi; kriteria tersebut belum divalidasi dengan uji anak dan membutuhkan persetujuan produk. Nilai 100/500 dapat lebih masuk akal sebagai panjang bank soal lintas sesi, bukan satu sesi tanpa jeda.

| Level / operasi | 10 | 20 | 30 | 50 | 100 | 500 |
|---|---|---|---|---|---|---|
| L1 tambah (pool 25) | SUPPORTED | LIMITED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| L1 kurang (pool 45) | SUPPORTED | SUPPORTED | LIMITED | UNSUPPORTED | UNSUPPORTED | UNSUPPORTED |
| L1 campuran balanced (pool 50) | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | UNSUPPORTED | UNSUPPORTED |
| L2 tambah (pool 100) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | UNSUPPORTED |
| L2 kurang (pool 190) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | UNSUPPORTED |
| L2 campuran balanced (pool 200) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | UNSUPPORTED |
| L3 tambah (pool 1.000) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L3 kurang (pool 2.385) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L3 campuran balanced (pool 2.000) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L4 tambah (pool 676) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L4 kurang (pool 1.620) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L4 campuran balanced (pool 1.352) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L5 tambah — nilai hilang (pool 3.321) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L5 kurang — nilai hilang (pool 8.010) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |
| L5 campuran balanced (pool 6.642) | SUPPORTED | SUPPORTED | SUPPORTED | SUPPORTED | LIMITED | LIMITED |

Ringkasan dukungan jumlah besar:

- **100 soal:** tidak didukung secara matematis oleh ketiga mode Level 1. Semua mode Level 2–5 memiliki pool yang cukup, tetapi 100 diklasifikasikan LIMITED sebagai satu sesi.
- **500 soal:** tidak didukung secara matematis oleh semua mode Level 1–2. Semua mode Level 3–5 memiliki pool cukup menurut definisi hitungan ini, tetapi tetap LIMITED sebagai satu sesi karena durasi, kelelahan, dan pengulangan struktur subketerampilan.
- **Campuran:** tabel memakai keseimbangan 50/50 untuk jumlah genap. Jika produk mengizinkan ketimpangan operasi yang lebih besar, kapasitas campuran total pada tabel kapasitas dapat dipakai, tetapi distribusi pembelajaran berubah dan perlu persetujuan.

## 7. Analisis Risiko Soal Monoton

1. Kapasitas unik tidak sama dengan variasi pedagogis. Ribuan operand dapat diuji dengan bentuk yang sama dan strategi yang sama.
2. L1 tambah mempunyai 25 soal; 20 soal memakai 80% pool. Hasil dan fakta yang sama dapat terasa berulang sebelum duplikasi literal terjadi.
3. L2 tambah mempunyai 100 soal; meminta 100 menghabiskan seluruh pool dan sangat mudah menjadi latihan pola jawaban daripada sesi pendek.
4. L3/L4 punya pool lebih besar karena bilangan bervariasi, tetapi hampir semua pertanyaan masih bentuk langsung bersimbol. Memperpanjang sesi ke 500 tidak otomatis memperluas pemahaman.
5. Mengulang jawaban benar yang sama tidak berarti pertanyaan duplikat, tetapi rangkaian panjang hasil yang sama dapat monoton. Pengurutan soal perlu menghindari streak hasil, operand, carry/borrow pattern, serta posisi jawaban yang berulang.
6. L5 nilai-hilang memiliki kapasitas tinggi, tetapi banyak item berbagi struktur; jangan menyamakan angka 8.010 dengan 8.010 pengalaman kognitif yang berbeda.
7. Untuk anak 8 tahun, durasi dan kebiasaan sesi belum diuji pada pengguna proyek. Rekomendasi awal audit adalah 10 soal per ronde, opsi 20 jika anak/orang tua memilih; 30–50 dibagi menjadi ronde pendek dengan jeda. 100/500 lebih cocok sebagai bank lintas banyak sesi, tidak sebagai kewajiban menyelesaikan satu sesi.

## 8. Rancangan Algoritma Generator

### Alur yang direkomendasikan

1. Validasi permintaan: level eksplisit, operasi, jumlah integer positif, format mode, serta batas jawaban. Level tidak berubah otomatis berdasarkan benar/salah atau kecepatan.
2. Bentuk seluruh kandidat valid untuk level dan mode. Setiap kandidat membawa key canonical, skill tags, operand/result, prompt format, dan batas domain.
3. Deduplicate berdasarkan key sebelum sampling. Untuk tambah langsung urutkan operand dalam key; untuk kurang jangan ditukar; untuk L5 sertakan posisi blank.
4. Hitung kapasitas final sesudah filter domain, kebijakan nol, dan kuota wajib. Jika `requestedCount > validPool`, kembalikan error terstruktur sebelum membuat sesi; jangan loop/retry untuk mencoba mengisi.
5. Bagi pool menjadi strata keterampilan. Tentukan kuota per strata secara proporsional dan sisa kuota dengan aturan deterministic (largest remainder atau urutan yang ditetapkan). Bila kuota tidak dapat dipenuhi oleh pool, tolak konfigurasi/permintaan dengan alasan yang bisa diuji.
6. Sampling tanpa pengembalian dari setiap strata. Gunakan Fisher–Yates dengan RNG yang diinjeksi; simpan satu set `usedQuestionKeys` untuk seluruh ronde dalam satu sesi, bukan direset saat ronde berganti.
7. Urutkan item terpilih dengan pembatas lokal: jangan mengulang operasi lebih dari dua kali berturut dalam mode campuran, hindari streak hasil/operand/kategori skill yang sama, dan sebarkan challenge-tag. Jika batas keras tidak mungkin, relax urutan secara terdefinisi tanpa membuang soal atau membuat duplikasi.
8. Bangun pilihan jawaban setelah kandidat soal final. Pilih satu jawaban benar dan tiga distractor berbeda; validasi ulang jumlah/keunikan/rentang sebelum mengembalikan sesi.
9. Atur posisi jawaban benar menggunakan shuffled bag posisi 0–3. Dalam tiap empat soal, tiap posisi muncul satu kali; untuk sisa 1–3 soal, frekuensi total berbeda paling banyak satu.
10. Kembalikan metadata sesi untuk pengujian/debug (level, mode, seed opsional, daftar key dan skill tags). Jangan menyimpan event mentah atau mengubah evidence aktivitas konsep lainnya.

### Enumerasi vs generasi acak

| Metode | Kelebihan | Risiko |
|---|---|---|
| Enumerasi penuh lalu sampling | Kapasitas dapat dihitung pasti; penolakan over-capacity langsung; deduplikasi dan strata mudah diaudit; sampling tanpa pengembalian terjamin. | Pool perlu diperbarui jika definisi level berubah; untuk domain sangat besar bisa memakan memori, tetapi pool tertinggi audit ini hanya 11.331 kandidat. |
| Generasi acak dengan retry duplikat | Kode awal terlihat sederhana dan tidak menyimpan pool penuh. | Mendekati kapasitas, collision meningkat tajam; rentan loop/tidak memenuhi jumlah; capacity sulit dijamin; quotas dan determinisme menjadi lebih rumit. |
| Hibrida | Dapat berguna jika domain nanti sangat besar: enumerasi strata/batas, lalu generate di strata. | Lebih banyak cabang, lebih sulit direview, belum perlu untuk ukuran MVP. |

**Rekomendasi MVP:** enumerasi seluruh pool dalam fungsi murni TypeScript, deduplicate, kemudian sampling ber-strata tanpa pengembalian. Semua pool rekomendasi kecil untuk browser lokal; kesederhanaan dan jaminan kapasitas lebih bernilai daripada optimasi generasi acak.

### RNG dan determinisme

- Injeksi fungsi RNG/seed agar test dapat mereproduksi sesi yang sama.
- Gunakan PRNG seeded kecil untuk reproduksibilitas lokal, bukan untuk keamanan/kriptografi.
- Hindari modulo bias untuk pemilihan integer indeks; implementasikan `intBelow(n)` dengan rejection sampling atau utility yang setara.
- Fisher–Yates menghasilkan pengacakan tanpa replacement bila indeks dipilih secara benar.
- Seed sama + versi generator sama + input sama harus menghasilkan urutan dan pilihan jawaban sama. Simpan versi algoritma jika kelak sesi perlu direproduksi.

## 9. Strategi Pilihan Jawaban dan Distractor

Setiap soal menampilkan tepat empat nilai yang berbeda dan tepat satu jawaban benar. Nilai pilihan harus integer dalam batas yang disetujui level; hindari distractor negatif atau di atas 100 bila itu tidak sesuai level.

Sumber distractor berdasarkan kesalahan yang dapat dijelaskan:

- `off by one`: hasil ±1 untuk kesalahan hitung satu langkah;
- `ones/tens confusion`: digit satuan atau puluhan tertukar/diabaikan;
- `carry omitted` / `carry misapplied`: khusus tambah dengan regroup;
- `borrow omitted` / `borrow misapplied`: khusus kurang dengan regroup;
- `operation confusion`: memakai operasi lawan ketika bentuk soal membingungkan;
- `inverse error`: khusus nilai-hilang, menghitung dengan operasi/relasi invers yang keliru;
- `near fact`: jawaban dekat dari fakta pasangan yang mirip.

Ketentuan:

1. Jangan memakai jawaban benar sebagai distractor lewat duplikasi data yang berbeda.
2. Jangan mengandalkan distraktor yang selalu hanya berbeda ±1; variasikan sumber kesalahan, tetapi jangan membuatnya ambigu.
3. Buang distractor yang sama satu sama lain atau sama dengan jawaban benar; lakukan fallback deterministik dari domain integer yang sah.
4. Jika empat pilihan unik tidak dapat dibangun untuk kandidat tertentu, tandai generator error/configuration error; jangan diam-diam mengurangi jumlah pilihan atau memasukkan angka tidak valid.
5. Posisi benar diseimbangkan terpisah dari nilai distractor. Distractor jangan selalu diletakkan di posisi tertentu.
6. Pada Level 1/2, opsi harus tetap berada pada rentang jawaban level; nol hanya boleh muncul jika kebijakan nol telah disetujui.
7. Pada Level 5, posisi blank menentukan domain jawaban; semua pilihan harus berupa bilangan yang dapat menjadi nilai blank sesuai batas operand.

## 10. Rancangan Pengujian Otomatis (Vitest)

### Invariant — harus selalu lulus

- **Jawaban:** hitung ulang setiap kandidat dari operand/posisi blank; hasil/solusi sama dengan nilai benar yang disimpan.
- **Batas:** setiap operand, hasil, blank, dan distractor mematuhi batas level; operasi kurang tidak pernah negatif.
- **Skill tag:** tag carry/borrow/no-regroup sesuai digit; Level 2 bridge-ten sesuai definisi; Level 5 blank position valid.
- **Keunikan sesi:** tidak ada question key terulang dalam sesi, termasuk lintas ronde.
- **Kanonisasi tambah:** menukar operand tidak menambah kandidat/kunci baru. Pengurangan tidak mengurutkan ulang operand.
- **Kapasitas pool:** candidate count sama persis dengan tabel untuk definisi yang dipilih; L4 alternatif `<100` harus 640 bila aturan itu dipilih.
- **Empat pilihan:** tepat empat; semuanya berbeda; tepat satu sama dengan jawaban benar; semuanya berada pada rentang sah.
- **Jumlah:** jika permintaan ≤ kapasitas valid, hasil tepat sebanyak diminta; tidak lebih dan tidak kurang.
- **Over-capacity:** kapasitas+1 ditolak sebelum hasil sesi parsial dibuat; kasus 500 harus ditolak pada L1/L2 sesuai mode.
- **Campuran:** jumlah tambah/kurang sama untuk request genap; jika kelak request ganjil, selisih ≤1; tidak ada streak operasi di luar aturan urutan yang disetujui.
- **Distractor:** tidak melanggar bounds, tidak duplikat, dan tiap pool menyimpan provenance/error-tag agar aturan bisa diuji.
- **Tanpa adaptasi:** jawaban salah, hint, atau durasi tidak mengubah level sesi secara otomatis.

### Batas jumlah yang wajib dicakup

Buat `test.each` untuk jumlah `1, 10, 50, 100, 500` pada semua level dan mode:

- `1` harus berhasil pada seluruh pool yang berisi kandidat.
- `10` harus berhasil pada seluruh pool rekomendasi.
- `50` harus berhasil pada L1 tambah? Tidak: ditolak karena kapasitas 25; L1 kurang ditolak karena kapasitas 45; L1 campuran balanced berhasil tepat 50. Mode lain berhasil.
- `100` ditolak pada semua mode L1; pada L2 tambah 100 mengembalikan pool penuh dan dinyatakan LIMITED oleh audit; mode lain yang cukup mengembalikan tepat 100.
- `500` ditolak pada semua mode L1/L2; L3–L5 menghasilkan 500 unik namun UI produk sebaiknya menandainya LIMITED/menawarkan pembagian ronde.
- Uji `capacity`, `capacity−1`, `capacity+1` untuk setiap kombinasi sebagai batas generator, bukan hanya daftar panjang di atas.

### Seed dan statistik

- Jalankan invariants untuk banyak seed deterministik (disarankan minimal 1.000 seed per bentuk uji) termasuk request dekat kapasitas. Ini pemeriksaan invariant; semua seed harus lulus tanpa toleransi.
- Uji determinisme: seed dan input sama menghasilkan urutan/key/opsi yang sama; seed berbeda tetap memenuhi semua invariant.
- Uji posisi jawaban: pada setiap sesi, jumlah tiap posisi benar berbeda maksimum satu bila bag seimbang; ini invariant.
- Uji statistik agregat memakai kumpulan seed tetap, misalnya 1.000 sesi × 10 soal, lalu periksa posisi benar dan skill strata tidak menyimpang melebihi toleransi yang ditentukan sebelumnya (misalnya maksimum deviasi 5% dari ekspektasi untuk setiap kategori yang memiliki populasi memadai). Ini uji statistik dengan toleransi, bukan assertion exact atas satu run acak.
- Untuk operation mix, invariant sesi genap harus tepat 50/50, bukan sekadar statistik.
- Jangan membuat test statistik flakey memakai `Math.random()` tanpa seed. Gunakan seed list tetap dan dokumentasikan batas toleransinya.

## 11. Risiko dan Batasan Teknis

- Kapasitas tergantung pada definisi produk; perubahan operand nol, hasil 100, digit range, atau blank position mengubah angka.
- Tidak ada studi durasi sesi atau uji anak untuk menentukan apakah 20, 30, atau 50 soal tepat untuk pengguna Math Adventure.
- Materi referensi proyek saat ini membahas kompetensi Module 00 dan rujukan fondasi, bukan validasi kurikulum/standar khusus Math Drill kelas 2. Jangan mengklaim Level 1–5 sebagai pemetaan standar resmi tanpa kajian tambahan.
- Nilai-hilang L5 menambah tuntutan relasional/inverse reasoning dan membaca simbol. Perlu visual/netral prompt dan pilot dengan anak sebelum disahkan.
- Distractor yang tidak dirancang berdasarkan pola salah yang masuk akal dapat membuat item ambigu atau memberi petunjuk posisi/jawaban.
- Repeated answers tidak sama dengan repeated questions, tetapi streak jawaban yang sama memengaruhi kesan variasi.
- Random sampling tanpa strata dapat menghasilkan sesi dengan sedikit soal carry/borrow walaupun pool total besar; kuota dan kapasitas setelah kuota harus diuji.
- Seed yang terlihat/terulang dapat membuat urutan dapat ditebak; untuk latihan lokal nonkompetitif ini bukan risiko keamanan, tetapi dapat mengurangi variasi.
- 500 soal tidak boleh memicu loop tanpa batas, browser hang, atau memori berlebihan. Pool audit saat ini kecil, tetapi UI harus memecah tampilan menjadi ronde dan tidak merender ratusan kontrol sekaligus.
- Hindari timer menghukum, ranking, atau pemeringkatan kecepatan. Dokumen desain proyek menekankan pemahaman, productive struggle, dan pemisahan kesalahan konsep dari kesalahan input; Math Drill tetap perlu persetujuan tujuan produk tersendiri.

## 12. Keputusan Produk yang Membutuhkan Persetujuan Orang Tua

1. Apakah definisi dasar tanpa nol yang dipakai pada tabel disetujui? Jika nol dipakai, apakah `a+0`, `a−0`, hasil 0, dan `0+0` masuk sebagai skill-tag berkuota?
2. Apakah Level 2 mencampur fakta biasa dengan fakta bridge-over-10, atau setiap item Level 2 harus melintasi 10? Berapa proporsi tiap tag?
3. Apakah Level 3 hanya memakai dua operand dua digit? Apakah Level 4 boleh menghasilkan tepat 100 (36 item tambah dengan carry kedua) atau harus berhenti pada 99?
4. Apakah usulan Level 5 nilai-hilang diterima, khususnya penggunaan `□` dan soal `a−□=c`; atau lebih disukai Level 5 yang memakai operasi langsung dengan prompt strategi seperti kompensasi/cek invers?
5. Jika Level 5 memakai nilai-hilang, apakah prompt mengizinkan kedua bentuk pengurangan (missing minuend dan missing subtrahend) serta semua hasil positif 1–89?
6. Apakah campuran harus 50/50, boleh selisih satu untuk jumlah ganjil, atau memakai kuota pedagogis lain?
7. Berapa default dan maksimum per ronde? Rekomendasi audit: 10 default, 20 opsional; pecah 30–50 menjadi ronde; 100/500 hanya bank lintas sesi, bukan satu tuntutan sesi.
8. Apakah empat pilihan jawaban berlaku pada setiap level termasuk Level 1? Jika ya, setujui toleransi/dasar provenance distractor dan penanganan item yang kekurangan tiga distractor valid.
9. Apakah orang tua dapat memilih level secara manual dan level tidak berubah otomatis? Rekomendasi: ya, tidak adaptif; level selanjutnya hanya melalui pilihan eksplisit.
10. Apakah feedback memberi penjelasan strategi atau hanya koreksi ringkas? Tentukan juga apakah jawaban ditampilkan segera atau sesudah anak memilih/meninjau ronde.

## 13. Rekomendasi Implementasi Tahap 2

Setelah keputusan di bagian 12 disetujui:

1. Bekukan spesifikasi level, nol, bentuk Level 5, mode campuran, dan panjang ronde sebelum menulis generator.
2. Implementasikan generator murni TypeScript yang menerima level, mode, jumlah, dan RNG; tidak mengimpor React/DOM serta tidak menyimpan data ke cloud.
3. Gunakan enumerasi + canonical keys + strata + sampling tanpa pengembalian. Error over-capacity harus eksplisit dan tidak boleh memberi sesi parsial.
4. Bangun test invariant terlebih dahulu, verifikasi pool cardinality, lalu integrasikan UI.
5. Buat Math Drill terpisah dari aktivitas konsep yang ada; jangan mengubah learning evidence, aturan, atau navigasi aktivitas lain tanpa spesifikasi/approval.
6. Mulai pilot dengan 10 soal tanpa timer. Observasi apakah anak memahami simbol, distractor, instruksi nilai-hilang, jeda, dan kontrol ulang; revisi spesifikasi sebelum menambah panjang sesi.
7. STOP setelah persetujuan implementasi Tahap 2 dan QA yang diminta; tidak ada kode, konfigurasi, dependency, commit, push, atau deployment yang dilakukan dalam Tahap 1 ini.

---

## Status perubahan Tahap 1

Dokumen audit ini adalah satu-satunya output yang diminta untuk tahap ini. Source aplikasi, test, konfigurasi, dependency, proyek lain, VPS, dan layanan eksternal tidak diubah. Generator dan antarmuka Math Drill belum diimplementasikan.
