/**
 * Simple Prebuilt Automation Workflows
 * 
 * Ready-to-use automations that can be enabled with one click
 */

import { Workflow } from './types';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';

export const PREBUILT_WORKFLOWS: Workflow[] = [
  {
    id: 'welcome-email',
    name: 'Welcome Email',
    description: 'Send welcome email when a new contact is created',
    trigger: {
      type: 'contact.created',
      resource: 'contacts'
    },
    actions: [
      {
        type: 'send-email',
        execute: async (data: any) => {
          await sendEmail({
            to: data.contact.email,
            subject: `Welcome to ${data.tenant.name}!`,
            html: `
              <p>Hi ${data.contact.first_name || 'there'},</p>
              <p>Welcome to ${data.tenant.name}! We're excited to work with you.</p>
              <p>Our team will be in touch soon.</p>
              <br/>
              <p>Best regards,<br/>${data.tenant.name} Team</p>
            `
          });
        }
      }
    ],
    enabled: false,
    category: 'Email'
  },
  
  {
    id: 'task-due-reminder',
    name: 'Task Due Reminder',
    description: 'Remind users when a task is due today (runs daily at 9 AM)',
    trigger: {
      type: 'task.due_today',
      resource: 'tasks',
      schedule: '0 9 * * *' // Daily at 9 AM
    },
    actions: [
      {
        type: 'send-notification',
        execute: async (data: any) => {
          await createNotification({
            userId: data.task.assigned_to,
            tenantId: data.tenant_id,
            type: 'task_due',
            title: 'Task Due Today',
            body: `${data.task.title} is due today`,
            link: `/tenant/tasks/${data.task.id}`
          });
        }
      }
    ],
    enabled: true,
    category: 'Notifications'
  },
  
  {
    id: 'deal-stage-change',
    name: 'Deal Stage Change Notification',
    description: 'Notify when a deal moves to a new stage',
    trigger: {
      type: 'deal.updated',
      resource: 'deals',
      condition: 'stage.changed'
    },
    actions: [
      {
        type: 'send-notification',
        execute: async (data: any) => {
          await createNotification({
            userId: data.deal.assigned_to,
            tenantId: data.tenant_id,
            type: 'deal_stage',
            title: 'Deal Stage Updated',
            body: `${data.deal.title} moved from ${data.old_stage} to ${data.new_stage}`,
            link: `/tenant/deals/${data.deal.id}`
          });
        }
      }
    ],
    enabled: false,
    category: 'Notifications'
  },
  
  {
    id: 'lead-assignment',
    name: 'Auto-Assign Leads',
    description: 'Automatically assign new leads to available team members (round-robin)',
    trigger: {
      type: 'lead.created',
      resource: 'leads'
    },
    actions: [
      {
        type: 'assign-round-robin',
        execute: async (data: any) => {
          // Get all sales reps in tenant
          const { queryMany, query } = await import('@/lib/db/client');
          const reps = await queryMany<any>(`
            SELECT user_id FROM public.tenant_members
            WHERE tenant_id = $1 AND role_slug IN ('admin', 'sales_rep') AND status = 'active'
            ORDER BY RANDOM()
            LIMIT 1
          `, [data.tenant_id]);
          
          if (reps[0]) {
            await query(
              `UPDATE public.contacts SET assigned_to = $1 WHERE id = $2`,
              [reps[0].user_id, data.contact?.id ?? data.lead?.id]
            );
          }
        }
      }
    ],
    enabled: false,
    category: 'Assignment'
  },
  
  {
    id: 'follow-up-reminder',
    name: 'Follow-up Reminder',
    description: 'Create follow-up task if no activity on contact for 7 days',
    trigger: {
      type: 'contact.no_activity',
      resource: 'contacts',
      schedule: '0 10 * * *', // Daily at 10 AM
      condition: 'last_activity > 7 days'
    },
    actions: [
      {
        type: 'create-task',
        execute: async (data: any) => {
          const { query } = await import('@/lib/db/client');
          await query(
            `INSERT INTO public.tasks (tenant_id, title, assigned_to, due_date, priority, created_by)
             VALUES ($1, $2, $3, NOW() + INTERVAL '1 day', 'medium', $4)`,
            [data.tenant_id, `Follow up with ${data.contact.first_name}`, data.contact.assigned_to, data.tenant_id]
          );
        }
      }
    ],
    enabled: false,
    category: 'Tasks'
  }
];

export function getWorkflow(id: string): Workflow | undefined {
  return PREBUILT_WORKFLOWS.find(w => w.id === id);
}

export function getAllWorkflows(): Workflow[] {
  return PREBUILT_WORKFLOWS;
}

export function getWorkflowsByCategory(category: string): Workflow[] {
  return PREBUILT_WORKFLOWS.filter(w => w.category === category);
}
