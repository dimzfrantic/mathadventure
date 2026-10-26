# 00.1-B — Panduan Implementasi Vertical Slice

Status: Prototipe lokal terbatas; UX distribusi dan pemeriksaan menggunakan satu papan.
Referensi normatif: `phase-2c-00.1-b-distribution-specification.md`

## Cakupan yang dibuat

Implementasi hanya mencakup task `00.1-B`, variant `sufficient` (persediaan cukup), dengan data prototipe lima teman dan lima benda. Jumlah ini bukan keputusan final. Variant shortage dan surplus belum dibuat. Kode aktivitas 00.1-A tidak diubah pada revisi UX ini.

Alur anak: pilih aktivitas 00.1-B → mulai tantangan → pilih benda di persediaan → pilih teman penerima → periksa papan dengan tombol `Sudah selesai, periksa!` → lihat feedback pada papan yang sama → bila perlu, perbaiki dan periksa lagi.

Persediaan dan seluruh penerima tetap terlihat saat distribusi maupun sesudah pemeriksaan. Tidak ada layar pemeriksaan terpisah, checkbox penerima, atau radio tentang sisa. Satu benda hanya berada di satu lokasi; alokasi ganda kepada teman tetap terlihat dan dapat diperbaiki. Feedback salah menyebut konteks langsung pada kartu penerima dan tidak menghapus alokasi. Anak dapat mengembalikan benda, membatalkan langkah, atau memilih mulai ulang secara eksplisit. Tap/klik berfungsi tanpa drag-and-drop; drag tersedia sebagai alternatif.

Klik dan perubahan papan tidak menghasilkan verdict atau menyimpan attempt. Hanya tombol `Sudah selesai, periksa!` yang mengevaluasi snapshot saat itu dan menambahkan satu attempt. Tombol itu dinonaktifkan untuk snapshot distribusi yang sama; setelah alokasi berubah, pemeriksaan berikutnya menghasilkan attempt baru, tanpa menimpa attempt sebelumnya. Attempt tersimpan hanya dalam store memory-only. Hasil setelah hint atau retry tidak berubah menjadi fresh independent. Ringkasan attempt mencatat fakta papan seperti `hasUnallocatedItems`, bukan jawaban anak tentang sisa; aplikasi tidak mengklaim identifikasi sisa secara terpisah telah diukur.

## Pemisahan state

- State papan, jeda/resume, dan `completedVariants` adalah state UI sesi sementara.
- Attempt disimpan append-only di `MemoryDistributionEvidenceStore`, hanya di memori halaman.
- Ringkasan attempt memuat identitas `taskId`, `variantId`, `attemptId`, outcome/validitas, jumlah penerima/benda, ringkasan alokasi, fakta persediaan dari snapshot, level hint saat ini/riwayat, dan penanda pengulangan.
- Raw klik, tap, dan drag tidak disimpan sebagai event stream.
- Tidak ada persistence lintas reload, backend/cloud, analytics, atau mastery engine.
- Hanya hasil pemeriksaan valid dan benar menandai variant `sufficient` selesai untuk sesi UI. Status sesi tidak dipakai untuk menghitung evidence atau mastery.

Revisi UX ini hanya mengubah file khusus 00.1-B, tests-nya, dan dokumen spesifikasi/panduan. Tidak menambah dependency atau mengubah 00.1-A.

## Menjalankan secara lokal

Dari root `D:\Hermes Project\math-adventure`, jalankan:

```text
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

Buka `http://127.0.0.1:5173/` di komputer host. Untuk perangkat lain pada Wi-Fi yang sama, gunakan `http://192.168.100.147:5173/` (alamat Wi-Fi IPv4 host saat terakhir diperiksa; alamat dapat berubah). Alamat ZeroTier yang terdeteksi adalah `http://10.147.20.8:5173/` untuk perangkat yang memang terhubung ke jaringan ZeroTier yang sama. Jika alamat berubah, periksa `ipconfig` pada host.

`--host 0.0.0.0` membuat Vite mendengarkan pada semua interface jaringan. Ini server development tanpa autentikasi; gunakan hanya pada jaringan yang dipercaya dan jangan meneruskan port 5173 ke internet/public IP. Koneksi dari perangkat lain tetap dapat dipengaruhi Windows Firewall atau isolasi client Wi-Fi. Proses dev server berhenti saat proses terminal dihentikan; tidak ada service/autostart.

Pada shell yang belum mengenali Node portable proyek ini, tambahkan direktori Node ke PATH sebelum menjalankan perintah. Di PowerShell:

```powershell
$env:Path = "C:\Users\MAI-PC\AppData\Local\Programs\node-v24.21.0;$env:Path"
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

## Skenario uji manual Dimz

1. Buka aplikasi; pastikan 00.1-A tetap aktivitas awal. Pilih tab 00.1-B lalu `Mulai tantangan`. Pastikan ada lima benda dan lima teman.
2. Sebelum membagikan, tekan `Sudah selesai, periksa!`. Pastikan papan tetap terlihat, kelima penerima masih tampak, muncul pesan pada kartu teman yang belum mendapat, dan tidak ada layar/form review terpisah.
3. Pilih benda lalu teman dengan tap/klik. Pastikan tidak muncul verdict matematika dan attempt tidak dibuat hanya karena klik/alokasi.
4. Berikan dua benda kepada teman yang sama. Pastikan kedua benda tetap terlihat dan pemeriksaan menandai teman yang menerima lebih dari satu serta teman yang belum mendapat.
5. Perbaiki dengan `Kembalikan` atau `Batalkan langkah terakhir`, alokasikan benda kepada teman yang tepat, lalu periksa ulang. Pastikan papan dan pekerjaan lain tidak direset; hasil baru muncul pada papan yang sama.
6. Tekan `Petunjuk`, lalu buat distribusi benar. Pastikan hint tidak membagikan atau memindahkan benda otomatis dan attempt belum tersimpan sebelum pemeriksaan. Setelah hasil benar, ringkasan internal tetap `guided`, bukan independent.
7. Dari hasil salah, pilih `Mulai pembagian ini dari awal`. Pastikan papan kosong kembali, attempt lama tetap ada, dan keberhasilan sesudah retry bukan fresh independent.
8. Uji `Jeda` lalu `Lanjutkan`; papan dipertahankan selama halaman terbuka. Setelah reload, pastikan attempt/checkpoint tidak persisten.
9. Uji keyboard dengan Tab dan Enter/Space. Pastikan kontrol memiliki nama yang jelas dan focus-visible tampak. Drag-and-drop tidak wajib untuk menyelesaikan task.
10. Uji reduced motion melalui pengaturan sistem/browser bila tersedia. Pengujian perangkat touch fisik dan screen reader nyata tetap perlu dilakukan manual.

## Pemeriksaan otomatis revisi UX

- `npm run typecheck` — lulus.
- `npm test` — 69 tes lulus dalam 8 file.
- `npm run build` — lulus.
- `npm run lint` — lulus.
- `git diff --check` — lulus; Git hanya melaporkan peringatan normal tentang konversi LF/CRLF pada file integrasi yang sudah ada.

Test otomatis meregresi pemeriksaan benar/salah, tidak adanya verdict/attempt selama distribusi, penguncian pemeriksaan ulang pada snapshot sama, feedback pada papan yang sama, perbaikan, hint, retry, klasifikasi guided, evidence memory-only, keyboard/tap, dan pause/resume. Smoke test browser lokal juga mengonfirmasi papan tetap menampilkan 5 penerima setelah pemeriksaan salah, alokasi ganda tetap terlihat, pesan kontekstual muncul, checkbox/radio review tidak ada, serta tombol pemeriksaan hanya aktif kembali setelah alokasi berubah. Enter berhasil mengaktifkan tombol benda dan penerima native saat difokuskan; urutan Tab menyeluruh, touch fisik, screen reader nyata, dan sesi manual Dimz masih perlu diuji.

Tidak ada dependency baru, commit, atau push.
