# Audit perluasan Math Drill: sublevel Level 5 dan Final Challenge

Status: ANALYSIS & DOCUMENTATION ONLY — rancangan untuk review manusia, bukan izin implementasi. Cakupan: hanya Math Drill; kontrak Level 1–4 tetap. Pengguna melaporkan Tahap 2B lulus 10/10 pemeriksaan orang tua termasuk Samsung Internet dan pemahaman Level 5; audit ini tidak mengulang atau mengklaim verifikasi independen uji anak tersebut.

## 1. Executive summary

- Usulan konservatif: Dasar dan Menengah memakai bilangan positif tanpa nol, dengan **seluruh nilai dalam persamaan** dibatasi masing-masing 10 dan 20; Lanjutan adalah **persis** pool Level 5 Tahap 2A, bukan substitusi aturan baru. Tiga posisi blank dipertahankan. Ini definisi audit yang belum disetujui produk.
- Enumerasi penuh menurut bentuk prompt menghasilkan Dasar 45 tambah + 90 kurang = 135; Menengah 190 + 380 = 570; Lanjutan 3.321 + 8.010 = 11.331. Menengah memuat seluruh Dasar. Menengah dan Lanjutan berbagi 111 bentuk prompt; jangan menjumlahkan kapasitas sublevel secara mentah bila lebih dari satu diaktifkan.
- Dengan kebijakan Tahap 2A (empat nilai berbeda dalam domain jawaban, hanya satu benar), keempat opsi mungkin dibuat bahkan di Dasar. **Namun** jika semua distractor diwajibkan tetap membentuk operand sah ketika disubstitusikan ke persamaan, beberapa bentuk tepi tidak punya tiga pilihan salah. Kebijakan distractor ini perlu diputuskan.
- Final Challenge sebaiknya menerima daftar level yang **dipilih eksplisit** orang tua, operasi yang diizinkan, serta sublevel Level 5 yang diizinkan. Sesi dihasilkan sekali, dengan kuota transparan, key semantik global, sampling tanpa pengembalian, dan pengurutan terkontrol; tidak ada auto-unlock/auto-upgrade berdasarkan skor atau usia.
- Scoring per soal saat ini dapat dipakai kembali; rekap menurut level/sublevel/operasi memerlukan agregator baru dan perubahan tipe sesi, bukan mengubah bobot benar pertama 1, benar kedua 0,5, dua salah 0. `firstTryAccuracy` harus tetap terpisah dari `weightedScore`.
- Keputusan produk kritis: definisi angka sublevel, sublevel Level 5 yang boleh masuk Challenge, kebijakan overlap/kunci fakta, prioritas keseimbangan level vs operasi, kebijakan kuota tak terpenuhi, serta kriteria penggunaan label “tes akhir”. Jangan implementasikan sebelum diputuskan.

Dasar audit: `docs/math-drill-generator-audit.md` §3–9, `docs/math-drill-stage-2a-report.md` §3–8, `docs/math-drill-stage-2b-report.md` §4–13; implementasi aktual `src/features/math-drill/domain/{types,generator,scoring,random,index}.ts`, `src/features/math-drill/MathDrillApp.tsx`. Angka di bawah dihitung ulang dengan enumerasi integer read-only, bukan diturunkan dari klaim lama atau eksekusi generator versi baru.

## 2. Definisi matematis tiga sublevel Level 5

Semua variabel bilangan bulat positif; operasi pengurangan tidak negatif dan hasil `c` selalu positif. Blank adalah operand, **bukan** hasil. Sublevel adalah penanda keterampilan di dalam `level=5`, bukan penomoran Level 6–7. Operasi `addition` hanya bentuk pertama; `subtraction` memakai dua bentuk berikut. `x` menyatakan jawaban di blank.

| Sublevel | `□ + b = c` | `□ − b = c` | `a − □ = c` | Domain opsi jawaban numerik |
|---|---|---|---|---|
| Dasar, N=10 (usulan) | `1≤x,b`, `c=x+b≤10` | `1≤b<a≤10`, `x=a`, `c=a−b≥1` | `1≤b<a≤10`, `x=b`, `c=a−b≥1` | Integer 1–10 |
| Menengah, N=20 (usulan) | `1≤x,b`, `c=x+b≤20` | `1≤b<a≤20`, `x=a`, `c=a−b≥1` | `1≤b<a≤20`, `x=b`, `c=a−b≥1` | Integer 1–20 |
| Lanjutan (existing) | `10≤x,b≤99`, `c=x+b≤100` | `10≤b<a≤99`, `x=a`, `c=a−b≥1` | `10≤b<a≤99`, `x=b`, `c=a−b≥1` | Integer 10–99 (hasil `c` bisa 1–89) |

Lanjutan mengikuti tepat `level5Candidates()` di `generator.ts:68–83`: pada tambah, angka diketahui dan blank masing-masing dua digit, jumlah boleh 100; pada kurang, minuend/subtrahend dua digit dan selisih positif **boleh satu digit**. Jadi pernyataan lama “semua nilai Lanjutan 10–99” tidak akurat bagi hasil pengurangan; jangan memperketat hasil secara diam-diam. Dasar/Menengah mengizinkan nilai 1 dan angka satu digit; tidak mengubah domain soal langsung Level 1–4.

Contoh batas Dasar: `□ + 9 = 10` valid (x=1); `□ − 9 = 1` valid (x=10); `2 − □ = 1` valid (x=1). `□ + 9 = 11`, `□ − 10 = 0`, dan `2 − □ = 0` tidak valid. Contoh Lanjutan existing: `□ + 90 = 100`, `□ − 10 = 1` (blank=11), `11 − □ = 1` (blank=10). Perlu persetujuan untuk memilih batas “semua nilai ≤N”, alih-alih hanya jawaban blank ≤N; keduanya menghasilkan kapasitas berbeda.

Urutan pengenalan yang **direkomendasikan untuk diuji**, bukan klaim standar: pertama `□ + b = c` dengan konteks tambah yang sudah dikenal; kedua `□ − b = c` melalui pertanyaan “berapa semula?”; terakhir `a − □ = c` yang membutuhkan penalaran tentang bagian yang diambil. Uji juga urutan dua bentuk kurang secara langsung—kesulitan tiap anak tidak dapat disimpulkan hanya dari sintaks. Mulai dengan representasi konkret/relasi invers sebelum mencampur bentuk; jangan otomatis menaikkan sublevel dari hasil satu sesi. CCSS `1.OA.D.8` membahas bilangan tak diketahui dalam persamaan tambah/kurang, dan `2.OA.A.1` menyebut unknowns in all positions dalam soal cerita sampai 100; keduanya **tidak** mewajibkan urutan tiga bentuk, kebijakan sublevel, UI, atau label Final Challenge.[1][2] Prinsip proyek mengutamakan penalaran dan bukan kecepatan (`docs/learning-design-specification.md` §1–2).

## 3. Tabel kapasitas aktual dan kelayakan empat pilihan

Definisi unik: satu operasi + satu posisi blank + nilai tetap yang menentukan prompt; angka jawaban sama pada prompt lain tidak menyatukan soal. Dengan `N=10/20`, tambah mempunyai `Σ(b=1..N−1)(N−b)=N(N−1)/2`; masing-masing bentuk kurang mempunyai `C(N,2)=N(N−1)/2`. Untuk Lanjutan, tambah `Σ(b=10..90)(91−b)=3.321`, tiap bentuk kurang `C(90,2)=4.005`. Angka berikut diverifikasi ulang dengan enumerasi semua pasangan integer dan himpunan key semantik; bukan benchmark sesi.

| Sublevel | `□+b=c` | `□−b=c` | `a−□=c` | Tambah | Kurang | Total unik | Maks. mixed seimbang genap / ganjil* |
|---|---:|---:|---:|---:|---:|---:|---:|
| Dasar ≤10 | 45 | 45 | 45 | 45 | 90 | 135 | 90 / 91 |
| Menengah ≤20 | 190 | 190 | 190 | 190 | 380 | 570 | 380 / 381 |
| Lanjutan existing | 3.321 | 4.005 | 4.005 | 3.321 | 8.010 | 11.331 | 6.642 / 6.643 |

\* `mixed` menuntut beda jumlah tambah/kurang paling banyak satu; untuk genap `2×min(poolTambah,poolKurang)`, untuk ganjil operasi lebih besar menerima satu ekstra. Angka ganjil ini adalah batas matematis, belum dibatasi `count≤500` dari validator Tahap 2A. Untuk 10/20/30/50, Dasar addition hanya bisa maksimal 45; permintaan **50 addition Dasar harus ditolak**, walaupun 50 mixed Dasar valid. Batas ini juga berlaku saat Dasar satu-satunya strata aktif.

| Himpunan sublevel diizinkan | Tambah unik | Kurang unik | Total unik | Maks mixed genap / ganjil |
|---|---:|---:|---:|---:|
| Dasar ∪ Menengah | 190 | 380 | 570 | 380 / 381 |
| Dasar ∪ Lanjutan | 3.366 | 8.100 | 11.466 | 6.732 / 6.733 |
| Menengah ∪ Lanjutan (juga semua tiga) | 3.510 | 8.280 | 11.790 | 7.020 / 7.021 |

Alasannya: Dasar ⊂ Menengah (overlap 45 tambah + 90 kurang). Menengah ∩ Lanjutan berisi **1** tambah (`□+10=20`) dan **110** kurang (55 pasangan `10≤b<a≤20`, masing-masing dua posisi blank); Dasar ∩ Lanjutan kosong. Karena itu `135+570+11.331` bukan kapasitas semua sublevel yang benar. Menamai sublevel lebih kecil pada soal overlap hanya untuk keperluan laporan juga perlu kebijakan assignment yang eksplisit.

Empat pilihan ala Tahap 2A sah secara **nilai jawaban**: jawaban + tiga distractor berbeda dan dalam 1–10, 1–20, atau 10–99; tiap domain memuat lebih dari empat bilangan. Fallback pilihan tetangga pada `generator.ts:133–153` dapat dipakai sebagai pola, tetapi harus menguji ulang angka tepi dan jangan memaksa distractor baru tampak sebagai persamaan benar. Bila syarat tambahan ialah setiap opsi boleh menggantikan blank **tanpa melanggar domain operand maupun hasil**, kapasitas kandidat yang punya ≥4 nilai substitusi berubah menjadi:

| Sublevel | Tambah layak ketat | Kurang layak ketat (dua bentuk) | Catatan |
|---|---:|---:|---|
| Dasar | 39 | 78 | Masing-masing bentuk kehilangan 6 soal tepi. |
| Menengah | 184 | 368 | Masing-masing bentuk kehilangan 6 soal tepi. |
| Lanjutan existing | 3.315 | 7.998 | Masing-masing bentuk kehilangan 6 soal tepi. |

Contoh `□+9=10` Dasar hanya memberi satu substitusi yang tetap membuat jumlah ≤10; tidak mungkin punya empat pilihan yang semuanya memenuhi batas operand/hasil itu. Ini **bukan** kebijakan pilihan engine sekarang. Jika yang dimaksud “pilihan valid” hanya angka di rentang jawaban (kontrak Tahap 2A), gunakan tabel utama; jika semua alternatif harus masih menjadi operasi dalam domain, saring kandidat lalu hitung ulang kapasitas/kuota sebelum memulai. Empat opsi tidak harus semuanya menghasilkan persamaan benar—hanya satu yang boleh benar.

### Keunikan fakta, canonical key, dan overlap level

Existing key adalah `${level}:${shape}` (`generator.ts:21–23`), misalnya `5:missing-addend:27:63`, `5:missing-minuend:27:35`, `5:missing-subtrahend:82:46`. Jangan gunakan label sublevel di **satu-satunya** key deduplikasi Challenge: prompt identik dari Menengah dan Lanjutan akan muncul dua kali. Usulan `semanticKey = operation + blankPosition + fixedKnown + equationResult` (atau representasi kanonik operand ekuivalen); pertahankan `sourceLevel`, `sourceSublevels`, dan `assignedBucket` secara terpisah. Legacy key tidak perlu diubah untuk sesi latihan biasa; sebuah `challengeKey` unik global bisa dipakai pada skor sesi Challenge. Bentuk kurang `□−b=c` dan `a−□=c` untuk fakta `a−b=c` dianggap dua item *posisi blank* berbeda—namun satu fakta aritmetika yang sama; jangan menampilkan keduanya berdekatan bila tujuan menghindari pengulangan terasa. `□+b=c` dan bentuk langsung `x+b`/`b+x` juga berbagi fakta matematika pada level lain, walaupun tugas respons berbeda. Aturan “dedupe prompt identik” versus “dedupe seluruh fakta aritmetika termasuk beda representasi” harus ditetapkan; kebijakan kedua mengurangi kapasitas, terutama pada lintas level, dan memerlukan enumerasi ulang.

## 4. Rancangan Final Challenge

Bentuk sesi yang direkomendasikan: orang tua memilih himpunan level dari {1,2,3,4,5} (tak kosong), operasi yang diizinkan (`addition`, `subtraction`, atau keduanya), jumlah 10/20/30/50, dan bila 5 dipilih, sublevel Level 5 yang secara eksplisit diizinkan. **Default aman** dalam rancangan: jangan memilih level/sublevel baru secara otomatis; layar meminta pilihan eksplisit atau memakai konfigurasi orang tua yang memang telah disimpan dan dapat dilihat (persistence bukan bagian audit/izin implementasi ini). Tidak ada klaim bahwa aplikasi sekarang menyimpan progres mastery atau konfigurasi orang tua—`MathDrillApp.tsx:19–37` hanya state sesi lokal dan satu `level`.

Tetapkan kebijakan konten dulu: apakah Challenge memasukkan seluruh sublevel yang diizinkan dengan kuota masing-masing, atau orang tua hanya memilih sublevel tertinggi dan item sublevel di bawahnya boleh muncul? Rekomendasi audit: aktifkan himpunan sublevel eksplisit, tampilkan ringkasan komposisi sebelum mulai, dan jangan memasukkan bentuk yang belum pernah dipelajari. Bila belum ada metadata kompetensi yang disetujui, pilihan manual orang tua adalah satu-satunya sinyal kesiapan; satu hasil Challenge bukan bukti mastery.

Semantik hasil: satu sesi tersnapshot sepenuhnya di awal; progress/round seperti Tahap 2B; tidak ada perubahan komposisi berdasarkan jawaban, timer, ranking, hadiah, atau bukti pembelajaran otomatis. Nama “Final Challenge” tidak boleh menyiratkan sertifikasi/pemeringkatan; perlu keputusan apakah layar anak menyebut “Tantangan campuran” atau nama lain.

## 5. Distribusi, pembulatan, dan aturan pencampuran

Usulan **baseline untuk dihitung, belum keputusan produk**: bobot sama di antara level terpilih, seimbangkan total operasi (+/−) bila keduanya diizinkan, lalu seimbangkan dua bentuk pengurangan Level 5 bila kuota mencukupi. Tambah dan kurang Level 5 tidak bisa sekaligus dibuat “tiga bentuk masing-masing sepertiga” dan “operasi 50/50”: satu bentuk tambah dan dua bentuk kurang; misalnya sepuluh soal L5 yang balanced mempunyai lima tambah serta lima kurang dibagi 2/3 atau 3/2 antar dua bentuk. Rotasi remainder menurut seed agar tidak selalu menguntungkan level/posisi sama.

Contoh pembagian level tanpa constraint kapasitas lain, **bukan bukti feasibility semua konfigurasi**:

| Level yang dipilih | 10 soal | 20 soal | 30 soal | 50 soal |
|---|---|---|---|---|
| 1, 3, 5 (urut level) | 4 / 3 / 3 | 7 / 7 / 6 | 10 / 10 / 10 | 17 / 17 / 16 |
| 1, 2, 3, 4, 5 (urut level) | 2 / 2 / 2 / 2 / 2 | 4 / 4 / 4 / 4 / 4 | 6 / 6 / 6 / 6 / 6 | 10 / 10 / 10 / 10 / 10 |

Rumus sederhana: untuk `k` level, setiap level mendapat `floor(n/k)`; sisanya `n mod k` dialokasikan satu-satu menurut urutan rotasi deterministik berbasis seed. Untuk masing-masing level dan mode mixed, alokasi tambah/kurang berbeda maksimal satu **jika layak**, sembari menjaga total sesi tepat n/2 masing-masing untuk jumlah 10/20/30/50. Jika sublevel Level 5 lebih dari satu, bagi kuota Level 5 lagi menurut bobot yang disetujui; remainder antarbucket tidak boleh membuat prompt identik dipilih dua kali.

Langkah rancangan generator: (1) validasi pilihan eksplisit, count, seed, roundSize; (2) enumerasi hanya pool yang disetujui, beri metadata level/sublevel/bentuk/skill; (3) dedup global berdasarkan semanticKey lalu simpan bucket asal yang layak; (4) alokasikan kuota level → operasi → sublevel/bentuk, cek feasible bersama memakai pencocokan kapasitas/bucket (bukan sekadar `sum(getCapacity(...))`); (5) sampling seeded tanpa replacement atas assignment yang feasible; (6) buat empat pilihan dan posisi benar seimbang; (7) urutkan seluruh sesi dengan aturan variasi yang tidak mengubah kuota/key; (8) bagi ronde default 10; (9) keluarkan metadata requested, target, actual, dan alasan penyesuaian yang disetujui. Algoritme detail matching/flow dan strategi fallback perlu uji kontrak, bukan dianggap telah tersedia.

Level 2: kuota bridge lama `floor(0.7×kuotaL2+0.5)` tetap **lokal Level 2** dan fleksibel bila pool bridge kurang (`generator.ts:89–98, 202–229`), tidak diterapkan 70% ke seluruh Challenge. Jika kuota operasi Level 2 didistribusikan, metadata target/aktual bridge per operasi tetap dicatat. Jangan menerapkan `getCapacity` existing untuk level tunggal seolah-olah kapasitas gabungan Challenge: mixed odd +1 dan overlap sublevel membuat jumlah kapasitas bucket tidak aditif.

Aturan anti-monoton: shuffle ber-seed pada kandidat **setelah** kuota dan dedup; susun dengan target lunak tidak lebih dari dua soal beruntun dari level/operasi/posisi blank yang sama *jika ada alternatif*, hindari soal dengan fakta saudara dan jawaban sama berdekatan, sebar soal L5 dan operasi dalam setiap ronde. Jangan urutkan berdasarkan kesulitan numerik. Jangan jadikan semua constraint streak keras: jika satu bucket mendominasi atau satu operasi saja dipilih, batas streak tidak mungkin; hindari loop retry tanpa batas. Gunakan algoritme penjadwalan terikat (`bounded attempts`/backtracking terbatas) dan jika tidak mungkin, relaksasi urutan terdokumentasi tanpa mengubah kuota, key, atau pilihan level. Seed sama + input/versi sama ⇒ sesi identik; posisi benar tetap tersebar seperti Tahap 2A.

Jika kuota level/operasi/bentuk tak cukup: rekomendasi **tolak secara terstruktur dan tawarkan pilihan eksplisit** untuk menurunkan jumlah, mengubah komposisi, atau menambah hanya level yang sudah dipelajari. Jangan diam-diam mengubah level/sublevel/operasi atau menggandakan soal. Alternatif mengalihkan sisa ke bucket terpilih yang masih cukup perlu persetujuan terpisah, batas deviasi, dan metadata actual-vs-target. Kapasitas yang ditampilkan harus kapasitas **konfigurasi berkuota**, bukan sekadar ukuran union pool. Error perlu menyebut bucket sempit dan alternatif yang sah; tidak menyimpulkan kesiapan anak.

## 6. Perubahan kontrak API yang dibutuhkan (rancangan, belum diimplementasikan)

| Area | Kondisi sekarang | Rancangan kompatibel / perubahan yang dibutuhkan |
|---|---|---|
| Request Level 5 | `GenerateRequest` wajib satu `level`, `mode`, `count`, `seed`; `getCapacity(level,mode)`; `validateRequest` satu level | Pertahankan pemanggilan existing `{level:5,...}` ⇒ **Lanjutan** secara eksplisit untuk kompatibilitas; opsi `level5Sublevel` untuk sesi biasa butuh persetujuan. API baru `validateChallengeRequest` dan `generateChallengeSession` dengan `selectedLevels`, `allowedOperations`, `selectedLevel5Sublevels`, `count`, `seed`, `roundSize`, kebijakan kuota versi. Jangan menyisipkan array ke `level` existing tanpa migrasi. |
| Soal | `DrillQuestion`: `key`, `level`, `operation`, `prompt`, `operands`, `answer`, `choices`, `correctChoiceIndex`, `skillTags` | Tambahkan metadata `sublevel?`, `blankPosition?`, `semanticKey`, `sourceSublevels?`, `assignedBucket`, `generatorVersion` bila perlu reproduksibilitas; buat identitas unik untuk respons di Challenge. Jangan mengubah string prompt Level 5 Lanjutan. |
| Sesi | `DrillSession.level` tunggal, `mode` tunggal, `quota?` hanya Level 2 | Discriminated union `kind:'practice'|'challenge'` atau `ChallengeSession` terpisah; Challenge menyimpan seleksi eksplisit, total/per-bucket target dan actual, `rounds`, `seed`, `policyVersion`. API latihan lama tetap bisa dipakai tanpa migrasi mendadak. |
| Kapasitas/validasi | `getCapacity` menghitung pool level tunggal; `validateRequest` hanya memeriksa 1–500 dan pool | `getChallengeCapacity(requestWithoutCount)` menghitung union setelah dedup, distractor-filter dan kuota; `validateChallengeRequest` mengembalikan feasibility/penjelasan bottleneck, bukan `sum(getCapacity)`. Error baru untuk seleksi kosong, sublevel L5 tidak diizinkan, konflik kuota, atau pool setelah dedup tak cukup; pertahankan error lama untuk API lama. |
| Generator/urutan | `generateSession` satu level; mixed interleave berdasarkan operasi; bag posisi 0–3 | Challenge mengalokasikan level × operasi × sublevel/bentuk, dedup global, menjaga seed, lalu susun tanpa urutan linear mudah→sulit/sulit→mudah. Batas memori/performa uji di browser target; jangan minta backend. |
| Scoring | `answerQuestion` key di sesi, maksimum dua jawaban; `getScoreMetrics` global | Pertahankan state machine dan weighted scoring. Buat agregator read-only per level, sublevel, operasi, skill/tag/bentuk dari `responses` dan metadata soal; `errorsBySkillTag` sekarang menghitung **jawaban salah** (bisa dua per soal), sedangkan `wrongTwice` menghitung **soal**—jangan disamakan. |
| UI | `MathDrillApp.tsx` memilih satu level; label hasil hanya global | Tambahkan mode Challenge terpisah: hanya level/sublevel yang dipilih, preview komposisi, error kapasitas terarah, pertanyaan satu per layar, hasil global + per kategori dengan penyebut dan ukuran sampel jelas; bukan UI kompetisi atau diagnosis otomatis. |
| Tests | `tests/math-drill-{generator,scoring,ui}.test.ts(x)` jalan; ada dua `src/features/math-drill/domain/*.test.ts` di luar glob | Test enumerasi/overlap, 4 pilihan tepi, quota-bottleneck, seed, anti-duplikat semantik lintas ronde, urutan, scoring dua kesempatan lintas level, agregasi kosong/parsial, UI kecil/keyboard, regresi L1–4 dan legacy Level 5. Jangan ubah konfigurasi test tanpa persetujuan. |

Rumus metrik per grup `g`: `planned_g`, `attempted_g`, `completed_g`, `first_g`, `second_g`, `wrongTwice_g`, `inProgress_g`, `unanswered_g`; `firstTryAccuracy_g = first_g / attempted_g ×100` bila attempted>0, `weightedScore_g = (first_g+0.5×second_g)/planned_g ×100` bila planned>0, `successWithinTwoAttempts_g = (first_g+second_g)/planned_g ×100`. Untuk grup nol-soal tampilkan `N/A`, bukan 0% yang tampak seperti gagal; keluarkan raw numerator/denominator agar pembulatan/UI bisa diaudit. Kategori skill yang saling tumpang-tindih boleh menghasilkan jumlah per-skill lebih besar dari total soal; jangan menjumlahkan persentase kelompok overlap menjadi 100%. Hasil campuran tidak boleh mengklaim mastery dari sampel kecil.

## 7. Risiko pedagogis dan teknis

- “Tes akhir” berpotensi terasa menghukum; rekomendasikan bahasa ramah, dua kesempatan, jeda ronde, dan tanpa timer/ranking. Metrik bukan diagnosis konsep atau label anak.
- Bentuk `a−□=c` mungkin terasa berbeda dari `□−b=c`; urutan dan jumlah per bentuk butuh observasi anak, bukan diasumsikan setara dari kapasitas yang sama. Contoh uji: minta anak menjelaskan simbol blank dan strategi pada ketiga bentuk tanpa menebak dari opsi.
- Dasar/Menengah memuat fakta langsung Level 1/2 dalam representasi berbeda; satu fakta yang sama pada dua level/sublevel dapat terasa repetitif meski key prompt berbeda. Kebijakan semantic-vs-fact dedup perlu disahkan.
- Empat distractor domain-valid belum tentu pedagogis atau layak substitusi sebagai operand untuk semua soal tepi. Jangan klaim kualitas distractor dari validasi integer saja.
- Prioritas adil antara level, operasi, sublevel, bentuk, skill bridge Level 2, dan panjang sesi dapat saling bertentangan; satu fungsi `capacity` skalar saja menyembunyikan bottleneck.
- Reusing `DrillSession.level` yang tunggal untuk Challenge bisa mengelirukan consumer; menjaga API lama terpisah mengurangi regresi. UI lama hanya satu level dan `getScoreMetrics` belum mempunyai breakdown.
- Render responsif 320/360/412 CSS px dan Samsung Internet perlu diuji ulang untuk konfigurasi banyak level dan laporan per level; lolosnya UI Level 5 yang ada belum memvalidasi UI Challenge.
- Pengacakan seeded bukan jaminan bebas streak tanpa postprocessing, dan restriksi streak keras tidak selalu mungkin. Ukur variasi yang benar-benar dialami, bukan hanya kapasitas numerik.
- Dokumen Tahap 2B masih mencatat uji Android fisik sebagai PENDING pada saat ditulis; informasi terbaru mengenai kelulusan uji 10/10 berasal dari laporan pengguna pada permintaan audit ini, bukan hasil pemeriksaan agent atau pembaruan laporan Tahap 2B.

## 8. Keputusan produk yang diperlukan sebelum implementasi

1. Apakah batas Dasar/Menengah berlaku untuk **semua** nilai persamaan dan mengecualikan nol seperti tabel, atau hanya untuk jawaban blank? Apakah contoh hasil kurang satu digit di Lanjutan tetap sah? (Audit mempertahankannya.)
2. Apakah urutan pengenalan tambah → kurang blank minuend → kurang blank subtrahend diterima sebagai hipotesis uji, dan apakah sublevel selalu manual, atau ada prasyarat formal yang akan ditetapkan terpisah?
3. Dalam Final Challenge, level dan sublevel mana yang boleh dicampur? Apakah Level 5 memakai satu sublevel terpilih, beberapa sublevel eksplisit, atau semua yang telah dipelajari? Sumber kebenaran status “telah dipelajari” belum ada pada Math Drill.
4. Pilih prioritas kuota: bobot sama per level, global operasi 50/50, bentuk L5 relatif seimbang, target bridge L2, atau bobot produk lain. Bila infeasible, **tolak** atau redistribusikan di antara bucket terpilih dengan toleransi berapa?
5. Apakah distractor cukup integer dalam domain jawaban (existing), atau semua harus tetap substitusi operand yang sah? Konsekuensinya tabel kapasitas berbeda.
6. Definisikan duplikasi: prompt identik saja, atau satu fakta aritmetika tak boleh diulang dalam format/level lain? Jarak minimum antara bentuk saudara?
7. Apakah “Final Challenge” asesmen sekali jalan atau latihan campuran ramah? Bagaimana hasil parsial/keluar diperlakukan? Tidak boleh diartikan mastery tanpa model evidence yang disetujui.
8. Apakah jumlah 10/20/30/50 semua ditawarkan, atau 30/50 perlu pemecahan ronde/opsi berhenti? Berapa default dan apakah tampil preview distribusi untuk orang tua?
9. Putuskan strategi kompatibilitas `{level:5}` lama (rekomendasi default Lanjutan) dan format/version key sesi Challenge sebelum perubahan code.

## 9. Rekomendasi urutan implementasi berikutnya (belum dikerjakan)

1. Review keputusan §8 dan uji singkat urutan bentuk/sublevel dengan anak; bekukan kebijakan nol, batas nilai, pilihan, kuota, key, dan error terlebih dahulu.
2. Tulis kontrak test enumeratif yang gagal untuk sublevel dan overlap; jaga regression L1–4 dan `{level:5}` lama. Tambahkan tes perbedaan distractor domain-valid vs substitusi-valid sesuai keputusan.
3. Implementasikan sublevel dalam domain murni dan capacity per operasi/bentuk; validasi Level 5 lama tidak berubah. Pastikan dedup lintas sublevel dan capacity union.
4. Rancang/tes API Challenge dan alokasi kuota feasible lintas level/operasi/sublevel, tanpa fallback tersembunyi; baru lakukan sampling/ordering seeded/rounding.
5. Pertahankan `answerQuestion` dan uji rekap per kategori terpisah termasuk empty/partial; implementasikan UI pilihan orang tua, preview, alur soal, dan hasil setelah domain stabil.
6. Jalankan suite regresi, typecheck/lint/build, uji browser sempit dan Samsung Internet dengan manusia; revisi berdasarkan temuan, bukan menambah fitur di audit ini.

## 10. Acceptance criteria untuk tahap implementasi (draft, menunggu keputusan §8)

- [ ] Semua tiga bentuk di tiap sublevel memenuhi batas yang **disetujui**; Lanjutan identik dengan soal/kapasitas existing; Level 1–4 serta request legacy tidak berubah.
- [ ] Jika kebijakan tabel utama disetujui, enumerasi pool 45/90, 190/380, 3.321/8.010 tepat; overlap 135, 0, 111 sesuai pasangan sublevel; union tiga sublevel 3.510/8.280. Jika kebijakan berbeda disetujui, angka kontrak dihitung ulang **sebelum** implementation.
- [ ] Semua item punya 4 pilihan integer unik dengan satu jawaban benar dan bound sesuai sublevel; kasus tepi `□+9=10`, `2−□=1`, dan Lanjutan `□+90=100` diuji.
- [ ] Challenge hanya memilih level/sublevel/operasi yang disetujui orang tua. Tidak ada level baru otomatis, soal duplikat semantik dalam satu sesi/antar ronde, fallback diam-diam, atau sesi parsial saat invalid.
- [ ] Jumlah 10,20,30,50, kuota ganjil per bucket, operasi seimbang bila diminta, overlap, kapasitas−1/kapasitas/kapasitas+1, dan bottleneck kuota diuji dengan seed tetap; hasil sesuai jumlah persis atau error terstruktur. `getChallengeCapacity` menyatakan batas berdasarkan aturan kuota final, bukan penjumlahan kapasitas level.
- [ ] Level 2 tetap memakai target bridge fleksibel lokal, metadata target/aktual konsisten; perubahan kontrak tidak memengaruhi scoring Level 1–4.
- [ ] Urutan tidak monoton semata-mata level naik/turun dan menyebar operasi/bentuk bila layak; urutan deterministic untuk seed/versi/input sama; relaksasi constraint yang tak mungkin terdefinisi, bukan loop tak terbatas.
- [ ] Scoring tetap maksimum dua kesempatan: 1/0,5/0 poin; hasil global dan per level/sublevel/operasi/bentuk punya pembilang/penyebut, akurasi pertama dan skor berbobot berbeda; grup kosong `N/A`.
- [ ] UI satu soal per layar, target sentuh/fokus/label nilai-hilang terbaca, tidak horizontal overflow pada 320/360/412 CSS px; Samsung Internet diuji manusia, bukan hanya emulasi.
- [ ] Full regression test untuk Level 1–5 dan aktivitas konsep lulus; tidak ada persistence, timer, reward, backend, dependency baru, atau commit/push tanpa izin baru.

## Metode dan sumber

Enumerasi integer read-only dijalankan dalam satu perintah Python di luar source proyek: tiga pool diturunkan dari batas pada §2, setiap bentuk direpresentasikan sebagai `(operation, blankPosition, knownOrMinuend, result)`; dibuat set, dihitung ukuran/intersection/union per operasi, lalu dihitung alternatif opsi ketat. Pemeriksaan terpisah menghitung tiap bentuk dan batas mixed ganjil/genap. Tidak ada generator baru yang dijalankan atau test suite proyek untuk audit dokumentasi ini. File proyek yang digunakan sebagai bukti teknis tercantum di §1 dan §6; laporan historis Tahap 1 menyebut mixed genap Lanjutan 6.642, sedangkan 2A menyebut mixed maksimum termasuk ganjil 6.643—keduanya kompatibel, jangan dipertentangkan.

Sumber luar untuk konteks pedagogis **hanya** standar berikut. Urutan bentuk dan komposisi Challenge adalah rekomendasi desain internal, tidak diklaim diwajibkan sumber.

**STOP untuk review manusia.** Tidak ada implementasi source/test, konfigurasi, dependency, backend, database, deployment, commit, atau push.

## Sources

[1] https://www.thecorestandards.org/Math/Content/1/OA/D/8 — CCSS 1.OA.D.8
[2] https://www.thecorestandards.org/Math/Content/2/OA — CCSS 2.OA.A.1 dan 2.OA.B.2
