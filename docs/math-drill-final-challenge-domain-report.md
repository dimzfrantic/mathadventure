# Math Adventure — Final Challenge Stage 1: laporan domain engine

Status: implementasi domain selesai; STOP untuk review manusia. Tidak ada UI Final Challenge.

## 1. Ringkasan implementasi

Mode domain terpisah bernama `challenge` untuk “Tantangan Campuran”. Orang tua memilih himpunan Level 1–5, operasi `addition`/`subtraction`/`mixed`, dan jumlah 10/20/30/50. Jika Level 5 dipilih, daftar satu atau lebih sublevel Cari Angka wajib eksplisit. Tidak ada pemilihan otomatis berdasarkan skor atau usia. Seed uint32 menghasilkan sesi yang deterministik; sesi diberi `version: 1`, `policyVersion: 1`, dan identitas tersendiri. Soal, empat opsi, serta scoring 1/0,5/0 dan maksimal dua jawaban memakai implementasi latihan yang sama.

## 2. File yang diubah

- `src/features/math-drill/domain/challenge-types.ts` (baru): request, session, question metadata, quota, error, capacity, dan metrik.
- `src/features/math-drill/domain/challenge.ts` (baru): validasi, kapasitas feasible, alokasi, deduplikasi, sampling seeded, serta ronde.
- `src/features/math-drill/domain/challenge-summary.ts` (baru): agregator read-only hasil keseluruhan/per level/per sublevel/per operasi.
- `src/features/math-drill/domain/generator.ts`: mengekspor akses kandidat/instansiasi bagi engine baru; algoritme latihan lama tidak diubah.
- `src/features/math-drill/domain/scoring.ts`: hanya memperluas tipe parameter sesi menjadi struktur minimal `{id, questions}` agar `ChallengeSession` dapat memakai scoring engine lama; algoritme dan bobot tidak berubah.
- `src/features/math-drill/domain/index.ts`: mengekspor API baru.
- `tests/math-drill-challenge.test.ts` (baru): tes kontrak challenge dan regresi scoring/practice.
- `docs/math-drill-final-challenge-domain-report.md` (baru): laporan ini.

Tidak ada perubahan pada Math Drill UI, auto-advance 700 ms, modul konsep, dependency, konfigurasi build/test, atau file workspace lain. Tidak ada commit/push.

## 3. Kontrak API

- `getChallengeCapacity(selection: ChallengeSelection): ChallengeCapacity`: mengembalikan `feasibleCounts` dari {10,20,30,50}, `maxCount` terbesar yang feasible, dan `uniqueByOperation` setelah union prompt. Ini bukan ukuran mentah seluruh pool atau janji bahwa semua hitungan di bawah `maxCount` feasible.
- `validateChallengeRequest(request: ChallengeRequest): ChallengeValidation`: memeriksa level/sublevel/operasi/count/seed/roundSize lalu alokasi dan deduplikasi; sukses memuat quota, kegagalan memuat `code`, `message`, `requested`, `capacity`, dan bila relevan bottleneck jumlah prompt unik per operasi.
- `generateChallengeSession(request: ChallengeRequest): ChallengeResult`: menghasilkan `ChallengeSession` lengkap atau error, tanpa sesi parsial. `selectedLevels` disimpan terurut, begitu pula sublevel, `roundSize` default 10 dan maksimum 20.
- `getChallengeSummary(state, session): ChallengeSummary`: tidak memodifikasi state; mengembalikan `overall`, `byLevel` (1–5), `bySublevel` (Dasar/Menengah/Lanjutan), dan `byOperation` (tambah/kurang). Grup kosong memiliki `planned=0` dan rasio `value=null` agar UI kelak menampilkan N/A.
- `createScoreState`, `answerQuestion`, `getScoreMetrics` lama dapat menerima `ChallengeSession` melalui kontrak struktural `{id, questions}`; `DrillSession` lama tetap kompatibel. Tidak ada persistence atau serialisasi state.

Per rasio tersedia `{numerator, denominator, value}` dalam persen. `firstTryAccuracy` memakai jawaban benar percobaan pertama / soal yang pernah dicoba; `weightedScore` memakai (benar pertama + 0,5 × benar kedua) / seluruh soal direncanakan; `successWithinTwoAttempts` memakai kedua kelompok benar / seluruh soal direncanakan. `attempted`, `completed`, `unanswered`, dan `inProgress` dihitung terpisah. Metrik bukan diagnosis mastery.

## 4. Distribusi dan deduplikasi

1. Pilihan dinormalisasi untuk penjadwalan; hitungan dibagi dengan kuota dasar `floor(n/k)` dan remainder berputar menurut seed. Jika tiga sublevel dipilih tetapi kuota Level 5 hanya 2 dan ada remainder level lain, satu remainder dialihkan ke Level 5 tanpa merusak selisih antarlevel ≤1. Jika tidak cukup soal untuk memberi tiap sublevel sedikitnya satu item, request ditolak, bukan diam-diam menghilangkan sublevel.
2. Kuota Level 5 dibagi relatif rata antar-sublevel terpilih. Untuk mode `mixed`, dynamic programming memilih hitungan tambah per bucket yang memenuhi target global persis 50/50 (semua count yang diizinkan genap), sambil meminimalkan deviasi dari separuh pada tiap bucket dan menghormati pool operasi masing-masing. Mode operasi tunggal tidak memasukkan operasi lain.
3. Khusus Level 2, target bridge lokal `round(0,7 × jumlah soal Level 2)` dibagi pada pool operasi yang tersedia, dengan fallback fleksibel ke reinforcement jika bridge tidak cukup. Kuota target, bridge aktual, dan reinforcement aktual disimpan di sesi.
4. Kandidat dari generator latihan dipilih dengan RNG seeded dan matching tanpa pengembalian: setiap slot kuota mendapat prompt unik. `semanticKey` adalah prompt persamaan (membedakan posisi blank); prompt sama lintas Level 1/2 atau lintas sublevel Level 5 hanya muncul sekali. `sourceSublevels` merekam pool terpilih yang juga memuat prompt, sedangkan `level5Sublevel` adalah bucket yang diberi jatah. Representasi berbeda dari fakta aritmetika sama tetap boleh; `factKey` dipakai untuk menghindari penempatan berurutan ketika ada alternatif.
5. Setelah deduplikasi, pilihan jawaban dan posisi benar 0–3 diinstansiasi dengan algoritme lama. Urutan diacak seeded lalu dipilih dengan penalti adjacency fakta/level/operasi; kuota tidak berubah. Ronde dibagi setelah urutan selesai.

Kebijakan kuota level/sublevel relatif seimbang adalah kontrak tahap ini, bukan optimisasi yang memperbolehkan mengubah komposisi tanpa batas. `UNSATISFIABLE_ALLOCATION` dapat terjadi untuk suatu count meski count lebih besar feasible (misalnya 10 soal, 5 level dan tiga sublevel Level 5: kuota Level 5 hanya 2). `INSUFFICIENT_CAPACITY` menandai count melebihi feasible maksimum menurut kuota dan pool; `uniqueByOperation` adalah ukuran union, bukan bukti kelayakan kuota.

## 5. Hasil pengujian

- Tes challenge: kombinasi level 1–5, sublevel tunggal/multi, operasi tunggal/mixed, count 10/20/30/50, remainder level/sublevel, 50/50 global, overlap Dasar∪Menengah (190 tambah/380 kurang), Menengah∪Lanjutan (3.510/8.280), prompt unik lintas pool, Level 1/2 overlap pada batas 25+25, seed sama/sesi identik, posisi jawaban dan empat pilihan berbeda, bridge Level 2 35/50, error validasi, ronde custom, isolasi state skor, partial scoring, N/A grup kosong, dan regresi Level 1–5.
- Matriks perwakilan tambahan menguji empat seleksi level × tiga mode × empat count × tiga seed: feasibility hasil dibanding `getChallengeCapacity`.
- `npm test`: 17 file, 211/211 tes lulus.
- `npm run typecheck`: lulus.
- `npm run lint`: lulus tanpa temuan.
- `npm run build`: lulus (36 modul ditransformasi).
- `git diff --check`: lulus; file domain/test/dokumen yang belum terlacak juga diperiksa dengan `git diff --no-index --check` terhadap `/dev/null`.

## 6. Keterbatasan dan risiko

- Kesetaraan kuota per level/sublevel diutamakan; sistem menolak konfigurasi bila kebijakan kuota itu tak feasible, walaupun ukuran union pool saja tampak besar. UI perlu menampilkan pesan dan alternatif pilihan eksplisit, bukan diam-diam mengubah kuota.
- `getChallengeCapacity` mengembalikan kelayakan hanya pada empat preset count, bukan kapasitas numerik maksimum semua integer. Validasi count dan seed tetap wajib sebelum generasi.
- Anti-adjacency adalah aturan lunak greedy, bukan jaminan global bebas streak bila distribusi bucket tidak memungkinkan. Tidak ada batas streak keras atau diagnosis belajar.
- `sourceSublevels` mencatat overlap prompt dari sublevel yang dipilih; pencampuran representasi fakta sama lintas level diperbolehkan. Posisi saudara fakta diusahakan terpisah, tetapi tidak memaksakan perubahan quota.
- Kinerja dan ergonomi UI Android/Samsung Internet untuk mode challenge baru belum diuji: tahap ini tidak membuat UI. Laporan pengguna tentang 10/10 PASS Level 5 reguler bukan hasil uji challenge.
- Identitas versi sesi disiapkan untuk evolusi kontrak, tetapi tidak ada schema migrasi atau penyimpanan; persistence harus dirancang dan disetujui terpisah.

## 7. Rekomendasi tahap UI berikutnya

Buat konfigurasi orang tua yang menampilkan pilihan level, sublevel Level 5 eksplisit, operasi, empat preset count, dan preview `feasibleCounts`/quota dari API domain. Jika invalid, tampilkan alasan bottleneck dan tawarkan pilihan manual (jumlah/level/sublevel/operasi), jangan auto-upgrade atau substitusi diam-diam. Gunakan satu soal per layar dan alur dua kesempatan/feedback yang sudah ada, lalu tampilan hasil global dan breakdown dengan denominator serta N/A untuk grup kosong. Uji aksesibilitas, fokus, viewport 320/360/412 px, dan Samsung Internet fisik sebelum menyatakan tahap UI lulus. Implementasi UI tidak dilakukan pada tahap ini.

STOP untuk review manusia.
