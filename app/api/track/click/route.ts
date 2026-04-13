/**
 * Email Click Tracking Proxy
 * GET /api/track/click?t=TRACKING_ID&url=ENCODED_URL
 *
 * Records click and redirects to the actual URL.
 * Wrap links in emails: <a href="APP_URL/api/track/click?t=TRACKING_ID&url=ENCODED_URL">
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const trackId  = searchParams.get('t');
  const rawUrl   = searchParams.get('url');

  // Validate destination URL
  let destination = '/';
  if (rawUrl) {
    try {
      const decoded = decodeURIComponent(rawUrl);
      // Only allow http/https URLs — prevent open redirect to javascript:
      if (/^https?:\/\//i.test(decoded)) destination = decoded;
    } catch { /* ignore */ }
  }

  if (trackId) {
    // Record click — fire and forget
    Promise.resolve().then(async () => {
      try {
        const row = await queryOne<any>(
          'SELECT id, contact_id, tenant_id, clicks FROM public.email_tracking WHERE id=$1',
          [trackId]
        );
        if (!row) return;

        const clicks = Array.isArray(row.clicks) ? row.clicks : [];
        clicks.push({ url: destination, clicked_at: new Date().toISOString() });

        await query(
          `UPDATE public.email_tracking
           SET clicked_at = COALESCE(clicked_at, now()),
               click_count = click_count + 1,
               clicks = $2::jsonb
           WHERE id = $1`,
          [trackId, JSON.stringify(clicks.slice(-50))] // keep last 50 clicks
        );

        // Log activity
        if (row.contact_id) {
          await query(
            `INSERT INTO public.activities (tenant_id, contact_id, type, description, metadata)
             VALUES ($1, $2, 'email', 'Email link clicked', $3)`,
            [row.tenant_id, row.contact_id,
             JSON.stringify({ tracking_id: trackId, url: destination, event: 'click' })]
          ).catch(() => {});
        }
      } catch { /* never fail on tracking */ }
    });
  }

  return NextResponse.redirect(destination, { status: 302 });
}
