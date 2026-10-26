# Phase 2C — Spesifikasi Pembelajaran dan Interaksi 00.1-B
## Membagikan Satu untuk Setiap Objek

Status: IMPLEMENTED PROTOTYPE — revisi UX single-board disetujui; belum divalidasi sebagai alat asesmen.

## 1. Tujuan dan batas

Aktivitas ini berada pada kompetensi `00.1 One-to-One Correspondence`. Anak membagikan benda dari satu persediaan bersama kepada para penerima, satu benda untuk setiap penerima. Hasil distribusi diperiksa berdasarkan snapshot papan; persediaan yang masih berisi benda adalah fakta papan, bukan respons anak yang terpisah.

### Tujuan pembelajaran yang dapat diamati

Setelah mencoba aktivitas, anak diharapkan dapat:

1. Mengambil benda dari persediaan dan membagikannya satu per satu kepada penerima yang berbeda.
2. Membentuk dan memeriksa distribusi “tepat satu benda untuk setiap penerima” pada satu papan yang selalu menampilkan persediaan serta seluruh penerima.
3. Menggunakan feedback pada papan untuk memperbaiki distribusi bila perlu.
4. Jika diminta pada task lain, menunjukkan atau menjelaskan alasan sederhana, misalnya, “Yang ini belum dapat” atau “Setiap teman sudah dapat satu.” Penjelasan lisan bukan syarat task ini dan tidak diukur secara terpisah.

Batas klaim: aktivitas menilai hasil distribusi pada task yang diberikan. Aktivitas ini sendiri tidak menetapkan mastery, diagnosis, atau kemampuan umum anak.

### Perbedaan bermakna dari 00.1-A

00.1-A meminta anak mencocokkan dua kelompok yang sudah tersedia dan menjawab sisi mana yang tersisa. 00.1-B mengubah struktur tindakan: anak mengambil benda dari persediaan bersama dan melakukan distribusi bertahap ke penerima. Persediaan berkurang saat benda dibagikan, status penerima berubah saat menerima, dan hasil harus diperiksa dari tindakan alokasi tersebut.

Jangan sekadar mengganti astronaut/roket dengan teman/bintang sambil mempertahankan papan dua kolom dan pola klik pasangan 00.1-A. B harus memakai representasi “persediaan → penerima” dan keadaan distribusi yang dapat dibangun, diperiksa, serta diperbaiki anak. Dasar konsep tetap beririsan pada korespondensi satu-satu; perbedaannya adalah konteks keputusan dan proses distribusi, bukan klaim bahwa konsep matematika dasarnya sama sekali baru.

### Batas implementasi

- Spesifikasi ini hanya untuk `00.1-B`; tidak mengubah atau membuka kembali implementasi `00.1-A`.
- Tidak menetapkan kebutuhan backend, cloud, dependency, persistence, analytics, atau mastery engine.
- Singapore MOE Primary Mathematics Syllabus tetap `NOT VERIFIED`; dokumen ini tidak membuat klaim kesesuaian dengannya.
- Rancangan aktivitas, tantangan, dan evidence di sini adalah keputusan desain internal yang perlu ditinjau dan diuji bersama anak.

## 2. Konteks dan prinsip desain

Observasi langsung pada 00.1-A menunjukkan anak usia 8 tahun yang diuji dapat mengoperasikan aktivitas, menjawab, dan menjelaskan alasan, tetapi cepat bosan karena tiga susunan terlalu mudah. Karena itu 00.1-A dianggap selesai untuk MVP saat ini. Jangan memperpanjangnya dengan sekadar menambah angka/jumlah.

00.1-B sebaiknya menawarkan variasi penalaran melalui kondisi distribusi, susunan penerima, benda, dan konteks. Tidak ada timer, penalti, nyawa, skor kompetitif, papan peringkat, atau hadiah yang mengutamakan kecepatan. Anak boleh berpikir, memperbaiki distribusi, meminta petunjuk, menjeda, atau berhenti.

Prinsip dari spesifikasi Phase 2A tetap berlaku: tujuan utama jelas, instruksi pendek, bantuan bertahap, drag-and-drop selalu memiliki alternatif ketuk/klik, feedback suportif, warna bukan satu-satunya penanda, dan kesalahan input tidak otomatis dianggap kesalahan konsep.

## 3. Alur permainan

1. **Pengenalan situasi:** tampilkan instruksi ringkas, misalnya “Bagikan satu benda untuk setiap teman.” Tampilkan persediaan bersama dan semua penerima pada papan.
2. **Distribusi pada papan:** anak memilih benda lalu memilih penerima. Persediaan berkurang saat benda dibagikan; setiap alokasi tetap terlihat di kartu penerima. Anak boleh memberi lebih dari satu benda kepada penerima yang sama. Sistem tidak menghapus/menolak benda kedua dan tidak memberi verdict matematika pada klik atau perpindahan.
3. **Pemeriksaan eksplisit:** satu tombol utama pada papan, **“Sudah selesai, periksa!”** menandai permintaan anak untuk memeriksa snapshot distribusi saat ini. Tidak ada layar/form pemeriksaan terpisah, daftar checkbox penerima, atau pertanyaan radio tentang sisa. Persediaan dan seluruh penerima tetap terlihat.
4. **Feedback dan perbaikan pada papan yang sama:** setelah tombol ditekan, evaluasi snapshot satu kali dan tampilkan feedback yang sesuai. Bila salah, pertahankan seluruh alokasi; tandai secara tekstual penerima yang belum mendapat atau mendapat lebih dari satu, lalu anak dapat memindahkan/mengembalikan benda atau undo tanpa reset. Mengubah papan menghapus feedback yang sudah tidak mutakhir; anak dapat menekan tombol pemeriksaan lagi untuk membuat attempt baru.
5. **Selesai benar, jeda, atau mulai ulang:** hasil benar mendapat feedback sesuai aturan jumlah/variant yang aktif. Jeda/resume mempertahankan papan selama halaman terbuka. Bila anak ingin memulai ulang secara eksplisit, retry membuat papan baru tetapi mempertahankan riwayat hint dan attempt yang sudah tersimpan di memori.

### Representasi interaksi yang direkomendasikan

- Papan tunggal menampilkan persediaan bersama dan semua kartu penerima sebelum maupun sesudah pemeriksaan.
- Kartu/area penerima memperlihatkan benda yang sudah diterima dan pesan konteks setelah pemeriksaan bila jumlahnya belum tepat satu.
- Indikator berbasis teks/ikon/posisi membedakan belum menerima dan sudah menerima; jangan mengandalkan warna saja.
- Persediaan tetap terlihat, termasuk benda yang belum dibagikan; anak tidak diwajibkan menghitung jumlah sisa secara eksak.
- Benda tidak menghilang akibat drop di lokasi invalid; aplikasi tidak otomatis membagikan benda atau memilih penerima.
- Anak boleh menempatkan lebih dari satu benda pada penerima yang sama. Semua benda tetap terlihat dan dapat dipindahkan kembali; sistem tidak menolak atau menghapus benda kedua otomatis.

## 4. Variasi tantangan

Variasi berikut menetapkan tiga jenis tantangan awal yang berbeda: persediaan cukup, kurang, dan lebih. Contoh prototipe 5 penerima/5 benda, 6 penerima/4 benda, dan 4 penerima/6 benda hanya contoh untuk membahas alur; angka final belum diputuskan. Pilih kuantitas kecil-menengah dan variasikan hubungan jumlah, cara distribusi, tata letak, serta konteks sebelum mempertimbangkan kenaikan jumlah. Tidak wajib memainkan semua variasi dalam satu sesi.

### A. Persediaan cukup — satu untuk setiap penerima

- Contoh: 5 teman dan 5 kartu ucapan.
- Tata penerima dapat tersebar, berbeda baris, atau tidak mengikuti urutan kiri-ke-kanan.
- Fokus: mendistribusikan satu per satu tanpa melewatkan penerima atau memberi ganda.

### B. Benda lebih sedikit daripada penerima

- Contoh: 6 teman dan 4 paket bibit.
- Anak mendistribusikan benda kepada penerima yang berbeda. Penerima yang belum mendapat tetap tampak pada papan; sistem menilai hasil dari snapshot, bukan dari laporan terpisah anak.
- Jangan mengharuskan anak memilih “siapa yang lebih cepat”; penerima yang belum menerima ditentukan oleh distribusi yang dibuat anak.

### C. Benda lebih banyak daripada penerima

- Contoh: 4 keranjang dan 6 buah.
- Anak memberi satu benda kepada setiap penerima, sementara benda yang tersisa tetap terlihat di persediaan. Snapshot menguji distribusi; ia tidak membuktikan bahwa anak menyebut/mengidentifikasi sisa secara terpisah.
- Jangan meminta anak menghabiskan semua buah jika itu mengharuskan pemberian kedua kepada penerima.

### D. Tata letak/urutan berubah

- Posisi penerima tidak berbaris rapi; dapat berbentuk dua baris, lingkaran, atau susunan asimetris.
- Persediaan diletakkan terpisah dari penerima; urutan visual tidak memberi petunjuk siapa yang harus dipilih berikutnya.
- Gunakan benda/karakter dan latar berbeda agar anak tidak hanya mengingat jawaban layar sebelumnya.

### E. Konteks transfer

- Membagikan satu pensil ke setiap meja, satu kartu ke setiap teman, atau satu buah ke setiap keranjang.
- Aturan tetap eksplisit: satu untuk setiap penerima. Jangan menyisipkan aturan tambahan (warna, nilai, atau kategori) tanpa menjelaskan bahwa itu tujuan baru.

Jangan menyajikan rangkaian panjang dari variasi yang hampir identik. Pilih variasi yang menguji distribusi di bawah tata letak/kondisi berbeda, beri kesempatan berhenti, dan pertimbangkan sesi pendek.

## 5. Aturan interaksi

### Input dan aksesibilitas

- Drag-and-drop boleh disediakan, tetapi harus ada jalur setara: ketuk/klik benda di persediaan, lalu ketuk/klik penerima.
- Keyboard dapat menjadi alternatif tambahan: fokus benda, pilih, lalu navigasi dan konfirmasi penerima dengan kontrol native yang jelas.
- Target interaktif besar dan memiliki jarak; nama kontrol dapat dipahami screen reader.
- Fokus keyboard terlihat; urutan fokus logis dari instruksi → persediaan → penerima → pemeriksaan → bantuan/jeda.
- Status penerima/benda dapat diketahui lewat teks, bentuk, ikon, dan posisi, bukan warna saja.
- Hormati `prefers-reduced-motion`; animasi perpindahan harus dapat dimatikan/tidak penting untuk memahami state.
- Sediakan undo untuk distribusi terakhir dan cara memperbaiki satu alokasi tanpa reset seluruh task.
- Drop/klik yang tidak valid tidak menghapus atau menggandakan benda. Jelaskan secara singkat dan biarkan anak mencoba lagi.

### State distribusi dan validasi

Task menetapkan jumlah penerima, persediaan, dan aturan “tepat satu untuk setiap penerima”. Untuk vertical slice saat ini hanya variant `sufficient` yang berjalan dengan lima penerima/lima benda sebagai data prototipe; `shortage` dan `surplus` belum diimplementasikan.

- Selama aktivitas, satu benda berada di persediaan atau pada tepat satu penerima; benda tidak digandakan atau hilang. Satu penerima boleh terlihat memiliki beberapa benda sebagai state yang keliru dan dapat diperbaiki.
- Papan persediaan dan seluruh penerima tetap tampil sebelum dan sesudah pemeriksaan. Tidak ada halaman review terpisah, daftar checkbox “Teman X perlu diperbaiki”, atau radio untuk melaporkan benda tersisa.
- Penempatan, pemindahan, pemilihan benda, dan undo adalah aksi UI, bukan jawaban final. Jangan memberi verdict matematika atau menyimpan attempt pada setiap klik.
- Tombol **“Sudah selesai, periksa!”** adalah satu-satunya batas pemeriksaan. Saat ditekan, sistem mengevaluasi satu snapshot penuh dan menyimpan satu attempt; tidak ada deklarasi selesai terpisah, form jawaban pemeriksaan, atau completed attempt sebelum aksi ini.
- Untuk variant `sufficient`, jawaban benar berarti setiap penerima memiliki tepat satu benda dan persediaan kosong. Sistem boleh mencatat fakta turunan `hasUnallocatedItems` pada snapshot, tetapi fakta ini hanya menggambarkan state papan—bukan jawaban anak dan bukan bukti bahwa anak mengidentifikasi sisa secara terpisah.
- Feedback salah ditampilkan pada papan yang sama: penerima kosong atau menerima lebih dari satu diberi pesan teks kontekstual. Seluruh alokasi dipertahankan. Anak dapat memperbaiki, mengembalikan benda, atau undo lalu menekan tombol pemeriksaan lagi.
- Attempt yang sudah diperiksa tetap tersimpan secara append-only di memory-only store. Pemeriksaan ulang atas pembagian yang berubah menghasilkan attempt baru; tombol pemeriksaan dikunci untuk snapshot pembagian yang sama agar klik berulang tidak menggandakan evidence.
- Outcome `inconclusive` (bila ada) menggunakan `valid: null`; jangan memaksa hasil menjadi benar/salah. Progress sesi hanya diperbarui setelah hasil valid benar.

## 6. Bantuan bertahap

Petunjuk bersifat opsional dan bertahap. Petunjuk tidak membagikan benda, tidak memilih penerima, dan tidak menyebut jawaban akhir secara langsung.

- **Level 1 — pertanyaan strategi:** “Bagikan satu per satu. Siapa yang sudah menerima?”
- **Level 2 — dukungan pengamatan:** “Periksa setiap kartu teman. Setiap teman perlu mendapat tepat satu benda.” Anak tetap menentukan sendiri benda dan penerima yang perlu diubah; jangan sorot penerima tertentu atau memindahkan benda.
- Jika petunjuk level 2 mengarahkan penerima tertentu, keberhasilan pada task tersebut dicatat sebagai hasil dengan bantuan secara internal, bukan sebagai independent.
- Petunjuk tidak boleh menyebut jawaban akhir, mengalokasikan benda otomatis, menghapus pilihan, atau menonaktifkan penerima lain sebagai cara memberi jawaban.
- Bila anak meminta bantuan, kontrol `Petunjuk` memberi arahan bertahap; jangan membuat tombol diagnosis kesulitan atau meminta anak mengklasifikasikan penyebab kesulitan.

Contoh copy anak: “Mau petunjuk?” dan “Lihat satu per satu, siapa yang belum mendapat?” Hindari istilah evidence, mastery, diagnostic, independent, guided, inconclusive pada layar anak.

## 7. Feedback anak

Feedback fokus pada tindakan dan hubungan matematika, bukan penilaian kemampuan anak.

### Distribusi benar

- Untuk variant `sufficient`: “Yeay, semua teman sudah mendapat satu benda!”
- Feedback ini menyatakan hasil snapshot distribusi yang diperiksa; tidak mengklaim mastery atau generalisasi.

### Distribusi belum tepat

- “Ayo kita periksa lagi bersama. Perhatikan kartu teman yang diberi pesan.”
- Pada kartu penerima kosong: “Teman ini belum mendapat benda.”
- Pada kartu penerima yang memiliki lebih dari satu: “Teman ini mendapat lebih dari satu benda. Kamu bisa mengembalikan salah satunya.”
- Semua alokasi tetap terlihat. Anak dapat memilih benda, mengembalikannya, memakai undo, atau memulai ulang secara eksplisit. Tidak ada auto-repair.

Jangan menggunakan “kamu tidak bisa”, “kamu ceroboh”, atau nada menghukum. Jangan menampilkan label klasifikasi internal. Jangan meminta anak menjawab terpisah apakah ada sisa atau siapa yang perlu diperbaiki; fakta persediaan berasal dari papan dan tidak menjadi bukti identifikasi sisa secara mandiri.

### Task belum diperiksa

- Selama distribusi, anak masih dapat mengalokasikan; jangan menilai klik atau meminta submit dan jangan membuat attempt.
- Tombol “Sudah selesai, periksa!” memicu pemeriksaan snapshot pada papan yang sama. Tidak ada layar pemeriksaan kedua atau formulir jawaban.
- Hanya tekanan tombol tersebut menghasilkan attempt. Bila papan salah, simpan attempt tersebut, tampilkan feedback kontekstual, dan pertahankan alokasi untuk diperbaiki.
- Setelah perbaikan, pemeriksaan berikutnya menghasilkan attempt baru; hasil lama tidak ditimpa dan bantuan/riwayat retry tetap tercatat.

### Jeda atau kebutuhan bantuan

- “Kita bisa berhenti sebentar.”
- “Mau melihat petunjuk?”

Tidak ada tombol khusus yang meminta anak membedakan kesulitan antarmuka dari kesulitan matematika.

## 8. Tahap task dan learning evidence internal

Aksi distribusi bukan jawaban matematika dan tidak dinilai satu per satu. Tabel membedakan manipulasi papan, pemeriksaan eksplisit, hasil, dan outcome yang tidak dapat ditafsirkan. Label internal bukan copy UI anak dan bukan keputusan mastery.

| Keadaan | Definisi normatif | Antarmuka anak | Perlakuan evidence/progres variasi |
|---|---|---|---|
| Distribusi berlangsung | Anak memilih, membagikan, memindahkan, mengembalikan, atau undo benda. Alokasi ganda boleh terjadi dan tetap terlihat. | Papan selalu menampilkan persediaan bersama dan semua penerima. Tidak ada verdict pada klik. | Belum ada completed attempt; raw event stream tidak disimpan. |
| Pemeriksaan diminta | Anak menekan “Sudah selesai, periksa!” | Snapshot dievaluasi; papan tetap terlihat dan menjadi lokasi feedback. | Simpan satu ringkasan attempt untuk snapshot ini. Fakta state seperti `hasUnallocatedItems` bukan jawaban anak tentang sisa. |
| Hasil salah yang dapat ditafsirkan | Snapshot melanggar aturan variant (untuk `sufficient`: ada penerima bukan tepat satu atau ada benda di stock). | Pesan kontekstual pada papan; alokasi dipertahankan. Anak dapat memperbaiki, undo, memeriksa ulang, atau memilih retry eksplisit. | Attempt salah tetap append-only. Hasil pemeriksaan ulang adalah attempt baru. Tidak ada diagnosis miskonsepsi dari satu attempt. |
| Hasil benar | Snapshot memenuhi aturan variant yang aktif. Untuk `sufficient`, tiap penerima tepat satu dan stock kosong. | Feedback positif sesuai kondisi jumlah, pada papan yang sama. | Tandai variant selesai untuk progres sesi saja. Attempt setelah hint/retry tetap guided, bukan fresh independent. |
| Tidak dapat ditafsirkan | Interaksi/instruksi tidak cukup untuk menilai dengan wajar. | Tawarkan bantuan atau jeda tanpa meminta anak mendiagnosis penyebabnya. | Outcome internal `inconclusive`, `valid: null`; tidak menandai variant selesai. |

**Butuh bantuan** adalah kondisi dukungan, bukan verdict benar/salah tersendiri. Anak boleh meminta hint sebelum maupun sesudah menyatakan selesai. Permintaan hint tidak mengakhiri task dan tidak menghasilkan attempt. Catat hanya level/jenis bantuan yang relevan pada ringkasan completed attempt; jika petunjuk konseptual digunakan, keberhasilan diklasifikasikan sebagai hasil dengan bantuan, bukan independent.

### Pemeriksaan eksplisit, bukan penilaian setiap klik

- Alokasi, pemindahan, pemilihan benda, dan undo tidak mengeluarkan verdict matematika. Feedback operasional hanya boleh menjelaskan status interaksi.
- Tombol **“Sudah selesai, periksa!”** memeriksa snapshot distribusi secara langsung. Papan tidak berpindah ke layar lain dan seluruh persediaan serta penerima tetap tampak.
- Evaluasi snapshot menghasilkan satu attempt. Tombol pemeriksaan untuk snapshot pembagian yang sama dinonaktifkan agar klik berulang tidak menggandakan evidence. Setelah alokasi berubah, pemeriksaan berikutnya menghasilkan attempt baru; attempt sebelumnya tidak dihapus.
- Jika hasil salah tetapi dapat ditafsirkan, feedback kontekstual ditempatkan pada papan; seluruh alokasi dipertahankan. Anak tidak wajib mengidentifikasi penerima/sisa lewat formulir terpisah.
- Riwayat hint tingkat tertinggi dan status retry tetap melekat pada pemeriksaan selanjutnya. Jawaban benar setelah hint atau retry tidak diklasifikasikan sebagai independent atau fresh independent.

### Model data minimal yang digunakan

Attempt memory-only memiliki `taskId` (`00.1-B`), `variantId`, `attemptId`, outcome internal, `valid` yang dapat bernilai null, jumlah penerima/benda, ringkasan berapa penerima tepat satu/tidak tepat satu, `hasUnallocatedItems` yang diturunkan dari snapshot, tingkat hint saat ini/riwayat, dan penanda pengulangan. `hasUnallocatedItems` adalah kondisi papan, bukan laporan anak atau evidence bahwa identifikasi sisa secara terpisah telah diuji. Simpan hanya pada batas tombol pemeriksaan; jangan simpan raw pointer/touch/drag stream, koordinat, atau seluruh urutan klik. Attempt dan checkpoint hanya hidup di memori halaman.

00.1-B tidak membuat mastery engine dan tidak menyimpulkan mastery penuh dari satu aktivitas. Bukti aktivitas ini tidak dicampur dengan progres variasi sesi atau progres susunan sesi 00.1-A.

## 9. Progres variasi dalam sesi (terpisah dari evidence)

Rancangan cakupan jangka lanjut mencakup `sufficient`, `shortage`, dan `surplus`, tetapi vertical slice saat ini hanya memuat `sufficient`. Prototipe menyimpan `completedVariants` di state UI memory-only; hasil benar menandai variant yang sedang aktif untuk sesi tersebut. Daftar dan navigasi tiga variant belum diimplementasikan dalam cakupan ini.

Aturan normatif untuk saat daftar variant kelak diperluas:

- Mulai sesi dengan tidak ada variant selesai. Membuka variant tidak menandainya selesai.
- Hanya snapshot yang secara eksplisit diperiksa dan bernilai benar yang menambahkan variant ke `completedVariants`.
- Distribusi yang belum diperiksa, hasil salah, dan `inconclusive` tidak menandai variant selesai.
- Bila ada tombol tantangan berikutnya, cari variant belum selesai secara melingkar dari urutan daftar; jangan melompati variant yang belum selesai atau mengulang yang sudah selesai otomatis.
- Progres sesi bukan learning evidence, tidak memengaruhi klasifikasi attempt/mastery, dan hilang saat reload.
- “Bermain lagi” secara eksplisit mengosongkan progres UI sesi; evidence attempt yang masih ada di memori tidak dihapus oleh reset tersebut.

## 10. Acceptance criteria

Normatif untuk prototipe 00.1-B saat ini; kriteria untuk variant yang belum dibuat berlaku sebagai batas desain sebelum implementasi berikutnya:

1. Anak mendapat instruksi ringkas untuk membagikan tepat satu benda kepada setiap penerima.
2. Persediaan dan semua penerima tetap terlihat pada satu papan selama distribusi dan setelah pemeriksaan.
3. Satu benda hanya berada di satu lokasi; alokasi ganda kepada satu penerima diperbolehkan sebagai state terlihat dan dapat diperbaiki.
4. Anak secara aktif memilih benda dan penerima; tidak ada auto-distribute atau jawaban otomatis.
5. Tombol utama adalah “Sudah selesai, periksa!”; tidak ada halaman pemeriksaan terpisah, checkbox/radio review, atau pertanyaan terpisah tentang sisa.
6. Klik/tap/drag, pemindahan, dan undo tidak mengeluarkan verdict atau menyimpan attempt. Satu snapshot dievaluasi hanya setelah pemeriksaan eksplisit.
7. Untuk `sufficient`, benar bila semua penerima menerima tepat satu benda dan persediaan kosong.
8. Untuk `shortage` (belum diimplementasikan), valid bila setiap benda dialokasikan kepada penerima berbeda dan persediaan kosong; penerima tak terlayani terlihat. Aplikasi tidak boleh mengklaim bahwa anak mengidentifikasi mereka secara terpisah kecuali ada respons eksplisit yang memang diuji.
9. Untuk `surplus` (belum diimplementasikan), valid bila setiap penerima mendapat tepat satu benda; sisa persediaan terlihat dan tidak dianggap salah. Tidak ada klaim identifikasi sisa secara terpisah tanpa respons eksplisit.
10. Pemeriksaan salah yang dapat ditafsirkan menampilkan feedback tekstual kontekstual pada papan dan mempertahankan seluruh alokasi untuk perbaikan tanpa reset otomatis.
11. Perbaikan dan pemeriksaan ulang menyimpan attempt baru, bukan menimpa attempt terdahulu. Hint/retry tetap tercatat; hasil benar setelah bantuan atau retry tidak menjadi fresh independent.
12. Fakta attempt mengenai sisa berasal dari snapshot papan (`hasUnallocatedItems`), bukan laporan anak; tidak ada klaim evidence bahwa identifikasi sisa secara terpisah telah diukur.
13. Hint tidak membagikan benda atau menyelesaikan alokasi; copy anak tidak menampilkan label evaluasi internal.
14. Tap/klik berfungsi tanpa drag. Keyboard, focus-visible, target interaktif, nama screen reader, reduced motion, serta state non-warna dapat diuji.
15. Tidak ada timer, penalti, perbandingan anak, kompetisi kecepatan, atau reward yang mendorong terburu-buru.
16. 5/5, 6/4, dan 4/6 hanya contoh prototipe; jumlah final belum ditetapkan. Hanya `sufficient` dibangun pada vertical slice saat ini.
17. Evidence, event UI, progres sesi, dan mastery terpisah; tidak ada keputusan mastery dari satu aktivitas.
18. Tidak ada backend/cloud atau persistence lintas reload pada implementasi sekarang.
19. Implementasi dibatasi pada 00.1-B; kode 00.1-A tidak berubah.

## 11. Risiko kebosanan dan mitigasi

| Risiko | Mitigasi desain |
|---|---|
| Aktivitas terasa seperti pengulangan 00.1-A dengan gambar baru. | Gunakan alur persediaan → alokasi aktif → pemeriksaan hasil; hindari dua kolom dan pemetaan pasangan satu klik yang sama. Uji apakah anak memahami bahwa ia sedang membagikan dari persediaan. |
| Task menjadi membosankan karena hanya bertambah banyak objek. | Variasikan jumlah relatif, susunan penerima, konteks, bentuk persediaan, dan strategi pemeriksaan sebelum menaikkan jumlah. Jaga durasi task singkat. |
| Banyak task yang identik terasa repetitif. | Pilih sejumlah kecil task kontras (cukup/kurang/lebih) dan hentikan saat tujuan task tercapai; tidak wajib melewati seluruh varian dalam satu sesi. |
| Visual layout secara tidak sengaja memberi urutan/jawaban. | Acak posisi yang dapat dipahami tanpa mengandalkan urutan tetap; lakukan review aksesibilitas agar pengacakan tidak mengganggu focus order atau label. |
| Benda ekstra mendorong anak membagikan dua kepada penerima. | Instruksi menyebut tepat satu; penerima dan alokasi terlihat jelas; anak dapat mengembalikan benda kedua dan menerima feedback netral. Jangan menghapus benda kedua secara diam-diam. |
| Anak merasa salah karena persediaan tidak habis pada kondisi surplus. | Jelaskan melalui instruksi bahwa satu benda untuk setiap penerima; feedback menegaskan bahwa benda yang tersisa dapat memang tidak perlu dibagikan. Jangan selalu menyamakan “semua benda habis” dengan berhasil. |
| Task shortage terasa seperti ada penerima yang “dihukum”. | Gunakan narasi netral, misalnya persediaan yang tersedia memang terbatas; hindari menyalahkan anak atau membuat karakter kecewa. |
| Hint menjadi jalan pintas atau membocorkan target. | Hint pertama mengajukan pertanyaan strategi; hint kedua hanya membantu memeriksa state dan tetap membiarkan anak mengambil/mengalokasikan benda. Uji kebocoran untuk setiap variant. |
| Distribusi ganda disebabkan salah tap, bukan miskonsepsi. | Tampilkan konfirmasi state yang jelas, undo/pemindahan kembali, target besar, alternatif klik dan keyboard; jangan mengklasifikasikan satu aksi ambigu sebagai miskonsepsi. |
| Penerima/benda tertutup atau sulit dipilih pada layar kecil. | Layout responsif, scroll/fokus yang tetap jelas, ukuran target memadai, dan uji viewport kecil serta pembesaran teks sebelum implementasi. |
| Aktivitas menjadi terlalu sulit karena aturan sampingan. | Satu tujuan per task; jangan gabungkan operasi penjumlahan, klasifikasi, membaca panjang, atau aturan warna tanpa tujuan terpisah dan instruksi eksplisit. |

## 12. Hal yang perlu diuji bersama anak

1. Apakah anak memahami satu tombol “Sudah selesai, periksa!” sebagai permintaan untuk mengevaluasi hasil, sementara papan tetap di layar? Apakah ia menyadari bahwa klik alokasi sebelumnya bukan verdict?
2. Apakah feedback tekstual pada penerima kosong dan penerima dengan benda lebih dari satu jelas serta membantu perbaikan tanpa reset?
3. Apakah anak dapat menemukan persediaan dan seluruh penerima selama feedback muncul, termasuk pada viewport kecil dan saat pembesaran teks?
4. Apakah hint bertahap mendukung strategi tanpa mengarahkan jawaban atau memindahkan benda? Apakah pengulangan/riwayat hint tercatat konsisten?
5. Rentang jumlah final dan durasi task; 5/5, 6/4, dan 4/6 hanya contoh prototipe. Tentukan lewat uji keterbacaan, beban interaksi, dan minat anak, bukan asumsi.
6. Uji aksesibilitas manual dengan keyboard, touch device, pembesaran teks, reduced motion, dan screen reader; pastikan alternatif tap/klik setara dengan drag.
7. Sebelum variant `shortage`/`surplus` dibangun, tentukan apakah tujuan eksplisitnya hanya distribusi atau juga respons anak untuk mengidentifikasi sisa/penerima yang belum terlayani. Jangan mengklaim evidence untuk respons yang tidak diminta.
8. Uji apakah anak dapat memperbaiki salah alokasi dan memahami bahwa bantuan atau retry tidak mengubahnya menjadi keberhasilan independent.

## 13. Dasar dokumentasi internal

- `docs/educational-references.md`: batas klaim CCSS `K.CC.B.4.a`; matching/distribusi lintas kelompok adalah penerapan konseptual/desain internal, bukan tuntutan literal aktivitas standar. `K.CC.C.6` mendukung perbandingan kelompok menggunakan matching/counting; tidak diklaim sebagai standar distribusi digital tertentu.
- `docs/learning-design-specification.md`: tujuan awal 00.1-B dan prinsip eksplorasi, variasi, bantuan, bukti berulang, serta kriteria mastery yang tidak bergantung satu jawaban.
- `docs/learning-interaction-specification.md`: aturan input alternatif, hint, feedback, error classification, completion, dan pemisahan event UI dari evidence; khususnya kontrak normatif bagian 11.
- Observasi langsung Dimz pada 00.1-A yang disebutkan pada permintaan Phase 2C: interaksi dan penjelasan berjalan baik, tetapi tiga susunan cepat membosankan. Ini menjadi masukan desain, bukan klaim validasi umum untuk semua anak.
