/**
 * Webhook Delivery with Retry Mechanism
 * 
 * Features:
 * - Retry with exponential backoff
 * - Delivery logging
 * - Failure tracking
 * - Uses pg-boss for reliable delivery
 */

import { query, queryOne } from '@/lib/db/client';
import { devLogger } from '@/lib/dev-logger';

export interface WebhookPayload {
  id: string;
  tenant_id: string;
  url: string;
  event: string;
  payload: any;
  headers?: Record<string, string>;
  max_retries?: number;
}

export interface WebhookDelivery {
  id: string;
  webhook_id: string;
  url: string;
  status: 'pending' | 'success' | 'failed';
  attempt: number;
  response_status?: number;
  response_body?: string;
  error_message?: string;
  next_retry_at?: Date;
  headers?: Record<string, string>;
  payload: any;
  max_retries?: number;
}

/**
 * Queue webhook for delivery with retry
 */
export async function queueWebhook(payload: WebhookPayload): Promise<string> {
  const result = await queryOne<{ id: string }>(
    `INSERT INTO public.webhook_deliveries
     (tenant_id, integration_id, event, payload, status, attempts)
     VALUES ($1, $2, $3, $4, 'pending', 0)
     RETURNING id`,
    [payload.id, payload.id, payload.event, JSON.stringify(payload.payload)]
  );

  if (!result) {
    throw new Error('Failed to queue webhook');
  }

  // Immediately attempt delivery
  try {
    await processWebhookDelivery(result.id);
  } catch (err) {
    // Will be retried
  }

  devLogger.queue('webhook-delivery', 'queued');

  return result.id;
}

/**
 * Process webhook delivery
 */
export async function processWebhookDelivery(deliveryId: string): Promise<void> {
  const delivery = await queryOne<{
    id: string;
    url: string;
    event: string;
    payload: any;
    attempts: number;
  }>(
    `SELECT id, event, payload, attempts FROM public.webhook_deliveries WHERE id = $1`,
    [deliveryId]
  );

  if (!delivery) {
    throw new Error(`Webhook delivery ${deliveryId} not found`);
  }

  // Extract URL from payload since webhook_deliveries doesn't store URL directly
  // The URL is stored in the integrations table
  const integration = await queryOne<{ config: any }>(
    `SELECT config FROM public.integrations WHERE id = (SELECT integration_id FROM public.webhook_deliveries WHERE id = $1)`,
    [deliveryId]
  );

  const url = integration?.config?.url;
  if (!url) {
    throw new Error(`No URL found for webhook delivery ${deliveryId}`);
  }

  const payloadData = delivery.payload;
  const sigDelivery = { ...delivery, url } as unknown as WebhookDelivery;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'NuCRM-Webhook/1.0',
    'X-Webhook-Signature': await generateSignature({
      id: delivery.id,
      webhook_id: '',
      url,
      status: 'pending',
      attempt: delivery.attempts || 0,
      payload: payloadData,
      max_retries: 3,
    } as unknown as WebhookDelivery),
  };

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payloadData),
      signal: AbortSignal.timeout(10_000),
    });

    const responseBody = await response.text();

    if (response.ok) {
      await query(
        `UPDATE public.webhook_deliveries
         SET status = 'delivered',
             response_code = $1,
             response_body = $2,
             delivered_at = now()
         WHERE id = $3`,
        [response.status, responseBody, deliveryId]
      );

      devLogger.queue('webhook-delivery', 'completed');
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error: any) {
    const attempt = (delivery.attempts || 0) + 1;
    const maxRetries = 3;

    if (attempt < maxRetries) {
      const delay = Math.pow(2, attempt) * 60;
      const nextRetry = new Date(Date.now() + delay * 1000);

      await query(
        `UPDATE public.webhook_deliveries
         SET status = 'pending',
             attempts = $1,
             response_body = $2,
             next_retry_at = $3
         WHERE id = $4`,
        [attempt, error.message, nextRetry, deliveryId]
      );

      devLogger.queue('webhook-delivery', 'retrying');
    } else {
      await query(
        `UPDATE public.webhook_deliveries
         SET status = 'failed',
             attempts = $1,
             response_body = $2
         WHERE id = $3`,
        [attempt, error.message, deliveryId]
      );

      devLogger.queue('webhook-delivery', 'failed');
      devLogger.error(error as Error, `Webhook delivery ${deliveryId}`);
    }
  }
}

/**
 * Generate webhook signature for verification
 */
export async function generateSignature(delivery: WebhookDelivery): Promise<string> {
  const { createHmac } = await import('crypto');
  const secret = process.env['WEBHOOK_SECRET'];
  
  if (!secret || secret === 'webhook-secret-change-in-production') {
    throw new Error('WEBHOOK_SECRET environment variable must be configured in production');
  }

  const payload = JSON.stringify(delivery.payload);
  const signature = createHmac('sha256', secret)
    .update(payload)
    .digest('hex');

  return `sha256=${signature}`;
}

/**
 * Get webhook delivery stats
 */
export async function getWebhookStats(webhookId: string, days: number = 7): Promise<{
  total: number;
  success: number;
  failed: number;
  pending: number;
  avgDeliveryTime: number;
}> {
  const [total, success, failed, pending, avgTime] = await Promise.all([
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM public.webhook_deliveries 
       WHERE webhook_id = $1 AND created_at > now() - interval '${days} days'`,
      [webhookId]
    ),
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM public.webhook_deliveries 
       WHERE webhook_id = $1 AND status = 'success' AND created_at > now() - interval '${days} days'`,
      [webhookId]
    ),
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM public.webhook_deliveries 
       WHERE webhook_id = $1 AND status = 'failed' AND created_at > now() - interval '${days} days'`,
      [webhookId]
    ),
    queryOne<{ count: number }>(
      `SELECT count(*)::int as count FROM public.webhook_deliveries 
       WHERE webhook_id = $1 AND status = 'pending' AND created_at > now() - interval '${days} days'`,
      [webhookId]
    ),
    queryOne<{ avg_ms: number }>(
      `SELECT EXTRACT(EPOCH FROM AVG(delivered_at - created_at)) * 1000 as avg_ms
       FROM public.webhook_deliveries
       WHERE webhook_id = $1 AND status = 'success' AND created_at > now() - interval '${days} days'`,
      [webhookId]
    ),
  ]);

  return {
    total: total?.count || 0,
    success: success?.count || 0,
    failed: failed?.count || 0,
    pending: pending?.count || 0,
    avgDeliveryTime: avgTime?.avg_ms || 0,
  };
}

export default {
  queueWebhook,
  processWebhookDelivery,
  generateSignature,
  getWebhookStats,
};
