interface EmailPayload {
  to: string | string[];
  subject: string;
  html: string;
  text?: string;
  from?: string;
  replyTo?: string;
}

interface SendResult {
  success: boolean;
  provider?: string;
  messageId?: string;
  error?: string;
}

function getFromAddress(): string {
  const name = process.env.SMTP_FROM_NAME ?? 'NuCRM';
  const email = process.env.SMTP_FROM_EMAIL ?? 'noreply@nucrm.io';
  return `${name} <${email}>`;
}

async function sendViaResend(payload: EmailPayload): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) return { success: false, error: 'RESEND_API_KEY not set' };

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
      },
      body: JSON.stringify({
        from: payload.from ?? getFromAddress(),
        to: Array.isArray(payload.to) ? payload.to : [payload.to],
        subject: payload.subject,
        html: payload.html,
        text: payload.text,
        reply_to: payload.replyTo,
      }),
    });

    const data = await res.json() as any;
    if (res.ok) {
      return { success: true, provider: 'resend', messageId: data.id };
    }
    return { success: false, error: data.message ?? `HTTP ${res.status}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// FIX MEDIUM-09: Cache transporter to avoid recreating it on every email send
let smtpTransporter: any = null;
let smtpConfig: string | null = null;

async function sendViaSMTP(payload: EmailPayload): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  if (!host) return { success: false, error: 'SMTP_HOST not set' };

  try {
    // Dynamic import to avoid loading nodemailer in non-email paths
    const nodemailer = await import('nodemailer');
    const port = parseInt(process.env.SMTP_PORT ?? '587', 10);
    const secure = port === 465;

    // FIX MEDIUM-09: Reuse transporter if config hasn't changed
    const currentConfig = `${host}:${port}:${process.env.SMTP_USER}`;
    if (!smtpTransporter || smtpConfig !== currentConfig) {
      smtpTransporter = nodemailer.default.createTransport({
        host,
        port,
        secure,
        auth: {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        },
      });
      smtpConfig = currentConfig;
    }

    const toAddr = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
    const info = await smtpTransporter.sendMail({
      from: payload.from ?? getFromAddress(),
      to: toAddr,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
      replyTo: payload.replyTo,
    });

    return { success: true, provider: 'smtp', messageId: info.messageId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

/**
 * Send an email using whichever provider is configured.
 * Tries Resend first, falls back to SMTP.
 * In development with no provider configured, logs to console.
 */
export async function sendEmail(payload: EmailPayload): Promise<SendResult> {
  // Try Resend first
  if (process.env.RESEND_API_KEY) {
    const result = await sendViaResend(payload);
    if (result.success) return result;
    console.warn('[email] Resend failed, trying SMTP fallback:', result.error);
  }

  // Try SMTP
  if (process.env.SMTP_HOST) {
    return sendViaSMTP(payload);
  }

  // Development fallback - log to console
  if (process.env.NODE_ENV !== 'production') {
    const to = Array.isArray(payload.to) ? payload.to.join(', ') : payload.to;
    console.log(`\n📧 [DEV EMAIL - not sent]\nTo: ${to}\nSubject: ${payload.subject}\n`);
    return { success: true, provider: 'console (dev)' };
  }

  return {
    success: false,
    error: 'No email provider configured. Set RESEND_API_KEY or SMTP_HOST in your environment.',
  };
}

/** Render a simple template string with {{variable}} placeholders */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? '');
}

/** Send super admin alert for cron job failures */
export async function alertSuperAdmin(subject: string, message: string) {
  const adminEmail = process.env.SUPER_ADMIN_EMAIL;
  if (!adminEmail) return;
  await sendEmail({
    to: adminEmail,
    subject: `[NuCRM Alert] ${subject}`,
    html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px">
      <h3 style="color:#dc2626;margin:0 0 12px">${subject}</h3>
      <pre style="background:#f3f4f6;padding:16px;border-radius:8px;font-size:13px;white-space:pre-wrap">${message}</pre>
      <p style="color:#9ca3af;font-size:12px;margin-top:16px">Sent from NuCRM monitoring</p>
    </div>`,
    text: `${subject}\n\n${message}`,
  }).catch(() => {});
}

/**
 * Send notification via Discord/Slack webhook (free, no email needed)
 * Set DISCORD_WEBHOOK_URL or SLACK_WEBHOOK_URL in env vars
 */
export async function sendWebhookNotification(opts: {
  title: string;
  message: string;
  color?: string;
  url?: string;
}) {
  const { title, message, color = '#7c3aed', url } = opts;
  const timestamp = new Date().toISOString();

  // Discord webhook
  const discordUrl = process.env['DISCORD_WEBHOOK_URL'];
  if (discordUrl) {
    try {
      await fetch(discordUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          embeds: [{
            title,
            description: message,
            color: parseInt(color.replace('#', ''), 16),
            url,
            footer: { text: 'NuCRM' },
            timestamp,
          }],
        }),
      });
    } catch (err) {
      console.error('[webhook] Discord failed:', err);
    }
  }

  // Slack webhook
  const slackUrl = process.env['SLACK_WEBHOOK_URL'];
  if (slackUrl) {
    try {
      const slackColor = color.replace('#', '');
      await fetch(slackUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          blocks: [
            { type: 'header', text: { type: 'plain_text', text: title } },
            { type: 'section', text: { type: 'mrkdwn', text: message } },
            { type: 'context', elements: [{ type: 'mrkdwn', text: `*NuCRM* | ${timestamp}` }] },
          ],
          attachments: [{ color: `#${slackColor}` }],
        }),
      });
    } catch (err) {
      console.error('[webhook] Slack failed:', err);
    }
  }
}

/**
 * Send notification via Telegram Bot
 * Users configure their own bot token + chat ID
 * Setup: @BotFather → /newbot → get token → /start bot → get chat ID via @userinfobot
 */
export async function sendTelegram(opts: {
  botToken: string;
  chatId: string;
  title: string;
  message: string;
  icon?: string;
  url?: string;
}) {
  const { botToken, chatId, title, message, icon = '🔔', url } = opts;
  if (!botToken || !chatId) return;

  const text = `${icon} *${title}*\n\n${message}${url ? `\n\n🔗 [Open](${url})` : ''}`;

  try {
    const res = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      console.error('[telegram] Failed:', data.description || res.status);
    }
  } catch (err) {
    console.error('[telegram] Error:', err);
  }
}

/**
 * Send Telegram notification to a user if they have Telegram configured
 */
export async function sendTelegramToUser(opts: {
  userId: string;
  title: string;
  message: string;
  icon?: string;
  url?: string;
  eventType?: 'login' | 'signup' | 'password_change' | '2fa_change' | 'security_alert';
}) {
  try {
    const { queryOne } = await import('@/lib/db/client');
    const user = await queryOne<{
      telegram_bot_token: string;
      telegram_chat_id: string;
      telegram_enabled: boolean;
      telegram_notify_login: boolean;
      telegram_notify_signup: boolean;
      telegram_notify_password_change: boolean;
      telegram_notify_2fa_change: boolean;
      telegram_notify_security_alerts: boolean;
    }>(
      `SELECT telegram_bot_token, telegram_chat_id, telegram_enabled,
              telegram_notify_login, telegram_notify_signup,
              telegram_notify_password_change, telegram_notify_2fa_change,
              telegram_notify_security_alerts
       FROM public.users WHERE id = $1`,
      [opts.userId]
    );

    // Check if Telegram is enabled
    if (!user?.telegram_enabled) return;
    if (!user.telegram_bot_token || !user.telegram_chat_id) return;

    // Check if this event type is enabled for the user
    const eventPrefs: Record<string, boolean> = {
      login: user.telegram_notify_login,
      signup: user.telegram_notify_signup,
      password_change: user.telegram_notify_password_change,
      '2fa_change': user.telegram_notify_2fa_change,
      security_alert: user.telegram_notify_security_alerts,
    };

    // If eventType specified, check preference; otherwise send
    if (opts.eventType && !eventPrefs[opts.eventType]) return;

    await sendTelegram({
      botToken: user.telegram_bot_token,
      chatId: user.telegram_chat_id,
      title: opts.title,
      message: opts.message,
      icon: opts.icon,
      url: opts.url,
    });
  } catch (err) {
    console.error('[telegram] Failed to send to user:', err);
  }
}

/** Create email tracking for open/click tracking */
export async function createEmailTracking(data: {
  tenantId: string;
  contactId: string;
  recipient: string;
  subject: string;
  sequenceEnrollmentId?: string;
}): Promise<string | null> {
  try {
    const { queryOne } = await import('@/lib/db/client');
    const trackingId = crypto.randomUUID();
    await queryOne(
      `INSERT INTO public.email_tracking (id, tenant_id, contact_id, recipient, subject, sequence_enrollment_id, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())`,
      [trackingId, data.tenantId, data.contactId, data.recipient, data.subject, data.sequenceEnrollmentId || null]
    );
    return trackingId;
  } catch (err) {
    console.error('[email] Failed to create tracking:', err);
    return null;
  }
}

/** Add tracking pixel and link tracking to HTML */
export function addTracking(html: string, trackingId: string, appUrl: string): string {
  const trackingPixel = `<img src="${appUrl}/api/email/track/open?id=${trackingId}" width="1" height="1" style="display:none" />`;
  return html.replace('</body>', `${trackingPixel}</body>`);
}
