# Phase 2B — 00.1-A first learning vertical slice

Status: implementasi lokal terbatas untuk functional test Dimz; bukan produk pendidikan tervalidasi.

## Scope

Hanya aktivitas 00.1-A: memasangkan astronaut dan roket, memilih sisi yang tersisa, undo/retry, hint dua tingkat, pause/exit, tap/click, native keyboard button, dan HTML drag-and-drop. Tiga susunan contoh (3:3, 4:3, 3:4) hanya variasi task 00.1-A; menu tidak memberi tahu mana sisi yang tersisa. Tidak ada 11 aktivitas lain, diagnostic adaptif penuh, mastery engine, reward, atau parent dashboard.

## Batas learning logic

`src/learning/matching.ts`: pure functions untuk membuat task, transisi pasangan/undo/retry/hint, sisa, validasi, dan hasil attempt. Sebuah roket atau astronaut hanya boleh berada pada satu pasangan; identitas pasangan bebas karena objek identik. Tugas valid jika sebanyak mungkin pasangan satu-satu terbentuk dan jawaban sisi sisa sesuai. Jika jumlah berbeda, objek sisa tetap tampil. Hint 1 bertanya apa yang belum berpasangan; hint 2 hanya menyorot satu astronaut yang belum berpasangan bila ada, tidak pernah menyorot roket target. Success pasca hint adalah guided evidence.

`src/MatchingApp.tsx`: rendering dan event sementara. Tap/drag memanggil reducer matematika yang sama. Tombol native mendukung Tab, Enter, Space. CSS menyertakan reduced-motion; pemeriksaan screen reader dan motorik nyata masih perlu functional test.

## Evidence dan persistence

`src/learning/evidenceStore.ts`: interface dan adapter memori, tanpa browser storage. Attempt yang disimpan selama halaman terbuka: `attemptId` unik dalam instance store, `taskId` (`00.1-A`), `variantId` (susunan), outcome, `valid`, `hintLevel` attempt saat ini, `hintHistoryLevel` bantuan tertinggi yang pernah dilihat pada variasi tersebut, jumlah pasangan, jawaban sisi sisa, serta penanda pengulangan/kelayakan evidence mandiri. Retry/edit menambahkan attempt tanpa menghapus attempt lama. `valid` bernilai `null` untuk outcome `inconclusive`: itu berarti kebenaran jawaban matematika tidak dinilai pada attempt ini, bukan salah atau benar. `false` pada attempt yang dapat ditafsirkan berarti penyelesaian/jawaban tidak sesuai; `true` berarti jawaban sesuai. Field ini bukan keputusan mastery. Checkpoint menyalin task, pasangan, jawaban, hint saat ini dan riwayat undo secara mendalam; UI events mentah tidak disimpan.

Anak melihat instruksi singkat dan umpan balik suportif dalam bahasa Indonesia; identifier outcome internal tidak ditampilkan. Submit jawaban sebelum semua pasangan yang mungkin dibuat akan tetap di aktivitas, mempertahankan papan dan pilihan sisi tersisa, menampilkan pesan untuk melanjutkan memasangkan, serta tidak membuat attempt. Setelah semua pasangan terbentuk, pilihan sisi tersisa yang belum diisi meminta anak memilih tanpa menghapus progres. UI tidak meminta anak mengklasifikasikan kesulitan antarmuka versus matematika dan tidak menyediakan tombol khusus untuk memicu `inconclusive`; outcome itu tetap tersedia hanya sebagai klasifikasi internal. Tidak ada keputusan mastery dari satu attempt.

Adapter ini tidak menyimpan ke disk/localStorage/IndexedDB: menutup atau memuat ulang halaman menghapus checkpoint, evidence, dan progres susunan sesi. Progres susunan selesai adalah state sesi UI terpisah dari learning evidence/mastery; hanya jawaban benar setelah tugas lengkap menandai susunan selesai. Tugas tidak lengkap tidak disubmit, jawaban salah tetap menawarkan perbaikan, dan outcome `inconclusive` tidak menandai susunan selesai. Tombol lanjut mencari susunan belum selesai berikutnya dalam urutan melingkar dari susunan saat ini. Setelah semua tiga susunan selesai, tampil pesan “Yeay, semua susunan sudah kamu coba!” dengan pilihan kembali ke menu atau bermain lagi; bermain lagi mereset progres sesi. Menu utama tetap bisa memilih susunan manual. Tidak ada keputusan mastery otomatis.

## Trade-off terbuka untuk review

- Outcome dan bukti interaksi tetap internal; hanya bahasa suportif yang terlihat anak.
- Menu variasi statis dapat dipelajari/dihafal; tidak ada randomisasi atau retensi lintas sesi.
- HTML5 drag-and-drop belum terbukti nyaman pada semua layar sentuh; tap/click adalah jalur yang setara.
- Tidak ada data persistence setelah reload; penambahan penyimpanan lokal membutuhkan persetujuan untuk kebutuhan/retensi data.
- Tidak ada perhitungan mastery walaupun interface evidence sudah siap diuji.
