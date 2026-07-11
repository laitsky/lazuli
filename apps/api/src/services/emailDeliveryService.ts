import type { Env } from '../types';

const DEFAULT_MAGIC_LINK_FROM = 'signin@lazuli.now';
const DEFAULT_ALERT_FROM = 'alerts@lazuli.now';
const EMAIL_TIMEOUT_MS = 8_000;

interface EmailSenderBinding {
  send(message: {
    from: string;
    to: string;
    subject: string;
    headers?: Record<string, string>;
    text?: string;
    html?: string;
  }): Promise<unknown>;
}

interface EmailDeliveryEnv {
  MAGIC_LINK_EMAIL?: EmailSenderBinding;
  ALERT_EMAIL?: EmailSenderBinding;
  MAGIC_LINK_EMAIL_FROM?: string;
  ALERT_EMAIL_FROM?: string;
}

export interface EmailDeliveryResult {
  ok: boolean;
  status: number;
  provider: 'cloudflare-email' | 'email-webhook';
}

export function hasMagicLinkDeliveryProvider(env: Env): boolean {
  const emailEnv = env as Env & EmailDeliveryEnv;
  return Boolean(emailEnv.MAGIC_LINK_EMAIL || env.MAGIC_LINK_DELIVERY_WEBHOOK_URL);
}

export async function sendMagicLinkEmail(
  env: Env,
  input: { to: string; magicLink: string; expiresAt: number }
): Promise<EmailDeliveryResult | null> {
  const emailEnv = env as Env & EmailDeliveryEnv;
  const subject = 'Sign in to Lazuli';
  const minutes = Math.max(1, Math.ceil((input.expiresAt - Date.now()) / 60_000));
  const text = `Sign in to Lazuli: ${input.magicLink}\n\nThis link expires in ${minutes} minutes. If you did not request it, ignore this email.`;

  if (emailEnv.MAGIC_LINK_EMAIL) {
    try {
      await emailEnv.MAGIC_LINK_EMAIL.send({
        from: emailEnv.MAGIC_LINK_EMAIL_FROM ?? DEFAULT_MAGIC_LINK_FROM,
        to: input.to,
        subject,
        text,
        html: `<p>Sign in to Lazuli:</p><p><a href="${escapeHtml(input.magicLink)}">Continue to Lazuli</a></p><p>This link expires in ${minutes} minutes. If you did not request it, ignore this email.</p>`,
      });
      return { ok: true, status: 202, provider: 'cloudflare-email' };
    } catch (error) {
      if (!env.MAGIC_LINK_DELIVERY_WEBHOOK_URL) throw emailProviderError(error);
    }
  }

  if (!env.MAGIC_LINK_DELIVERY_WEBHOOK_URL) return null;
  const response = await fetch(env.MAGIC_LINK_DELIVERY_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(env.MAGIC_LINK_DELIVERY_WEBHOOK_SECRET
        ? { Authorization: `Bearer ${env.MAGIC_LINK_DELIVERY_WEBHOOK_SECRET}` }
        : {}),
    },
    body: JSON.stringify({
      email: input.to,
      magicLink: input.magicLink,
      expiresAt: input.expiresAt,
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status, provider: 'email-webhook' };
}

export async function sendAlertEmail(
  env: Env,
  input: {
    to: string;
    subject: string;
    text: string;
    payload: Record<string, unknown>;
    idempotencyKey?: string;
  }
): Promise<EmailDeliveryResult | null> {
  const emailEnv = env as Env & EmailDeliveryEnv;
  if (emailEnv.ALERT_EMAIL) {
    try {
      await emailEnv.ALERT_EMAIL.send({
        from: emailEnv.ALERT_EMAIL_FROM ?? DEFAULT_ALERT_FROM,
        to: input.to,
        subject: input.subject,
        text: input.text,
        headers: input.idempotencyKey ? { 'X-Lazuli-Idempotency-Key': input.idempotencyKey } : {},
      });
      return { ok: true, status: 202, provider: 'cloudflare-email' };
    } catch (error) {
      if (!env.ALERT_EMAIL_DELIVERY_WEBHOOK_URL) throw emailProviderError(error);
    }
  }

  if (!env.ALERT_EMAIL_DELIVERY_WEBHOOK_URL) return null;
  const response = await fetch(env.ALERT_EMAIL_DELIVERY_WEBHOOK_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(input.idempotencyKey ? { 'Idempotency-Key': input.idempotencyKey } : {}),
      ...(env.ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET
        ? { Authorization: `Bearer ${env.ALERT_EMAIL_DELIVERY_WEBHOOK_SECRET}` }
        : {}),
    },
    body: JSON.stringify({
      kind: 'price-alert-email',
      to: input.to,
      subject: input.subject,
      text: input.text,
      payload: input.payload,
    }),
    redirect: 'manual',
    signal: AbortSignal.timeout(EMAIL_TIMEOUT_MS),
  });
  return { ok: response.ok, status: response.status, provider: 'email-webhook' };
}

function emailProviderError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  return new Error(`Cloudflare email delivery failed: ${message.slice(0, 200)}`);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[character] ?? character;
  });
}
