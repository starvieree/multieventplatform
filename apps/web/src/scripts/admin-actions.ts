// Tombol aksi admin: [data-action] memanggil API (JSON) dengan konfirmasi dan alasan wajib bila diminta, lalu memuat ulang halaman.
document.querySelectorAll<HTMLButtonElement>('[data-action]').forEach((b) => b.addEventListener('click', async () => {
  if (b.dataset.confirm && !confirm(b.dataset.confirm)) return;
  const body: Record<string, unknown> = b.dataset.body ? JSON.parse(b.dataset.body) : {};
  if (b.dataset.reason) { const r = prompt(b.dataset.reason)?.trim(); if (!r || r.length < 3) return; body.reason = r; }
  b.disabled = true;
  try {
    const res = await fetch(b.dataset.action!, { method: b.dataset.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) { alert(out?.error?.message ?? 'Tindakan gagal.'); b.disabled = false; return; }
    location.reload();
  } catch { alert('Koneksi bermasalah.'); b.disabled = false; }
}));
export {};
