# Audit UX Mobile & Interaksi Sentuh — 00.1-A dan 00.1-B

**Status:** AUDIT ONLY — belum ada implementasi/perubahan source.
**Tanggal audit:** 11 Oktober 2026
**Project:** `D:\Hermes Project\math-adventure`
**Auditor:** No Name (Hermes)
**Approver:** Dimz

## 1. Executive Summary

Dua masalah UX utama dapat dijelaskan oleh tata letak responsif yang benar-benar aktif, bukan oleh fixed-height clipping:

1. **00.1-A menumpuk seluruh panel astronaut dan roket secara vertikal pada lebar ≤700 CSS px.** Pada simulasi 320×640, panel astronaut mulai pada y=506 dan panel roket pada y=934; halaman aktivitas tingginya 2.068 CSS px dan tombol “Periksa jawaban” berada pada y=1.933. Anak harus menggulir antara dua kelompok untuk membuat pasangan. Ini terkonfirmasi dari CSS dan direproduksi dalam emulasi browser.
2. **00.1-B menaruh persediaan sebelum daftar penerima yang juga satu kolom pada lebar ponsel.** Penerima terakhir dan tombol pemeriksaan berada jauh di bawah persediaan. Pada 320×640, persediaan mulai y=508, penerima pertama y=780, tombol pemeriksaan y=1.749, dan halaman awal tingginya 1.901 CSS px. Setelah hasil salah, pesan inline membuat halaman lebih tinggi; pesan hasil berada di atas area permainan. Ini terkonfirmasi dari CSS/DOM dan direproduksi dalam emulasi.
3. **Kedua aktivitas memakai HTML Drag and Drop API, bukan Pointer/Touch Events.** Tidak ada handler pointer/touch, pointer capture, atau `touch-action` di source. Simulasi mouse desktop berhasil untuk keduanya; touch emulation berhasil untuk tap, tetapi drag pada 00.1-B tidak mengalokasikan benda. Ini mendukung dugaan bahwa jalur drag saat ini tidak menyediakan interaksi sentuh lintas browser yang andal, tetapi **bukan bukti hasil pada Samsung Internet asli**.

Tap-to-select tetap merupakan alternatif yang berfungsi: alur tap 00.1-B berhasil dalam emulasi sentuh; di 00.1-A tap memilih astronaut dan pasangan berhasil setelah menggulir ke panel roket. Jadi aktivitas masih dapat diselesaikan dengan tap, tetapi scroll yang memisahkan objek membuat alur itu kurang nyaman.

**Tidak ditemukan horizontal overflow pada viewport emulasi yang diukur.** Konten bertambah tinggi dalam alur normal; tidak ada fixed-height clipping atau sticky/fixed control pada CSS aktivitas yang diperiksa. Rekomendasi utama adalah merapikan komposisi papan pada ponsel terlebih dahulu, lalu memutuskan apakah drag sentuh benar-benar perlu. Jangan mengubah reducer, aturan evaluasi, atau learning evidence untuk memperbaiki UX.

## 2. Lingkungan dan Batas Pengujian

### Perangkat yang dilaporkan Dimz

- Perangkat nyata: Android dengan Samsung Internet.
- Model HP, versi Android, dan versi Samsung Internet: belum diinformasikan.
- iOS, Chrome Android, dan Firefox Android: belum diuji.
- Scrolling berlebihan, drag jari yang tidak berfungsi, dan layout yang kurang rapi: **REPORTED BY DIMZ ON PHYSICAL DEVICE**.
- Tidak ada klaim bahwa masalah khusus Samsung Internet.

### Simulasi yang dilakukan

Aplikasi lokal di `http://127.0.0.1:5173/` diperiksa memakai Browser Use dengan **HeadlessChrome 145 pada Windows 10**, CSS viewport dan touch emulation. Ini bukan perangkat Android fisik dan bukan Samsung Internet.

Viewport yang diukur (CSS px): `320×640`, `360×800`, `375×812`, `390×844`, `412×915`, landscape `844×390`, dan desktop emulasi `1280×800`. Pengukuran DOM mencakup client/scroll width, tinggi halaman, posisi panel, kartu, feedback, dan tombol utama. Tidak ada horizontal overflow terukur pada kondisi awal yang diuji. Desktop mouse drag, touch drag emulation, touch tap, dan aktivasi keyboard Enter juga dicoba.

**NOT YET VERIFIED:** pengujian fisik Android/Samsung Internet; perilaku drag di Samsung Internet, Chrome Android, Firefox Android, dan iOS; versi perangkat/browser; pembesaran teks/zoom; screen reader; serta console error/warning. Simulasi tidak menggantikan pemeriksaan visual/aksesibilitas menyeluruh pada Samsung Internet. Browser zoom atau pembesaran teks sistem tidak diuji secara nyata. Screen reader tidak diuji. Console browser tidak tersedia untuk pemeriksaan dalam harness yang digunakan. Tidak ada pengujian fisik.

### Source aktif yang diperiksa

- `src/App.tsx:8-27` — activity switcher dan mounting kedua aktivitas.
- `src/main.tsx` — entry point aplikasi; global CSS masuk melalui entry point.
- `src/MatchingApp.tsx` dan `src/matching.css` — aktivitas 00.1-A.
- `src/DistributionApp.tsx` dan `src/distribution.css` — aktivitas 00.1-B.
- `src/activity-navigation.css` dan `src/index.css` — navigasi dan aturan global.

Styling aktivitas terutama menggunakan class dan stylesheet CSS khusus; source komponen yang diperiksa tidak mengandalkan kumpulan utility class Tailwind untuk layout papan. `src/index.css:15-18` menetapkan `body { min-width: 320px; min-height: 100vh; }` dan box sizing global pada baris 12.

## 3. Temuan 00.1-A — Memasangkan

### A1. Kelompok objek terpisah vertikal pada ponsel

**Prioritas: P1 — hambatan UX inti, masih ada workaround tap + scroll.**
**Status:** CONFIRMED FROM CODE; REPRODUCED IN SIMULATION; gejala terkait REPORTED BY DIMZ ON PHYSICAL DEVICE.

- **Gejala:** astronaut dan roket tidak berada dalam satu konteks visual; untuk memilih astronaut lalu memilih roket, anak harus menggulir ke kelompok lain. Instruksi, ringkasan pasangan, undo/hint, pilihan benda tersisa, dan tombol pemeriksaan menambah tinggi halaman.
- **Bukti kode:** `src/matching.css:43` memakai dua kolom untuk `.board-grid`, tetapi `:72-76` mengganti `.board-grid` menjadi satu kolom pada `max-width:700px`. `.token-list` tetap dua kolom (`:48-49`, `:76`). `src/MatchingApp.tsx:33-64` merender daftar astronaut dan roket sebagai dua panel terpisah; ringkasan berada sesudah kedua panel (`:66-72`). Instruksi ada di `:179-184`; tool row, hint, fieldset sisa, dan pemeriksaan berada sesudah papan (`:185-200`).
- **Reproduksi simulasi:** pada `320×640`, aktivitas setinggi 2.068 px; panel astronaut mulai y=506, panel roket y=934, dan tombol pemeriksaan y=1.933. Pada `390×844`, panel mulai y=411 dan y=776, tombol pemeriksaan y=1.665. Di semua lebar portrait yang diminta, panel tetap tersusun vertikal. Tidak ada visible element yang melewati batas horizontal viewport terukur.
- **Tap/keyboard:** tap astronaut menandai pilihan; setelah menggulir ke panel roket, tap roket membuat pasangan pada emulasi. Enter pada tombol native juga membuat satu pasangan ketika fokus keyboard diarahkan dengan benar.
- **Penyebab:** stack vertikal pada breakpoint adalah penyebab struktural scrolling antarkelompok yang terkonfirmasi. Tinggi nyata di Samsung Internet belum diverifikasi.
- **Dampak:** anak harus mengingat pilihan yang ditandai sambil berpindah area; alur pasangan terputus. Drag native juga akan sulit bila sumber dan target berada di luar viewport satu sama lain tanpa autoscroll.
- **Rekomendasi:** susun ulang papan mobile agar kedua kelompok tetap berada dalam satu bidang pandang horizontal tanpa mengecilkan teks/target secara ekstrem. Kandidat untuk diuji: dua panel sempit berdampingan dengan satu kolom token per sisi dan padding panel mobile yang lebih hemat; validasi keterbacaan pada 320 px. Alternatifnya, gunakan komposisi papan lain yang mempertahankan astronaut dan roket terlihat bersamaan. Jangan menyusun pasangan secara tetap per baris jika itu dapat membocorkan jawaban.
- **Perkiraan file implementasi:** mulai dari `src/matching.css`; ubah `src/MatchingApp.tsx` hanya bila perlu untuk struktur semantik/layout. Pertahankan reducer dan evidence.

### A2. Ukuran target baik, tetapi instruksi/header memakan ruang

**Prioritas: P2.**
**Status:** CONFIRMED FROM CODE; tinggi/wrapping terlihat dalam REPRODUCED IN SIMULATION.

- Token matching memiliki `min-height:112px` (`src/matching.css:49`), jauh di atas sasaran sentuh 44 px. Tidak disarankan mengecilkan token secara drastis.
- Pada 320 px, activity heading setinggi 266 px dan panel pertama 410 px; teks instruksi/panel membungkus. Pada 360 px, heading 266 px. Layout meluaskan elemen, bukan memotongnya.
- Tombol aktivitas global memiliki `min-height:44px` (`matching.css:38`); label navigasi membungkus pada lebar sempit karena kedua tombol flex (`activity-navigation.css:37-47`). Tidak ada horizontal overflow dalam emulasi, tetapi navigasi tampak tinggi/berat dan menambah area awal.
- **Rekomendasi:** kurangi chrome/instruksi berulang di area main, gunakan instruksi singkat yang tetap jelas, dan ringkas label visual navigasi bila diperlukan (jangan hilangkan accessible name). Pertahankan teks status “Dipilih”, label objek, focus-visible, dan target minimum yang nyaman.

## 4. Temuan 00.1-B — Membagikan

### B1. Persediaan dan penerima berada pada rentang vertikal yang panjang

**Prioritas: P1 — hambatan UX inti, alokasi tap tetap dapat dilakukan.**
**Status:** CONFIRMED FROM CODE; REPRODUCED IN SIMULATION; gejala terkait REPORTED BY DIMZ ON PHYSICAL DEVICE.

- **Gejala:** anak memilih benda dari persediaan lalu harus bergerak jauh ke bawah untuk penerima; untuk benda berikutnya ia perlu kembali ke persediaan. Penerima terakhir dan tombol pemeriksaan jauh di bawah layar.
- **Bukti kode:** persediaan dirender sebelum seluruh penerima (`src/DistributionApp.tsx:155-175`); setiap penerima berisi tombol target dan area alokasi (`:177-202`); tombol pemeriksaan ditempatkan setelah grid penerima (`:206-209`). Grid penerima memakai `repeat(auto-fit, minmax(min(100%, 12rem), 1fr))` (`src/distribution.css:189-193`), sehingga pada lebar konten ponsel 320–412 px hanya ada satu kolom. Breakpoint `max-width:600px` hanya mengubah lebar/padding app dan flex toolbar/actions (`:274-287`), bukan menjadi grid penerima dua kolom.
- **Reproduksi simulasi awal:** pada `320×640`, heading y=107, toolbar y=328, persediaan y=508 (tinggi 251), penerima pertama y=780, penerima kelima y=1.553, tombol periksa y=1.749, dan tinggi halaman 1.901 px. Pada `390×844`, persediaan y=429, penerima pertama y=639, tombol periksa y=1.608, tinggi halaman 1.760 px. Nilai ini adalah koordinat dokumen, bukan koordinat tetap pada layar.
- **Penyebab:** satu kolom kartu dengan minimum 12rem serta urutan persediaan → lima kartu → aksi terkonfirmasi. Kartu masing-masing sekitar 180 px sebelum feedback.
- **Dampak:** hubungan stock–recipient tidak dapat dilihat seluruhnya; anak harus melakukan scroll bolak-balik untuk distribusi berulang. Pada landscape `844×390`, penerima menjadi empat kartu di baris pertama dan satu di baris berikutnya; tinggi layar tetap memerlukan scroll.
- **Rekomendasi:** buat papan distribusi mobile lebih ringkas. Evaluasi grid penerima responsif (misalnya dua kolom hanya bila label/feedback tetap terbaca) dan persediaan berbentuk tray ringkas. Karena menyusun grid saja tidak membuat persediaan tetap terlihat ketika anak menggulir penerima, pilihan paling efektif untuk mengurangi bolak-balik adalah mempertahankan akses ke tray persediaan saat pengguna berada pada daftar penerima. `position: sticky` adalah kandidat, bukan keputusan: bila dipilih, batasi pada tray persediaan, beri latar solid dan offset yang benar, serta uji agar tidak menutupi navigasi, feedback, tombol fokus, atau kartu. Jangan menetapkan tinggi tetap pada papan.
- **Perkiraan file implementasi:** `src/distribution.css`; mungkin struktur pembungkus pada `src/DistributionApp.tsx`. Jangan ubah `src/learning/distribution.ts` atau evaluator.

### B2. Feedback salah dapat berada jauh di luar viewport setelah pemeriksaan

**Prioritas: P1 — feedback penting secara visual; status live tetap ada.**
**Status:** CONFIRMED FROM CODE; REPRODUCED IN SIMULATION, bukan perangkat fisik.

- **Gejala:** feedback global ditempatkan di atas toolbar/papan. Jika anak menekan “Sudah selesai, periksa!” setelah menggulir ke bagian bawah, hasil dapat muncul di atas area yang sedang dilihat.
- **Bukti kode:** `src/DistributionApp.tsx:125-146` merender `<aside className="distribution-feedback">` setelah page heading dan sebelum toolbar; toolbar/papan/tombol periksa berada setelahnya. Tidak ada perpindahan fokus atau scroll ke feedback pada `checkDistribution` (`:52-58`) atau handler tombol (`:206-209`). Feedback diberi `aria-live="polite"` dan `aria-atomic="true"` (`:125-126`), sehingga jalur pembaca layar tersedia, tetapi tidak menjamin visibilitas visual.
- **Reproduksi simulasi:** pada 320×640, setelah distribusi salah dan scroll ke tombol bawah, tombol diperiksa melalui touch emulation. Tinggi dokumen berubah dari 1.901 menjadi 2.405 px; scrollY bertahan dekat dasar (1.614 px), sementara feedback berada pada top relatif viewport sekitar −1.286 px. Feedback berada di luar layar; tombol dan bagian bawah papan tetap di area yang terlihat.
- **Dampak:** anak mungkin tidak langsung melihat alasan koreksi setelah pemeriksaan, meskipun feedback inline per penerima ada di papan dan region global mempunyai `aria-live`.
- **Rekomendasi:** pertimbangkan menampilkan status ringkas dekat tombol pemeriksaan atau memberi fokus/scroll yang terkontrol ke feedback setelah pemeriksaan, tanpa memindahkan papan atau menghapus alokasi. Verifikasi perilaku keyboard dan screen reader serta pastikan pembaca layar tidak mengumumkan feedback dua kali. Prioritaskan feedback penerima yang kontekstual dan tetap terlihat saat perbaikan.
- **Perkiraan file implementasi:** `src/DistributionApp.tsx` dan `src/distribution.css`; jangan mengubah kapan attempt disimpan.

### B3. Tombol “Kembalikan” sedikit di bawah sasaran tinggi sentuh

**Prioritas: P2.**
**Status:** CONFIRMED FROM CODE; belum ada pengukuran aktual perangkat.

- `src/distribution.css:115-120` menetapkan min-height 44 px untuk `.return-item`, tetapi aturan khusus `:258-265` menimpanya menjadi 40 px. Tombol lain yang diperiksa memiliki target sekitar/di atas 44 px; `.recipient-target` terukur sekitar 49 px dalam emulasi.
- **Rekomendasi:** jika tidak mengganggu layout assignment, naikkan min-height tombol pemulangan menjadi sekurang-kurangnya 44 px dan uji jarak antar tombol. Ini perubahan CSS kecil.

## 5. Investigasi Drag-and-Drop

| Aktivitas | Implementasi aktual | Hasil simulasi | Kesimpulan |
|---|---|---|---|
| 00.1-A | HTML Drag and Drop API: astronaut `draggable`, `onDragStart` menulis ID ke `dataTransfer`; roket `onDragOver` mencegah default dan `onDrop` membaca ID lalu dispatch `pair`. `src/MatchingApp.tsx:26-30,39-43,55-58`. | Mouse drag di HeadlessChrome membuat satu pasangan. Touch emulation tidak membuat pasangan, tetapi target roket pada percobaan berada di y≈925, di luar viewport 844 px; percobaan ini **inconclusive** untuk kemampuan event touch. Tap astronaut lalu scroll dan tap roket berhasil membuat pasangan. | Drag desktop tersedia; dukungan touch nyata belum diketahui. Penyebab layout yang memisahkan target terkonfirmasi. Jangan mengklaim Samsung Internet gagal berdasarkan simulasi ini. |
| 00.1-B | HTML Drag and Drop API: benda stok `draggable` dan `onDragStart`; target penerima menangani `onDragOver`/`onDrop`. `src/DistributionApp.tsx:40-50,160-169,179-186`. | Mouse drag mengurangi stok dari 5 menjadi 4 dan memberi 1 alokasi. Touch drag emulation dengan sumber dan target sama-sama di viewport (390×844; pusat sumber y≈514, target y≈718) berakhir dengan stok 5 dan alokasi 0. Tap benda lalu tap target berhasil: stok 4, alokasi 1. | Touch drag tidak bekerja dalam browser emulation tersebut; ini **bukan** hasil uji perangkat Samsung/Android. Tap fallback bekerja dalam emulasi. |

Pemeriksaan source tambahan tidak menemukan `onPointer*`, `onTouch*`, `touch-action`, `setPointerCapture`, atau `releasePointerCapture` di `src`. Drag/drop yang aktif bergantung pada event native HTML DnD; tidak ada jalur Pointer/Touch khusus. CSS aktivitas juga tidak memakai `touch-action`, `position:sticky/fixed`, atau deklarasi `overflow` yang dapat mematikan scroll atau memotong papan.

**Kemungkinan penyebab:** mekanisme HTML DnD adalah fakta source; tidak adanya handler sentuh juga fakta source. Browser mengambil alih gesture untuk scrolling atau tidak memulai native drag pada sentuhan adalah hipotesis yang masuk akal dan sejalan dengan simulasi 00.1-B, tetapi penyebab spesifik pada Samsung Internet belum terkonfirmasi. Tidak ada bukti cukup untuk mengatribusikannya ke versi browser tertentu.

**Keamanan/state:** state matching baru berubah pada `dropOnRocket`; assignment B baru berubah pada `handleDrop`. Tidak ada perubahan state pada `dragstart`; drop di luar target tidak menjalankan handler target sehingga benda tidak semestinya hilang/terduplikasi melalui drag yang dibatalkan. Reducer tetap menjadi sumber aturan dan undo. Namun, pada B `handleDrop` menjalankan `select-item` lalu `assign`; reducer toggle pilihan item yang sama. Karena itu, bila benda lebih dulu dipilih dengan tap lalu benda yang sama diseret, jalur ini berpotensi membatalkan pilihan dan gagal mengalokasikan. Ini **risiko teridentifikasi dari kode, belum direproduksi**, dan sebaiknya dimasukkan ke regression test jika drag dipertahankan.

Test `tests/matching-ui.test.tsx:305-312` memicu `dragStart/drop` dengan `DataTransfer` palsu di jsdom. Itu menguji handler/logika, bukan dukungan drag sentuh perangkat. Tidak ditemukan regression test sejenis untuk jalur drag B.

**Rekomendasi interaksi:** jadikan tap-to-select → tap tujuan metode utama yang selalu tersedia; drag tidak boleh menjadi syarat menyelesaikan tugas. Jangan menambah library. Sebelum mengimplementasikan drag touch, minta persetujuan Dimz apakah nilai UX-nya membenarkan kompleksitas. Jika disetujui, gunakan satu fungsi aksi domain yang sama untuk tap dan drag; Pointer Events dapat dipertimbangkan sebagai enhancement tanpa state bisnis kedua. Gunakan ambang gerak/cancel yang jelas, tangani `pointercancel`, pastikan hanya satu aksi saat drop, dan jangan mutasi sebelum drop valid. Untuk menjaga scroll, hindari `touch-action:none` pada seluruh halaman/board; bila perlu, uji handle drag khusus dengan touch-action lokal. Pertahankan tap, keyboard, fokus, serta scroll biasa. Uji pembatalan, drop di luar, undo, dan tap setelah drag pada perangkat nyata.

## 6. Analisis Scrolling, Layout, dan Viewport

Tinggi halaman aktivitas memang jauh melampaui tinggi viewport ponsel, tetapi tidak ada fixed height yang memotong konten. Pengalaman scroll terutama berasal dari urutan dan stacking konten, bukan bukti overflow horizontal.

| CSS viewport | 00.1-A: tinggi dokumen; panel; tombol periksa | 00.1-B: tinggi awal; persediaan; penerima pertama; tombol periksa | Horizontal overflow terukur |
|---|---|---|---|
| 320×640 | 2.068; panel y=506/934; tombol y=1.933 | 1.901; stok y=508; penerima y=780; tombol y=1.749 | Tidak |
| 360×800 | 1.923; panel y=506/896; tombol y=1.788 | 1.781; stok y=450; penerima y=660; tombol y=1.629 | Tidak |
| 375×812 | 1.843; panel y=432/818; tombol y=1.708 | 1.781; stok y=450; penerima y=660; tombol y=1.629 | Tidak |
| 390×844 | 1.800; panel y=411/776; tombol y=1.665 | 1.760; stok y=429; penerima y=639; tombol y=1.608 | Tidak |
| 412×915 | 1.800; panel y=411/776; tombol y=1.665 | 1.760; stok y=429; penerima y=639; tombol y=1.608 | Tidak |
| 844×390 landscape | 1.219; panel berdampingan y=354; tombol y=1.068 | 1.046; stok y=308; penerima y=457; tombol y=894 | Tidak |
| 1280×800 desktop emulasi | 1.248; panel berdampingan y=375; tombol y=1.089 | 833; stok y=312; penerima y=461; tombol y=681 | Tidak |

Angka posisi adalah CSS document coordinates dari emulasi, bukan hasil pengukuran Samsung Internet. Mode desktop memiliki scrollbar browser; lebar `documentElement.clientWidth` yang terukur 1.265 px dari emulasi 1.280 px.

- **00.1-A:** pada lebar ≤700, kelompok berpindah dari dua kolom menjadi dua panel berurutan. Token tetap 112 px tinggi. Board dan kontrol di bawahnya membuat scroll panjang, tetapi objek tidak terpotong.
- **00.1-B:** pada lebar ponsel hingga 412 px, minimum kartu 12rem mempertahankan satu kolom. Halaman hasil salah bertambah tinggi: pada emulasi 320×640 feedback global 192 px dan penerima kelima mencapai sekitar y=2.006 dengan feedback per penerima. Ini meningkatkan jarak scroll.
- **Landscape:** breakpoint berbasis lebar membuat panel A berdampingan pada 844 px, tetapi tinggi 390 px berarti tetap perlu scroll untuk kontrol. Pada B lima kartu terbagi empat + satu; tidak semua kontrol berada di satu viewport.
- **Navigasi:** pada ≤480 px dua tombol `.activity-switcher` berbagi lebar dan label membungkus. Pada 320 px tinggi tombol terukur sekitar 65 px, tanpa horizontal overflow. Toolbar B dan tombol A membungkus secara normal.
- **Browser zoom/pembesaran teks:** tidak diuji; wrapping/overflow pada zoom teks Android atau zoom halaman masih perlu verifikasi manual.
- **Virtual keyboard:** komponen aktivitas yang diperiksa tidak memiliki text input; 00.1-A memakai radio dan kedua aktivitas memakai tombol. Keyboard lunak tidak diperkirakan muncul pada alur biasa, tetapi perilaku toolbar/fokus dengan pengaturan aksesibilitas sistem belum diuji.

## 7. Matriks Prioritas P0/P1/P2

Definisi untuk audit ini: **P0** = blocker/data loss; **P1** = hambatan utama stabilisasi mobile; **P2** = polish atau target sekunder. P1 tidak berarti aktivitas sama sekali tidak dapat diselesaikan—tap adalah workaround yang bekerja.

| ID | Prioritas | Temuan | Status bukti | Dampak ringkas |
|---|---|---|---|---|
| A1 | P1 | Panel astronaut/roket stack vertikal dan berjauhan | CONFIRMED FROM CODE; REPRODUCED IN SIMULATION; gejala dilaporkan Dimz | Scroll antar kelompok memutus proses mencocokkan |
| B1 | P1 | Stok dan lima penerima dalam alur vertikal panjang | CONFIRMED FROM CODE; REPRODUCED IN SIMULATION; gejala dilaporkan Dimz | Scroll bolak-balik untuk mengambil benda dan memilih tujuan |
| B2 | P1 | Feedback pemeriksaan global berada di atas papan dan dapat di luar viewport setelah check dari bawah | CONFIRMED FROM CODE; REPRODUCED IN SIMULATION | Hasil penting tidak langsung terlihat secara visual |
| D1 | P1* | Drag memakai HTML DnD saja, tidak ada jalur pointer/touch | CONFIRMED FROM CODE; B touch drag REPRODUCED IN SIMULATION; laporan fisik Dimz | Drag jari tidak andal; tap tetap berfungsi |
| B3 | P2 | Tombol “Kembalikan” override target tinggi menjadi 40 px | CONFIRMED FROM CODE | Target sedikit di bawah sasaran 44 px |
| N1 | P2 | Label navigasi membungkus dan menghabiskan tinggi pada lebar sempit | CONFIRMED FROM CODE; ukuran terukur simulasi | Hierarki awal kurang ringkas, tetapi masih dapat digunakan |

`*D1` tetap P1 selama drag sentuh diperlakukan sebagai sasaran stabilisasi. Jika Dimz menyetujui bahwa drag hanya affordance opsional dan tap adalah metode resmi, turunkan ke P2/known limitation dan jangan menambah kompleksitas drag hanya demi kemiripan permainan. **Tidak ada temuan P0.**

## 8. Rekomendasi Desain Mobile-First

1. **00.1-A:** tempatkan kedua kelompok dalam satu bidang pandang di ponsel dengan token tetap terbaca dan target cukup besar. Uji panel berdampingan dengan satu kolom token per panel serta padding yang lebih hemat pada lebar 320 px; bila label jadi sempit, ubah komposisi papan, bukan mengecilkan semua teks/objek. Pertahankan status “Dipilih”, pasangan yang sudah dibuat, dan kontrol undo.
2. **00.1-B:** rancang ulang area bermain sebagai papan ringkas. Uji dua kolom penerima hanya jika tombol dan feedback tiap penerima tetap jelas pada lebar 320/360 px. Pertimbangkan tray persediaan yang tetap mudah dijangkau ketika daftar penerima digulir; sticky boleh dicoba dalam prototype, tetapi bukan keputusan final sebelum uji overlap dan landscape.
3. Kurangi tinggi instruksi dan chrome non-esensial di sekitar papan; jangan menghapus instruksi penting, target sentuh, atau akses ke hint/undo/pause.
4. Feedback salah harus terlihat dekat konteks penerima dan/atau tindakan pemeriksaan. Jangan mengubah pembagian anak saat feedback muncul.
5. Pertahankan halaman dalam alur normal yang dapat scroll; jangan memberi `height:100vh`/fixed-height pada papan, jangan membuat seluruh halaman tidak dapat discroll, dan jangan menaruh kontrol tetap yang menutupi kartu.
6. Pertahankan label teks/status agar warna dan animasi bukan satu-satunya pembawa informasi.

## 9. Rekomendasi Teknis Tanpa Dependency Baru

- CSS-first: `src/matching.css`, `src/distribution.css`, dan bila diperlukan `src/activity-navigation.css`. Ubah markup komponen hanya untuk grouping semantik, urutan visual, atau region feedback.
- Jangan sentuh logic/evidence untuk layout. Gunakan reducer yang ada sebagai sumber aturan.
- Jika drag touch disetujui, implementasikan sebagai jalur input tambahan di komponen (atau helper lokal tanpa dependency) yang memanggil aksi domain yang sama dengan tap. Tangani pointer capture bila digunakan, `pointercancel`, drop target valid, drop di luar, gesture scroll, dan suppress click hanya setelah drag sungguhan. Jangan mengunci scrolling seluruh page.
- Hindari event path terpisah yang membuat tap dan drag menghasilkan aturan/undo berbeda. Uji dragging benda terpilih, drop ke penerima penuh, drop di luar, drag dibatalkan, click/tap sesudah drag, serta undo.
- Setelah perubahan yang disetujui, jalankan typecheck, seluruh test, build, lint, `git diff --check`, lalu browser regression desktop dan viewport mobile. Audit ini sendiri tidak mengubah source dan tidak menjalankan quality gate kode.

## 10. Risiko Regresi yang Harus Dijaga

| Area | Risiko | Guardrail |
|---|---|---|
| Matching 00.1-A | Perubahan DOM/CSS dapat mengubah cara pilih pasangan, selection, atau radio sisa | Aksi tetap lewat `reduceMatch`; cek tap/Enter, undo, hint, retry, remainder, hasil inconclusive, completed variants |
| Distribution 00.1-B | Perubahan event/layout dapat mengalokasikan dua kali, kehilangan benda, atau mengubah isi saat hasil salah | `reduceDistribution` tetap satu-satunya rule source; tes duplikasi, stock conservation, return, undo, drop batal, salah/benar |
| Attempt/evidence | Pemeriksaan pada setiap klik atau snapshot berulang bisa menggandakan attempt/menjadi fresh independent | Hanya tombol eksplisit yang memanggil pemeriksaan; jaga attempt identity, repeatedVariant, hint history, retry, inconclusive; jangan ubah evidence store |
| Feedback | Scroll/focus otomatis dapat membuat fokus keyboard lompat atau live announcement ganda | Uji keyboard/AT dan pastikan feedback diumumkan sekali tanpa menghilangkan konteks papan |
| Pointer drag | `pointercancel`/gesture click dapat menyebabkan aksi ganda atau mengganggu scroll | Pisahkan drag threshold/handle dari tap; tidak ada mutasi sebelum drop valid; uji di perangkat fisik |
| Responsive/accessibility | Grid dua kolom/sticky dapat mempersempit kartu, menutup fokus, atau overflow pada zoom | Ukur 320 px, pembesaran teks, landscape; target ≥44 px; tidak ada clipping/overlay |
| Desktop | Breakpoint mobile dapat mengubah layout/drag desktop | Uji mouse drag dan desktop layout setelah setiap perubahan CSS/DOM |

Tidak ada perubahan pada `src/learning/matching.ts`, `src/learning/distribution.ts`, evidence store, atau dependency selama audit.

## 11. Rencana Implementasi Bertahap (Menunggu Approval)

1. **Validasi perangkat:** catat model HP, Android, versi Samsung Internet, orientasi, dan zoom; ulangi langkah reproduksi di bawah pada perangkat Dimz.
2. **Perbaikan layout 00.1-A:** prototype CSS untuk menjaga dua kelompok terlihat bersama; uji 320–412 portrait, landscape, desktop, dan target sentuh.
3. **Perbaikan layout 00.1-B:** prototype papan/tray persediaan dan kartu penerima; ukur scroll bolak-balik, visibilitas hasil salah, undo, dan ruang pada landscape.
4. **Keputusan drag:** pilih secara eksplisit antara tap sebagai metode resmi tanpa drag touch, atau Pointer Events sebagai enhancement. Jangan memasang library. Jika drag disetujui, tambah unit/UI regression test termasuk pembatalan, duplicate, dan scroll.
5. **Regression gate dan pengujian manual:** typecheck/tests/build/lint/diff check, lalu ulangi checklist fisik. Jangan commit/push tanpa instruksi terpisah.

## 12. Checklist Pengujian Manual Android Samsung Internet

Catat model HP, versi Android, versi Samsung Internet, orientasi, ukuran zoom, dan apakah gesture dimulai dengan jari atau stylus.

### Masing-masing viewport/orientasi

- [ ] 320×640, 360×800, 375×812, 390×844, 412×915 CSS px bila perangkat/pengaturan memungkinkan.
- [ ] Portrait dan landscape; periksa juga setelah toolbar browser muncul/hilang.
- [ ] Uji zoom halaman dan pembesaran teks sistem; tidak ada horizontal overflow, teks terpotong, tombol tertutup, atau fokus di balik tray.
- [ ] Scroll biasa tetap berjalan di atas token, di sela target, dan dekat toolbar.

### 00.1-A

- [ ] Astronaut dan roket dapat dilihat/dihubungkan tanpa scroll bolak-balik yang tidak perlu.
- [ ] Tap astronaut → tap roket; status terpilih jelas; percobaan pasangan yang tidak valid tidak mengubah state.
- [ ] Jika drag tersedia: drag tiap arah, tahan lalu scroll, `pointercancel`, lepas di luar target, lepas di roket terpakai, lalu tap/keyboard; tidak ada pasangan ganda atau benda hilang.
- [ ] Undo, coba lagi, hint, jeda/lanjut, remainder radio, pemeriksaan benar/salah/inconclusive, dan pergantian variasi tetap bekerja.
- [ ] Focus-visible dapat dilihat dan label tombol diumumkan screen reader bila tersedia.

### 00.1-B

- [ ] Persediaan tetap mudah dijangkau saat mengisi lima penerima; tidak perlu scroll bolak-balik berulang.
- [ ] Tap benda → tap penerima dan return-item bekerja; benda tidak hilang/duplikat; undo mengembalikan alokasi yang tepat.
- [ ] Jika drag tersedia: drag benda yang belum dipilih dan yang telah dipilih, drag ke penerima kosong/penuh, drop di luar, batalkan dengan scroll, dan segera tap sesudahnya.
- [ ] Salah: seluruh alokasi tetap ada, pesan penerima mudah ditemukan, perubahan memperbarui papan; benar/inconclusive juga memberi feedback terlihat.
- [ ] Tombol pemeriksaan tidak membuat attempt duplikat pada snapshot sama; retry/hint tidak mengubah status evidence menjadi independent secara otomatis.
- [ ] Pause/resume, keyboard, focus-visible, live status, dan navigasi tetap tersedia; target “Kembalikan” nyaman disentuh.

## 13. Hal yang Belum Dapat Diverifikasi

- Perilaku pada Android fisik dan Samsung Internet, termasuk model/version yang belum diketahui.
- Apakah perilaku drag touch berbeda antara Samsung Internet, Chrome Android, Firefox Android, dan iOS.
- Apakah sentuhan dengan stylus menghasilkan perilaku berbeda.
- Hasil browser zoom/pembesaran teks pada browser dan pengaturan sistem sesungguhnya.
- Screen reader Android, urutan fokus dengan keyboard fisik, kontras warna formal, dan pengumuman live region.
- Layout visual lengkap pada setiap kombinasi ukuran perangkat; pengukuran lintas viewport di atas adalah DOM/CSS emulation, bukan inspeksi screenshot manual pada setiap state.
- Console error/warning, karena console tidak diperiksa melalui harness yang tersedia.
- Drag touch 00.1-A dalam kondisi source dan target sama-sama terlihat; pada percobaan 390×844 target berada di bawah viewport. Hasil tersebut tidak dipakai sebagai bukti kegagalan event.

## 14. Keputusan yang Membutuhkan Approval Dimz

1. Apakah **tap-to-select → tap tujuan** ditetapkan sebagai metode mobile utama dan drag hanya enhancement opsional?
2. Jika drag jari penting untuk UX, apakah Dimz menyetujui prototype Pointer Events tanpa dependency baru, dengan pengujian perangkat sebelum dirilis?
3. Apakah Dimz menyetujui prototype tray persediaan yang tetap terjangkau (termasuk uji sticky terbatas) untuk 00.1-B?
4. Apakah Dimz menyetujui pengubahan layout CSS/markup pada `src/matching.css`, `src/distribution.css`, `src/activity-navigation.css`, serta komponen terkait setelah prototype disetujui?

## 15. Batas Audit dan Status

Audit ini hanya membuat laporan. Tidak ada source code, learning logic/evidence, dependency, konfigurasi global, backend, cloud, atau deployment yang diubah. Tidak ada commit atau push. Typecheck, tests, build, dan lint tidak dijalankan sebagai bagian audit-only ini; tidak ada klaim bahwa semuanya dijalankan. Perubahan kerja yang sudah ada sebelum audit tidak diubah oleh audit ini.

**Status akhir:** temuan dan rekomendasi siap direview Dimz. Tidak ada implementasi yang dilakukan atau akan dilakukan sebelum approval eksplisit.