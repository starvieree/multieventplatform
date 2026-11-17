import crypto from 'node:crypto';
import QRCode from 'qrcode';

export interface QrisgateCreateTransactionParams {
  externalOrderId: string;
  amount: number;
  customerName?: string;
  returnUrl?: string;
}

export interface QrisgateTransactionData {
  transaction_id?: string;
  external_order_id: string;
  base_amount: number;
  unique_code?: number;
  total_amount: number;
  checkout_url?: string;
  qr_string?: string;
  qris_string?: string;
  qr_code?: string;
  [key: string]: any;
}

export interface QrisgateCreateTransactionResult {
  success: boolean;
  data?: QrisgateTransactionData;
  error?: string;
  isCreditExhausted?: boolean;
  creditBalance?: number;
  qrDataUrl?: string;
}

function getEnvValue(key: string): string | undefined {
  try {
    if (typeof import.meta !== 'undefined' && (import.meta as any).env && (import.meta as any).env[key] !== undefined) {
      return (import.meta as any).env[key];
    }
  } catch {}
  return process.env[key];
}

export class QrisgateService {
  private apiUrl: string = 'https://qrisgate.web.id/api/v1';

  getApiKey(): string {
    return getEnvValue('QRISGATE_API_KEY') || getEnvValue('QRISGATE_WEBHOOK_SECRET') || '';
  }

  getWebhookSecret(): string {
    return getEnvValue('QRISGATE_WEBHOOK_SECRET') || getEnvValue('QRISGATE_API_KEY') || '';
  }

  /**
   * Panggil POST /api/v1/transactions ke cloud QRISGate jika ingin alokasi melalui gateway cloud.
   */
  async createTransaction(
    params: QrisgateCreateTransactionParams
  ): Promise<QrisgateCreateTransactionResult> {
    const apiKey = this.getApiKey();

    if (!apiKey) {
      return {
        success: false,
        error: 'QRISGATE_API_KEY belum dikonfigurasi di file .env',
      };
    }

    try {
      const payload = {
        external_order_id: params.externalOrderId,
        amount: Math.round(params.amount),
        customer_name: params.customerName || 'Pelanggan',
        return_url: params.returnUrl || 'https://merchant.com/thank-you',
        include_qr_image: true,
      };

      const response = await fetch(`${this.apiUrl}/transactions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const resJson: any = await response.json().catch(() => ({}));

      if (!response.ok || resJson.success === false) {
        const errorMsg = resJson.error || resJson.message || `HTTP ${response.status}`;
        const isCredit = response.status === 402 || (errorMsg && errorMsg.toLowerCase().includes('saldo kredit'));

        return {
          success: false,
          error: errorMsg,
          isCreditExhausted: isCredit,
          creditBalance: resJson.credit_balance,
        };
      }

      const txData: QrisgateTransactionData = resJson.data || resJson;
      const rawQr = txData.qr_string || txData.qris_string || txData.qr_code || '';

      let qrDataUrl = (txData as any).qr_image_base64 || '';
      if (!qrDataUrl && rawQr) {
        try {
          qrDataUrl = await QRCode.toDataURL(rawQr, {
            errorCorrectionLevel: 'M',
            margin: 2,
            scale: 8,
          });
        } catch {}
      }

      return {
        success: true,
        data: txData,
        qrDataUrl,
      };
    } catch (err: any) {
      return {
        success: false,
        error: err?.message || 'Gagal menghubungi server QRISGate',
      };
    }
  }

  /**
   * Verifikasi signature HMAC-SHA256 untuk webhook QRISGate.
   */
  verifySignature(
    rawBody: string,
    signature: string | null,
    timestamp: string | null
  ): { valid: boolean; reason?: string } {
    const secret = this.getWebhookSecret();
    if (!secret) {
      return { valid: true };
    }

    if (!signature) {
      return { valid: false, reason: 'Missing x-qrisgate-signature header' };
    }

    if (timestamp) {
      const tsNum = Number(timestamp);
      if (Number.isNaN(tsNum) || Math.abs(Date.now() / 1000 - tsNum) > 300) {
        return { valid: false, reason: 'Timestamp kedaluwarsa (> 5 menit)' };
      }
    }

    const expected = crypto
      .createHmac('sha256', secret.trim())
      .update((timestamp || '') + '.' + rawBody)
      .digest('hex');

    const cleanSig = String(signature).replace(/^sha256=/, '');
    try {
      const a = Buffer.from(expected, 'hex');
      const b = Buffer.from(cleanSig, 'hex');
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { valid: false, reason: 'Signature mismatch' };
      }
    } catch {
      return { valid: false, reason: 'Malformed signature' };
    }

    return { valid: true };
  }
}

