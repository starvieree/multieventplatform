// Tombol "Daftar": request antrean dibuat server-side lewat API; browser hanya mengirim niat + idempotency key.
const form = document.getElementById('register-form') as HTMLFormElement | null;
const msg = document.getElementById('register-msg');
if (form && form.dataset.can === '1') {
  const keyFor = (ticket: string, qty: number) => {          // kunci stabil per (event, tiket, jumlah): klik berulang / reload tidak membuat antrean ganda
    const k = `reg-key:${form.dataset.event}:${ticket}:${qty}`;
    let v = sessionStorage.getItem(k);
    if (!v) { v = crypto.randomUUID(); sessionStorage.setItem(k, v); }
    return v;
  };
  const show = (t: string) => { if (msg) { msg.hidden = false; msg.textContent = t; } };
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.busy === '1') return;
    const ticket = (form.querySelector('input[name=ticket]:checked') as HTMLInputElement | null)?.value;
    const qty = Number((form.querySelector('#qty') as HTMLInputElement | null)?.value ?? 1);
    if (!ticket) return show('Pilih kategori tiket terlebih dahulu.');
    if (!Number.isInteger(qty) || qty < 1 || qty > Number(form.dataset.max)) return show('Jumlah tiket tidak valid.');
    form.dataset.busy = '1'; if (msg) msg.hidden = true;
    const btn = document.getElementById('register-btn') as HTMLButtonElement; btn.disabled = true; btn.textContent = 'Mengamankan kuota…';
    try {
      const res = await fetch('/api/v1/registrations/queue', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event_id: form.dataset.event, ticket_category_id: ticket, quantity: qty, idempotency_key: keyFor(ticket, qty) }) });
      const out = await res.json().catch(() => ({}));
      if (res.status === 401) { location.href = `/login?next=${encodeURIComponent(`/events/${form.dataset.slug}#daftar`)}`; return; }
      if (res.ok) { location.href = `/registration/queue/${out.data.queue_request_id}`; return; }
      show(out?.error?.message ?? 'Pendaftaran belum dapat diproses.');
    } catch { show('Koneksi bermasalah. Coba lagi sebentar.'); }
    form.dataset.busy = '0'; btn.disabled = false; btn.textContent = 'Daftar sekarang';
  });
}
