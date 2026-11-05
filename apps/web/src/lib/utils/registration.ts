export function nextAction(r: { id: string; registration_status: string }): { href: string; label: string } | null {
  if (r.registration_status === 'draft') return { href: `/registration/${r.id}/form`, label: 'Lengkapi formulir' };
  if (r.registration_status === 'awaiting_payment') return { href: `/registration/${r.id}/payment`, label: 'Lanjutkan pembayaran' };
  return null;
}
export function timeline(r: { registration_status: string; payment_status: string }, hasTicket: boolean) {
  const past = (s: string[]) => s.includes(r.registration_status);
  return [
    { title: 'Kuota diamankan', done: true },
    { title: 'Formulir diisi', done: past(['awaiting_payment', 'confirmed']) },
    { title: 'Pembayaran', done: r.payment_status === 'paid', text: r.payment_status === 'paid' ? undefined : 'Menunggu pembayaran bila event berbayar' },
    { title: 'Tiket terbit', done: hasTicket },
  ];
}
