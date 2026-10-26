# Educational References — Math Adventure

Status: Phase 2A, dokumentasi READ-ONLY

Dokumen ini memetakan sumber pendidikan yang digunakan untuk merancang Module 00. Setiap turunan desain diberi label:

- `DIRECT STANDARD`: kemampuan atau ekspektasi yang dinyatakan eksplisit oleh standar.
- `CONCEPTUAL / PEDAGOGICAL SUPPORT`: prinsip atau praktik yang mendukung pendekatan, tetapi tidak mewajibkan aktivitas tertentu.
- `INTERNAL DESIGN DECISION`: keputusan khusus Math Adventure.

## 1. Inventaris sumber dan status verifikasi

| Sumber | Path/URL | Status | Batas penggunaan |
|---|---|---|---|
| Common Core State Standards — Mathematics | https://www.thecorestandards.org/Math/ | Berhasil diakses pada halaman resmi dan halaman standar terkait | Dipakai untuk kode standar dan hubungan kompetensi yang benar-benar tertulis. Bukan kurikulum Indonesia atau padanan langsung kelas 2. |
| NCTM Principles to Actions — Executive Summary | `D:\Hermes Project\math-adventure\docs\PtAExecutiveSummary.pdf` | Berhasil dibuka dan diekstrak. PDF versi 1.3, 6 halaman berisi teks. Ekstraksi `pdftotext` berhasil, tetapi beberapa ligatur/karakter hilang atau tampil sebagai spasi, misalnya `effective` dapat tampil sebagai `e ective`. | Nomor halaman merujuk nomor halaman PDF. Kutipan isi ditulis sebagai parafrasa agar tidak bergantung pada karakter hasil ekstraksi yang rusak. |
| Bedok Green Primary School — Mathematics | https://www.bedokgreenpri.moe.edu.sg/bgps-experience/instructional-programmes/mathematics/ | Berhasil diakses dan ditinjau | Dipakai sebagai contoh pendekatan pedagogis sekolah, bukan standar universal dan bukan pengganti syllabus MOE. |
| Singapore MOE Primary Mathematics Syllabus | Belum ada dokumen terverifikasi yang digunakan | `NOT VERIFIED` | Tidak dipakai sebagai dasar klaim atau spesifikasi. |

PDF NCTM tidak diubah, dipindahkan, atau dihapus.

## 2. Common Core State Standards — temuan dan batas interpretasi

### 2.1 Counting & Cardinality

`K.CC.B.4` menyatakan pemahaman hubungan antara bilangan dan kuantitas serta hubungan counting dengan cardinality.

`K.CC.B.4.a` secara eksplisit menyatakan bahwa saat menghitung objek, anak mengucapkan nama bilangan dalam urutan standar dan memasangkan tiap objek dengan tepat satu nama bilangan, serta tiap nama bilangan dengan tepat satu objek. Ini adalah hubungan object-to-number-name dalam tindakan counting.

Batas klaim penting: `K.CC.B.4.a` tidak secara eksplisit menetapkan matching dua kelompok benda yang berbeda, seperti astronaut–roket. Matching lintas dua kelompok adalah `INTERNAL DESIGN DECISION` yang menerapkan gagasan korespondensi satu-satu secara konseptual, bukan pemenuhan literal aktivitas yang disebut standar. Rujukan: halaman resmi CCSS Kindergarten Counting & Cardinality, `K.CC.B.4.a`.

Rujukan langsung standar: `https://www.thecorestandards.org/Math/Content/K/CC/B/4/a/` (teks standar `K.CC.B.4.a`); halaman keluarga standar: `https://www.thecorestandards.org/Math/Content/CC/`.

`K.CC.B.4.b` menyatakan bahwa nama bilangan terakhir yang diucapkan memberi jumlah objek yang dihitung dan jumlah tetap sama terlepas dari susunan atau urutan counting. Ini dukungan langsung untuk kardinalitas ketika susunan berubah; tugas memindahkan/regroup dalam produk tetap merupakan penerapan desain. Kode standar tidak memerintahkan animasi, drag-and-drop, atau UI tertentu.

`K.CC.C.6` menyatakan bahwa siswa mengidentifikasi apakah jumlah objek dalam satu kelompok lebih besar, lebih kecil, atau sama dengan kelompok lain, misalnya menggunakan matching dan counting; catatan standar membatasi kelompok hingga sepuluh objek.

### 2.2 Measurement & Data

`K.MD.A.1` meminta siswa mendeskripsikan atribut terukur, seperti panjang atau berat.

`K.MD.A.2` mendukung perbandingan langsung objek berdasarkan atribut terukur.

`K.MD.B.3` meminta siswa mengklasifikasikan objek ke kategori yang diberikan, menghitung jumlah pada tiap kategori, dan mengurutkan kategori berdasarkan banyaknya objek.

`1.MD.A.1` secara eksplisit menyebut mengurutkan tiga objek berdasarkan panjang dan membandingkan panjang dua objek secara tidak langsung menggunakan objek ketiga. Ini mendukung variasi ordering, tetapi tidak menjadikan semua bentuk pengurutan sebagai standar Grade 1 yang identik.

### 2.3 Standards for Mathematical Practice

CCSS menjelaskan bahwa Mathematical Practices menggambarkan keahlian/proses yang dikembangkan lintas jenjang, bukan daftar aktivitas digital tertentu. Untuk Module 00, hubungan yang paling relevan adalah:

- `MP1`: memahami masalah dan bertahan dalam penyelesaian; mendukung kesempatan mencoba kembali tanpa tekanan waktu.
- `MP2`: menalar secara abstrak dan kuantitatif; mendukung hubungan antara objek, kuantitas, dan representasi.
- `MP3`: membangun argumen dan menilai alasan; mendukung permintaan penjelasan sederhana.
- `MP4`: memodelkan dengan matematika; mendukung penggunaan konteks kehidupan sehari-hari.
- `MP5`: menggunakan alat secara strategis; mendukung manipulatif konkret maupun virtual.
- `MP6`: memperhatikan ketepatan; mendukung bahasa yang jelas dan pembedaan atribut.
- `MP7`: mencari dan menggunakan struktur; mendukung klasifikasi dan pengenalan pola.
- `MP8`: mencari dan menyatakan keteraturan dalam penalaran berulang; memberi dukungan konseptual untuk mengenali unit pola, tetapi tidak secara eksplisit mewajibkan pola AB/AAB.

## 3. NCTM Principles to Actions — temuan per halaman PDF

Path lokal: `D:\Hermes Project\math-adventure\docs\PtAExecutiveSummary.pdf`

### Halaman 1–2 PDF

Temuan utama:

- Standar memberi arah dan hasil bersama, tetapi tidak mengajar dengan sendirinya.
- Dokumen menekankan perlunya pembelajaran yang terhubung dengan makna, pemahaman, aplikasi, problem solving, dan reasoning.
- Dokumen mengkritik fokus yang terlalu besar pada prosedur tanpa koneksi ke makna serta asesmen yang terlalu menekankan recall.

Klasifikasi: `CONCEPTUAL / PEDAGOGICAL SUPPORT`.

Turunan desain: Math Adventure menempatkan representasi, penjelasan, variasi konteks, dan feedback proses di atas kecepatan.

### Halaman 3 PDF

Dokumen mencantumkan delapan Mathematics Teaching Practices:

1. Establish mathematics goals to focus learning.
2. Implement tasks that promote reasoning and problem solving.
3. Use and connect mathematical representations.
4. Facilitate meaningful mathematical discourse.
5. Pose purposeful questions.
6. Build procedural fluency from conceptual understanding.
7. Support productive struggle in learning mathematics.
8. Elicit and use evidence of student thinking.

Bagian ini menjadi dasar langsung untuk prinsip interaksi dan evidence model, tetapi tidak mengharuskan bentuk UI tertentu.

### Halaman 4–5 PDF

Temuan utama:

- Teaching and Learning diposisikan sebagai prinsip inti.
- Program matematika yang baik memberi pengalaman bermakna yang membantu siswa membuat sense of ideas dan reason mathematically.
- Access and Equity mengarah pada ekspektasi tinggi dengan dukungan yang sesuai, bukan pendekatan satu ukuran untuk semua.
- Curriculum perlu berupa learning progression yang koheren dan menghubungkan matematika dengan dunia nyata.
- Tools and Technology dapat membantu memvisualisasikan dan mengonkretkan abstraksi matematika jika digunakan secara tepat.
- Assessment perlu menjadi bagian dari pembelajaran, memakai beragam bukti, dan menginformasikan feedback serta langkah berikutnya.

Klasifikasi: `CONCEPTUAL / PEDAGOGICAL SUPPORT`.

Turunan desain: diagnostic harus singkat, targeted, dan tidak memaksa semua anak melalui urutan yang sama; aktivitas harus memiliki dukungan serta bukti proses.

### Halaman 5–6 PDF

Temuan utama:

- Dokumen menyebut lingkungan yang aman secara sosial, emosional, dan akademik.
- Feedback perlu deskriptif, akurat, tepat waktu, dan menyebut strengths, weaknesses, serta next steps.
- Physical atau virtual manipulatives dipandang dapat membantu eksplorasi matematika penting.

Klasifikasi: `CONCEPTUAL / PEDAGOGICAL SUPPORT`.

Batas interpretasi: NCTM tidak menetapkan struktur data Math Adventure, status mastery produk, atau teks feedback berbahasa Indonesia. Semua itu adalah keputusan desain internal yang diinformasikan oleh prinsip tersebut.

## 4. Bedok Green Primary School — temuan halaman publik

Halaman sekolah mempublikasikan pendekatan yang mencakup:

- hands-on learning dan penggunaan manipulatif;
- reasoning dan mathematical ideas;
- problem solving;
- penggunaan konteks kehidupan nyata;
- pendekatan UC3: Understand, Choose, Carry out, Check;
- keterlibatan rumah melalui Math@Home.

Klasifikasi: `CONCEPTUAL / PEDAGOGICAL SUPPORT`.

Batas interpretasi:

- Ini adalah praktik yang dipublikasikan oleh satu sekolah.
- Halaman ini bukan syllabus Singapore MOE.
- Math Adventure mengambil prinsip hands-on, reasoning, checking, dan konteks nyata sebagai inspirasi desain, bukan sebagai klaim endorsement atau transfer kurikulum.

## 5. Matriks keterlacakan enam kompetensi

| Kompetensi | DIRECT STANDARD | CONCEPTUAL / PEDAGOGICAL SUPPORT | INTERNAL DESIGN DECISION | Batas klaim |
|---|---|---|---|---|
| 00.1 One-to-One Correspondence | `K.CC.B.4.a` secara eksplisit memasangkan objek yang sedang dihitung dengan nama bilangan (relasi counting saja); tidak secara eksplisit mewajibkan matching dua kelompok objek | NCTM p. 3: menghubungkan representasi; Bedok Green: manipulatif/hands-on | Astronaut–roket dan distribusi adalah penerapan konseptual korespondensi satu-satu | Matching dua kelompok berbeda adalah desain internal, bukan aktivitas literal dalam `K.CC.B.4.a` |
| 00.2 Classification | `K.MD.B.3` | CCSS `MP7`; NCTM p. 3 dan p. 5: representations, reasoning, evidence | Aturan dapat berubah antara bentuk, warna, ukuran | CCSS menyebut kategori yang diberikan; perubahan aturan adalah keputusan produk |
| 00.3 Quantity Comparison | `K.CC.C.6`; dukungan `K.CC.B.4.b` | CCSS `MP2`, `MP5`; NCTM p. 3–5; konteks nyata Bedok Green | Menahan misleading visual cues dan meminta matching | Standar tidak menentukan tampilan atau interaksi digital |
| 00.4 Pattern Recognition | Tidak ditemukan standar CCSS langsung untuk AB/AAB pada halaman yang ditinjau | `MP7` dan `MP8`; NCTM p. 3: structure/reasoning | AB/AAB sebagai pola berulang awal; anak juga membuat pola | AB/AAB tidak diklaim sebagai tuntutan eksplisit CCSS |
| 00.5 Ordering and Relations | `K.MD.A.1`, `K.MD.A.2`, `1.MD.A.1`, dukungan `K.MD.B.3` | `MP2`, `MP5`, NCTM p. 3–4 | Menguji ukuran, panjang, dan kuantitas dengan atribut yang dinyatakan | Tidak semua ordering otomatis merepresentasikan standar yang sama |
| 00.6 Conservation of Quantity | `K.CC.B.4.b` mendukung jumlah tetap saat susunan berubah | `MP1`, `MP2`, `MP3`, NCTM p. 3–5 | Rapat, menyebar, pindah, dan regroup tanpa menambah/menghilangkan objek | Penjelasan dan variasi transfer adalah desain evidence, bukan ambang standar |

## 6. Keterbatasan referensi dan asumsi

1. CCSS adalah standar Amerika Serikat dan bukan kurikulum pengendali Math Adventure.
2. Module 00 memakai standar Kindergarten/Grade 1 sebagai referensi fondasi untuk anak kelas 2; ini bukan klaim penempatan kelas.
3. NCTM Executive Summary lokal dapat diekstrak, tetapi ligatur tertentu hilang pada output teks. Nomor halaman tetap dapat ditentukan dari pembagian halaman PDF.
4. Bedok Green bukan syllabus MOE dan tidak digunakan untuk mengklaim isi syllabus MOE.
5. Singapore MOE Primary Mathematics Syllabus tetap `NOT VERIFIED`.
6. Tidak ada referensi yang memvalidasi status mastery Math Adventure secara psikometrik.
7. Aktivitas digital dapat mencampur bukti matematika dengan kemampuan membaca, motorik, dan operasi perangkat.
8. Semua struktur aktivitas, feedback, event, dan mastery di dokumen lanjutan adalah spesifikasi internal yang perlu diuji bersama observasi nyata.
