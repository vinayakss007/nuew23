/**
 * One-click unsubscribe endpoint
 * GET /api/unsubscribe?contact=uuid&seq=uuid
 * Sets do_not_contact=true and cancels sequence enrollment
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const contactId  = searchParams.get('contact');
  const sequenceId = searchParams.get('seq');

  if (!contactId) {
    return new NextResponse('Missing contact parameter', { status: 400 });
  }

  try {
    // Set do_not_contact
    const contact = await queryOne<any>(
      `UPDATE public.contacts SET do_not_contact=true, updated_at=now()
       WHERE id=$1 AND deleted_at IS NULL RETURNING id, first_name, tenant_id`,
      [contactId]
    );

    if (!contact) {
      return new NextResponse('Contact not found', { status: 404 });
    }

    // Cancel all sequence enrollments for this contact
    await query(
      `UPDATE public.sequence_enrollments SET status='cancelled'
       WHERE contact_id=$1 AND status='active'`,
      [contactId]
    );

    // Log activity
    await query(
      `INSERT INTO public.activities (tenant_id,contact_id,type,description)
       VALUES ($1,$2,'note','Unsubscribed via email link — do not contact flag set')`,
      [contact.tenant_id, contactId]
    ).catch(() => {});

    // Return a clean HTML page
    return new NextResponse(
      `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title>
      <style>body{font-family:sans-serif;max-width:480px;margin:80px auto;text-align:center;color:#374151}
      h1{color:#059669}p{color:#6b7280;margin-top:8px}</style></head>
      <body><h1>✓ Unsubscribed</h1>
      <p>You've been unsubscribed and won't receive further emails from this sequence.</p>
      <p style="margin-top:24px;font-size:13px">You can safely close this page.</p>
      </body></html>`,
      { headers: { 'Content-Type': 'text/html' } }
    );
  } catch (err: any) {
    return new NextResponse('Something went wrong. Please contact support.', { status: 500 });
  }
}
