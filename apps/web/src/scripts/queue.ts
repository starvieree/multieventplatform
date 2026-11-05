// Polling status antrean (read-only). Tidak membuat request baru; berhenti saat tab tersembunyi agar hemat.
const root = document.getElementById('queue');
if (root && !['rejected', 'failed', 'expired'].includes(root.dataset.state ?? '')) {
  const id = root.dataset.id!; let delay = 2000;
  const body = document.getElementById('q-body')!, title = document.getElementById('q-title')!, actions = document.getElementById('q-actions')!, wait = document.getElementById('q-wait');
  const tick = async () => {
    if (document.hidden) return setTimeout(tick, 3000);
    try {
      const res = await fetch(`/api/v1/queue-requests/${id}`, { cache: 'no-store' });
      if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(location.pathname)}`; return; }
      const out = await res.json();
      const d = out.data;
      if (d?.status === 'accepted' && d.registration_id) { title.textContent = 'Kuota berhasil diamankan'; location.href = `/registration/${d.registration_id}/form`; return; }
      if (['rejected', 'failed', 'expired'].includes(d?.status)) {
        title.textContent = 'Pendaftaran belum berhasil'; body.innerHTML = ''; const p = document.createElement('p'); p.textContent = d.message ?? 'Permintaan tidak dapat diproses.'; body.append(p);
        actions.innerHTML = '<a class="btn" href="/events">Lihat event</a>'; return;
      }
      if (wait) wait.textContent = d?.status === 'processing' ? 'Sedang diproses…' : 'Menunggu giliran…';
      delay = 2000;
    } catch { if (wait) wait.textContent = 'Koneksi bermasalah, mencoba lagi…'; delay = Math.min(delay * 1.5, 8000); }
    setTimeout(tick, delay);
  };
  tick();
}
