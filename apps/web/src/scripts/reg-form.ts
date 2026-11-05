const form = document.getElementById('reg-form') as HTMLFormElement | null;
const cd = document.getElementById('countdown');
if (cd) {
  const end = +new Date(cd.dataset.expires!);
  const t = setInterval(() => {
    const s = Math.max(0, Math.floor((end - Date.now()) / 1000));
    cd.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
    if (s === 0) { clearInterval(t); location.reload(); }
  }, 1000);
}
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (form.dataset.busy === '1') return;                         // cegah double submit
  const msg = document.getElementById('reg-msg')!; msg.hidden = true;
  const answers: Record<string, unknown> = {};
  form.querySelectorAll<HTMLInputElement>('input, select, textarea').forEach((el) => {
    if (!el.name) return;
    if (el.type === 'checkbox') answers[el.name] = el.checked;
    else if (el.value !== '') answers[el.name] = el.type === 'number' ? Number(el.value) : el.value;
  });
  form.dataset.busy = '1'; const btn = document.getElementById('reg-btn') as HTMLButtonElement; const label = btn.textContent; btn.disabled = true; btn.textContent = 'Menyimpan…';
  try {
    const res = await fetch(`/api/v1/registrations/${form.dataset.id}/answers`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ answers }) });
    const out = await res.json().catch(() => ({}));
    if (res.ok) { location.href = out.data.next === 'payment' ? `/registration/${form.dataset.id}/payment` : `/registration/${form.dataset.id}/status`; return; }
    msg.hidden = false; msg.textContent = out?.error?.message ?? 'Data belum dapat disimpan.';
  } catch { msg.hidden = false; msg.textContent = 'Koneksi bermasalah. Coba lagi.'; }
  form.dataset.busy = '0'; btn.disabled = false; btn.textContent = label;
});
