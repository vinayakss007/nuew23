// Background Worker for NuCRM SaaS
// Handles scheduled jobs, email sending, webhook delivery, etc.

import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const REDIS_URL = process.env['REDIS_URL'] || 'redis://localhost:6379';

const connection = new IORedis(REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => {
    if (times > 10) return null;
    return Math.min(times * 100, 3000);
  },
});

console.log('[Worker] Background worker started');
console.log('[Worker] Connected to Redis:', REDIS_URL);

// Email queue worker - matches queue names from lib/queue/index.ts
const emailWorker = new Worker(
  'send-email',
  async (job) => {
    const { to, subject, body, html, tenantId } = job.data;
    console.log(`[Email Worker] Processing job: ${job.id} - Sending email to ${to}`);
    
    try {
      // Import email service dynamically to avoid circular dependencies
      const { sendEmail } = await import('@/lib/email/service');
      const result = await sendEmail({
        to,
        subject,
        html: html || body,
        text: body,
      });
      
      console.log(`[Email Worker] Email sent successfully to ${to}`);
      return { sent: true, to, messageId: result?.messageId };
    } catch (error: any) {
      console.error(`[Email Worker] Failed to send email to ${to}:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Notification queue worker
const notificationWorker = new Worker(
  'send-notification',
  async (job) => {
    const { userId, title, message, type, data } = job.data;
    console.log(`[Notification Worker] Processing job: ${job.id} - Sending notification to user ${userId}`);
    
    try {
      const { query } = await import('@/lib/db/client');
      await query(
        `INSERT INTO public.notifications (user_id, title, message, type, data, is_read, created_at)
         VALUES ($1, $2, $3, $4, $5, false, now())`,
        [userId, title, message, type, JSON.stringify(data || {})]
      );
      
      console.log(`[Notification Worker] Notification sent to user ${userId}`);
      return { sent: true, userId };
    } catch (error: any) {
      console.error(`[Notification Worker] Failed to send notification:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Bulk emails worker
const bulkEmailWorker = new Worker(
  'send-bulk-emails',
  async (job) => {
    const { recipients, subject, body, tenantId } = job.data;
    console.log(`[Bulk Email Worker] Processing job: ${job.id} - Sending to ${recipients.length} recipients`);
    
    const results = [];
    for (const recipient of recipients) {
      try {
        const { sendEmail } = await import('@/lib/email/service');
        await sendEmail({
          to: recipient.email,
          subject,
          html: body.replace(/\{first_name\}/g, recipient.first_name || ''),
          text: body.replace(/\{first_name\}/g, recipient.first_name || ''),
        });
        results.push({ email: recipient.email, success: true });
      } catch (error: any) {
        console.error(`[Bulk Email Worker] Failed for ${recipient.email}:`, error.message);
        results.push({ email: recipient.email, success: false, error: error.message });
      }
    }
    
    console.log(`[Bulk Email Worker] Completed: ${results.filter(r => r.success).length}/${results.length} sent`);
    return { total: recipients.length, success: results.filter(r => r.success).length, results };
  },
  { connection, concurrency: 3 }
);

// Export CSV worker
const exportCsvWorker = new Worker(
  'export-csv',
  async (job) => {
    const { userId, entityType, filters, tenantId } = job.data;
    console.log(`[Export CSV Worker] Processing job: ${job.id} - Exporting ${entityType}`);
    
    try {
      const { query } = await import('@/lib/db/client');
      let data;
      
      switch (entityType) {
        case 'contacts':
          data = await query(
            `SELECT * FROM public.contacts WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tenantId]
          );
          break;
        case 'deals':
          data = await query(
            `SELECT * FROM public.deals WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tenantId]
          );
          break;
        case 'tasks':
          data = await query(
            `SELECT * FROM public.tasks WHERE tenant_id=$1 AND deleted_at IS NULL`,
            [tenantId]
          );
          break;
        default:
          throw new Error(`Unknown entity type: ${entityType}`);
      }
      
      // Convert to CSV
      const { stringify } = await import('csv-stringify/sync');
      const csv = stringify(data.rows, { header: true });
      
      // Store export result for download
      await query(
        `INSERT INTO public.exports (user_id, tenant_id, entity_type, data, status, created_at)
         VALUES ($1, $2, $3, $4, 'completed', now())`,
        [userId, tenantId, entityType, csv]
      );
      
      console.log(`[Export CSV Worker] Export completed for ${entityType}`);
      return { success: true, entityType, rowCount: data.rows.length };
    } catch (error: any) {
      console.error(`[Export CSV Worker] Failed:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 2 }
);

// Contact import worker
const contactImportWorker = new Worker(
  'contact-import',
  async (job) => {
    const { userId, contacts, tenantId } = job.data;
    console.log(`[Contact Import Worker] Processing job: ${job.id} - Importing ${contacts.length} contacts`);
    
    const { query } = await import('@/lib/db/client');
    let imported = 0;
    let errors = 0;
    
    for (const contact of contacts) {
      try {
        await query(
          `INSERT INTO public.contacts (tenant_id, user_id, email, first_name, last_name, company, phone, lead_source, tags)
           VALUES ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)
           ON CONFLICT (email, tenant_id) DO UPDATE SET
             first_name=EXCLUDED.first_name,
             last_name=EXCLUDED.last_name,
             updated_at=now()`,
          [tenantId, userId, contact.email, contact.first_name, contact.last_name, contact.company, contact.phone, contact.lead_source, JSON.stringify(contact.tags || [])]
        );
        imported++;
      } catch (error: any) {
        console.error(`[Contact Import Worker] Failed for ${contact.email}:`, error.message);
        errors++;
      }
    }
    
    console.log(`[Contact Import Worker] Completed: ${imported} imported, ${errors} errors`);
    return { success: true, imported, errors, total: contacts.length };
  },
  { connection, concurrency: 2 }
);

// Automation queue worker
const automationWorker = new Worker(
  'run-automation',
  async (job) => {
    const { automationId, contactId, dealId, tenantId, triggerData } = job.data;
    console.log(`[Automation Worker] Processing job: ${job.id} - Automation ${automationId}`);
    
    try {
      const { evaluateAutomations } = await import('@/lib/automation/engine');
      await evaluateAutomations({
        tenantId,
        event: job.data.eventType || 'contact.created',
        data: triggerData || {},
      });
      
      console.log(`[Automation Worker] Automation ${automationId} completed successfully`);
      return { success: true, automationId };
    } catch (error: any) {
      console.error(`[Automation Worker] Failed:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Webhook delivery worker (for pg-boss webhook deliveries)
const webhookWorker = new Worker(
  'webhooks',
  async (job) => {
    const { url, payload, headers, webhookId } = job.data;
    console.log(`[Webhook Worker] Processing job: ${job.id} - Delivering to ${url}`);
    
    try {
      const { processWebhookDelivery } = await import('@/lib/webhooks/delivery');
      
      // If delivery ID is provided, process it
      if (job.data.deliveryId) {
        await processWebhookDelivery(job.data.deliveryId);
        return { delivered: true, deliveryId: job.data.deliveryId };
      }
      
      // Otherwise, send direct webhook
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(headers || {}),
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      console.log(`[Webhook Worker] Webhook delivered successfully to ${url}`);
      return { delivered: true, url, status: response.status };
    } catch (error: any) {
      console.error(`[Webhook Worker] Failed to deliver webhook:`, error.message);
      throw error;
    }
  },
  { connection, concurrency: 5 }
);

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('[Worker] SIGTERM received, shutting down gracefully...');
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    exportCsvWorker.close(),
    contactImportWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
  ]);
  await connection.quit();
  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('[Worker] SIGINT received, shutting down gracefully...');
  await Promise.all([
    emailWorker.close(),
    notificationWorker.close(),
    bulkEmailWorker.close(),
    exportCsvWorker.close(),
    contactImportWorker.close(),
    automationWorker.close(),
    webhookWorker.close(),
  ]);
  clearInterval(heartbeatInterval); // FIX LOW-04: Clear heartbeat interval
  await connection.quit();
  process.exit(0);
});

// Keep the process alive - FIX LOW-04: Store interval ID for cleanup
const heartbeatInterval = setInterval(() => {
  console.log('[Worker] Heartbeat - workers are running');
}, 60000);
