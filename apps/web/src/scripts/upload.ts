// Unggah gambar (admin) ke /api/v1/admin/uploads; server memvalidasi isi file lalu mengembalikan path storage.
document.querySelectorAll<HTMLElement>('[data-upload]').forEach((box) => {
  const file = box.querySelector<HTMLInputElement>('[data-file]'), text = box.querySelector<HTMLInputElement>('input[type=text], input:not([type])');
  file?.addEventListener('change', async () => {
    const f = file.files?.[0]; if (!f || !text) return;
    if (f.size > 2 * 1024 * 1024) { alert('Ukuran gambar maksimal 2 MB.'); file.value = ''; return; }
    const fd = new FormData(); fd.append('file', f);
    const hint = box.querySelector<HTMLElement>('.hint'); const old = hint?.textContent ?? ''; if (hint) hint.textContent = 'Mengunggah…';
    try {
      const res = await fetch('/api/v1/admin/uploads', { method: 'POST', body: fd }); const out = await res.json();
      if (!res.ok) throw new Error(out?.error?.message ?? 'Gagal mengunggah.');
      text.value = out.data.path; let p = box.querySelector<HTMLImageElement>('[data-preview]');
      if (!p) { p = document.createElement('img'); p.dataset.preview = '1'; p.width = 160; p.height = 90; p.alt = ''; p.style.cssText = 'margin-top:8px;border-radius:8px;filter:grayscale(1)'; box.append(p); }
      p.src = URL.createObjectURL(f); if (hint) hint.textContent = 'Berhasil diunggah. Simpan formulir untuk menerapkan.';
    } catch (e) { if (hint) hint.textContent = e instanceof Error ? e.message : 'Gagal mengunggah.'; setTimeout(() => { if (hint) hint.textContent = old; }, 4000); }
    file.value = '';
  });
});
export {};
