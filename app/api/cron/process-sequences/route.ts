import { verifySecret } from '@/lib/crypto';
import { createEmailTracking, addTracking } from '@/lib/email/service';
import { logError } from '@/lib/errors';
import { NextRequest, NextResponse } from 'next/server';
import { queryMany, query } from '@/lib/db/client';
import { sendEmail } from '@/lib/email/service';

export async function POST(req: NextRequest) {
  if (!verifySecret(req.headers.get('x-cron-secret'), process.env.CRON_SECRET))
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  try {
    const due = await queryMany<any>(
      `SELECT se.*, s.steps, c.email, c.first_name, c.do_not_contact, c.tenant_id
       FROM public.sequence_enrollments se
       JOIN public.sequences s ON s.id=se.sequence_id
       JOIN public.contacts c ON c.id=se.contact_id
       WHERE se.status='active' AND se.next_run_at <= now() LIMIT 200`
    );
    let processed = 0;
    for (const en of due) {
      const steps = Array.isArray(en.steps) ? en.steps : [];
      const idx = en.current_step ?? 0;
      if (idx >= steps.length) {
        await query(`UPDATE public.sequence_enrollments SET status='completed', completed_at=now() WHERE id=$1`, [en.id]);
        continue;
      }
      const step = steps[idx];
      try {
        if (step.action_type === 'send_email' && en.email && !en.do_not_contact) {
          const APP_URL = process.env.NEXT_PUBLIC_APP_URL || '';
          const unsubLink = `${APP_URL}/api/unsubscribe?contact=${en.contact_id}&seq=${en.sequence_id}`;
          const body = step.body || step.content || '';
          const html = `<div style="font-family:sans-serif;max-width:600px">${body.replace(/\n/g,'<br>')}<br><br><hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0"><p style="font-size:11px;color:#9ca3af">You received this email because you are enrolled in a follow-up sequence. <a href="${unsubLink}" style="color:#9ca3af">Unsubscribe</a></p></div>`;
          const APP_URL2 = process.env.NEXT_PUBLIC_APP_URL || '';
          const trackId = await createEmailTracking({
            tenantId: en.tenant_id, contactId: en.contact_id,
            recipient: en.email, subject: step.subject || 'Follow up',
            sequenceEnrollmentId: en.id,
          });
          const trackedHtml = trackId ? addTracking(html, trackId, APP_URL2) : html;
          await sendEmail({ to: en.email, subject: step.subject || 'Follow up', html: trackedHtml, text: body + `\n\nUnsubscribe: ${unsubLink}` });
        } else if (step.action_type === 'create_task') {
          await query(`INSERT INTO public.tasks (tenant_id,title,contact_id,priority,completed) VALUES ($1,$2,$3,'medium',false)`,
            [en.tenant_id, step.content||'Follow up', en.contact_id]).catch(()=>{});
        }
        const next = idx + 1;
        const done = next >= steps.length;
        const delay = !done ? (steps[next]?.delay_days ?? 0) : 0;
        await query(
          `UPDATE public.sequence_enrollments SET current_step=$1,
           status=CASE WHEN $2 THEN 'completed' ELSE 'active' END,
           completed_at=CASE WHEN $2 THEN now() ELSE NULL END,
           next_run_at=CASE WHEN NOT $2 THEN now()+($3||' days')::interval ELSE NULL END
           WHERE id=$4`,
          [next, done, delay, en.id]
        );
        processed++;
      } catch { await query(`UPDATE public.sequence_enrollments SET next_run_at=now()+interval '1 hour' WHERE id=$1`, [en.id]).catch(()=>{}); }
    }
    return NextResponse.json({ ok: true, processed });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
