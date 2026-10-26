# Math Adventure — Phase 7B UI Parent Dashboard

## Spesifikasi Desain dan Persyaratan Implementasi

**Status:** Draft spesifikasi untuk implementasi  
**Proyek:** Math Adventure — local MVP  
**Fokus:** Dashboard Orang Tua, autentikasi PIN, penguncian sesi, dan pengelolaan reward  
**Lokasi proyek:** `D:\Hermes Project\math-adventure`

---

## 1. Tujuan

Menyediakan menu Orang Tua yang terintegrasi dengan aplikasi Math Adventure untuk mengelola penukaran reward anak secara terkontrol, tanpa mengubah sistem pembelajaran dan perhitungan reward yang sudah disepakati.

Dashboard harus:

- Dapat dibuka melalui menu utama aplikasi.
- Dilindungi PIN orang tua 6 digit.
- Meminta pembuatan PIN saat menu Orang Tua pertama kali dibuka jika PIN belum tersedia.
- Mengunci dashboard secara manual maupun otomatis setelah tidak aktif.
- Menyediakan pengelolaan permintaan penukaran, koreksi transaksi, dan pengaturan reward yang termasuk dalam cakupan Phase 7B.
- Tetap mudah digunakan oleh orang tua, tetapi tidak menambah teks yang tidak perlu pada layar aktivitas anak.

Phase 7B bukan pengembangan akun pengguna, sinkronisasi cloud, atau sistem keamanan server.

## 2. Keputusan Desain

| Aspek | Keputusan |
|---|---|
| Akses | Menu Orang Tua dari menu utama |
| Setup PIN | Buat PIN ketika menu Orang Tua pertama kali dibuka |
| Panjang PIN | Tepat 6 digit angka |
| Penguncian manual | Tersedia tombol Kunci Dashboard |
| Penguncian otomatis | Kunci setelah tidak ada aktivitas |
| Timeout awal | Usulan 5 menit, menggunakan satu konfigurasi terpusat |
| Penyimpanan | Lokal di browser/perangkat, mengikuti arsitektur yang sudah ada |
| Backend/cloud | Tidak diperlukan |
| Akun orang tua | Tidak diperlukan |
| Pemulihan PIN | Tidak boleh menyediakan jalan pintas yang melewati autentikasi |
| Cakupan pengujian | Unit/integration test dan pengujian browser lokal yang realistis |

**Catatan:** Timeout 5 menit merupakan nilai awal yang diusulkan untuk spesifikasi, bukan keputusan bisnis yang sudah ditetapkan sebelumnya. Implementasi harus menggunakan satu sumber konfigurasi agar dapat diubah tanpa mengubah banyak bagian kode.

## 3. Alur Pengguna

### 3.1. Pertama Kali Membuka Menu Orang Tua

1. Pengguna memilih menu **Orang Tua** pada menu utama.
2. Aplikasi memeriksa apakah konfigurasi PIN sudah tersedia.
3. Jika PIN belum tersedia, tampilkan layar **Buat PIN Orang Tua**.
4. Orang tua memasukkan PIN 6 digit.
5. Orang tua memasukkan ulang PIN untuk konfirmasi.
6. Aplikasi memvalidasi kedua PIN.
7. Jika cocok, aplikasi menyimpan verifier PIN secara aman di penyimpanan lokal.
8. Setelah penyimpanan berhasil, dashboard dibuka.

Jika kedua PIN berbeda atau tidak valid, jangan simpan konfigurasi PIN dan tampilkan pesan yang jelas.

Jangan membuka dashboard sebelum penyimpanan PIN berhasil.

### 3.2. Membuka Dashboard Setelah PIN Dibuat

1. Orang tua membuka menu Orang Tua.
2. Aplikasi menampilkan layar **Masukkan PIN Orang Tua**.
3. PIN diverifikasi.
4. Jika benar, dashboard dibuka.
5. Jika salah, akses tetap terkunci dan jumlah kegagalan dicatat.

### 3.3. Mengunci Dashboard

Dashboard harus terkunci ketika:

- Orang tua menekan tombol **Kunci Dashboard**.
- Tidak ada aktivitas pengguna selama timeout yang ditentukan.
- Pengguna meninggalkan atau memuat ulang halaman sehingga status autentikasi tidak lagi dapat dipercaya.

Setelah terkunci, membuka kembali menu Orang Tua harus meminta PIN.

Penguncian dashboard tidak boleh menghapus data reward atau transaksi.

## 4. Persyaratan Keamanan PIN

### 4.1. Penyimpanan PIN

- Jangan menyimpan PIN dalam bentuk teks biasa.
- Gunakan mekanisme derivasi/verifikasi PIN berbasis Web Crypto API jika sesuai dengan lingkungan aplikasi, dengan salt acak dan parameter yang layak.
- Jangan menyimpan PIN di `localStorage`, URL, log, pesan error, atau metadata transaksi.
- Jangan menulis PIN ke console selama development maupun pengujian.
- Jangan membuat PIN tetap seperti `123456` sebagai default.
- Jangan menyimpan PIN dalam source code atau environment variable yang dibundel ke frontend.
- Jangan menganggap hash PIN saja menjadikan data lokal kebal dari manipulasi.

Sebelum memilih implementasi, periksa kompatibilitas runtime yang benar-benar digunakan oleh aplikasi lokal.

### 4.2. Pembatasan Percobaan

Terapkan pembatasan percobaan PIN yang salah.

Rekomendasi awal:

- Setelah 5 kegagalan berturut-turut, terapkan jeda sebelum percobaan berikutnya.
- Jeda meningkat secara bertahap jika kegagalan terus berulang.
- Tampilkan pesan yang tidak membocorkan informasi sensitif.
- Simpan status pembatasan secara konsisten sesuai arsitektur lokal yang ada.

Jangan membuat penguncian permanen yang mudah menghilangkan akses orang tua akibat kesalahan memasukkan PIN.

### 4.3. Pengelolaan Sesi Autentikasi

- Status autentikasi orang tua harus terpisah dari status permainan anak.
- PIN yang berhasil diverifikasi hanya memberi akses ke fungsi dashboard orang tua.
- Kunci dashboard harus segera menutup akses ke tampilan dan tindakan administratif.
- Jangan mempertahankan autentikasi setelah reload secara default.
- Timer idle harus dibersihkan ketika sesi dikunci atau komponen dilepas.
- Aktivitas yang relevan harus memperbarui waktu aktivitas terakhir.
- Jika browser tidak mendukung mekanisme keamanan yang dibutuhkan, tampilkan penanganan kegagalan yang aman; jangan melewati PIN secara diam-diam.

### 4.4. Batas Keamanan

Math Adventure merupakan aplikasi lokal tanpa autentikasi server. PIN berfungsi sebagai penghalang akses dalam penggunaan sehari-hari, bukan perlindungan kuat terhadap orang yang memiliki kendali penuh atas browser, profil pengguna, DevTools, atau berkas penyimpanan.

Jangan menyatakan bahwa PIN menjamin data lokal tidak bisa dimodifikasi.

Pengamanan server-side, sinkronisasi multi-perangkat, dan perlindungan terhadap pengguna yang memiliki akses penuh ke perangkat berada di luar cakupan Phase 7B.

### 4.5. Pemulihan PIN

Jangan menyediakan tombol **Lupa PIN** yang langsung membuka dashboard atau menonaktifkan PIN.

Jika pemulihan diperlukan, desainnya harus menjadi keputusan terpisah yang mempertimbangkan risiko hilangnya data lokal.

Implementasi Phase 7B tidak boleh menghapus data reward, transaksi, atau riwayat permainan sebagai efek samping kegagalan autentikasi.

## 5. Struktur UI Parent Dashboard

### 5.1. Menu Utama

Tambahkan akses **Orang Tua** tanpa mengganggu menu dan permainan yang sudah ada.

Persyaratan:

- Label mudah dipahami orang tua.
- Tampilan tetap responsif pada desktop dan ponsel.
- Tidak menampilkan PIN, saldo sensitif, atau kontrol administratif pada menu anak.
- Tidak mengubah alur memulai permainan.

### 5.2. Layar Setup PIN

Elemen UI:

- Judul: **Buat PIN Orang Tua**
- Input PIN 6 digit.
- Input konfirmasi PIN.
- Tombol **Simpan PIN**.
- Pesan validasi yang singkat dan jelas.

Input PIN harus mendukung perangkat mobile, menggunakan input numerik yang sesuai, dan tidak membocorkan nilai PIN setelah validasi.

### 5.3. Layar Autentikasi

Elemen UI:

- Judul: **Masukkan PIN Orang Tua**
- Input PIN 6 digit.
- Tombol **Buka Dashboard**.
- Pesan kesalahan jika PIN salah.
- Informasi jeda jika percobaan dibatasi.

Jangan menampilkan rincian internal seperti hash, salt, atau detail mekanisme keamanan.

### 5.4. Beranda Dashboard

Dashboard harus menyediakan navigasi yang jelas menuju:

1. **Permintaan Penukaran**
2. **Riwayat dan Status Transaksi**
3. **Koreksi Saldo**
4. **Pengaturan Reward**
5. **Kunci Dashboard**

Gunakan kartu atau bagian yang ringkas. Hindari menjejalkan seluruh formulir administratif ke satu layar.

## 6. Pengelolaan Penukaran Reward

Dashboard harus menampilkan transaksi yang relevan dengan statusnya, setidaknya:

- Pending
- Confirmed
- Cancelled

Tindakan yang diizinkan:

- **Pending:** dapat dikonfirmasi atau dibatalkan.
- **Confirmed:** tidak dapat dibatalkan langsung; koreksi harus dilakukan melalui transaksi koreksi.
- **Cancelled:** tidak mengurangi saldo yang tersedia.

Sebelum tindakan yang mengubah status, tampilkan konfirmasi yang menjelaskan tindakan dan dampaknya.

Cegah klik berulang menghasilkan perubahan ganda.

Setelah tindakan berhasil, tampilkan status yang benar berdasarkan hasil penyimpanan, bukan berdasarkan asumsi UI.

## 7. Koreksi Saldo

Sediakan tindakan koreksi yang hanya dapat digunakan setelah autentikasi orang tua.

Persyaratan:

- Koreksi harus memiliki alasan yang wajib diisi.
- Koreksi harus memiliki ID unik dan perilaku idempotent.
- Koreksi terhadap transaksi sumber hanya dapat dilakukan jika transaksi sumber berstatus confirmed.
- Percobaan ulang dengan ID dan isi koreksi yang sama tidak boleh menggandakan dampak saldo.
- ID yang sama dengan isi substantif berbeda harus ditolak.
- Riwayat transaksi dan koreksi harus tetap dapat ditelusuri.
- Jangan mengubah atau menghapus riwayat lama untuk membuat saldo tampak sesuai.

Gunakan mekanisme koreksi dan persistence yang sudah ada. Jangan membangun sistem saldo kedua khusus untuk dashboard.

## 8. Pengaturan Reward

Dashboard dapat menampilkan dan mengelola konfigurasi reward yang memang sudah didukung oleh sistem.

Pertahankan ketentuan yang telah disepakati:

- Nilai penukaran: **Rp500 per bintang**.
- Tidak ada minimum level.
- Mode Regular dan Challenge memiliki nilai reward yang sama.
- Penukaran pending dan confirmed mengurangi saldo tersedia.
- Penukaran cancelled tidak mengurangi saldo tersedia.
- Setiap penukaran menggunakan snapshot nilai reward saat diajukan.
- Transaksi pending tidak kedaluwarsa otomatis.
- Transaksi confirmed tidak dapat dibatalkan langsung; gunakan transaksi koreksi.
- Minimum penukaran: 1 bintang.
- Maksimum penukaran dibatasi saldo yang tersedia.
- Tidak ada multiplier.

Perubahan konfigurasi berlaku sesuai aturan snapshot yang sudah ada. Jangan mengubah nilai transaksi lama hanya karena konfigurasi baru disimpan.

Jika konfigurasi yang ada belum mendukung suatu pengaturan, jangan menambahkan kemampuan baru secara diam-diam. Dokumentasikan gap tersebut untuk keputusan terpisah.

## 9. Aturan Perolehan Reward yang Tidak Boleh Berubah

Dashboard bukan tempat untuk mendesain ulang reward dari sesi matematika.

Pertahankan aturan Phase 7A berikut:

| Hasil sesi | Bintang sesi | Collectible |
|---|---:|---:|
| Tidak ada soal selesai | 0 | 0 |
| Ada soal selesai, coverage di bawah 70% | 1 | 0 |
| Coverage minimal 70%, akurasi di bawah 70% | 1 | 1 |
| Coverage minimal 70%, akurasi minimal 70% | 2 | 2 |
| Coverage 100% dan akurasi minimal 90% | 3 | 3 |

Tidak ada bonus kecepatan.

Durasi sesi dari Stage 6 harus tetap disimpan sesuai desain yang sudah ada untuk penggunaan tahap selanjutnya, tetapi Phase 7B tidak boleh menghitung reward berdasarkan kecepatan.

Jangan mengubah definisi coverage, akurasi, jumlah soal selesai, atau aturan collectible sebagai bagian dari pekerjaan UI ini.

## 10. Persistensi dan Konsistensi Data

- Gunakan lapisan persistence dan controller reward yang sudah ada.
- Jangan mengakses atau mengubah IndexedDB langsung dari komponen UI jika arsitektur sekarang menggunakan controller/service.
- Jangan membuat salinan saldo yang menjadi sumber kebenaran kedua.
- Tampilkan saldo berdasarkan perhitungan yang sudah digunakan oleh sistem reward.
- Tangani kegagalan baca/tulis secara jelas.
- Jika penyimpanan gagal, jangan tampilkan pesan sukses palsu.
- Pertahankan perilaku idempotent untuk operasi transaksi dan koreksi.
- Jangan mengubah skema penyimpanan tanpa alasan teknis yang jelas dan migrasi yang aman.

Catatan: pembacaan sesi dari snapshot memori dan transaksi IndexedDB lintas-store belum merupakan transaksi atomik menyeluruh. Batasan yang sudah didokumentasikan untuk MVP satu browser/perangkat tidak boleh dianggap sudah terselesaikan oleh penambahan dashboard.

Jangan mengklaim adanya jaminan konkurensi lintas-tab atau multi-instance yang belum diuji.

## 11. Responsif dan Aksesibilitas

- Dashboard harus nyaman dipakai di desktop dan ponsel.
- Input PIN tidak boleh terpotong atau tertutup keyboard virtual.
- Tombol penting memiliki ukuran area sentuh yang memadai.
- Fokus keyboard terlihat.
- Pesan validasi dapat dipahami tanpa hanya mengandalkan warna.
- Penguncian otomatis tidak boleh bergantung pada drag-and-drop atau interaksi permainan.
- Hindari modal bertumpuk.
- Jangan menambah teks panjang pada halaman aktivitas anak untuk menjelaskan fitur orang tua.

## 12. Di Luar Cakupan

Jangan mengerjakan hal berikut dalam Phase 7B ini:

- Akun orang tua atau autentikasi cloud.
- Sinkronisasi reward lintas perangkat.
- Multi-instance distributed locking.
- Sistem pembayaran nyata.
- Monetisasi, analisis pasar, atau fitur komersial.
- Perubahan kurikulum atau permainan matematika.
- Perubahan aturan reward Phase 7A.
- Refactor besar yang tidak dibutuhkan dashboard.
- Perubahan produksi/VPS.
- Workflow Hermes Kanban.
- Reset database atau penghapusan data untuk membuat tes lolos.

## 13. Kriteria Penerimaan

### 13.1. Autentikasi

- [ ] Menu Orang Tua dapat diakses dari menu utama.
- [ ] Pembukaan pertama memulai setup PIN.
- [ ] PIN harus tepat 6 digit.
- [ ] Konfirmasi PIN harus cocok.
- [ ] PIN tidak disimpan dalam teks biasa.
- [ ] PIN salah tidak membuka dashboard.
- [ ] Pembatasan percobaan bekerja.
- [ ] Tombol Kunci Dashboard mengunci akses.
- [ ] Timeout idle mengunci dashboard.
- [ ] Reload tidak mempertahankan autentikasi secara default.

### 13.2. Reward dan Transaksi

- [ ] Permintaan pending dapat dikonfirmasi atau dibatalkan.
- [ ] Transaksi confirmed tidak dapat dibatalkan langsung.
- [ ] Koreksi memerlukan alasan.
- [ ] Operasi idempotent tidak menggandakan dampak saldo.
- [ ] Saldo yang ditampilkan sesuai perhitungan reward yang sudah ada.
- [ ] Perubahan konfigurasi tidak mengubah snapshot transaksi lama.
- [ ] Aturan reward sesi tidak berubah.

### 13.3. Kualitas

- [ ] Tes yang relevan lulus.
- [ ] `npx tsc --noEmit` lulus.
- [ ] Lint diperiksa dan warning dilaporkan.
- [ ] UI diuji pada browser lokal desktop.
- [ ] UI diuji pada viewport mobile.
- [ ] Tidak ada data reward yang dihapus atau di-reset.
- [ ] Tidak ada commit otomatis.
- [ ] Tidak ada perubahan VPS/produksi.
- [ ] Keterbatasan keamanan lokal dan pengujian lintas-tab dilaporkan secara jujur.

---

**Akhir Spesifikasi Phase 7B UI Parent Dashboard**
