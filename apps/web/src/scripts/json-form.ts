// Form -> JSON API dengan proteksi double-submit, umpan balik berrole=status, dan redirect opsional.
type Json = Record<string, unknown>;
document.querySelectorAll<HTMLFormElement>('form[data-json-form]').forEach((form) => {
  const box = form.querySelector<HTMLElement>('[data-feedback]');
  const say = (msg: string, bad = false) => { if (!box) return; box.hidden = false; box.className = `alert ${bad ? 'alert--bad' : 'alert--ok'}`; box.setAttribute('role', bad ? 'alert' : 'status'); box.textContent = msg; };
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (form.dataset.busy === '1') return;
    form.dataset.busy = '1';
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit], button:not([type])');
    if (btn) { btn.disabled = true; btn.dataset.label = btn.textContent ?? ''; btn.textContent = 'Menyimpan…'; }
    const body: Json = {};
    new FormData(form).forEach((v, k) => { body[k] = v; });
    form.querySelectorAll<HTMLInputElement>('input[type=checkbox]').forEach((c) => { body[c.name] = c.checked; });
    form.querySelectorAll<HTMLInputElement>('input[type=number]').forEach((c) => { if (c.name in body && body[c.name] !== '') body[c.name] = Number(body[c.name]); });
    if (form.dataset.hp !== undefined) body.hp = (body.hp as string) ?? '';
    try {
      const res = await fetch(form.dataset.endpoint!, { method: form.dataset.method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { say(out?.error?.message ?? 'Gagal menyimpan. Periksa isian lalu coba lagi.', true); return; }
      say(form.dataset.success ?? 'Berhasil disimpan.');
      if (form.dataset.reset !== undefined) form.reset();
      if (form.dataset.redirect) location.href = form.dataset.redirect.replace('{id}', out?.data?.id ?? '');
    } catch { say('Koneksi bermasalah. Coba lagi sebentar.', true); }
    finally { form.dataset.busy = '0'; if (btn) { btn.disabled = false; btn.textContent = btn.dataset.label ?? 'Simpan'; } }
  });
});
