import { createHmac } from 'crypto';
import { query, queryMany, queryOne } from '@/lib/db/client';

export type WebhookEvent =
  | 'contact.created' | 'contact.updated' | 'contact.deleted'
  | 'deal.created'    | 'deal.updated'    | 'deal.stage_changed' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed'
  | 'company.created';

export async function fireWebhooks(
  tenantId: string,
  event: WebhookEvent,
  data: Record<string, any>
) {
  try {
    const hooks = await queryMany<{ id: string; config: any; name: string }>(
      `SELECT id, name, config FROM public.integrations
       WHERE tenant_id=$1 AND type='webhook' AND is_active=true`,
      [tenantId]
    );
    if (!hooks.length) return;

    const payload = JSON.stringify({
      event,
      timestamp: new Date().toISOString(),
      tenant_id: tenantId,
      data,
    });

    // Insert delivery records for tracking
    for (const hook of hooks) {
      const url = hook.config?.url;
      if (!url) continue;

      try {
        // Create delivery record
        const delivery = await queryOne<{ id: string }>(
          `INSERT INTO public.webhook_deliveries
           (tenant_id, integration_id, event, payload, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING id`,
          [tenantId, hook.id, event, payload]
        );

        const secret = hook.config?.secret;
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'User-Agent': 'NuCRM-Webhook/1.0',
          'X-NuCRM-Event': event,
          'X-NuCRM-Delivery': crypto.randomUUID(),
        };
        if (secret) {
          headers['X-NuCRM-Signature'] = 'sha256=' + createHmac('sha256', secret).update(payload).digest('hex');
        }

        const res = await fetch(url, { method: 'POST', headers, body: payload, signal: AbortSignal.timeout(10_000) });

        if (res.ok) {
          await query(
            `UPDATE public.webhook_deliveries
             SET status = 'success', response_code = $1, delivered_at = now()
             WHERE id = $2`,
            [res.status, delivery?.id]
          );
        } else {
          const body = await res.text().catch(() => '');
          await query(
            `UPDATE public.webhook_deliveries
             SET status = 'failed', response_code = $1, response_body = $2
             WHERE id = $3`,
            [res.status, body, delivery?.id]
          );
          // Queue for retry in failed_webhooks
          await query(
            `INSERT INTO public.failed_webhooks (tenant_id, webhook_id, url, payload, headers, retry_count, next_retry_at)
             VALUES ($1, $2, $3, $4, $5, 0, now() + interval '1 hour')`,
            [tenantId, hook.id, url, payload, JSON.stringify(headers)]
          ).catch(() => {});
        }

        await query(
          `UPDATE public.integrations SET last_used_at=now() WHERE id=$1`,
          [hook.id]
        ).catch(() => {});
      } catch (err: any) {
        console.warn(`[webhook] ${hook.name} delivery error:`, err.message);
        // Log failure
        try {
          await query(
            `UPDATE public.webhook_deliveries
             SET status = 'failed', response_body = $1
             WHERE integration_id = $2 AND event = $3
             ORDER BY created_at DESC LIMIT 1`,
            [err.message, hook.id, event]
          );
        } catch {}
        // Queue for retry
        await query(
          `INSERT INTO public.failed_webhooks (tenant_id, webhook_id, url, payload, headers, retry_count, next_retry_at)
           VALUES ($1, $2, $3, $4, '{}', 0, now() + interval '1 hour')`,
          [tenantId, hook.id, hook.config?.url, payload]
        ).catch(() => {});
      }
    }
  } catch (err: any) {
    console.error('[webhooks]', err.message);
  }
}

/** Retry failed webhook deliveries from the failed_webhooks table */
export async function retryFailedWebhooks(): Promise<number> {
  try {
    const failed = await queryMany<{ id: string; url: string; payload: string; headers: any }>(
      `SELECT id, url, payload, headers FROM public.failed_webhooks
       WHERE retry_count < 3 AND next_retry_at <= now()
       ORDER BY created_at ASC
       LIMIT 50`
    );
    if (!failed.length) return 0;

    let retried = 0;
    for (const item of failed) {
      try {
        const res = await fetch(item.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...item.headers },
          body: item.payload,
          signal: AbortSignal.timeout(10_000),
        });
        if (res.ok) {
          await query(`DELETE FROM public.failed_webhooks WHERE id=$1`, [item.id]);
          retried++;
        } else {
          await query(
            `UPDATE public.failed_webhooks SET retry_count=retry_count+1, next_retry_at=now()+interval '1 hour' WHERE id=$1`,
            [item.id]
          );
        }
      } catch {
        await query(
          `UPDATE public.failed_webhooks SET retry_count=retry_count+1, next_retry_at=now()+interval '1 hour' WHERE id=$1`,
          [item.id]
        );
      }
    }
    return retried;
  } catch (err) {
    console.error('[webhooks] Retry failed:', err);
    return 0;
  }
}
