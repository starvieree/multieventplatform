const root = document.getElementById('status');
if (root?.dataset.state === 'awaiting_payment') {
  const id = root.dataset.id!;
  const check = async (refresh: boolean) => {
    try {
      const r = await fetch(`/api/v1/registrations/${id}/payment-status${refresh ? '?refresh=1' : ''}`, { cache: 'no-store' });
      const d = (await r.json()).data;
      if (d && (d.registration_status !== root.dataset.state || d.payment_status !== root.dataset.pay)) location.reload();
    } catch { /* abaikan; coba lagi pada siklus berikutnya */ }
  };
  let n = 0; const t = setInterval(() => { if (!document.hidden && ++n < 60) void check(false); else if (n >= 60) clearInterval(t); }, 5000);
  const btn = document.getElementById('refresh') as HTMLButtonElement | null;
  btn?.addEventListener('click', async () => { btn.disabled = true; btn.textContent = 'Memeriksa…'; await check(true); btn.disabled = false; btn.textContent = 'Segarkan status'; });
}
