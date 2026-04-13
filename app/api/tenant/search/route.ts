import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';

export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // Rate limit: 60 searches per minute per IP
    const limited = await checkRateLimit(request, { action: 'search', max: 60, windowMinutes: 1 });
    if (limited) return limited;

    const { searchParams } = new URL(request.url);
    const q = searchParams.get('q')?.trim();
    const type = searchParams.get('type') ?? 'all'; // all | contacts | deals | companies | tasks
    const limit = Math.min(20, parseInt(searchParams.get('limit') ?? '8'));

    if (!q || q.length < 1) {
      return NextResponse.json({ contacts: [], deals: [], companies: [], tasks: [], total: 0 });
    }

    const pattern = `%${q}%`;
    const tid = ctx.tenantId;

    const [contacts, deals, companies, tasks] = await Promise.all([
      (type === 'all' || type === 'contacts')
        ? queryMany(`
            SELECT id, first_name, last_name, email, phone, lead_status,
                   co.name AS company_name
            FROM public.contacts c
            LEFT JOIN public.companies co ON co.id = c.company_id
            WHERE c.tenant_id=$1 AND c.is_archived=false AND c.deleted_at IS NULL
              AND (c.first_name ILIKE $2 OR c.last_name ILIKE $2 OR c.email ILIKE $2
                   OR c.phone ILIKE $2 OR co.name ILIKE $2
                   OR (c.first_name || ' ' || c.last_name) ILIKE $2)
            ORDER BY c.updated_at DESC LIMIT $3`,
            [tid, pattern, limit])
        : Promise.resolve([]),

      (type === 'all' || type === 'deals')
        ? queryMany(`
            SELECT d.id, d.title, d.stage, d.value, d.close_date,
                   c.first_name, c.last_name,
                   co.name AS company_name
            FROM public.deals d
            LEFT JOIN public.contacts c ON c.id = d.contact_id
            LEFT JOIN public.companies co ON co.id = d.company_id
            WHERE d.tenant_id=$1 AND d.deleted_at IS NULL
              AND (d.title ILIKE $2
                   OR c.first_name ILIKE $2 OR c.last_name ILIKE $2
                   OR (c.first_name || ' ' || c.last_name) ILIKE $2
                   OR co.name ILIKE $2)
            ORDER BY d.updated_at DESC LIMIT $3`,
            [tid, pattern, limit])
        : Promise.resolve([]),

      (type === 'all' || type === 'companies')
        ? queryMany(`
            SELECT c.id, c.name, c.industry, c.phone, c.website,
                   COALESCE(cnt.contact_count, 0) AS contact_count
            FROM public.companies c
            LEFT JOIN (
              SELECT company_id, count(*)::int AS contact_count
              FROM public.contacts WHERE deleted_at IS NULL GROUP BY company_id
            ) cnt ON cnt.company_id = c.id
            WHERE c.tenant_id=$1 AND c.deleted_at IS NULL
              AND (c.name ILIKE $2 OR c.industry ILIKE $2 OR c.website ILIKE $2 OR c.phone ILIKE $2)
            ORDER BY c.updated_at DESC LIMIT $3`,
            [tid, pattern, limit])
        : Promise.resolve([]),

      (type === 'all' || type === 'tasks')
        ? queryMany(`
            SELECT t.id, t.title, t.description, t.priority, t.due_date, t.completed,
                   c.first_name, c.last_name
            FROM public.tasks t
            LEFT JOIN public.contacts c ON c.id = t.contact_id
            WHERE t.tenant_id=$1 AND t.deleted_at IS NULL
              AND (t.title ILIKE $2 OR t.description ILIKE $2
                   OR c.first_name ILIKE $2 OR c.last_name ILIKE $2
                   OR (c.first_name || ' ' || c.last_name) ILIKE $2)
            ORDER BY t.due_date ASC NULLS LAST LIMIT $3`,
            [tid, pattern, limit])
        : Promise.resolve([]),
    ]);

    const total = contacts.length + deals.length + companies.length + tasks.length;
    return NextResponse.json({ contacts, deals, companies, tasks, total, query: q });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
