import QRCode from 'qrcode';

export interface ParsedQrisInfo {
  version: string;
  isDynamic: boolean;
  merchantName?: string;
  city?: string;
  postalCode?: string;
  currency?: string;
  amount?: number;
  acquirer?: string;
  mpan?: string;
  crc: string;
  raw: string;
}

export interface DynamicQrisResult {
  raw: string;
  amount: number;
  qrDataUrl: string;
  qrSvg: string;
  info: ParsedQrisInfo;
}

export const DEFAULT_MERCHANT_QRIS =
  '00020101021126610016ID.CO.SHOPEE.WWW01189360091800241681090208241681090303UMI51440014ID.CO.QRIS.WWW0215ID10266407358030303UMI5204594553033605802ID5908musgraph6010BANYUWANGI61056846562070703A016304CA12';

function getEnv(key: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key] !== undefined) {
      return (import.meta as any).env[key];
    }
  } catch {}
  return process.env[key];
}

/**
 * Menghitung standar CRC16-CCITT (Polynomial 0x1021, Initial 0xFFFF, no reflection, final XOR 0x0000)
 * sesuai spesifikasi resmi EMVCo Merchant-Presented Mode untuk QRIS.
 */
export function calculateCrc16(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if ((crc & 0x8000) !== 0) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

/**
 * Validasi string QRIS EMVCo dan keabsahan CRC16.
 */
export function validateQris(raw: string): { valid: boolean; reason?: string } {
  if (!raw || typeof raw !== 'string') {
    return { valid: false, reason: 'QRIS string kosong' };
  }
  const clean = raw.trim();
  if (!clean.startsWith('000201')) {
    return { valid: false, reason: 'Harus diawali format standar EMVCo 000201' };
  }
  if (!clean.includes('6304')) {
    return { valid: false, reason: 'Tag 63 (CRC checksum) tidak ditemukan' };
  }
  const crcIndex = clean.lastIndexOf('6304');
  const payloadToCrc = clean.slice(0, crcIndex + 4);
  const actualCrc = clean.slice(crcIndex + 4, crcIndex + 8).toUpperCase();
  const expectedCrc = calculateCrc16(payloadToCrc);
  if (actualCrc !== expectedCrc) {
    return { valid: false, reason: `CRC tidak cocok: expected ${expectedCrc}, got ${actualCrc}` };
  }
  return { valid: true };
}

/**
 * Membaca tag-tag TLV dari string QRIS.
 */
export function parseQris(raw: string): ParsedQrisInfo {
  const clean = raw.trim();
  const info: ParsedQrisInfo = {
    version: '01',
    isDynamic: false,
    crc: '',
    raw: clean,
  };

  let idx = 0;
  while (idx < clean.length - 4) {
    const tag = clean.substring(idx, idx + 2);
    const lengthStr = clean.substring(idx + 2, idx + 4);
    const length = parseInt(lengthStr, 10);
    if (Number.isNaN(length) || idx + 4 + length > clean.length) {
      break;
    }
    const val = clean.substring(idx + 4, idx + 4 + length);

    if (tag === '01') {
      info.isDynamic = val === '12';
    } else if (tag === '53') {
      info.currency = val === '360' ? 'IDR' : val;
    } else if (tag === '54') {
      info.amount = parseInt(val, 10);
    } else if (tag === '59') {
      info.merchantName = val;
    } else if (tag === '60') {
      info.city = val;
    } else if (tag === '61') {
      info.postalCode = val;
    } else if (tag === '26' || tag === '51') {
      const mpanMatch = val.match(/0118([0-9]{18})/);
      if (mpanMatch) {
        info.mpan = mpanMatch[1];
      }
      if (val.includes('SHOPEE')) {
        info.acquirer = 'ShopeePay';
      } else if (val.includes('BRI')) {
        info.acquirer = 'Bank BRI';
      } else if (val.includes('BCA')) {
        info.acquirer = 'Bank BCA';
      } else if (val.includes('MANDIRI')) {
        info.acquirer = 'Bank Mandiri';
      } else if (val.includes('GOPAY')) {
        info.acquirer = 'GoPay';
      } else if (val.includes('DANA')) {
        info.acquirer = 'DANA';
      }
    } else if (tag === '63') {
      info.crc = val;
    }

    idx += 4 + length;
  }

  const lastCrc = clean.match(/6304([A-Fa-f0-9]{4})$/);
  if (lastCrc) {
    info.crc = lastCrc[1];
  }

  return info;
}

/**
 * Mengubah QRIS Statis Merchant menjadi QRIS Dinamis ber-Tag 54 (Nominal Otomatis).
 * Mengikuti spesifikasi EMVCo:
 * 1. Tag 01: '11' (statis) -> '12' (dinamis)
 * 2. Tag 54: Menyisipkan nominal tagihan
 * 3. Tag 63: Menghitung ulang Checksum CRC16-CCITT
 */
export function convertStaticToDynamic(staticQris: string, amount: number): string {
  if (!staticQris || typeof staticQris !== 'string') {
    throw new Error('String QRIS statis wajib diisi');
  }

  let clean = staticQris.trim();
  if (!clean.startsWith('000201')) {
    throw new Error('Format QRIS tidak valid: Harus diawali 000201');
  }

  const integerAmount = Math.round(amount);
  if (integerAmount <= 0) {
    throw new Error('Nominal transaksi harus lebih besar dari 0');
  }

  // 1. Ubah Tag 01 dari '11' (statis) menjadi '12' (dinamis)
  clean = clean.replace('010211', '010212');

  // 2. Format Tag 54
  const amountStr = integerAmount.toString();
  const tag54Length = amountStr.length.toString().padStart(2, '0');
  const tag54 = `54${tag54Length}${amountStr}`;

  // 3. Potong CRC lama (Tag 63)
  const crcTagIdx = clean.lastIndexOf('6304');
  let bodyWithoutCrc = crcTagIdx !== -1 ? clean.slice(0, crcTagIdx) : clean;

  // 4. Jika sebelumnya sudah ada Tag 54, buang terlebih dahulu
  const existingTag54 = bodyWithoutCrc.match(/54(\d{2})(\d+)/);
  if (existingTag54 && existingTag54.index !== undefined) {
    const existingLen = parseInt(existingTag54[1], 10);
    const totalTagLen = 4 + existingLen;
    bodyWithoutCrc =
      bodyWithoutCrc.slice(0, existingTag54.index) +
      bodyWithoutCrc.slice(existingTag54.index + totalTagLen);
  }

  // 5. Sisipkan Tag 54 sebelum Tag 58 (Kode Negara 5802ID) atau sebelum Tag 63
  const tag58Idx = bodyWithoutCrc.indexOf('5802ID');
  let newPayload: string;
  if (tag58Idx !== -1) {
    newPayload = bodyWithoutCrc.slice(0, tag58Idx) + tag54 + bodyWithoutCrc.slice(tag58Idx);
  } else {
    newPayload = bodyWithoutCrc + tag54;
  }

  // 6. Prefiks Tag 63: '6304'
  const payloadToSign = newPayload + '6304';

  // 7. Hitung ulang CRC16
  const newCrc = calculateCrc16(payloadToSign);

  return payloadToSign + newCrc;
}

export class QrisService {
  private staticQris?: string;

  constructor(staticQris?: string) {
    this.staticQris = staticQris;
  }

  public getStaticQris(): string {
    if (this.staticQris) {
      return this.staticQris;
    }
    const envVal =
      (import.meta as any).env?.MERCHANT_QRIS_STATIC ||
      getEnv('MERCHANT_QRIS_STATIC') ||
      process.env.MERCHANT_QRIS_STATIC;
    return (envVal && envVal.trim()) || DEFAULT_MERCHANT_QRIS;
  }

  /**
   * Menghasilkan string QRIS dinamis dan me-render DataURL serta SVG gambar QR code.
   */
  public async generateDynamicQris(amount: number, customStaticQris?: string): Promise<DynamicQrisResult> {
    const sourceStatic = customStaticQris || this.getStaticQris();
    const dynamicString = convertStaticToDynamic(sourceStatic, amount);

    const [qrDataUrl, qrSvg] = await Promise.all([
      QRCode.toDataURL(dynamicString, {
        width: 380,
        margin: 2,
        errorCorrectionLevel: 'M',
        color: {
          dark: '#0f172a',
          light: '#ffffff',
        },
      }),
      QRCode.toString(dynamicString, {
        type: 'svg',
        margin: 2,
        errorCorrectionLevel: 'M',
      }),
    ]);

    const info = parseQris(dynamicString);

    return {
      raw: dynamicString,
      amount,
      qrDataUrl,
      qrSvg,
      info,
    };
  }

  public parseQris(raw: string): ParsedQrisInfo {
    return parseQris(raw);
  }
}

