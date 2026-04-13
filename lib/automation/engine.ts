/**
 * Automation Execution Engine
 *
 * Evaluates active automation rules against trigger events and executes
 * matching actions. Called when key CRM events occur (contact.created,
 * deal.won, etc.).
 *
 * Supports trigger types:
 *   contact.created | contact.updated
 *   deal.created    | deal.updated | deal.won | deal.lost
 *   task.created    | task.completed
 */

import { queryMany, query } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';

export type TriggerEvent =
  | 'contact.created' | 'contact.updated'
  | 'deal.created'    | 'deal.updated' | 'deal.won' | 'deal.lost'
  | 'task.created'    | 'task.completed';

export interface TriggerPayload {
  tenantId: string;
  userId?: string;
  event: TriggerEvent;
  data: Record<string, any>;
}

/**
 * Evaluate all active automations for a given event and run matching ones.
 * Non-blocking: errors are caught per-automation so one failure doesn't stop others.
 */
export async function evaluateAutomations(payload: TriggerPayload): Promise<void> {
  try {
    const automations = await queryMany<any>(
      `SELECT id, name, trigger_type, trigger_config, actions, conditions
       FROM public.automations
       WHERE tenant_id = $1
         AND is_active = true
         AND trigger_type = $2
       ORDER BY created_at ASC`,
      [payload.tenantId, payload.event]
    );

    if (!automations.length) return;

    for (const automation of automations) {
      try {
        // Evaluate conditions
        if (!meetsConditions(automation.conditions, payload.data)) continue;

        // Execute actions sequentially
        for (const action of (automation.actions ?? [])) {
          await executeAction(action, payload);
        }

        // Log successful run
        await query(
          `INSERT INTO public.automation_runs
             (tenant_id, automation_id, trigger_event, status, triggered_by, metadata)
           VALUES ($1, $2, $3, 'success', $4, $5)`,
          [payload.tenantId, automation.id, payload.event,
           payload.userId ?? null, JSON.stringify(payload.data)]
        ).catch(() => {});

      } catch (err: any) {
        console.error(`[automation] ${automation.name} (${automation.id}) failed:`, err.message);

        await query(
          `INSERT INTO public.automation_runs
             (tenant_id, automation_id, trigger_event, status, triggered_by, error_message, metadata)
           VALUES ($1, $2, $3, 'failed', $4, $5, $6)`,
          [payload.tenantId, automation.id, payload.event,
           payload.userId ?? null, err.message, JSON.stringify(payload.data)]
        ).catch(() => {});
      }
    }
  } catch (err: any) {
    // Never throw — automation evaluation is always non-blocking
    console.error('[automation] evaluateAutomations error:', err.message);
  }
}

// ─── Condition Evaluation ─────────────────────────────────────────────────────

function meetsConditions(conditions: any[], data: Record<string, any>): boolean {
  if (!Array.isArray(conditions) || conditions.length === 0) return true;

  return conditions.every((cond) => {
    const fieldVal = getNestedValue(data, cond.field);
    switch (cond.operator) {
      case 'equals':          return String(fieldVal) === String(cond.value);
      case 'not_equals':      return String(fieldVal) !== String(cond.value);
      case 'contains':        return String(fieldVal ?? '').includes(cond.value);
      case 'not_contains':    return !String(fieldVal ?? '').includes(cond.value);
      case 'greater_than':    return Number(fieldVal) > Number(cond.value);
      case 'less_than':       return Number(fieldVal) < Number(cond.value);
      case 'is_empty':        return fieldVal == null || fieldVal === '';
      case 'is_not_empty':    return fieldVal != null && fieldVal !== '';
      default:               return true;
    }
  });
}

function getNestedValue(obj: Record<string, any>, path: string): any {
  return path.split('.').reduce((acc, key) => acc?.[key], obj);
}

// ─── Action Executor ──────────────────────────────────────────────────────────

async function executeAction(action: any, payload: TriggerPayload): Promise<void> {
  const { type, config = {} } = action;

  switch (type) {
    case 'send_email': {
      const to = config.to || payload.data?.['email'];
      if (!to) return;
      await sendEmail({
        to,
        subject: config.subject || 'Automated message from NuCRM',
        html: interpolate(config.body || '', payload.data),
      });
      break;
    }

    case 'send_notification': {
      const userId = config.user_id || payload.data?.['assigned_to'] || payload.userId;
      if (!userId) return;
      await createNotification({
        userId,
        tenantId: payload.tenantId,
        type: 'system',
        title: interpolate(config.title || 'Automation triggered', payload.data),
        body:  config.body ? interpolate(config.body, payload.data) : undefined,
        link:  config.link || undefined,
      });
      break;
    }

    case 'update_field': {
      const { resource, id_field, field, value } = config;
      const resourceId = payload.data?.[id_field || 'id'];
      if (!resourceId || !resource || !field) return;

      const allowed: Record<string, string[]> = {
        contacts: ['lead_status','lifecycle_stage','assigned_to','score','tags'],
        deals:    ['stage','probability','assigned_to'],
        tasks:    ['priority','assigned_to'],
      };
      if (!allowed[resource]?.includes(field)) return;

      await query(
        `UPDATE public.${resource} SET ${field} = $1, updated_at = now()
         WHERE id = $2 AND tenant_id = $3`,
        [value, resourceId, payload.tenantId]
      );
      break;
    }

    case 'create_task': {
      const contactId = payload.data?.['contact_id'] || payload.data?.['id'];
      await query(
        `INSERT INTO public.tasks
           (tenant_id, title, priority, contact_id, deal_id, assigned_to, created_by, completed)
         VALUES ($1, $2, $3, $4, $5, $6, $7, false)`,
        [
          payload.tenantId,
          interpolate(config.title || 'Follow up', payload.data),
          config.priority || 'medium',
          contactId || null,
          payload.data?.['deal_id'] || null,
          config.assigned_to || payload.userId || null,
          payload.userId || null,
        ]
      );
      break;
    }

    case 'enroll_sequence': {
      const contactId = payload.data?.['contact_id'] || payload.data?.['id'];
      const sequenceId = config.sequence_id;
      if (!contactId || !sequenceId) return;

      // Get first step delay
      const seq = await query(
        `SELECT steps FROM public.sequences WHERE id = $1 AND tenant_id = $2 AND active = true`,
        [sequenceId, payload.tenantId]
      );
      const steps = seq.rows[0]?.steps ?? [];
      const firstDelay = steps[0]?.delay_days ?? 0;

      await query(
        `INSERT INTO public.sequence_enrollments
           (tenant_id, sequence_id, contact_id, status, current_step, next_run_at, enrolled_by)
         VALUES ($1, $2, $3, 'active', 0, now() + ($4 || ' days')::interval, $5)
         ON CONFLICT (sequence_id, contact_id) DO NOTHING`,
        [payload.tenantId, sequenceId, contactId,
         String(firstDelay), payload.userId || null]
      );
      break;
    }

    default:
      console.warn(`[automation] Unknown action type: ${type}`);
  }
}

function interpolate(template: string, data: Record<string, any>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => String(data[key] ?? ''));
}
