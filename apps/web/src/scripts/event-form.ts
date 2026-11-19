const form = document.getElementById('event-form') as HTMLFormElement | null;

if (form) {
  const tabs = [...form.querySelectorAll<HTMLButtonElement>('[role=tab]')];
  const isEditMode = Boolean(form.dataset.id && form.dataset.id.length > 10);

  // Menyimpan posisi langkah aktif dan langkah terjauh yang sudah dibuka
  let currentStepIndex = 0;
  let maxStepReached = isEditMode ? tabs.length - 1 : 0;

  // Fungsi validasi sebelum melangkah ke step berikutnya
  const validateStep = (index: number): { valid: boolean; message?: string; focusName?: string } => {
    if (index === 0) { // Informasi Dasar
      const title = (form.querySelector<HTMLInputElement>('[name="title"]')?.value ?? '').trim();
      const slug = (form.querySelector<HTMLInputElement>('[name="slug"]')?.value ?? '').trim();
      const cat = form.querySelector<HTMLSelectElement>('[name="category_id"]')?.value ?? '';
      const type = form.querySelector<HTMLSelectElement>('[name="event_type"]')?.value ?? '';

      if (!title) return { valid: false, message: 'Judul event wajib diisi sebelum melanjutkan ke langkah berikutnya.', focusName: 'title' };
      if (!slug) return { valid: false, message: 'Slug URL wajib diisi sebelum melanjutkan.', focusName: 'slug' };
      if (!cat) return { valid: false, message: 'Pilih kategori event terlebih dahulu.', focusName: 'category_id' };
      if (!type) return { valid: false, message: 'Pilih tipe penyelenggaraan event.', focusName: 'event_type' };
      return { valid: true };
    }

    if (index === 1) { // Media & Poster
      // Media bersifat opsional saat draf
      return { valid: true };
    }

    if (index === 2) { // Jadwal
      const s = form.querySelector<HTMLInputElement>('[name="start_at"]')?.value ?? '';
      const e = form.querySelector<HTMLInputElement>('[name="end_at"]')?.value ?? '';
      const ro = form.querySelector<HTMLInputElement>('[name="registration_opens_at"]')?.value ?? '';
      const rc = form.querySelector<HTMLInputElement>('[name="registration_closes_at"]')?.value ?? '';

      if (!s) return { valid: false, message: 'Tentukan tanggal dan waktu mulai event.', focusName: 'start_at' };
      if (!e) return { valid: false, message: 'Tentukan tanggal dan waktu selesai event.', focusName: 'end_at' };
      if (!ro) return { valid: false, message: 'Tentukan waktu pembukaan pendaftaran tiket.', focusName: 'registration_opens_at' };
      if (!rc) return { valid: false, message: 'Tentukan waktu penutupan pendaftaran tiket.', focusName: 'registration_closes_at' };
      return { valid: true };
    }

    if (index === 3) { // Lokasi & Venue
      const type = form.querySelector<HTMLSelectElement>('[name="event_type"]')?.value ?? 'offline';
      const v = (form.querySelector<HTMLInputElement>('[name="venue_name"]')?.value ?? '').trim();
      const u = (form.querySelector<HTMLInputElement>('[name="online_url"]')?.value ?? '').trim();

      if (type === 'online' && !u) {
        return { valid: false, message: 'Untuk event online, cantumkan tautan pertemuan (Zoom/YouTube/Meet).', focusName: 'online_url' };
      }
      if (type === 'offline' && !v) {
        return { valid: false, message: 'Untuk event offline, cantumkan nama tempat/gedung pelaksanaan.', focusName: 'venue_name' };
      }
      return { valid: true };
    }

    if (index === 4) { // Kuota & Tiket
      const quota = Number(form.querySelector<HTMLInputElement>('[name="total_quota"]')?.value ?? 0);
      const maxUser = Number(form.querySelector<HTMLInputElement>('[name="max_per_user"]')?.value ?? 0);
      const tickets = [...form.querySelectorAll<HTMLElement>('#ticket-list [data-ticket]')];

      if (quota <= 0) return { valid: false, message: 'Tentukan kuota total event (minimal 1 tiket).', focusName: 'total_quota' };
      if (maxUser <= 0) return { valid: false, message: 'Tentukan maksimal tiket per akun pemesan.', focusName: 'max_per_user' };
      if (tickets.length === 0) {
        return { valid: false, message: 'Tambahkan setidaknya 1 kategori tiket sebelum melanjutkan.' };
      }
      const emptyTicket = tickets.find((t) => !(t.querySelector<HTMLInputElement>('[data-k="name"]')?.value ?? '').trim());
      if (emptyTicket) {
        return { valid: false, message: 'Pastikan nama seluruh kategori tiket telah diisi.' };
      }
      return { valid: true };
    }

    if (index === 5) { // Form Tambahan
      return { valid: true };
    }

    if (index === 6) { // FAQ & SEO
      return { valid: true };
    }

    return { valid: true };
  };

  // Render status visual seluruh bullet dan garis stepper
  const updateStepperUI = () => {
    tabs.forEach((tabBtn, i) => {
      const stepEl = tabBtn.closest<HTMLElement>('.wizard-step');
      if (!stepEl) return;

      stepEl.classList.remove('is-active', 'is-complete', 'is-locked');

      if (i < currentStepIndex) {
        // Langkah sebelumnya yang sudah dilewati -> Hijau dengan centang
        stepEl.classList.add('is-complete');
        tabBtn.disabled = false;
        tabBtn.removeAttribute('aria-disabled');
      } else if (i === currentStepIndex) {
        // Langkah yang sedang aktif saat ini -> Biru
        stepEl.classList.add('is-active');
        tabBtn.disabled = false;
        tabBtn.removeAttribute('aria-disabled');
      } else {
        // Langkah mendatang
        if (i <= maxStepReached) {
          // Pernah dibuka sebelumnya
          tabBtn.disabled = false;
          tabBtn.removeAttribute('aria-disabled');
        } else {
          // Terkunci, belum boleh loncat -> Abu-abu
          stepEl.classList.add('is-locked');
          tabBtn.disabled = true;
          tabBtn.setAttribute('aria-disabled', 'true');
        }
      }

      // Update garis penghubung antar-step (step-line-1 s/d step-line-6)
      if (i > 0) {
        const line = form.querySelector<HTMLElement>(`.step-line-${i}`);
        if (line) {
          if (i <= currentStepIndex) {
            line.classList.add('is-done');
          } else {
            line.classList.remove('is-done');
          }
        }
      }
    });
  };

  // Tampilkan hanya panel form yang sedang aktif
  const selectByIndex = (index: number) => {
    currentStepIndex = index;
    tabs.forEach((x, i) => {
      const on = i === index;
      x.setAttribute('aria-selected', String(on));
      x.tabIndex = on ? 0 : -1;

      const targetId = x.getAttribute('aria-controls');
      if (targetId) {
        const panel = document.getElementById(targetId);
        if (panel) {
          panel.hidden = !on;
          panel.style.display = on ? '' : 'none';
        }
      }
    });

    updateStepperUI();
  };

  // Klik langsung pada bullet stepper (dengan pencegahan loncat langkah)
  tabs.forEach((t) => {
    t.addEventListener('click', () => {
      const targetIdx = Number(t.dataset.stepIndex);

      // Cegah loncat ke langkah yang belum dibuka secara urut
      if (targetIdx > maxStepReached) {
        alert('Langkah ini belum dapat dibuka. Mohon isi formulir secara berurutan.');
        return;
      }

      // Jika ingin maju dari step saat ini, validasi step saat ini terlebih dahulu
      if (targetIdx > currentStepIndex) {
        const v = validateStep(currentStepIndex);
        if (!v.valid) {
          alert(v.message ?? 'Lengkapi formulir pada bagian ini terlebih dahulu.');
          if (v.focusName) form.querySelector<HTMLElement>(`[name="${v.focusName}"]`)?.focus();
          return;
        }
      }

      selectByIndex(targetIdx);
      window.scrollTo({ top: form.offsetTop - 80, behavior: 'smooth' });
    });
  });

  // Navigasi tombol Lanjut & Kembali
  form.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;

    // Tombol Lanjut ke langkah berikutnya
    const nextBtn = target.closest<HTMLElement>('[data-step-next]');
    if (nextBtn) {
      const v = validateStep(currentStepIndex);
      if (!v.valid) {
        alert(v.message ?? 'Lengkapi bagian ini sebelum melanjutkan.');
        if (v.focusName) form.querySelector<HTMLElement>(`[name="${v.focusName}"]`)?.focus();
        return;
      }

      const nextIdx = currentStepIndex + 1;
      if (nextIdx < tabs.length) {
        maxStepReached = Math.max(maxStepReached, nextIdx);
        selectByIndex(nextIdx);
        window.scrollTo({ top: form.offsetTop - 80, behavior: 'smooth' });
      }
      return;
    }

    // Tombol Kembali ke langkah sebelumnya
    const prevBtn = target.closest<HTMLElement>('[data-step-prev]');
    if (prevBtn) {
      if (currentStepIndex > 0) {
        selectByIndex(currentStepIndex - 1);
        window.scrollTo({ top: form.offsetTop - 80, behavior: 'smooth' });
      }
      return;
    }

    // Tambah & Hapus dinamis (tiket/field/faq)
    const add = target.closest<HTMLElement>('[data-add]');
    if (add) {
      const tpl = document.getElementById(`tpl-${add.dataset.add}`) as HTMLTemplateElement;
      document.getElementById(`${add.dataset.add}-list`)!.append(tpl.content.cloneNode(true));
    }
    if (target.closest('[data-remove]')) {
      target.closest('[data-ticket],[data-field],[data-faq]')?.remove();
    }
  });

  // Inisialisasi awal
  selectByIndex(0);

  const val = (root: Element, k: string) => root.querySelector<HTMLInputElement>(`[data-k="${k}"]`);
  const msg = document.getElementById('ev-msg')!;
  const say = (t: string, bad = false) => {
    if (!msg) return;
    msg.hidden = false;
    msg.style.display = 'block';
    msg.className = `alert ${bad ? 'alert--bad' : 'alert--ok'}`;
    msg.textContent = t;
    msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  // Submit form event pada langkah terakhir
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (form.dataset.busy === '1') return;

    // Validasi final seluruh bagian sebelum pengiriman
    for (let i = 0; i < tabs.length; i++) {
      const v = validateStep(i);
      if (!v.valid) {
        selectByIndex(i);
        alert(`[Langkah ${i + 1}] ${v.message}`);
        if (v.focusName) form.querySelector<HTMLElement>(`[name="${v.focusName}"]`)?.focus();
        return;
      }
    }

    const g = (n: string) => (form.querySelector<HTMLInputElement>(`[name="${n}"]`)?.value ?? '').trim();
    const event: Record<string, unknown> = {};
    [
      'title', 'slug', 'organizer_name', 'event_type', 'summary', 'description',
      'poster_path', 'banner_path', 'og_image_path', 'poster_alt', 'start_at',
      'end_at', 'registration_opens_at', 'registration_closes_at', 'venue_name',
      'address', 'online_url', 'requirements', 'meta_title', 'meta_description'
    ].forEach((n) => { event[n] = g(n); });

    event.category_id = g('category_id') || null;
    event.total_quota = Number(g('total_quota'));
    event.max_per_user = Number(g('max_per_user'));
    event.allow_multiple_categories = form.querySelector<HTMLInputElement>('input[name="allow_multiple_categories"]')?.checked ?? false;
    event.faq = [...form.querySelectorAll('[data-faq]')].map((r) => ({ q: val(r, 'q')!.value, a: val(r, 'a')!.value })).filter((f) => f.q && f.a);
    const ticket_categories = [...form.querySelectorAll<HTMLElement>('[data-ticket]')].map((r) => ({
      id: r.dataset.kId ?? '',
      name: val(r, 'name')!.value,
      description: val(r, 'description')!.value,
      price: Number(val(r, 'price')!.value),
      quota: Number(val(r, 'quota')!.value),
      sales_start_at: val(r, 'sales_start_at')!.value,
      sales_end_at: val(r, 'sales_end_at')!.value,
      is_active: val(r, 'is_active')!.checked
    }));
    const form_fields = [...form.querySelectorAll('[data-field]')].map((r) => ({
      field_key: val(r, 'field_key')!.value,
      label: val(r, 'label')!.value,
      field_type: val(r, 'field_type')!.value,
      options: val(r, 'options')!.value.split(',').map((s) => s.trim()).filter(Boolean),
      is_required: val(r, 'is_required')!.checked
    }));

    const id = form.dataset.id;
    const btn = document.getElementById('ev-save') as HTMLButtonElement;
    form.dataset.busy = '1';
    btn.disabled = true;
    btn.textContent = 'Menyimpan…';
    if (msg) {
      msg.hidden = true;
      msg.style.display = 'none';
    }

    try {
      const res = await fetch(id ? `/api/v1/admin/events/${id}` : '/api/v1/admin/events', {
        method: id ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event, ticket_categories, form_fields })
      });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) {
        say(out?.error?.message ?? 'Event belum dapat disimpan.', true);
        return;
      }
      if (!id) {
        location.href = `/admin/dashboard/events/${out.data.id}?saved=1`;
        return;
      }
      say('Event berhasil disimpan. Memuat ulang…');
      setTimeout(() => location.reload(), 600);
    } catch {
      say('Koneksi bermasalah. Coba lagi.', true);
    } finally {
      form.dataset.busy = '0';
      btn.disabled = false;
      btn.textContent = 'Simpan Event';
    }
  });
}

document.querySelectorAll<HTMLButtonElement>('[data-event-status]').forEach((b) =>
  b.addEventListener('click', async () => {
    if (!confirm(b.dataset.confirm ?? 'Ubah status event?')) return;
    b.disabled = true;
    const res = await fetch(`/api/v1/admin/events/${b.dataset.id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: b.dataset.eventStatus })
    });
    const out = await res.json().catch(() => ({}));
    if (res.ok) location.reload();
    else {
      alert(out?.error?.message ?? 'Gagal mengubah status.');
      b.disabled = false;
    }
  })
);

export {};
