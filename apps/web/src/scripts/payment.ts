declare global { interface Window { snap?: { pay: (token: string, cb: Record<string, () => void>) => void } } }
const root = document.getElementById('pay');
const btn = document.getElementById('pay-btn') as HTMLButtonElement | null;
const msg = document.getElementById('pay-msg');
const show = (t: string) => { if (msg) { msg.hidden = false; msg.textContent = t; } };
const loadSnap = () => new Promise<void>((ok, bad) => {
  if (window.snap) return ok();
  const s = document.createElement('script'); s.src = root!.dataset.snap!; s.setAttribute('data-client-key', root!.dataset.clientKey!);
  s.onload = () => ok(); s.onerror = () => bad(new Error('snap')); document.head.append(s);
});
btn?.addEventListener('click', async () => {
  if (btn.dataset.busy === '1') return;
  btn.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Menyiapkan pembayaran…'; if (msg) msg.hidden = true;
  const status = `/registration/${root!.dataset.id}/status`;
  try {
    const res = await fetch(`/api/v1/registrations/${root!.dataset.id}/payment-session`, { method: 'POST' });
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out?.error?.message ?? 'Pembayaran belum dapat disiapkan.');
    await loadSnap();
    // Callback Snap hanya navigasi UI. Kebenaran status datang dari webhook server (halaman status membaca database).
    window.snap!.pay(out.data.snap_token, { onSuccess: () => { location.href = status; }, onPending: () => { location.href = status; }, onError: () => { location.href = status; }, onClose: () => { btn.dataset.busy = '0'; btn.disabled = false; btn.textContent = 'Lanjutkan pembayaran'; } });
  } catch (e) { show(e instanceof Error ? e.message : 'Terjadi masalah.'); btn.dataset.busy = '0'; btn.disabled = false; btn.textContent = 'Bayar sekarang'; }
});
export {};
