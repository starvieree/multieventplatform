// Toggle navbar publik & sidebar panel (mobile). Atribut ARIA diperbarui agar tetap dapat diakses keyboard.
const nav = document.getElementById('nav');
const navBtn = document.getElementById('nav-toggle');
navBtn?.addEventListener('click', () => {
  const open = nav?.getAttribute('data-open') !== 'true';
  nav?.setAttribute('data-open', String(open)); navBtn.setAttribute('aria-expanded', String(open));
});
const panel = document.getElementById('panel');
const pBtn = document.getElementById('panel-toggle');
pBtn?.addEventListener('click', () => {
  const open = panel?.getAttribute('data-open') !== 'true';
  panel?.setAttribute('data-open', String(open)); pBtn.setAttribute('aria-expanded', String(open));
});
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  panel?.setAttribute('data-open', 'false'); nav?.setAttribute('data-open', 'false');
  navBtn?.setAttribute('aria-expanded', 'false'); pBtn?.setAttribute('aria-expanded', 'false');
  document.querySelectorAll('.nav__drop details[open]').forEach((d) => d.removeAttribute('open'));
});
