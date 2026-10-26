# Learning Interaction Specification — Math Adventure

Status: Phase 2A, revisi dokumentasi disetujui; dokumentasi saja, belum implementasi

## 1. Tujuan dan batas

Dokumen ini menjelaskan bagaimana anak berinteraksi dengan aktivitas belajar, diagnostic, transfer, dan retensi. Ini belum merupakan implementasi source code.

Prinsip:

- satu tujuan utama per layar;
- teks singkat dan bahasa Indonesia alami;
- target sentuh/click besar;
- drag-and-drop selalu memiliki alternatif tap/click;
- warna tidak menjadi satu-satunya pembeda;
- tidak ada timer yang menghukum;
- feedback menjelaskan proses, bukan mempermalukan anak;
- animasi singkat dan mendukung pemahaman;
- `prefers-reduced-motion` harus dihormati saat diimplementasikan;
- data interaksi minimum dan tetap lokal;
- orang tua dapat membantu menafsirkan bukti tanpa mengubahnya menjadi diagnosis.

## 2. Child learning journey

### 2.1 Adventure home

Layar awal menampilkan:

- sapaan singkat;
- misi yang tersedia;
- status kemajuan dengan bahasa positif;
- tombol lanjut, ulangi nanti, dan keluar;
- akses bantuan yang jelas.

Contoh teks:

- “Pilih satu misi untuk dicoba.”
- “Kamu boleh mencoba pelan-pelan.”
- “Belum yakin? Kita bisa mencoba cara lain.”

Tidak ditampilkan:

- ranking;
- jumlah kesalahan sebagai hukuman;
- label “lemah” atau “gagal”;
- countdown;
- perbandingan dengan anak lain.

### 2.2 Activity introduction

Setiap aktivitas dibuka dengan satu instruksi utama dan contoh visual singkat jika diperlukan.

Struktur:

1. tujuan sederhana;
2. area kerja;
3. pilihan respons;
4. tombol bantuan;
5. tombol jeda/keluar.

Contoh:

> “Pasangkan satu astronaut dengan satu roket.”

Teks tidak boleh memuat beberapa aturan baru sekaligus. Jika aturan berubah, perubahan harus diumumkan.

### 2.3 Exploration

Anak dapat menyentuh atau memindahkan objek sebelum diminta menjawab. Eksplorasi tidak langsung dicatat sebagai benar/salah; hanya event interaksi minimum yang diperlukan untuk memahami strategi.

### 2.4 Guided practice

Aplikasi memberi ruang lebih kecil, jumlah objek lebih sedikit, atau contoh satu langkah. Bantuan tidak otomatis menyelesaikan tugas.

### 2.5 Independent challenge

Bantuan tersedia tetapi tidak dipaksa. Representasi, susunan, objek, atau konteks dapat berubah.

### 2.6 Transfer dan retensi

Transfer menggunakan konteks atau representasi baru. Retensi menggunakan tugas singkat setelah jeda. Keduanya tidak diberi label “ujian” kepada anak.

## 3. Interaksi per jenis aktivitas

Pemetaan jenis interaksi ke kompetensi Module 00:

| Kompetensi | Jenis interaksi utama |
|---|---|
| `00.1 One-to-One Correspondence` | matching, distribution, pairing |
| `00.2 Classification` | sorting dan changing rule |
| `00.3 Quantity Comparison` | compare groups dan create equal groups |
| `00.4 Pattern Recognition` | continue pattern dan create pattern |
| `00.5 Ordering and Relations` | ordering by attribute |
| `00.6 Conservation of Quantity` | rearrange, regroup, compare before/after |

### 3.1 Matching dan one-to-one

Mode utama:

- drag objek sumber ke target;
- tap objek sumber lalu tap target;
- keyboard alternative bila perangkat mendukung keyboard.

State visual:

- objek belum dipilih;
- objek dipilih dengan focus ring;
- target valid;
- pasangan berhasil;
- pasangan salah dan kembali ke posisi aman;
- pasangan belum lengkap.

Aturan UX:

- target efektif minimal sekitar 44×44 CSS px;
- jangan mengandalkan warna saja untuk menunjukkan pasangan;
- gunakan garis, bentuk, label, atau perubahan posisi;
- saat drag gagal, jangan membuat objek hilang;
- tap alternative harus dapat menyelesaikan tugas yang sama.

### 3.2 Sorting/classification

Mode utama:

- area kategori memiliki judul teks dan bentuk pembeda;
- objek dapat diseret atau dipilih lalu ditempatkan melalui tombol kategori;
- aturan aktif selalu terlihat.

Saat aturan berubah:

- tampilkan pesan “Aturan baru”;
- kosongkan status visual yang dapat membingungkan;
- jangan menganggap kelompok lama sebagai jawaban salah sebelum aturan baru dijelaskan.

### 3.3 Quantity comparison

Mode utama:

- dua area kelompok dengan pilihan persis: “Kelompok kiri lebih banyak”, “Kelompok kanan lebih banyak”, “Sama banyak”;
- tombol “pasangkan untuk memeriksa” opsional, yang tidak memilih jawaban;
- anak dapat mengubah pilihan sebelum submit;

Aplikasi harus memvariasikan panjang barisan, jarak, ukuran, orientasi, dan kepadatan agar anak tidak dapat menyelesaikan hanya dengan visual cue yang menyesatkan.

### 3.4 Pattern

Mode utama:

- urutan objek dengan slot kosong;
- pilihan elemen yang cukup besar;
- penanda unit dapat ditampilkan setelah hint;
- mode membuat pola sendiri menyediakan reset dan undo.

Jangan menilai pola hanya dari elemen berikutnya. Untuk aktivitas membuat pola, evidence harus mencakup unit berulang.

### 3.5 Ordering

Mode utama:

- slot urutan diberi arah dan teks, misalnya “paling pendek → paling panjang”;
- child dapat menukar objek dengan drag atau tap;
- garis pangkal/pembanding dapat dipanggil melalui hint.

Jangan menggunakan posisi awal sebagai petunjuk jawaban. Atribut yang dibandingkan harus disebutkan.

### 3.6 Conservation

Mode utama:

- anak dapat memindahkan objek;
- aplikasi menunjukkan bahwa objek yang sama tetap ada;
- pilihan “tetap sama” atau “berubah” disertai permintaan alasan sederhana.

Animasi harus memperlihatkan perpindahan tanpa menambah atau menghapus objek. Jika objek tertumpuk, sediakan cara untuk memeriksa melalui pasangan/counting.

## 4. Feedback dan hint

### 4.1 Jawaban benar

Contoh:

- “Ya, setiap astronaut punya satu roket.”
- “Benar. Jumlahnya tetap sama karena tidak ada benda yang ditambah atau diambil.”
- “Kamu menemukan bagian pola yang berulang.”

Feedback benar harus menyebut alasan konsep bila memungkinkan, bukan hanya “hebat”.

### 4.2 Jawaban kurang tepat

Contoh:

- “Belum cocok. Coba lihat satu per satu.”
- “Susunannya terlihat lebih panjang, tetapi mari kita pasangkan bendanya.”
- “Pola ini belum berulang dengan cara yang sama. Coba cari bagian kecil yang diulang.”

Hindari:

- “Salah!” sebagai satu-satunya feedback;
- bahasa yang mempermalukan;
- bunyi atau animasi negatif yang berlebihan.

### 4.3 Hint tahap pertama

Hint tahap pertama memberi pertanyaan atau strategi, tanpa menunjuk jawaban langsung.

Contoh:

- “Mana yang belum punya pasangan?”
- “Atribut apa yang sedang kita gunakan?”
- “Coba pasangkan satu benda dengan satu benda.”
- “Bagian mana yang terus diulang?”
- “Cari yang paling pendek dulu.”
- “Apakah ada benda yang ditambah atau diambil?”

### 4.4 Hint tahap kedua

Hint tahap kedua memberi dukungan visual atau menyederhanakan variasi, tetapi anak tetap melakukan langkah konsep.

Contoh:

- sorot objek yang belum berpasangan;
- tampilkan satu contoh pasangan;
- tandai satu unit pola dengan kurung;
- beri garis pangkal untuk perbandingan panjang;
- tampilkan garis pasangan sebelum meminta label.

### 4.5 Ajakan mencoba lagi

Contoh:

- “Coba lagi dengan cara memasangkan.”
- “Tidak apa-apa. Kita gunakan lebih sedikit benda dulu.”
- “Pilih satu objek, lalu pilih pasangannya.”
- “Mau mencoba dengan susunan yang berbeda?”

### 4.6 Perpindahan aktivitas

Contoh:

- “Kamu sudah mencoba cara ini. Sekarang kita lihat contoh yang berbeda.”
- “Kita lanjut ke tantangan baru.”
- “Kita simpan ini dan coba lagi nanti.”

Jangan menggunakan perpindahan sebagai hadiah finansial atau hukuman.

## 5. Bantuan adaptif dan kesalahan nonmatematis

Sebelum menandai kesalahan konsep, sistem perlu memeriksa kemungkinan:

- instruksi belum dibaca/didengar;
- anak belum memahami kosakata;
- target terlalu kecil;
- drag gagal karena perangkat;
- objek tertutup atau terpotong;
- anak belum memahami arah urutan;
- fokus terganggu atau anak membutuhkan jeda.

Respons yang sesuai:

1. ulangi instruksi dengan kalimat lebih singkat;
2. tawarkan mode tap/click;
3. kurangi jumlah objek;
4. tampilkan contoh netral;
5. catat attempt sebagai `inconclusive` bila bukti matematika tidak dapat dipisahkan dari masalah operasi.

## 6. Accessibility dan child-friendly UI

### Target dan navigasi

- target interaktif besar dan memiliki jarak cukup;
- focus state terlihat jelas;
- urutan keyboard logis;
- setiap kontrol memiliki nama yang dapat dibaca screen reader;
- drag memiliki tap/click alternative;
- tombol keluar, jeda, bantuan, dan ulangi dapat ditemukan tanpa gestur khusus.

### Bahasa

- kalimat pendek;
- satu instruksi utama per layar;
- hindari istilah teknis tanpa contoh;
- gunakan ikon bersama teks, bukan ikon saja;
- bila audio ditambahkan, teks tetap tersedia;
- audio lokal tidak boleh mengirim data anak ke layanan pihak ketiga.

### Visual

- jangan memakai warna sebagai satu-satunya sinyal;
- kontras teks dan kontrol harus diuji;
- bentuk, label, pola garis, atau posisi membantu membedakan state;
- animasi penting memiliki versi statis;
- hormati `prefers-reduced-motion`;
- tidak ada flicker atau perubahan layout yang membuat objek hilang.

### Error dan emosi

- kesalahan dapat diperbaiki;
- tidak ada timer yang menghukum;
- tidak ada suara mengejek;
- anak dapat berhenti tanpa kehilangan seluruh progres;
- keberhasilan tidak selalu diikuti ledakan animasi besar.

## 7. Model konseptual learning interaction

### 7.1 Competency

`Competency` adalah konsep yang ingin dipahami, misalnya `00.3_quantity_comparison`.

Field konseptual minimum:

- `competencyId`;
- nama dan tujuan;
- prasyarat;
- status mastery sementara;
- daftar aktivitas terkait.

### 7.2 Activity

`Activity` adalah pengalaman belajar yang memiliki tujuan dan aturan.

Field konseptual:

- `activityId`;
- `competencyId`;
- `activityType`: exploration, guided, independent, diagnostic, transfer, retention;
- tujuan;
- representasi;
- variasi yang tersedia;
- hint policy;
- acceptance evidence.

### 7.3 Task

`Task` adalah satu instans soal atau situasi dalam activity.

Field konseptual:

- `taskId`;
- `activityId`;
- `variantId`;
- objek dan relasi yang diperlukan;
- aturan validasi;
- atribut yang diuji;
- konteks tampilan.

### 7.4 Attempt

`Attempt` adalah satu kesempatan anak menyelesaikan task.

Field konseptual:

- `attemptId`;
- `taskId`;
- waktu mulai dan selesai;
- hasil;
- independent atau dibantu;
- jumlah hint;
- alasan inconclusive bila ada;
- tipe kesalahan yang teramati.

### 7.5 Interaction event

`InteractionEvent` adalah event UI sementara untuk menjaga respons tampilan. Event pada bagian ini tidak disimpan permanen sebagai raw stream; ringkasan evidence yang dapat dipersist dibatasi oleh bagian 11.5.

Event minimum:

- activity_started;
- instruction_presented;
- task_presented;
- object_selected;
- object_moved;
- object_matched;
- category_selected;
- order_changed;
- pattern_element_added;
- answer_submitted;
- hint_requested;
- hint_shown;
- retry_started;
- task_completed;
- activity_paused;
- activity_exited;
- parent_observation_added.

Jangan mencatat keypress mentah, isi perangkat, lokasi, school identity, foto, kontak, atau event yang tidak membantu memahami proses belajar.

### 7.6 Hint usage

`HintUsage` tidak menjadi log waktu mentah. Jika hint diberikan, simpan dalam ringkasan attempt hanya jenis/level hint dan apakah hint konseptual dipakai untuk menetapkan label `guided`; event permintaan dan tampilan hint tetap ephemeral. Detail minimum persisted ada di bagian 11.5.

### 7.7 Observation

`Observation` adalah catatan terstruktur dari aplikasi atau orang tua tentang perilaku yang relevan.

Contoh:

- child_used_matching_strategy;
- child_explained_reason;
- motor_interaction_difficulty;
- instruction_reading_difficulty;
- child_needed_reassurance;
- parent_observed_understanding.

Observation tidak boleh berubah menjadi diagnosis otomatis.

### 7.8 Evidence

`Evidence` adalah ringkasan bukti yang menghubungkan attempt, observation, hint, variant, dan hasil.

Evidence digunakan untuk menilai status sementara, bukan untuk mengklaim kemampuan ilmiah yang tervalidasi.

### 7.9 Mastery state

`MasteryState` hanya memakai empat status:

- `NOT_UNDERSTOOD`;
- `EMERGING`;
- `PROVISIONALLY_MASTERED`;
- `RETAINED_OR_TRANSFERRED`.

Kondisi administratif terpisah: `UNASSESSED` atau `INSUFFICIENT_EVIDENCE`; bukan status mastery tambahan. Status transisi dan syarat bukti lengkap ada di `learning-design-specification.md` bagian 13.

## 8. Diagnostic, targeted remediation, transfer, retention

Kebijakan ini merangkum aturan operasional yang ditetapkan di `learning-design-specification.md` bagian 13:

- satu tugas awal yang singkat per kompetensi; semua kompetensi tidak harus dinilai di satu sesi;
- paling banyak dua task diagnostic/targeted yang dinilai per sesi selain task yang sedang dikerjakan; bukti lain dikumpulkan lintas sesi;
- tambahan task dipilih hanya saat bukti awal belum cukup; satu jawaban benar tidak memicu mastery;
- independent, guided, dan inconclusive dicatat terpisah;
- `SKIP` melewati remediasi langsung bila task awal interpretable mendukung pemahaman, bukan melewati evidence berikutnya;
- targeted remediation hanya untuk pola konsep yang dapat ditafsirkan; recheck memakai task/variant baru tanpa hint konsep;
- pause/exit aman, hasil task selesai tetap ada, task terputus bukan evidence;
- inconclusive tidak menurunkan mastery; tawarkan jeda atau alternatif input.

## 9. Parent observation

Orang tua dapat menambahkan observasi singkat setelah sesi, tanpa dashboard penuh pada Phase 2A.

Pilihan observasi:

- “Anak memahami konsep tetapi salah menekan objek.”
- “Anak menjawab benar setelah diberi petunjuk.”
- “Anak menjelaskan jawaban secara lisan.”
- “Anak tampak kesulitan membaca instruksi.”
- “Anak tampak lelah atau ingin berhenti.”
- “Anak menggunakan cara memasangkan/menghitung.”

Aturan:

- observasi adalah bukti tambahan;
- observasi tidak otomatis menimpa bukti aktivitas;
- orang tua dapat menulis catatan singkat;
- catatan tidak dipakai untuk diagnosis klinis;
- penyimpanan tetap lokal.

## 10. Kriteria penerimaan UX

Spesifikasi interaksi siap diimplementasikan bila:

- setiap aktivitas mempunyai satu tujuan utama;
- semua drag memiliki alternatif tap/click;
- instruksi dapat dipahami tanpa teks panjang;
- feedback tidak menghukum atau mempermalukan;
- bantuan bertahap tidak langsung memberikan jawaban;
- warna bukan satu-satunya pembeda;
- reduced motion memiliki perilaku yang wajar;
- diagnostic, guided, independent, transfer, dan retention dapat dibedakan;
- event minimum dapat menjelaskan proses tanpa telemetry eksternal;
- parent observation dipisahkan dari diagnosis;
- desain dapat diuji melalui keyboard, mouse, touch, dan screen reader checks yang relevan.

## 11. Revisi normatif Phase 2A — aturan aktivitas, diagnostic, dan evidence

Bagian 11 adalah sumber normatif bila ada perbedaan dengan ringkasan/contoh terdahulu di atas. Empat status mastery dan kondisi administratif mengikuti aturan di `learning-design-specification.md` bagian 13.

### 11.1 Kontrak interaksi bersama

- `initial state`: instruksi dan aturan eksplisit terlihat; semua objek yang dipakai task terlihat dan dapat diakses; belum ada jawaban terpilih, pasangan, pengelompokan, atau urutan yang ditandai benar.
- `actions`: drag/drop dan tap/click setara secara fungsi; keyboard boleh menjadi alternatif tambahan. Objek tidak boleh hilang bila input dilepas di lokasi invalid. Focus dan state tidak mengandalkan warna saja.
- `valid answer`: ditentukan oleh relasi/aturan konsep, bukan posisi visual awal. Evaluator memeriksa semua objek/slot wajib dan tidak menerima duplikasi atau omission.
- `completion`: task selesai hanya setelah kondisi completion pada baris aktivitas terpenuhi dan anak mengonfirmasi submit/finish; pemindahan sementara belum menjadi jawaban final.
- `unbalanced counts`: bila jumlah kelompok tidak sama, simpan semua objek. Sisa yang benar ditampilkan/ditentukan, bukan disembunyikan, didaur ulang, atau dihapus. Task matching selesai saat semua objek di sisi yang ditentukan sudah dipasangkan dan anak mengidentifikasi sisa (jika pertanyaan task meminta); bila task meminta kesamaan jumlah, jawaban valid hanya ketika relasi jumlah benar.
- `undo/retry`: sebelum submit, undo membatalkan aksi terakhir tanpa penalti. Setelah submit, feedback ditampilkan; anak boleh retry dengan state task di-reset atau variant baru. Retry bukan evidence independen baru bila task/variant identik; simpan ringkasan attempt dan beri label guided jika hint konsep telah dipakai.
- `error classification`: `interaction_error` (tap/drag gagal, target tidak terjangkau, objek tertutup) tidak dinilai sebagai salah konsep; tawarkan tap/undo dan klasifikasikan attempt inconclusive bila strategi tidak dapat dipastikan. `interpretable_concept_error` terjadi hanya bila instruksi dipahami dan tindakan/response menunjukkan relasi matematika keliru. Salah aturan karena bahasa tidak dipahami adalah inconclusive, bukan miskonsepsi.
- `hint safety`: hint tidak memilih jawaban, menempatkan objek, menghapus distractor penentu, mengungkap label benar, atau melakukan langkah konsep atas nama anak. Sukses setelah hint konseptual, highlight yang mengarahkan, demo, atau simplifikasi strategis dicatat sebagai `guided`, tidak `independent`.

### 11.2 Matriks 12 aktivitas — aturan validasi dan selesai

Setiap baris adalah acceptance-test contract. “Finish” berarti semua kondisi yang disebut terpenuhi; validator tak boleh menyimpulkan mastery dari penyelesaian task.

| ID / aktivitas | Initial state dan aksi | Jawaban valid dan finish | Jumlah tak seimbang; undo/retry; error | Batas hint (H1 → H2) |
|---|---|---|---|---|
| 00.1-A Pasangkan Astronaut–Roket | Dua set terlihat; semua belum berpasangan. Drag astronaut ke roket atau tap astronaut lalu roket. Satu objek hanya boleh dipakai sekali. | Semua pasangan one-to-one terbentuk; bila jumlah tak sama, anak memilih/menunjukkan sisi yang tersisa. Finish setelah tak ada pasangan duplikat dan pertanyaan sisa dijawab. | Sisa tetap terlihat. Undo melepas pasangan terakhir; retry reset pasangan. Salah target yang terdeteksi sebelum commit = interaction error; commit pasangan duplikat/meninggalkan sisa yang diklaim habis = concept error bila input dipahami. | H1 tanya “Mana yang belum punya pasangan?” H2 sorot SATU astronaut belum berpasangan saja; jangan sorot roket jawaban, jangan garis/auto-pair. Success sesudah H2 = guided. |
| 00.1-B Bagikan satu benda per penerima | Penerima dan persediaan benda terlihat; belum ada distribusi. Tap benda lalu penerima atau drag. Satu objek/penerima hanya dapat masuk satu pasangan. | Bentuk sebanyak mungkin pasangan one-to-one tanpa duplikasi; anak mengidentifikasi sisi yang masih memiliki sisa. Finish setelah semua objek di sisi yang habis dipasangkan dan sisa disebut/ditunjukkan. | Bila jumlah penerima lebih banyak, penerima tak terlayani tetap terlihat; bila benda lebih banyak, benda tersisa tetap terlihat. Undo melepas distribusi terakhir; retry reset. Salah tap tanpa commit = interaction error; menyatakan semua terlayani saat ada sisa = concept error bila aturan dipahami. | H1 tanya siapa yang belum menerima. H2 tandai penerima belum menerima saja; jangan tunjuk benda sumber atau memindahkannya. Guided setelah H2. |
| 00.2-A Sortir berdasarkan bentuk | Aturan “bentuk” dan kategori berlabel terlihat; objek belum dikelompokkan. Drag atau pilih objek lalu kategori. | Tiap objek masuk kategori bentuk yang sesuai; finish setelah seluruh objek ditempatkan dan anak menekan selesai. | Kategori tak seimbang boleh; jangan paksa kuota sama. Undo pindahkan objek terakhir kembali; retry reset. Salah drop sebelum commit = interaction error; kategori menurut warna saat aturan bentuk = concept error jika instruksi dipahami. | H1 minta amati sisi/sudut. H2 tunjukkan contoh terpisah yang bukan objek target dan jangan mengklasifikasikan objek target. Guided bila H2 menunjukkan aturan. |
| 00.2-B Ganti aturan warna/ukuran | Objek terlihat dengan aturan aktif dinyatakan. Tap/drag sortir; sebelum fase kedua tampilkan aturan baru dan reset kategori/status visual. | Semua objek sesuai atribut aktif untuk setiap fase; finish setelah kedua fase (atau fase yang dinyatakan task) lengkap dan aturan baru diikuti. | Ukuran kelompok kategori tidak harus sama. Undo per aksi; retry fase saat ini. Salah kategori input = interaction error; tetap memakai aturan lama setelah instruksi baru dipahami = concept error. | H1 minta sebut/lihat atribut baru. H2 tekankan teks/ikon aturan baru tetapi jangan kelompokkan atau highlight jawaban objek. |
| 00.3-A Bandingkan dua kelompok | Kelompok kiri/kanan terlihat, belum ada pilihan. Tap satu dari label kiri lebih banyak/kanan lebih banyak/sama; matching tool opsional. | Pilihan cocok dengan cardinality aktual. Finish setelah satu pilihan dikonfirmasi; matching bukan submit dan tidak memilih label. | Jumlah tiap set boleh beda atau sama; seluruh objek terlihat. Undo hapus pilihan sebelum confirm; retry variant baru. Salah tap = interaction error; memilih berdasarkan panjang/ukuran meski instruksi dipahami = concept error. | H1 ajak pasangkan satu-satu. H2 tampilkan pasangan netral; jangan beri label sisi benar, jangan highlight sisa hanya pada kelompok yang lebih besar. Guided setelah bantuan strategi. |
| 00.3-B Buat kelompok sama banyak | Model kiri dan objek kanan/stock terlihat; aturan tambah/ambil dinyatakan. Anak memindah objek atau memakai kontrol tambah/ambil yang memang disediakan. | Jumlah akhir sama dengan model dan tidak ada objek tersembunyi/duplikat; finish setelah anak mengonfirmasi pemeriksaan pasangan/counting. | Jika stock tidak cukup, task berstatus tidak dapat diselesaikan/invalid design, bukan jawaban anak salah. Sisa supply tetap terlihat. Undo aksi terakhir; retry reset. Salah input yang tidak mengubah state = interaction error; stop sebelum set sama = concept error bila task dipahami. | H1 minta pasangkan. H2 tunjukkan pasangan yang belum lengkap tanpa memindahkan, menambah, atau menyebut banyak objek yang dibutuhkan. Guided setelah H2. |
| 00.4-A Lanjutkan pola | Pola dan arah baca jelas; slot kosong dan pilihan tampil; belum ada pilihan. Tap/drag elemen untuk slot. | Seluruh slot yang ditanyakan diisi sesuai unit berulang, dan anak menunjukkan/menandai unit (bila task meminta). Finish setelah submit. | Tidak berlaku hitungan kelompok; pilihan distractor tetap. Undo menghapus pilihan terakhir; retry pola variant baru. Salah drop = interaction error; unit salah setelah aturan dipahami = concept error. | H1 tanya unit berulang. H2 kurung satu siklus lengkap di luar slot jawaban; jangan menyorot elemen berikutnya atau menghapus distractor. Guided bila H2 dipakai. |
| 00.4-B Buat pola sendiri | Pilihan elemen dan aturan target (AB/AAB atau “buat pola berulang”) terlihat; canvas kosong. Anak menyusun elemen dan menandai unit. | Pola memiliki unit konsisten yang diulang sekurangnya dua kali; anak menandai unit yang cocok. Finish setelah pemeriksaan struktur/unit. | Jumlah pilihan elemen bukan target kuantitas; minimum panjang sesuai unit x 2. Undo elemen terakhir; retry kosongkan canvas. Tap yang tidak menambah elemen = interaction error; urutan tanpa pengulangan = concept error. | H1 minta memilih lalu mengulang unit. H2 contoh struktur dengan objek lain, tanpa mengisi unit/slot target anak. |
| 00.5-A Urutkan panjang/ukuran | Tiga objek dengan atribut target dan arah jelas; slot belum terisi. Drag ke slot atau tap urutan. | Relasi seluruh tiga objek memenuhi urutan yang dinyatakan; finish setelah semua slot terisi dan konfirmasi. | Set tetap tiga objek; jika dua objek setara untuk atribut yang diuji, task ditolak sebagai ambiguous sebelum anak mulai. Undo aksi terakhir; retry dengan variant baru. Salah slot karena target tidak terjangkau = interaction error; membandingkan atribut salah = concept error. | H1 minta cari ekstrem yang diminta. H2 tampilkan garis pangkal/pembanding, tanpa menempatkan atau mengurutkan objek. |
| 00.5-B Urutkan kelompok kuantitas | Tiga kelompok dengan objek dapat dihitung, arah “sedikit→banyak” atau sebaliknya terlihat; urutan belum dibuat. Drag/tap kotak. | Urutan cardinality yang tepat; finish setelah ketiga kelompok terurut dan anak mengonfirmasi. | Angka/ukuran kotak bukan petunjuk; task invalid jika kelompok cardinality sama namun diminta urutan ketat tanpa tie rule. Undo urutan terakhir; retry variant baru. Salah drag = interaction error; memakai panjang barisan bukan cardinality = concept error. | H1 sarankan hitung/pasangkan. H2 minta bandingkan satu pasangan tanpa menyusun seluruh urutan. |
| 00.6-A Susun ulang benda | Satu set benda dan baseline awal terlihat; anak mengubah posisi benda yang sama, lalu menjawab tetap sama/berubah dan/atau alasannya. | Jika tiada objek ditambah/diambil, jumlah dinyatakan sama; finish setelah jawaban dan alasan/strategi diminta task diberikan. | Objek tidak boleh masuk/keluar set saat transformasi; jika hilang/duplikat karena bug, invalid/inconclusive. Undo membalik perpindahan terakhir; retry reset baseline. Salah drag = interaction error; menyimpulkan jumlah berubah hanya dari sebaran = concept error. | H1 tanya apakah ada yang ditambah/diambil. H2 tampilkan before/after sinkron tanpa label benar/salah atau pasangan jawaban. |
| 00.6-B Regroup dan periksa | Set objek tertutup dan terlihat; area kelompok kosong/aturan jumlah kelompok dinyatakan. Anak membagi objek yang sama ke area dan boleh meminta mode pasangan/count. | Tiap objek asal dipakai tepat sekali; total sama dengan set awal; finish setelah regroup lengkap dan anak menyatakan/memeriksa total. | Tidak boleh menambah/membuang objek; area kosong diperbolehkan jika aturan task membolehkan. Undo perpindahan terakhir; retry reset. Objek tertutup/duplikat oleh UI = interaction error; menganggap jumlah berubah karena banyak kelompok = concept error. | H1 ingatkan gunakan benda yang sama. H2 tawarkan pairing/counting sebagai alat, tanpa menyatakan total atau memindahkan benda. Guided setelah strategi eksplisit. |

### 11.3 Diagnostic dan mastery: kontrak interaksi

Kebijakan operasional canonical ada di `learning-design-specification.md` bagian 13; ringkasannya:

- satu tugas awal per kompetensi; tambahan hanya bila diperlukan; maksimal dua task diagnostic/targeted yang dinilai dalam satu sesi selain task yang sedang dikerjakan;
- bukti lintas sesi disimpan terpisah dari batas task/sesi; pause/exit mempertahankan task selesai dan checkpoint minimum;
- satu success tidak menghasilkan mastery; independent dan guided tidak dicampur;
- `SKIP` berarti lewati remediasi langsung bila strategi awal sesuai, bukan lewati evidence mendatang;
- targeted remediation mengikuti pola error interpretable; recheck memakai variant baru tanpa hint konsep;
- inconclusive tidak menurunkan mastery; tawarkan jeda atau alternatif input;
- empat mastery states tetap: `NOT_UNDERSTOOD`, `EMERGING`, `PROVISIONALLY_MASTERED`, `RETAINED_OR_TRANSFERRED`; `UNASSESSED` dan `INSUFFICIENT_EVIDENCE` hanya kondisi administratif;
- transfer-only dan retention-only dicatat berbeda; contradictory evidence menunda perubahan dan memerlukan recheck;
- tidak ada threshold persentase tunggal.

### 11.4 Hint audit: seluruh 12 aktivitas

Aturan pengujian hint: untuk setiap H1/H2, sistem tidak boleh mengisi/memilih jawaban target, menghilangkan informasi pembeda, atau menyelesaikan langkah matematika untuk anak. QA mencoba task dengan jawaban benar dan salah sebelum/sesudah hint; hint yang membuka strategi membuat hasil attempt `guided`. Batas per aktivitas ditetapkan pada kolom terakhir matriks 11.2. Khusus astronaut–roket, H2 hanya boleh menyorot satu astronaut yang belum berpasangan; roket yang benar tidak ditandai.

### 11.5 Ephemeral UI events dan persisted learning evidence

#### Ephemeral (memori UI, tidak disimpan permanen)

- pointer/touch move, hover, focus, animasi, drag preview, urutan klik sementara;
- state highlight/hint yang sedang tampil;
- percobaan drop invalid yang pulih tanpa tindakan konsep yang dapat ditafsirkan;
- raw event stream dan koordinat interaksi.

Hapus saat task ditutup kecuali nilai checkpoint minimal dibutuhkan untuk resume.

#### Persisted (minimum untuk resume dan menilai proses)

- identitas versi competency/activity/task/variant;
- attempt selesai: waktu/sesi, outcome (`independent`, `guided`, `inconclusive`, `interpretable_incorrect`), validitas hasil, kategori strategi/error yang teramati, level/jenis hint, dan alasan inconclusive bila ada;
- ringkasan alasan/pernyataan konsep pilihan jika task memerlukannya; jangan menyimpan audio/transkrip bebas secara default;
- mastery status serta kondisi administratif, transfer/retention flags terpisah, perubahan status dan alasan ringkas beserta rujukan attempt;
- checkpoint aktif minimum untuk resume: task/variant, posisi langkah, objek yang sudah berpasangan/ditempatkan (bukan event historis), pilihan belum submit; anak bisa memilih reset;
- parent observation hanya jika ditambahkan secara eksplisit dan tetap lokal.

Persist hasil/checkpoint pada batas yang jelas (task selesai, pause, atau exit aman), bukan setiap raw event. Jangan simpan telemetry eksternal, raw coordinates, seluruh klik, atau seluruh event stream. Jika checkpoint tidak diperlukan untuk resume, buang saat sesi berakhir. Aturan retensi/penghapusan data lokal perlu disetujui sebelum implementasi.

## 12. Acceptance tests tingkat spesifikasi

- Setiap aktivitas dimulai dengan state kosong/awal dan aturan yang terlihat.
- Semua input dapat dilakukan dengan tap/click; drag gagal tidak menghilangkan objek.
- Semua jawaban valid/invalid dan completion ditentukan oleh matrix 11.2.
- Unequal counts tidak disamarkan; task ambiguous ditolak sebelum tampil.
- Undo memulihkan aksi terakhir; retry tidak salah dihitung sebagai variant/evidence baru.
- Error operasional menghasilkan inconclusive bila konsep tidak dapat ditafsirkan; concept error memerlukan instruksi/interaksi yang dipahami.
- Hint tidak memilih/menempatkan jawaban; semua success pasca hint konseptual berlabel guided.
- Quantity comparison hanya memiliki tiga label kiri/kanan/sama.
- Pause/exit mempertahankan hasil selesai dan hanya checkpoint minimum; raw event tidak dipersist.
- Satu task benar tidak dapat menghasilkan mastery; independent/guided, transfer/retention, administrative condition berbeda.
- Tiga dokumen menandai `K.CC.B.4.a` sebagai counting object-to-number-name, dan matching dua kelompok sebagai penerapan desain konseptual.

