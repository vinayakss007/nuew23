/**
 * Email Open Tracking Pixel
 * GET /api/track/open?t=TRACKING_ID
 *
 * Returns a 1x1 transparent GIF and records the open event.
 * Embed in emails: <img src="https://yourapp.com/api/track/open?t=TRACKING_ID" width="1" height="1" />
 *
 * To generate tracking ID when sending email:
 *   const trackId = await createEmailTracking(tenantId, contactId, recipient, subject);
 *   Include in HTML: `<img src="${APP_URL}/api/track/open?t=${trackId}" ... />`
 */
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';

// 1x1 transparent GIF
const PIXEL = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function GET(req: NextRequest) {
  const trackId = new URL(req.url).searchParams.get('t');

  if (trackId) {
    // Record open — fire and forget, never block
    Promise.resolve().then(async () => {
      try {
        const row = await queryOne<any>(
          'SELECT id, contact_id, tenant_id, open_count FROM public.email_tracking WHERE id=$1',
          [trackId]
        );
        if (!row) return;

        await query(
          `UPDATE public.email_tracking
           SET opened_at = COALESCE(opened_at, now()),
               open_count = open_count + 1
           WHERE id = $1`,
          [trackId]
        );

        // Log activity on first open only
        if (row.open_count === 0 && row.contact_id) {
          await query(
            `INSERT INTO public.activities (tenant_id, contact_id, type, description, metadata)
             VALUES ($1, $2, 'email', 'Email opened', $3)`,
            [row.tenant_id, row.contact_id, JSON.stringify({ tracking_id: trackId, event: 'open' })]
          ).catch(() => {});
        }
      } catch { /* never fail on tracking */ }
    });
  }

  return new NextResponse(PIXEL, {
    status: 200,
    headers: {
      'Content-Type':  'image/gif',
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'Pragma':        'no-cache',
    },
  });
}
