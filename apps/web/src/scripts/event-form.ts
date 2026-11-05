const form = document.getElementById('event-form') as HTMLFormElement | null;
if (form) {
  // Tab dengan navigasi panah/Home/End (pola ARIA tabs).
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const select = (t: HTMLButtonElement) => { tabs.forEach((x) => { const on = x === t; x.setAttribute('aria-selected', String(on)); x.tabIndex = on ? 0 : -1; (document.getElementById(x.getAttribute('aria-controls')!) as HTMLElement).hidden = !on; }); t.focus(); };
  tabs.forEach((t, i) => { t.addEventListener('click', () => select(t)); t.addEventListener('keydown', (e) => { const k = e.key; if (k === 'ArrowRight') select(tabs[(i + 1) % tabs.length]); else if (k === 'ArrowLeft') select(tabs[(i + tabs.length - 1) % tabs.length]); else if (k === 'Home') select(tabs[0]); else if (k === 'End') select(tabs[tabs.length - 1]); else return; e.preventDefault(); }); });

  form.addEventListener('click', (e) => {
    const t = e.target as HTMLElement;
    const add = t.closest<HTMLElement>('[data-add]'); if (add) { const tpl = document.getElementById(`tpl-${add.dataset.add}`) as HTMLTemplateElement; document.getElementById(`${add.dataset.add}-list`)!.append(tpl.content.cloneNode(true)); }
    if (t.closest('[data-remove]')) t.closest('[data-ticket],[data-field],[data-faq]')?.remove();
  });
  const val = (root: Element, k: string) => root.querySelector<HTMLInputElement>(`[data-k="${k}"]`);
  const msg = document.getElementById('ev-msg')!;
  const say = (t: string, bad = false) => { msg.hidden = false; msg.className = `alert ${bad ? 'alert--bad' : 'alert--ok'}`; msg.textContent = t; msg.scrollIntoView({ block: 'nearest' }); };
  form.addEventListener('submit', async (e) => {
    e.preventDefault(); if (form.dataset.busy === '1') return;
    const g = (n: string) => (form.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? '').trim();
    const event: Record<string, unknown> = {};
    ['title', 'slug', 'organizer_name', 'event_type', 'summary', 'description', 'poster_path', 'banner_path', 'og_image_path', 'poster_alt', 'start_at', 'end_at', 'registration_opens_at', 'registration_closes_at', 'venue_name', 'address', 'online_url', 'requirements', 'meta_title', 'meta_description'].forEach((n) => { event[n] = g(n); });
    event.category_id = g('category_id') || null; event.total_quota = Number(g('total_quota')); event.max_per_user = Number(g('max_per_user'));
    event.allow_multiple_categories = form.querySelector<HTMLInputElement>('input[name="allow_multiple_categories"]')?.checked ?? false;
    event.faq = [...form.querySelectorAll('[data-faq]')].map((r) => ({ q: val(r, 'q')!.value, a: val(r, 'a')!.value })).filter((f) => f.q && f.a);
    const ticket_categories = [...form.querySelectorAll<HTMLElement>('[data-ticket]')].map((r) => ({ id: r.dataset.kId ?? '', name: val(r, 'name')!.value, description: val(r, 'description')!.value, price: Number(val(r, 'price')!.value), quota: Number(val(r, 'quota')!.value), sales_start_at: val(r, 'sales_start_at')!.value, sales_end_at: val(r, 'sales_end_at')!.value, is_active: val(r, 'is_active')!.checked }));
    const form_fields = [...form.querySelectorAll('[data-field]')].map((r) => ({ field_key: val(r, 'field_key')!.value, label: val(r, 'label')!.value, field_type: val(r, 'field_type')!.value, options: val(r, 'options')!.value.split(',').map((s) => s.trim()).filter(Boolean), is_required: val(r, 'is_required')!.checked }));
    const id = form.dataset.id; const btn = document.getElementById('ev-save') as HTMLButtonElement;
    form.dataset.busy = '1'; btn.disabled = true; btn.textContent = 'Menyimpan…'; msg.hidden = true;
    try {
      const res = await fetch(id ? `/api/v1/admin/events/${id}` : '/api/v1/admin/events', { method: id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ event, ticket_categories, form_fields }) });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) { say(out?.error?.message ?? 'Event belum dapat disimpan.', true); return; }
      if (!id) { location.href = `/admin/dashboard/events/${out.data.id}?saved=1`; return; }
      say('Event disimpan. Memuat ulang…'); setTimeout(() => location.reload(), 600);
    } catch { say('Koneksi bermasalah. Coba lagi.', true); }
    finally { form.dataset.busy = '0'; btn.disabled = false; btn.textContent = 'Simpan event'; }
  });
}
document.querySelectorAll<HTMLButtonElement>('[data-event-status]').forEach((b) => b.addEventListener('click', async () => {
  if (!confirm(b.dataset.confirm ?? 'Ubah status event?')) return;
  b.disabled = true;
  const res = await fetch(`/api/v1/admin/events/${b.dataset.id}/status`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: b.dataset.eventStatus }) });
  const out = await res.json().catch(() => ({}));
  if (res.ok) location.reload(); else { alert(out?.error?.message ?? 'Gagal mengubah status.'); b.disabled = false; }
}));
export {};
