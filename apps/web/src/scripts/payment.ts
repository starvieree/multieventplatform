// apps/web/src/scripts/payment.ts
// Client logic for Dynamic QRIS EMVCo Tag 54, countdown timer, and settlement notification modal

const root = document.getElementById('pay');
const regId = root?.dataset.id;
const eventUrl = root?.dataset.eventUrl || '/events';
const statusUrl = `/registration/${regId}/status`;

// UI Elements
const qrisLoading = document.getElementById('qris-loading');
const qrisContent = document.getElementById('qris-content');
const qrisImg = document.getElementById('qris-img') as HTMLImageElement | null;
const qrExpiredOverlay = document.getElementById('qr-expired-overlay');
const btnExpiredRenew = document.getElementById('btn-expired-renew');
const countdownTimer = document.getElementById('countdown-timer');
const orderStatusBadge = document.getElementById('order-status-badge');
const currentOrderIdEl = document.getElementById('current-order-id');

const qrisExactAmount = document.getElementById('qris-exact-amount');
const qrisUniqueBadge = document.getElementById('qris-unique-badge');
const copyAmountBtn = document.getElementById('copy-amount-btn');
const btnDownload = document.getElementById('btn-download');
const btnCopyString = document.getElementById('btn-copy-string');

const displayMerchantName = document.getElementById('display-merchant-name');
const displayMerchantLoc = document.getElementById('display-merchant-loc');
const rawQrisDisplay = document.getElementById('raw-qris-display') as HTMLTextAreaElement | null;
const tag01Preview = document.getElementById('tag-01-preview');
const tag54Preview = document.getElementById('tag-54-preview');
const tag63Preview = document.getElementById('tag-63-preview');
const displayCrc = document.getElementById('display-crc');

// Modal Elements
const successModal = document.getElementById('success-modal');
const modalOrderId = document.getElementById('modal-order-id');
const modalAmount = document.getElementById('modal-amount');
const modalMerchant = document.getElementById('modal-merchant');
const modalAcquirer = document.getElementById('modal-acquirer');
const modalTime = document.getElementById('modal-time');
const btnCloseModal = document.getElementById('btn-close-modal');

let rawAmountToCopy = 0;
let rawQrisString = '';
let currentOrderId = '';
let isPaid = false;
let isExpired = false;
let expiresAtMs = Date.now() + 15 * 60 * 1000;
let pollTimer: number | null = null;
let countdownInterval: number | null = null;

const formatRupiah = (num: number) => {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(num);
};

// Web Audio API Sound Chime for instant celebration feedback
function playCelebrationSound() {
  try {
    const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtxClass) return;
    const audioCtx = new AudioCtxClass();
    const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
    notes.forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.18, audioCtx.currentTime + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + i * 0.12 + 0.36);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(audioCtx.currentTime + i * 0.12);
      osc.stop(audioCtx.currentTime + i * 0.12 + 0.42);
    });
  } catch {}
}

function handleOrderExpired() {
  if (isPaid) return;
  isExpired = true;
  if (pollTimer) clearInterval(pollTimer);
  if (countdownInterval) clearInterval(countdownInterval);

  if (orderStatusBadge) {
    orderStatusBadge.className = 'badge-expired';
    orderStatusBadge.innerHTML = '✕ KADALUARSA';
  }

  if (countdownTimer) {
    countdownTimer.textContent = '⏱️ 00:00 (Habis)';
    countdownTimer.classList.add('countdown-danger');
  }

  if (qrExpiredOverlay) {
    qrExpiredOverlay.hidden = false;
    qrExpiredOverlay.classList.add('is-active');
    qrExpiredOverlay.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 16px; text-align: center; max-width: 320px; box-shadow: 0 10px 30px rgba(0,0,0,0.15); border: 1px solid #fca5a5;">
        <div style="font-size: 36px; margin-bottom: 8px;">⏱️</div>
        <h3 style="color: #991b1b; margin: 0 0 6px; font-size: 1.1rem; font-weight: 750;">Waktu Habis</h3>
        <p style="font-size: 13px; color: #4b5563; line-height: 1.5; margin: 0 0 14px;">
          Batas waktu pembayaran telah habis. Anda akan dialihkan kembali ke halaman event...
        </p>
        <a href="${eventUrl}" class="btn btn--primary" style="display: block; width: 100%; text-decoration: none; padding: 8px 12px; font-size: 13px; border-radius: 8px;">
          Kembali ke Event
        </a>
      </div>
    `;
  }

  // Otomatis terpental ke halaman event setelah 2 detik
  setTimeout(() => {
    const targetUrl = eventUrl.includes('?') ? `${eventUrl}&expired=1` : `${eventUrl}?expired=1`;
    window.location.href = targetUrl;
  }, 2000);
}

function handleLatePaymentExpired(orderData?: any) {
  isExpired = true;
  if (pollTimer) clearInterval(pollTimer);
  if (countdownInterval) clearInterval(countdownInterval);

  if (orderStatusBadge) {
    orderStatusBadge.className = 'badge-expired';
    orderStatusBadge.innerHTML = '✕ PEMBAYARAN KADALUARSA';
    orderStatusBadge.style.background = '#fef2f2';
    orderStatusBadge.style.color = '#991b1b';
    orderStatusBadge.style.borderColor = '#f87171';
  }

  if (countdownTimer) {
    countdownTimer.textContent = '⏱️ Waktu Habis';
    countdownTimer.classList.add('countdown-danger');
  }

  if (qrExpiredOverlay) {
    qrExpiredOverlay.hidden = false;
    qrExpiredOverlay.classList.add('is-active');
    qrExpiredOverlay.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 14px; text-align: center; max-width: 340px; box-shadow: 0 10px 25px rgba(0,0,0,0.15); border: 1px solid #fca5a5;">
        <div style="font-size: 36px; margin-bottom: 8px;">⚠️</div>
        <h3 style="color: #991b1b; margin: 0 0 8px; font-size: 1.1rem; font-weight: 700;">Pembayaran Melebihi Batas Waktu</h3>
        <p style="font-size: 13px; color: #4b5563; line-height: 1.5; margin: 0 0 16px;">
          Pembayaran Anda terdeteksi, namun waktu pembayaran telah kadaluarsa sehingga <strong>tiket tidak dapat diterbitkan</strong>. Dana Anda tercatat untuk proses pengembalian dana (refund).
        </p>
        <a href="${statusUrl}" class="btn btn--primary" style="display: block; width: 100%; text-decoration: none; padding: 10px; font-size: 13.5px; border-radius: 8px;">
          Buka Status & Info Refund
        </a>
      </div>
    `;
  }

  setTimeout(() => {
    location.href = statusUrl;
  }, 4000);
}

function startCountdown(targetExpiryMs: number) {
  if (countdownInterval) clearInterval(countdownInterval);
  isExpired = false;
  expiresAtMs = targetExpiryMs;
  if (qrExpiredOverlay) {
    qrExpiredOverlay.hidden = true;
    qrExpiredOverlay.classList.remove('is-active');
  }

  function tick() {
    if (isPaid) {
      if (countdownInterval) clearInterval(countdownInterval);
      return;
    }

    const diffMs = expiresAtMs - Date.now();
    if (diffMs <= 0) {
      if (countdownInterval) clearInterval(countdownInterval);
      handleOrderExpired();
      return;
    }

    const totalSeconds = Math.floor(diffMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    const timeStr = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;

    if (countdownTimer) {
      countdownTimer.textContent = `⏱️ ${timeStr}`;
      if (minutes < 3) {
        countdownTimer.classList.add('countdown-danger');
      } else {
        countdownTimer.classList.remove('countdown-danger');
      }
    }
  }

  tick();
  countdownInterval = window.setInterval(tick, 1000);
}

function showSuccessModal(orderData?: any) {
  if (isPaid || isExpired) return;

  // STRICT GUARD: Pastikan modal hanya muncul jika status pembayaran benar-benar paid / confirmed
  const pStatus = orderData?.payment_status;
  const rStatus = orderData?.registration_status;
  if (pStatus !== 'paid' && rStatus !== 'confirmed' && rStatus !== 'paid') {
    return;
  }

  isPaid = true;
  if (pollTimer) clearInterval(pollTimer);
  if (countdownInterval) clearInterval(countdownInterval);

  if (qrExpiredOverlay) {
    qrExpiredOverlay.hidden = true;
    qrExpiredOverlay.classList.remove('is-active');
  }
  playCelebrationSound();

  if (orderStatusBadge) {
    orderStatusBadge.className = 'badge-paid';
    orderStatusBadge.innerHTML = '✓ LUNAS TERVERIFIKASI';
  }

  if (countdownTimer) {
    countdownTimer.textContent = '⏱️ Lunas';
    countdownTimer.classList.remove('countdown-danger');
    countdownTimer.style.color = '#059669';
  }

  const verifiedOrderId = orderData?.registration_code || orderData?.order_id || currentOrderId;
  const verifiedAmount = Number(orderData?.total_amount || rawAmountToCopy);

  if (modalOrderId && verifiedOrderId) modalOrderId.textContent = verifiedOrderId;
  if (modalAmount && verifiedAmount) modalAmount.textContent = formatRupiah(verifiedAmount);
  if (modalTime) {
    modalTime.textContent =
      new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + ' WIB';
  }

  if (successModal) {
    successModal.classList.add('is-active');
  }

  // Auto redirect setelah 5 detik jika tidak ditutup manual
  setTimeout(() => {
    location.href = statusUrl;
  }, 5000);
}

// -------------------------------------------------------------
// LOAD DYNAMIC QRIS SESSION
// -------------------------------------------------------------
async function loadQrisSession() {
  if (!regId) return;
  try {
    if (qrisLoading) qrisLoading.hidden = false;
    if (qrisContent) qrisContent.hidden = true;

    const res = await fetch(`/api/v1/registrations/${regId}/qris-session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const json = await res.json().catch(() => ({}));
    if (!res.ok || !json.success) {
      throw new Error(json?.error?.message || 'Gagal menyiapkan QRIS Dinamis.');
    }

    const d = json.data;
    rawAmountToCopy = d.total_amount;
    rawQrisString = d.qris_string;
    currentOrderId = d.order_id;

    if (currentOrderIdEl) currentOrderIdEl.textContent = d.order_id;
    if (qrisExactAmount) qrisExactAmount.textContent = formatRupiah(d.total_amount);

    if (qrisUniqueBadge) {
      qrisUniqueBadge.textContent = `* Nominal pas sesuai harga tiket event (${formatRupiah(d.total_amount)})`;
    }

    if (qrisImg && d.qr_data_url) {
      qrisImg.src = d.qr_data_url;
    }

    if (rawQrisDisplay && d.qris_string) {
      rawQrisDisplay.value = d.qris_string;
    }

    if (d.info) {
      if (displayMerchantName && d.info.merchantName) {
        displayMerchantName.textContent = d.info.merchantName;
      }
      if (displayMerchantLoc && d.info.city) {
        displayMerchantLoc.textContent = `${d.info.city}${d.info.postalCode ? ' • ' + d.info.postalCode : ''}`;
      }
      if (modalMerchant && d.info.merchantName) {
        modalMerchant.textContent = d.info.merchantName;
      }
      if (modalAcquirer && d.info.acquirer) {
        modalAcquirer.textContent = `QRIS ${d.info.acquirer}`;
      }
      if (displayCrc && d.info.crc) {
        displayCrc.textContent = d.info.crc;
      }
      if (tag01Preview) tag01Preview.textContent = '010212';
      if (tag54Preview) {
        const amtStr = String(d.total_amount);
        tag54Preview.textContent = `54${amtStr.length.toString().padStart(2, '0')}${amtStr}`;
      }
      if (tag63Preview && d.info.crc) {
        tag63Preview.textContent = `6304${d.info.crc}`;
      }
    }

    if (qrisLoading) qrisLoading.hidden = true;
    if (qrisContent) qrisContent.hidden = false;

    // Start countdown
    const expiry = d.expires_at ? new Date(d.expires_at).getTime() : Date.now() + 15 * 60 * 1000;
    startCountdown(expiry);

    // Start live auto-settlement polling
    startStatusPolling();
  } catch (err: any) {
    if (qrisLoading) {
      qrisLoading.innerHTML = `
        <div style="color: #b91c1c; font-weight: 600; font-size: 13.5px; margin-bottom: 8px;">
          ✕ ${err.message || 'Gagal memuat QRIS.'}
        </div>
        <button class="btn btn--secondary" id="retry-qris" style="font-size: 12px; padding: 6px 14px;">Coba Lagi</button>
      `;
      document.getElementById('retry-qris')?.addEventListener('click', () => {
        loadQrisSession();
      });
    }
  }
}

// -------------------------------------------------------------
// STATUS POLLING (2.0s interval)
// -------------------------------------------------------------
function startStatusPolling() {
  if (pollTimer) return;
  pollTimer = window.setInterval(async () => {
    if (!regId || isPaid || isExpired) return;
    try {
      const res = await fetch(`/api/v1/registrations/${regId}/payment-status?refresh=0`, {
        cache: 'no-store',
      });
      const json = await res.json().catch(() => ({}));
      if (json.success && json.data) {
        const pStatus = json.data.payment_status;
        const rStatus = json.data.registration_status;
        if (pStatus === 'paid' && rStatus === 'confirmed') {
          showSuccessModal(json.data);
        } else if (pStatus === 'paid' && (rStatus === 'cancelled' || rStatus === 'expired')) {
          handleLatePaymentExpired(json.data);
        } else if (pStatus === 'expired' || rStatus === 'expired' || rStatus === 'cancelled') {
          handleOrderExpired();
        }
      }
    } catch {}
  }, 2000);
}

// -------------------------------------------------------------
// EVENT HANDLERS (Copy, Download, Modal Actions)
// -------------------------------------------------------------

// Salin Nominal ke Clipboard
copyAmountBtn?.addEventListener('click', async () => {
  if (!rawAmountToCopy) return;
  try {
    await navigator.clipboard.writeText(rawAmountToCopy.toString());
    const originalText = copyAmountBtn.textContent;
    copyAmountBtn.textContent = '✓ Tersalin';
    copyAmountBtn.style.background = '#dcfce7';
    copyAmountBtn.style.color = '#15803d';
    copyAmountBtn.style.borderColor = '#86efac';
    setTimeout(() => {
      copyAmountBtn.textContent = originalText;
      copyAmountBtn.style.background = '#f1f5f9';
      copyAmountBtn.style.color = '#334155';
      copyAmountBtn.style.borderColor = '#cbd5e1';
    }, 2000);
  } catch {}
});

// Salin Raw String QRIS
btnCopyString?.addEventListener('click', async () => {
  if (!rawQrisString) return;
  try {
    await navigator.clipboard.writeText(rawQrisString);
    const originalHtml = btnCopyString.innerHTML;
    btnCopyString.innerHTML = '✓ String Tersalin!';
    btnCopyString.style.background = '#dcfce7';
    btnCopyString.style.color = '#15803d';
    setTimeout(() => {
      btnCopyString.innerHTML = originalHtml;
      btnCopyString.style.background = '';
      btnCopyString.style.color = '';
    }, 2000);
  } catch {}
});

// Unduh Gambar QR Code
btnDownload?.addEventListener('click', () => {
  if (!qrisImg?.src) return;
  const link = document.createElement('a');
  link.href = qrisImg.src;
  link.download = `QRIS-${currentOrderId || regId || 'order'}.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
});

// Perbarui QRIS jika kadaluarsa
btnExpiredRenew?.addEventListener('click', () => {
  if (qrExpiredOverlay) {
    qrExpiredOverlay.hidden = true;
    qrExpiredOverlay.classList.remove('is-active');
  }
  loadQrisSession();
});

// Tombol Simulasi Pembayaran Masuk (Uji Coba LUNAS)
const btnSimulatePay = document.getElementById('btn-simulate-pay') as HTMLButtonElement | null;
btnSimulatePay?.addEventListener('click', async () => {
  if (isPaid || !currentOrderId) return;
  const originalText = btnSimulatePay.textContent;
  btnSimulatePay.disabled = true;
  btnSimulatePay.textContent = 'Memproses pelunasan…';

  try {
    const res = await fetch('/api/v1/webhooks/qrisgate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        web_simulator_test: true,
        event: 'payment.paid',
        external_order_id: currentOrderId,
        total_amount: rawAmountToCopy,
        transaction_id: `SIM-${Date.now()}`,
      }),
    });
    const json = await res.json().catch(() => ({}));
    if (json.success && json.data?.settled) {
      // Trigger status check immediately
      const statusRes = await fetch(`/api/v1/registrations/${regId}/payment-status?refresh=0`, { cache: 'no-store' });
      const statusJson = await statusRes.json().catch(() => ({}));
      if (statusJson.success && statusJson.data) {
        showSuccessModal(statusJson.data);
      }
    } else {
      alert(json.data?.message || 'Gagal menyimulasikan pembayaran.');
      btnSimulatePay.disabled = false;
      btnSimulatePay.textContent = originalText;
    }
  } catch (err: any) {
    alert(err?.message || 'Koneksi bermasalah saat simulasi pembayaran.');
    btnSimulatePay.disabled = false;
    btnSimulatePay.textContent = originalText;
  }
});

// Tombol Segarkan Status Manual
const btnCheckStatus = document.getElementById('btn-check-status') as HTMLButtonElement | null;
btnCheckStatus?.addEventListener('click', async () => {
  if (!regId || isPaid) return;
  const originalText = btnCheckStatus.textContent;
  btnCheckStatus.disabled = true;
  btnCheckStatus.textContent = 'Memeriksa…';

  try {
    const res = await fetch(`/api/v1/registrations/${regId}/payment-status?refresh=0`, { cache: 'no-store' });
    const json = await res.json().catch(() => ({}));
    if (json.success && json.data) {
      if (json.data.payment_status === 'paid' || json.data.registration_status === 'confirmed') {
        showSuccessModal(json.data);
      } else {
        alert('Pembayaran belum terdeteksi. Silakan transfer atau klik tombol Simulasi Bayar.');
      }
    }
  } catch {}
  btnCheckStatus.disabled = false;
  btnCheckStatus.textContent = originalText;
});

// Tutup Modal dan Arahkan ke Status Tiket
btnCloseModal?.addEventListener('click', () => {
  if (successModal) successModal.classList.remove('is-active');
  location.href = statusUrl;
});

// Start session on DOM Ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadQrisSession);
} else {
  loadQrisSession();
}

export {};
