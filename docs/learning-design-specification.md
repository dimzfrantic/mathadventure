# Learning Design Specification — Math Adventure

Status: Phase 2A, revisi dokumentasi disetujui; dokumentasi saja, belum implementasi

## 1. Filosofi pembelajaran

Math Adventure adalah aplikasi local-first untuk membantu anak membangun pemahaman matematika melalui eksplorasi, representasi, alasan, dan transfer. Fokusnya bukan kecepatan, jumlah soal, atau hukuman atas kesalahan.

Prinsip desain:

1. Mulai dari tujuan konsep yang dapat diamati.
2. Gunakan objek konkret/virtual dan gambar sebelum simbol yang lebih abstrak.
3. Beri anak kesempatan menjelaskan atau menunjukkan alasan.
4. Variasikan susunan, objek, konteks, dan cara respons.
5. Bedakan kesalahan konsep dari kesalahan membaca, salah klik, atau masalah motorik.
6. Gunakan bantuan bertahap, bukan langsung memberikan jawaban.
7. Gunakan bukti dari beberapa percobaan, bukan satu jawaban.
8. Berikan jeda dan pemeriksaan transfer/retensi.
9. Jangan menampilkan label negatif kepada anak.
10. Izinkan anak melewati penguatan ketika bukti awal sudah cukup kuat.

Rujukan utamanya adalah kode CCSS yang tercantum di `educational-references.md`, dukungan pedagogis NCTM dari PDF lokal halaman 1–6, dan praktik publik Bedok Green. Aktivitas, status mastery, dan event adalah `INTERNAL DESIGN DECISION`.

## 2. Struktur pengalaman setiap kompetensi

Setiap kompetensi dapat memiliki urutan:

1. Explore — anak mengamati dan memanipulasi.
2. Discover — aplikasi memberi pertanyaan singkat tentang hubungan yang terlihat.
3. Guided practice — bantuan tersedia dan target dibuat sederhana.
4. Independent challenge — bantuan dikurangi dan representasi divariasikan.
5. Transfer/review — konsep digunakan pada konteks atau objek baru.

Tidak semua anak harus menyelesaikan setiap tahap. Diagnostic menentukan titik masuk dan kebutuhan penguatan.

## 3. Kompetensi 00.1 — One-to-One Correspondence

### Tujuan belajar

Anak dapat memasangkan satu objek dengan tepat satu objek lain, mengenali objek yang tersisa, dan menjelaskan bahwa setiap pasangan hanya memiliki satu anggota di masing-masing sisi.

### Prasyarat

- Memahami instruksi sederhana seperti “satu untuk setiap”.
- Mampu memilih atau menyeret satu objek.
- Tidak perlu sudah mampu membaca kalimat panjang.

### Hubungan referensi

- `DIRECT STANDARD`: CCSS `K.CC.B.4.a` hanya dalam konteks counting: tiap objek dihitung dipasangkan ke satu nama bilangan dan tiap nama bilangan ke satu objek. Standar itu tidak secara eksplisit meminta matching astronaut ke roket atau matching dua kelompok.
- Matching lintas dua kelompok dan distribusi benda adalah penerapan konseptual/internal, bukan tuntutan aktivitas langsung dari `K.CC.B.4.a`. Detail sumber ada di `educational-references.md`.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: NCTM PDF p. 3 tentang representasi dan p. 5–6 tentang manipulatif virtual.
- `INTERNAL DESIGN DECISION`: konteks astronaut–roket dan distribusi benda.

### Aktivitas A — Pasangkan Astronaut dan Roket

- Tujuan: mencocokkan satu astronaut ke satu roket.
- Instruksi anak: “Setiap astronaut butuh satu roket. Pasangkan mereka.”
- Interaksi: drag astronaut ke roket atau tap astronaut lalu tap roket.
- Keberhasilan: semua pasangan benar, tidak ada astronaut atau roket yang tertinggal.
- Miskonsepsi: satu astronaut dipasangkan dua kali, anak menganggap pasangan selesai karena posisi terlihat dekat, atau tidak memeriksa sisa objek.
- Nonmatematis: drag terlepas, target terlalu kecil, instruksi belum dipahami, anak lupa objek di luar area fokus.
- Hint 1: “Coba cari yang belum punya pasangan.”
- Hint 2: sorot hanya satu astronaut yang belum berpasangan; jangan menyorot roket jawaban atau menggambar/menghubungkan pasangan.
- Variasi: jumlah 3–8; posisi acak; roket lebih dekat atau lebih jauh; satu kelompok dapat memiliki sisa.
- Transfer: ganti konteks menjadi hewan–rumah atau kunci–gembok.
- Retensi: ulangi satu tugas singkat pada hari berikutnya dengan objek baru.
- Penguatan: jika anak berulang kali melewatkan objek atau membuat pasangan ganda setelah bantuan.
- Lewati penguatan: jika anak menyelesaikan dua susunan berbeda secara mandiri dan dapat menunjukkan objek yang tersisa.

### Aktivitas B — Bagikan Satu Benda untuk Setiap Penerima

- Tujuan: mendistribusikan benda satu per satu kepada karakter.
- Instruksi anak: “Berikan satu bintang untuk setiap teman.”
- Interaksi: tap satu bintang lalu tap satu karakter; drag juga tersedia.
- Keberhasilan: setiap karakter mendapat tepat satu benda dan anak dapat menunjukkan jika benda kurang atau tersisa.
- Miskonsepsi: memberi dua benda kepada satu karakter sebelum semua karakter mendapat satu; menganggap jumlah benda sama hanya karena terlihat berdekatan.
- Nonmatematis: salah tap karakter, lupa aturan setelah jeda, belum memahami kata “setiap”.
- Hint 1: “Cari teman yang belum menerima bintang.”
- Hint 2: tampilkan indikator kecil pada penerima yang sudah mendapat benda.
- Variasi: jumlah penerima dan benda tidak selalu sama; konteks ukuran dan posisi diubah.
- Transfer: membagikan pensil kepada meja atau buah kepada keranjang.
- Retensi: satu distribusi singkat tanpa label target.
- Penguatan: bila anak tidak mengikuti urutan satu-per-satu atau tidak dapat memeriksa sisa.
- Lewati penguatan: bila dua aktivitas distribusi dengan jumlah berbeda selesai mandiri.

## 4. Kompetensi 00.2 — Classification

### Tujuan belajar

Anak dapat mengelompokkan objek berdasarkan satu aturan yang disebutkan, mengubah aturan ketika diminta, dan menyebutkan aturan yang digunakan.

### Prasyarat

- Mampu membedakan bentuk, warna, atau ukuran yang terlihat.
- Mampu memahami instruksi “kelompokkan yang …”.
- Mampu memilih objek melalui tap/click.

### Hubungan referensi

- `DIRECT STANDARD`: CCSS `K.MD.B.3` tentang klasifikasi objek ke kategori yang diberikan.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: CCSS `MP7`; NCTM PDF p. 3 tentang struktur dan p. 4–5 tentang learning progression dan evidence.
- `INTERNAL DESIGN DECISION`: aturan dapat berubah dalam satu rangkaian.

### Aktivitas A — Sortir Berdasarkan Bentuk

- Tujuan: mengelompokkan lingkaran, segitiga, dan persegi.
- Instruksi anak: “Masukkan bentuk yang sama ke rumah yang sama.”
- Interaksi: drag/click objek ke area kategori; nama bentuk dapat dibacakan atau diwakili ikon.
- Keberhasilan: semua objek masuk kategori bentuk yang benar.
- Miskonsepsi: mengelompokkan berdasarkan warna padahal aturan bentuk; kategori berubah di tengah tugas tanpa disadari.
- Nonmatematis: belum mengenali kosakata bentuk, salah klik, area target tidak jelas.
- Hint 1: “Lihat sisi dan sudutnya. Mana yang bentuknya sama?”
- Hint 2: contohkan satu objek tanpa menyelesaikan objek lain.
- Variasi: warna dan ukuran dibuat berbeda agar bentuk menjadi atribut utama.
- Transfer: menyortir benda baru dengan bentuk yang sama.
- Retensi: sortir dua kategori singkat dengan bentuk berbeda.
- Penguatan: bila anak konsisten memakai warna sebagai aturan yang tidak diminta.
- Lewati penguatan: bila anak berhasil pada tiga kategori dan menyebut “aku mengelompokkan berdasarkan bentuk”.

### Aktivitas B — Ganti Aturan: Warna atau Ukuran

- Tujuan: menerapkan aturan baru pada kumpulan objek yang sama.
- Instruksi anak: “Sekarang gunakan aturan baru: kelompokkan berdasarkan warna.” Kemudian: “Coba lagi berdasarkan ukuran.”
- Interaksi: sortir ulang dengan tap/click dan tombol “ganti aturan”.
- Keberhasilan: anak mengikuti aturan baru dan tidak terikat pada kelompok sebelumnya.
- Miskonsepsi: menganggap kelompok pertama selalu benar; mencampur warna dan ukuran tanpa aturan.
- Nonmatematis: tidak memahami bahwa aturan berubah; lelah karena objek terlalu banyak.
- Hint 1: “Aturan sekarang bukan bentuk. Apa yang diminta?”
- Hint 2: tandai satu pasangan objek yang memiliki warna sama tetapi bentuk berbeda.
- Variasi: objek memiliki konflik atribut sehingga hanya satu aturan yang cocok.
- Transfer: mengelompokkan pakaian berdasarkan ukuran atau buah berdasarkan warna.
- Retensi: gunakan aturan baru dengan tampilan yang berbeda.
- Penguatan: bila anak gagal berpindah aturan dua kali berturut-turut.
- Lewati penguatan: bila anak berhasil menggunakan dua aturan berbeda dan dapat menyebutkan keduanya.

## 5. Kompetensi 00.3 — Quantity Comparison

### Tujuan belajar

Anak dapat membandingkan dua kelompok sebagai lebih banyak, lebih sedikit, atau sama banyak dengan menggunakan matching/counting, bukan hanya panjang barisan atau ukuran objek.

### Prasyarat

- One-to-one correspondence dasar.
- Mampu menghitung atau memasangkan dalam jumlah kecil.
- Memahami kata lebih banyak, lebih sedikit, sama.

### Hubungan referensi

- `DIRECT STANDARD`: CCSS `K.CC.C.6` dan dukungan `K.CC.B.4.b`.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: CCSS `MP2` dan `MP5`; NCTM PDF p. 3–5 tentang representasi, tools, evidence, dan assessment.
- `INTERNAL DESIGN DECISION`: sengaja mengubah panjang barisan, jarak, dan ukuran untuk mendeteksi misleading visual cues.

### Aktivitas A — Kelompok Mana yang Lebih Banyak?

- Tujuan: membandingkan dua kelompok objek.
- Instruksi anak: “Kelompok mana yang punya lebih banyak? Tunjukkan atau pilih jawabannya.”
- Interaksi: tap label “lebih banyak”, “lebih sedikit”, atau “sama”; tombol “pasangkan” tersedia.
- Keberhasilan: jawaban benar dan, pada sebagian tugas, anak dapat menunjukkan pasangan atau objek tersisa.
- Miskonsepsi: memilih barisan lebih panjang, objek lebih besar, atau kelompok lebih rapat tanpa menghitung.
- Nonmatematis: belum menguasai kosakata, salah tap, tidak menyadari objek tersembunyi karena layout.
- Hint 1: “Coba pasangkan satu dengan satu.”
- Hint 2: tampilkan garis pasangan netral untuk kedua kelompok; jangan highlight sisa atau sisi yang lebih banyak.
- Variasi: kelompok sama banyak dengan jarak berbeda; objek berbeda ukuran; orientasi vertikal.
- Transfer: bandingkan kursi dan anak, buah dan keranjang, atau benda dalam dua kotak.
- Retensi: satu perbandingan baru setelah jeda.
- Penguatan: jika anak mengikuti visual cue pada beberapa susunan.
- Lewati penguatan: jika berhasil pada susunan rapat, menyebar, dan ukuran berbeda tanpa hint.

### Aktivitas B — Buat Kelompok yang Sama Banyak

- Tujuan: membentuk kelompok yang sama banyak dengan model.
- Instruksi anak: “Buat kelompok kanan sama banyak dengan kelompok kiri.”
- Interaksi: pindahkan objek satu per satu; tap objek untuk menambah/mengurangi dalam batas yang jelas.
- Keberhasilan: kedua kelompok sama dan anak dapat memeriksa dengan pasangan.
- Miskonsepsi: menyamakan panjang visual, bukan jumlah; berhenti saat tampak seimbang tetapi ada objek tersisa.
- Nonmatematis: salah memahami operasi tambah/ambil; tidak mengetahui objek mana yang sudah dipindahkan.
- Hint 1: “Pasangkan setiap benda dengan satu benda di sebelahnya.”
- Hint 2: tampilkan pasangan yang belum lengkap.
- Variasi: mulai dari kelompok berbeda ukuran dan susunan.
- Transfer: membuat jumlah kursi sama dengan jumlah boneka atau buah sama dengan piring.
- Retensi: buat kelompok setara dengan objek baru.
- Penguatan: jika anak tidak memeriksa pasangan setelah menyusun.
- Lewati penguatan: jika dua kelompok setara dibuat dalam dua tampilan berbeda secara mandiri.

## 6. Kompetensi 00.4 — Pattern Recognition

### Tujuan belajar

Anak dapat mengenali unit berulang, melanjutkan pola AB/AAB, dan membuat pola berulang sendiri.

### Prasyarat

- Dapat membedakan atribut visual yang dipakai dalam pola.
- Memahami urutan kiri-ke-kanan atau arah pola yang ditentukan.
- Mampu memilih objek dari beberapa pilihan.

### Hubungan referensi

- `DIRECT STANDARD`: tidak ditetapkan untuk AB/AAB berdasarkan peninjauan sumber yang digunakan.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: CCSS `MP7` dan `MP8`; NCTM PDF p. 3 tentang struktur, reasoning, dan purposeful questions.
- `INTERNAL DESIGN DECISION`: AB/AAB dipilih sebagai pola berulang awal.

### Aktivitas A — Lanjutkan Polanya

- Tujuan: mengenali unit dan mengisi bagian yang hilang.
- Instruksi anak: “Pola ini berulang. Pilih benda yang datang berikutnya.”
- Interaksi: tap/click atau drag elemen berikutnya ke slot kosong.
- Keberhasilan: anak melanjutkan lebih dari satu langkah dan dapat menunjukkan bagian yang berulang.
- Miskonsepsi: menebak satu elemen tanpa mengenali unit; mengikuti warna tetapi mengabaikan bentuk yang menjadi aturan.
- Nonmatematis: membaca arah salah, salah klik, belum memahami kata berulang.
- Hint 1: “Cari bagian kecil yang terus diulang.”
- Hint 2: beri kurung visual pada satu unit, bukan jawaban.
- Variasi: AB, AAB, pola dengan bentuk dan warna yang bertukar; posisi awal diubah.
- Transfer: melanjutkan pola tepukan, benda kelas, atau kartu bergambar.
- Retensi: pola baru dengan unit yang sama tetapi objek berbeda.
- Penguatan: jika anak hanya benar untuk posisi yang dihafal.
- Lewati penguatan: jika anak mengenali unit dan melanjutkan AB serta AAB pada objek baru.

### Aktivitas B — Buat Polamu Sendiri

- Tujuan: membuat pola berulang dan mengomunikasikan unitnya.
- Instruksi anak: “Buat pola yang berulang. Setelah selesai, tunjukkan bagian yang diulang.”
- Interaksi: pilih dua atau tiga elemen, susun minimal dua siklus, lalu tandai unit.
- Keberhasilan: pola memiliki unit yang benar-benar berulang; anak dapat menunjuk unit.
- Miskonsepsi: membuat urutan tanpa pengulangan; mengubah aturan setelah satu siklus.
- Nonmatematis: pilihan objek tidak tersedia, terlalu banyak pilihan, belum memahami cara menandai unit.
- Hint 1: “Pilih bagian kecil, lalu ulangi bagian itu.”
- Hint 2: tampilkan satu contoh struktur tanpa mengisi pola anak.
- Variasi: minta AB atau AAB secara bergantian; gunakan objek berbeda.
- Transfer: membuat pola dengan gerakan, suara, atau benda nyata di rumah.
- Retensi: minta anak menjelaskan pola yang dibuat sebelumnya menggunakan objek baru.
- Penguatan: jika pola tidak memiliki unit berulang atau anak tidak dapat menunjuk unit.
- Lewati penguatan: jika anak dapat membuat dan menjelaskan dua pola berbeda.

## 7. Kompetensi 00.5 — Ordering and Relations

### Tujuan belajar

Anak dapat mengurutkan objek atau kelompok berdasarkan satu atribut yang disebutkan dan menjaga konsistensi relasi antarobjek.

### Prasyarat

- Dapat membandingkan dua objek berdasarkan atribut.
- Memahami kata pendek/panjang, kecil/besar, sedikit/banyak.
- Mampu mengikuti arah urutan, misalnya “dari paling pendek ke paling panjang”.

### Hubungan referensi

- `DIRECT STANDARD`: CCSS `K.MD.A.1`, `K.MD.A.2`, `1.MD.A.1`, serta dukungan `K.MD.B.3` untuk kategori berdasarkan jumlah.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: CCSS `MP2`, `MP5`; NCTM PDF p. 3–4 tentang representasi dan learning progression.
- `INTERNAL DESIGN DECISION`: setiap aktivitas menyatakan atribut agar anak tidak menebak dari warna/posisi.

### Aktivitas A — Susun Berdasarkan Panjang atau Ukuran

- Tujuan: mengurutkan tiga objek dari paling pendek ke paling panjang atau paling kecil ke paling besar.
- Instruksi anak: “Susun dari yang paling pendek ke yang paling panjang.”
- Interaksi: drag ke tiga slot atau tap dalam urutan.
- Keberhasilan: seluruh urutan benar, bukan hanya pasangan pertama.
- Miskonsepsi: menggunakan warna/posisi; membandingkan ujung objek yang tidak sejajar; hanya benar untuk dua objek.
- Nonmatematis: arah urutan terlewat, slot sulit dibaca, drag salah.
- Hint 1: “Cari yang paling pendek dulu.”
- Hint 2: tampilkan garis pangkal atau pembanding visual.
- Variasi: orientasi dan warna diubah; objek lebih dekat jaraknya.
- Transfer: pensil, pita, batang, atau gambar benda sehari-hari.
- Retensi: tiga objek baru dengan arah urutan dibalik.
- Penguatan: jika urutan berubah saat posisi objek berubah.
- Lewati penguatan: jika dua set tiga objek diurutkan mandiri dengan atribut yang diminta.

### Aktivitas B — Susun Kelompok Berdasarkan Kuantitas

- Tujuan: mengurutkan tiga kelompok dari paling sedikit ke paling banyak.
- Instruksi anak: “Susun kotak dari benda paling sedikit ke benda paling banyak.”
- Interaksi: drag/click kotak; anak dapat membuka mode pasangan untuk memeriksa.
- Keberhasilan: relasi keseluruhan benar.
- Miskonsepsi: memakai ukuran kotak atau panjang barisan; gagal membedakan jumlah saat susunan menyebar.
- Nonmatematis: tidak melihat semua objek, salah memahami “paling sedikit”, salah klik.
- Hint 1: “Hitung atau pasangkan benda di tiap kotak.”
- Hint 2: tampilkan satu pasangan perbandingan, bukan urutan jawaban.
- Variasi: jumlah kecil sampai sedang; susunan rapat, menyebar, dan bertumpuk.
- Transfer: mengurutkan piring berdasarkan jumlah buah atau rak berdasarkan jumlah buku.
- Retensi: urutan dari paling banyak ke paling sedikit dengan objek baru.
- Penguatan: jika anak hanya mengikuti panjang visual.
- Lewati penguatan: jika anak mengurutkan tiga kelompok dalam dua arah dan menjelaskan atribut kuantitas.

## 8. Kompetensi 00.6 — Conservation of Quantity

### Tujuan belajar

Anak memahami bahwa jumlah objek tetap sama ketika objek dirapatkan, disebarkan, dipindahkan, atau dikelompokkan ulang, selama tidak ada objek yang ditambah atau dihilangkan.

### Prasyarat

- One-to-one correspondence dan quantity comparison dasar.
- Dapat menghitung atau memasangkan kelompok kecil.
- Memahami perubahan susunan sebagai perubahan posisi, bukan otomatis perubahan jumlah.

### Hubungan referensi

- `DIRECT STANDARD`: CCSS `K.CC.B.4.b` mendukung jumlah tetap tanpa bergantung pada susunan/urutan.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: CCSS `MP1`, `MP2`, `MP3`; NCTM PDF p. 3–5 tentang representations, reasoning, tools, assessment, dan feedback.
- `INTERNAL DESIGN DECISION`: tugas sebelum/sesudah dengan manipulasi langsung dan permintaan alasan.

### Aktivitas A — Susun Ulang Benda

- Tujuan: membandingkan jumlah sebelum dan sesudah objek dipindahkan.
- Instruksi anak: “Pindahkan benda-benda ini. Apakah jumlahnya berubah? Mengapa?”
- Interaksi: drag objek ke susunan baru; anak memilih “tetap sama” atau “berubah” dan dapat memberi alasan melalui pilihan sederhana.
- Keberhasilan: memilih tetap sama dan menunjuk bahwa tidak ada objek ditambah/diambil.
- Miskonsepsi: susunan lebih panjang dianggap lebih banyak; susunan lebih rapat dianggap lebih sedikit.
- Nonmatematis: anak tidak menyadari hanya posisi yang berubah; salah klik label.
- Hint 1: “Apakah ada benda yang ditambah atau diambil?”
- Hint 2: tampilkan pasangan sebelum/sesudah.
- Variasi: rapat, menyebar, diagonal, lingkaran, dua kelompok kecil.
- Transfer: bandingkan mainan di barisan dengan mainan di lingkaran atau buah di dua tata letak.
- Retensi: satu perubahan susunan baru setelah jeda.
- Penguatan: jika anak berubah jawaban hanya karena panjang susunan.
- Lewati penguatan: jika anak berhasil pada beberapa susunan dan dapat memberi alasan sederhana.

### Aktivitas B — Regroup dan Periksa Lagi

- Tujuan: mengelompokkan ulang objek sambil mempertahankan jumlah.
- Instruksi anak: “Buat kelompok baru tanpa menambah atau mengambil benda. Apakah jumlahnya tetap?”
- Interaksi: drag objek ke dua atau tiga kelompok; tombol “periksa dengan pasangan” tersedia.
- Keberhasilan: jumlah total tetap dan anak dapat memeriksa melalui counting/matching.
- Miskonsepsi: menganggap tiga kelompok berarti lebih banyak daripada dua; lupa bahwa objek yang sama hanya berpindah.
- Nonmatematis: tidak melacak objek karena tumpang tindih; sulit mengoperasikan beberapa area.
- Hint 1: “Gunakan benda yang sama. Jangan ambil dari luar.”
- Hint 2: berikan mode pasangan atau hitung ulang secara visual.
- Variasi: regroup dengan total kecil; jumlah kelompok berbeda; objek dan posisi berubah.
- Transfer: membagi kancing ke wadah berbeda atau menyusun pensil dalam beberapa baris.
- Retensi: satu regroup pada konteks baru dan penjelasan singkat.
- Penguatan: jika anak belum dapat menjaga total atau selalu mengaitkan jumlah dengan banyaknya kelompok.
- Lewati penguatan: jika anak berhasil menjaga total pada dua regroup dan menjelaskan bahwa objek hanya dipindahkan.

## 9. Diagnostic dan targeted remediation

### Alur

`Initial Diagnostic → Evidence Evaluation → Targeted Learning / Skip → Recheck → Progression`

### Initial Diagnostic

- Enam kompetensi masing-masing mendapat satu tugas singkat pada awalnya.
- Tugas menggunakan representasi sederhana dan tidak memakai timer.
- Anak melihatnya sebagai “misi mencoba”, bukan ujian.
- Setiap kompetensi memiliki minimal satu kesempatan untuk menunjukkan alasan atau strategi.
- Jika anak gagal karena operasi perangkat, tugas ditandai `inconclusive`, bukan langsung sebagai kelemahan konsep.

### Evidence Evaluation

Evidence evaluator mempertimbangkan:

- correctness;
- apakah jawaban mandiri atau memakai hint;
- jenis representasi;
- apakah respons cepat berupa tebakan atau didukung tindakan matching/counting;
- penjelasan anak;
- kesalahan berulang lintas variasi;
- observasi orang tua bila tersedia.

### Targeted Learning atau Skip

- Jika bukti cukup kuat pada dua variasi sederhana, anak dapat melewati latihan penguatan langsung dan masuk ke transfer.
- Jika bukti bercampur, anak mendapat satu aktivitas guided practice, lalu recheck.
- Jika bukti menunjukkan pola kesalahan konsep, anak mendapat aktivitas penguatan yang menargetkan pola tersebut, bukan pengulangan seluruh Module 00.
- Jika bukti tidak cukup karena interaksi atau instruksi, lakukan retry dengan mode tap, audio/visual yang lebih jelas, atau jumlah objek lebih sedikit.

### Recheck

Recheck memakai representasi atau konteks berbeda. Pengulangan identik tidak cukup untuk memperkuat status.

### Progression

Anak dapat lanjut ke materi berikutnya bila bukti sementara cukup dan tidak ada pola miskonsepsi yang belum ditangani. Sistem tetap menjadwalkan transfer atau retensi tertunda.

## 10. Mastery evidence model

Status berikut adalah kategori produk sementara, bukan diagnosis psikometrik.

### NOT_UNDERSTOOD

Makna operasional: bukti saat ini menunjukkan anak belum dapat menyelesaikan tugas konsep secara konsisten.

Bukti: kesalahan konsep berulang pada beberapa variasi, bahkan setelah instruksi dipahami; strategi tidak sesuai konsep.

Faktor yang menurunkan keyakinan: salah klik, instruksi tidak terbaca, target terlalu kecil, atau kelelahan.

Perubahan: ke `EMERGING` setelah anak menunjukkan strategi yang mulai sesuai pada tugas guided atau satu tugas mandiri.

### EMERGING

Makna operasional: anak mulai menunjukkan pemahaman tetapi masih membutuhkan dukungan atau belum stabil pada variasi.

Bukti: benar setelah hint, dapat menjelaskan sebagian alasan, atau benar pada satu representasi tetapi gagal pada transfer.

Faktor penurun keyakinan: keberhasilan hanya pada urutan yang sama atau pilihan yang mudah ditebak.

Perubahan: ke `PROVISIONALLY_MASTERED` setelah bukti mandiri muncul pada variasi berbeda.

### PROVISIONALLY_MASTERED

Makna operasional: anak menunjukkan pemahaman yang cukup kuat untuk sementara pada beberapa konteks.

Bukti: beberapa tugas mandiri, variasi representasi, alasan sederhana, dan tidak bergantung pada satu pola visual.

Faktor penurun keyakinan: belum ada jeda waktu, belum ada transfer yang cukup, atau penjelasan tidak konsisten.

Perubahan: ke `RETAINED_OR_TRANSFERRED` setelah retensi atau transfer berhasil.

### RETAINED_OR_TRANSFERRED

Makna operasional: konsep tampak bertahan setelah jeda atau berhasil dipakai pada konteks baru.

Bukti: tugas tertunda, konteks berbeda, representasi baru, serta alasan yang tetap sesuai.

Faktor penurun keyakinan: tugas terlalu mirip, bantuan tersisa, atau anak mengulangi jawaban yang diingat.

Perubahan turun: status dapat kembali sementara ke `EMERGING` jika bukti baru bertentangan; sistem harus menyimpan alasan perubahan.

## 11. Transfer dan retention

Transfer tidak menggunakan objek yang sama persis. Contoh:

- astronaut–roket berubah menjadi anak–kursi;
- bentuk berwarna berubah menjadi benda kelas;
- kelompok titik berubah menjadi buah;
- pola kartu berubah menjadi pola gerakan;
- ukuran batang berubah menjadi panjang pensil;
- susunan baris berubah menjadi lingkaran atau kelompok wadah.

Retensi:

- dijadwalkan setelah jeda, bukan langsung setelah soal terakhir;
- singkat, satu atau dua tugas;
- tidak diberi label “tes” kepada anak;
- hasilnya menjadi bukti tambahan, bukan satu-satunya penentu status.

## 12. Kriteria penerimaan pedagogis

Dokumen ini dianggap siap untuk implementasi berikutnya jika:

- setiap kompetensi memiliki tujuan yang dapat diamati;
- terdapat dua aktivitas berbeda per kompetensi;
- setiap aktivitas memiliki bantuan, variasi, transfer, dan retensi;
- diagnostic tidak memaksa seluruh penguatan;
- kesalahan operasional dapat dibedakan dari kesalahan konsep;
- status mastery tidak bergantung pada satu jawaban atau satu persentase;
- semua klaim standar diberi kode atau label desain internal;
- bahasa dan interaksi dapat dipetakan ke spesifikasi interaksi;
- tidak ada klaim bahwa desain ini merupakan diagnosis tervalidasi.

## 13. Revisi normatif Phase 2A — diagnostic dan mastery

Bagian ini menggantikan bagian 9–11 sebelumnya bila terdapat perbedaan. Aturan input, validasi jawaban, selesai, undo/retry, dan hint per aktivitas ditetapkan di `learning-interaction-specification.md` bagian 3–8.

### Satu tugas awal, tugas lanjutan selektif

- Berikan satu tugas awal singkat yang dapat dinilai per kompetensi. Tugas keenam kompetensi tidak harus dikerjakan dalam satu sesi.
- Maksimal dua tugas diagnostic/targeted yang dinilai per sesi selain tugas yang sedang dikerjakan. Ini batas beban sesi, bukan ambang mastery.
- Berikan tugas tambahan hanya jika hasil awal tidak cukup memisahkan pemahaman, pola miskonsepsi, pengaruh hint, atau kendala interaksi. Tidak ada tugas tambahan otomatis setelah satu jawaban benar.
- Evidence dapat terakumulasi lintas sesi/hari. Jeda atau keluar tidak menghapus tugas yang sudah selesai; checkpoint task yang belum selesai dapat dilanjutkan, tetapi belum menjadi evidence.

### Klasifikasi hasil task dan tindakan

- `independent`: diselesaikan tanpa petunjuk konseptual, highlight yang mengarahkan, contoh jawaban, atau simplifikasi yang memberi strategi. Pengulangan instruksi netral saja boleh tetap independent.
- `guided`: sukses setelah hint konseptual, highlight yang mengarahkan, demonstrasi, atau bantuan yang mengungkap strategi. Guided evidence menunjukkan respons terhadap dukungan, bukan bukti mandiri.
- `inconclusive`: masalah instruksi, aksesibilitas, input/perangkat, interupsi, atau task yang ditinggalkan membuat strategi konsep tidak dapat ditafsirkan.
- `interpretable_incorrect`: anak memahami aturan dan interaksi tetapi respons menunjukkan konsep/strategi tidak sesuai.
- `SKIP targeted practice`: satu task awal interpretable menunjukkan strategi konsep yang sesuai; lewati remediasi langsung, bukan penilaian berikutnya atau mastery. Kumpulkan bukti mandiri lain/transfer pada waktu lain.
- `TARGETED REMEDIATION`: pola miskonsepsi sama terlihat pada dua task interpretable dengan variasi berbeda, atau satu miskonsepsi jelas dan anak memilih melanjutkan. Pilih latihan yang menargetkan pola itu.
- `RECHECK`: setelah remediasi, satu task baru pada konteks/representasi berbeda, tanpa hint konsep. Bukan pengulangan identik.
- `INCONCLUSIVE`: jangan turunkan mastery; tawarkan pause, mode tap, instruksi lebih jelas, atau task berbeda. Jangan mengulang berkali-kali dalam sesi yang sama.
- Anak boleh `PAUSE`/keluar kapan saja. Simpan evidence task selesai dan checkpoint minimum untuk melanjutkan.

### Status mastery dan kondisi administratif

`masteryStatus` adalah empat status mastery saja; boleh null bila keputusan ditunda. `assessmentCondition` terpisah: `UNASSESSED` (belum ada task interpretable) atau `INSUFFICIENT_EVIDENCE` (ada bukti tetapi belum cukup/selaras). Keduanya bukan status mastery baru. Bila kondisi administratif aktif, jangan hapus status terdahulu; simpan alasan penundaan.

| Status | Aturan masuk/transisi |
|---|---|
| `NOT_UNDERSTOOD` | Sedikitnya dua attempt interpretable pada variant berbeda menunjukkan pola miskonsepsi sama, dengan setidaknya satu kesempatan respons tanpa hint konsep; akses/perangkat bukan penjelasan yang lebih baik. Ke `EMERGING` bila strategi sesuai mulai tampak pada guided atau independent attempt. |
| `EMERGING` | Evidence parsial/tidak stabil, guided success, atau hasil mandiri bercampur. Ke `PROVISIONALLY_MASTERED` hanya saat kriteria mandiri di bawah terpenuhi; ke `NOT_UNDERSTOOD` hanya dengan pola keliru berulang yang interpretable. |
| `PROVISIONALLY_MASTERED` | Minimal dua task berhasil `independent` pada variant/representasi berbeda; setidaknya satu memperlihatkan strategi/alasan sesuai atau matching/counting yang teramati; tiada pola miskonsepsi tak terselesaikan. Satu jawaban benar tidak cukup. |
| `RETAINED_OR_TRANSFERRED` | Harus telah `PROVISIONALLY_MASTERED`, lalu memenuhi salah satu: (a) success independent pada konteks/representasi baru (`transfer`) atau (b) success independent pada review tertunda (`retention`), dengan strategi/alasan sesuai. Simpan dimensi yang benar-benar dibuktikan. |

Tidak ada ambang persentase tunggal. Task per sesi dibatasi terpisah dari jumlah/kualitas evidence lintas sesi. Hasil guided tidak menggantikan independent evidence untuk `PROVISIONALLY_MASTERED`.

### Konflik, transfer/retensi, dan alasan keputusan

- Jangan memilih hasil terbaru atau menghitung rasio benar sebagai pemutus konflik. Tinjau variant, strategi, tingkat hint, dan interpretability; simpan bukti mandiri dan guided terpisah.
- Kesalahan operasional dikecualikan dari evidence konsep; simpan kategori alasan minimal.
- Transfer tanpa retensi dapat memenuhi `RETAINED_OR_TRANSFERRED` dengan penanda `transfer_only`; jangan mengklaim retensi. Retensi tanpa transfer dapat memenuhi status itu dengan `retention_only`; jangan mengklaim transfer.
- Jika transfer/retensi saling bertentangan atau ada bukti lawan yang belum terjelaskan, tetapkan `INSUFFICIENT_EVIDENCE`, pertahankan riwayat, dan tunda keputusan sampai recheck interpretable.
- Tunda keputusan untuk satu success saja, seluruh success setelah hint konsep, variant terlalu mirip, task inconclusive, bukti bercampur tanpa pola yang dapat dijelaskan, atau anak berhenti/lelah.
- Setiap perubahan menyimpan ringkasan minimal: status/kondisi lama dan baru, waktu, competency, attempt/variant pendukung, jenis evidence, hint, konflik, alasan, serta aturan transisi. Jangan menyimpan seluruh event mentah.

