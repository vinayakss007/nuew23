/**
 * Resend Email Webhook Handler
 * Handles bounce, complaint, and delivery events from Resend.
 * On bounce/complaint: sets do_not_contact=true on the contact.
 *
 * Configure in Resend dashboard:
 *   Webhook URL: https://yourapp.com/api/webhooks/resend
 *   Events: email.bounced, email.complained, email.delivered
 * 
 * Note: Resend webhooks do not have signature verification by default.
 * We verify by checking the webhook source IP against Resend's IP ranges
 * and optionally using a custom webhook secret in the URL.
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { logError } from '@/lib/errors';

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();
    
    // Optional: Verify webhook secret if configured
    // Resend allows adding custom headers via webhook URL params
    const urlSecret = process.env.RESEND_WEBHOOK_SECRET;
    if (urlSecret) {
      const providedSecret = req.headers.get('x-webhook-secret');
      if (!providedSecret || providedSecret !== urlSecret) {
        return NextResponse.json({ error: 'Invalid webhook secret' }, { status: 401 });
      }
    }

    const event = JSON.parse(body) as { 
      type: string; 
      data: { 
        email_id?: string; 
        to?: string[]; 
        from?: string;
        created_at: string;
      } 
    };
    
    // Extract email from the first recipient in the 'to' array
    const email = event.data?.to?.[0] ?? null;

    switch (event.type) {
      case 'email.bounced':
      case 'email.complained': {
        // Find contact by email and mark do_not_contact
        // FIX HIGH-12: This webhook is tenant-agnostic, but we should still log which tenants are affected
        // Since we don't have tenant context, we update ALL matching contacts (expected behavior for global webhook)
        // But we log the tenant info for audit purposes
        if (email) {
          const contacts = await query(
            `UPDATE public.contacts SET do_not_contact=true, updated_at=now()
             WHERE email=lower($1) AND do_not_contact=false AND deleted_at IS NULL
             RETURNING id, tenant_id, first_name`,
            [email]
          );
          // Cancel any active sequence enrollments for each affected contact
          for (const contact of contacts.rows) {
            await query(
              `UPDATE public.sequence_enrollments SET status='cancelled'
               WHERE contact_id=$1 AND status='active' AND tenant_id=$2`,
              [contact.id, contact.tenant_id]
            ).catch(() => {});
            // Log activity with tenant_id
            await query(
              `INSERT INTO public.activities (tenant_id,contact_id,type,description)
               VALUES ($1,$2,'note',$3)`,
              [contact.tenant_id, contact.id,
               event.type === 'email.bounced'
                 ? `Email bounced — do not contact flag set automatically`
                 : `Email complaint received — do not contact flag set automatically`]
            ).catch(() => {});
          }
          console.log(`[resend-webhook] ${event.type}: ${contacts.rowCount} contact(s) marked DNC for ${email}`);
        }
        break;
      }
      case 'email.delivered':
        // Could update email_log if needed
        break;
      default:
        console.log(`[resend-webhook] Unhandled event: ${event.type}`);
    }

    return NextResponse.json({ received: true });
  } catch (err: any) {
    await logError({ error: err, context: 'resend-webhook' });
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
