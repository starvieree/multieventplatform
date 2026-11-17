export interface ParseNotificationResult {
  amount: number | null;
  rawText: string;
}

/**
 * Mengekstrak nominal pembayaran dari teks push notifikasi bank atau e-wallet:
 * Mendukung format:
 * - ShopeePay: "Kamu menerima pembayaran Rp 150.124"
 * - BRImo / BRI Merchant: "Uang masuk 150.124 rupiah" atau "Rp. 150.124"
 * - BCA / BCA Mobile: "Dana masuk dari QRIS Rp 150.124"
 * - GoPay / GoBiz: "Pembayaran berhasil diterima sebesar Rp 150.124"
 * - Mandiri Livin': "Transfer masuk Rp 150.124"
 */
export function extractAmountFromNotificationText(text: string): ParseNotificationResult {
  if (!text || typeof text !== 'string') {
    return { amount: null, rawText: text || '' };
  }

  const clean = text.trim();

  // Pola 1: "uang masuk / sebesar / terima ... rupiah"
  const match1 = clean.match(/(?:sebesar|masuk|terima|transaksi)[^\d]*([\d.,]+)\s*(?:rupiah)?/i);
  if (match1) {
    const rawNum = match1[1].replace(/[.,]/g, '');
    const amt = parseInt(rawNum, 10);
    if (!Number.isNaN(amt) && amt > 0) {
      return { amount: amt, rawText: clean };
    }
  }

  // Pola 2: Format umum "Rp 150.124" atau "Rp. 150.124"
  const match2 = clean.match(/rp\.?\s*([\d.,]+)/i);
  if (match2) {
    const rawNum = match2[1].replace(/[.,]/g, '');
    const amt = parseInt(rawNum, 10);
    if (!Number.isNaN(amt) && amt > 0) {
      return { amount: amt, rawText: clean };
    }
  }

  // Pola 3: "dana / saldo / transfer / pembayaran / qris masuk"
  const match3 = clean.match(/(?:dana|saldo|transfer|pembayaran|qris)\s*(?:masuk|berhasil|sukses)[^\d]*([\d.,]+)/i);
  if (match3) {
    const rawNum = match3[1].replace(/[.,]/g, '');
    const amt = parseInt(rawNum, 10);
    if (!Number.isNaN(amt) && amt > 0) {
      return { amount: amt, rawText: clean };
    }
  }

  return { amount: null, rawText: clean };
}

