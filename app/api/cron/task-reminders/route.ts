import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { queryMany, query } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/service';
import { createNotification } from '@/lib/notifications';

export async function POST(request: NextRequest) {
  if (!verifySecret(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
    return NextResponse.json({ error:'Unauthorized' }, { status:401 });
  }
  try {
    const today = new Date().toISOString().split('T')[0];

    // Tasks due TODAY — notify assignees
    const dueToday = await queryMany<any>(
      `SELECT t.id, t.title, t.due_date, t.tenant_id,
              u.id AS user_id, u.email, u.full_name,
              c.first_name AS contact_first, c.last_name AS contact_last
       FROM public.tasks t
       JOIN public.tenant_members tm ON tm.tenant_id=t.tenant_id AND tm.user_id=t.assigned_to AND tm.status='active'
       JOIN public.users u ON u.id=t.assigned_to
       LEFT JOIN public.contacts c ON c.id=t.contact_id
       WHERE t.completed=false AND t.deleted_at IS NULL
         AND t.due_date=$1`,
      [today]
    );

    // Tasks OVERDUE (1-3 days) — remind again
    const overdue = await queryMany<any>(
      `SELECT t.id, t.title, t.due_date, t.tenant_id,
              u.id AS user_id, u.email, u.full_name
       FROM public.tasks t
       JOIN public.tenant_members tm ON tm.tenant_id=t.tenant_id AND tm.user_id=t.assigned_to AND tm.status='active'
       JOIN public.users u ON u.id=t.assigned_to
       WHERE t.completed=false AND t.deleted_at IS NULL
         AND t.due_date >= $1::date - 3 AND t.due_date < $1`,
      [today]
    );

    let notified = 0;

    // Send in-app notifications for due today
    for (const task of dueToday) {
      await createNotification({
        userId: task.user_id, tenantId: task.tenant_id, type: 'task_due',
        title: `Task due today: ${task.title}`,
        body: task.contact_first ? `Contact: ${task.contact_first} ${task.contact_last}` : undefined,
        entity_type: 'task', entity_id: task.id,
      });
      notified++;
    }

    // Send in-app notifications + email for overdue
    for (const task of overdue) {
      const daysOverdue = Math.floor((Date.now() - new Date(task.due_date).getTime()) / 86400000);
      await createNotification({
        userId: task.user_id, tenantId: task.tenant_id, type: 'task_overdue',
        title: `Overdue task (${daysOverdue}d): ${task.title}`,
        entity_type: 'task', entity_id: task.id,
      });

      // Email for tasks overdue exactly 1 day (not every day — avoid spam)
      if (daysOverdue === 1 && task.email) {
        await sendEmail({
          to: task.email,
          subject: `Overdue task: ${task.title}`,
          html: `<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:32px"><h3 style="color:#dc2626">Task overdue: ${task.title}</h3><p style="color:#6b7280">This task was due ${task.due_date} and is now overdue.</p><a href="${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks" style="display:inline-block;background:#7c3aed;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:16px">View Tasks →</a></div>`,
          text: `Task overdue: ${task.title} (due ${task.due_date}). View: ${process.env.NEXT_PUBLIC_APP_URL}/tenant/tasks`,
        }).catch(() => {});
      }
      notified++;
    }

    return NextResponse.json({ ok:true, due_today: dueToday.length, overdue: overdue.length, notified });
  } catch (err:any) {
    return NextResponse.json({ error: err.message }, { status:500 });
  }
}
