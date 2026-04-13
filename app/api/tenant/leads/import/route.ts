import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g, '_'));
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? '']));
  });
}

function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inQuotes && line[i + 1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += line[i];
  }
  result.push(current); return result;
}

// Map CSV headers to leads table columns
const LEAD_COLUMN_MAP: Record<string, string> = {
  // Names
  'first_name': 'first_name', 'firstname': 'first_name', 'first name': 'first_name',
  'last_name': 'last_name', 'lastname': 'last_name', 'last name': 'last_name', 'surname': 'last_name',
  'full_name': 'full_name', 'fullname': 'full_name', 'name': 'first_name',
  // Contact
  'email': 'email', 'email_address': 'email', 'emailaddress': 'email',
  'phone': 'phone', 'phone_number': 'phone', 'mobile': 'mobile', 'telephone': 'phone',
  // Title & Department
  'job_title': 'title', 'title': 'title', 'position': 'title', 'role': 'title',
  'department': 'department', 'dept': 'department',
  // Company
  'company_name': 'company_name', 'company': 'company_name', 'organization': 'company_name', 'org': 'company_name',
  'company_size': 'company_size', 'companysize': 'company_size', 'company size': 'company_size', 'size': 'company_size',
  'company_industry': 'company_industry', 'industry': 'company_industry',
  'company_website': 'company_website', 'companywebsite': 'company_website',
  'company_annual_revenue': 'company_annual_revenue', 'annualrevenue': 'company_annual_revenue', 'revenue': 'company_annual_revenue',
  // Lead info
  'lead_source': 'lead_source', 'source': 'lead_source',
  'lead_status': 'lead_status', 'status': 'lead_status',
  'lifecycle_stage': 'lifecycle_stage', 'stage': 'lifecycle_stage',
  'score': 'score', 'rating': 'score', 'lead_score': 'score',
  // BANT
  'budget': 'budget', 'budget_amount': 'budget',
  'budget_currency': 'budget_currency', 'currency': 'budget_currency',
  'authority_level': 'authority_level', 'authority': 'authority_level',
  'need_description': 'need_description', 'need': 'need_description', 'pain_point': 'need_description', 'painpoint': 'need_description',
  'timeline': 'timeline', 'purchase_timeline': 'timeline', 'timeline_target_date': 'timeline_target_date',
  // Assignment
  'assigned_to': 'assigned_to', 'owner': 'assigned_to', 'owner_id': 'assigned_to',
  // Address
  'country': 'country', 'state': 'state', 'province': 'state', 'region': 'state',
  'city': 'city', 'postal_code': 'postal_code', 'zipcode': 'postal_code', 'zip': 'postal_code',
  'address_line1': 'address_line1', 'address': 'address_line1', 'street': 'address_line1',
  'address_line2': 'address_line2', 'address2': 'address_line2',
  'timezone': 'timezone',
  // Social & Web
  'website': 'website', 'url': 'website',
  'linkedin_url': 'linkedin_url', 'linkedin': 'linkedin_url',
  'twitter_handle': 'twitter_handle', 'twitter': 'twitter_handle',
  'facebook_url': 'facebook_url', 'facebook': 'facebook_url',
  // UTM & Tracking
  'utm_source': 'utm_source', 'utm_medium': 'utm_medium', 'utm_campaign': 'utm_campaign',
  'utm_term': 'utm_term', 'utm_content': 'utm_content',
  'referring_url': 'referring_url', 'referrer': 'referring_url',
  'landing_page': 'landing_page', 'landingpage': 'landing_page',
  'form_id': 'form_id', 'form': 'form_id',
  // Conversion & Loss
  'lost_reason': 'lost_reason', 'loss_reason': 'lost_reason',
  'lost_to_competitor': 'lost_to_competitor', 'competitor': 'lost_to_competitor',
  // Other
  'notes': 'notes', 'note': 'notes', 'description': 'notes', 'comments': 'notes',
  'internal_notes': 'internal_notes', 'internalnotes': 'internal_notes',
  'tags': 'tags', 'tag': 'tags',
  'number_of_employees': 'number_of_employees', 'employees': 'number_of_employees',
};

const VALID_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted', 'lost', 'nurturing'];
const VALID_LIFECYCLES = ['visitor', 'lead', 'marketing_qualified_lead', 'sales_qualified_lead', 'opportunity', 'customer', 'evangelist'];
const VALID_AUTHORITY = ['decision_maker', 'influencer', 'user', 'unknown'];

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action: 'lead_csv_import', max: 10, windowMinutes: 60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'leads.import' as any);
    if (deny) return deny;

    const body = await request.json();
    const { csv, skipDuplicates = true, updateExisting = false } = body;
    if (!csv) return NextResponse.json({ error: 'csv field required' }, { status: 400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error: 'No data rows found in CSV' }, { status: 400 });
    if (rows.length > 50000) return NextResponse.json({ error: 'CSV too large (max 50,000 rows)' }, { status: 400 });

    const results = { imported: 0, updated: 0, skipped: 0, errors: [] as string[] };
    const BATCH_SIZE = 500;
    const insertBatch: any[][] = [];

    const executeBatch = async () => {
      if (insertBatch.length === 0) return;
      const values = insertBatch.flat();
      const rowCount = insertBatch.length;
      const colCount = insertBatch[0]?.length ?? 30;
      const valuePlaceholders = insertBatch.map((_, rowIdx) => {
        return `(${Array.from({ length: colCount }, (_, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(',')})`;
      }).join(',');

      await query(
        `INSERT INTO public.leads (tenant_id,created_by,assigned_to,first_name,last_name,email,phone,mobile,
         title,department,company_name,company_size,company_industry,company_website,company_annual_revenue,
         lead_source,lead_status,lifecycle_stage,score,budget,budget_currency,authority_level,need_description,timeline,
         country,state,city,address_line1,address_line2,postal_code,timezone,
         website,linkedin_url,twitter_handle,facebook_url,
         utm_source,utm_medium,utm_campaign,utm_term,utm_content,referring_url,landing_page,
         tags,notes,internal_notes)
         VALUES ${valuePlaceholders}`,
        values
      );
      results.imported += rowCount;
      insertBatch.length = 0;
    };

    for (const [index, row] of rows.entries()) {
      try {
        const mapped: Record<string, string> = {};
        for (const [key, val] of Object.entries(row)) {
          const dbCol = LEAD_COLUMN_MAP[key.toLowerCase().trim()];
          if (dbCol && val) mapped[dbCol] = val;
        }

        const firstName = (mapped as any)['first_name']?.trim();
        if (!firstName) { results.errors.push(`Row ${index + 2}: first_name is required`); results.skipped++; continue; }

        const email = (mapped as any)['email']?.toLowerCase().trim() || null;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.errors.push(`Row ${index + 2}: invalid email "${email}"`); results.skipped++; continue;
        }

        const leadStatus = VALID_STATUSES.includes((mapped as any)['lead_status'])
          ? (mapped as any)['lead_status'] : 'new';
        const lifecycle = VALID_LIFECYCLES.includes((mapped as any)['lifecycle_stage'])
          ? (mapped as any)['lifecycle_stage'] : 'lead';
        const authority = VALID_AUTHORITY.includes((mapped as any)['authority_level'])
          ? (mapped as any)['authority_level'] : 'unknown';
        const tags = (mapped as any)['tags']
          ? (mapped as any)['tags'].split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];
        const scoreVal = (mapped as any)['score']
          ? Math.min(100, Math.max(0, parseInt((mapped as any)['score']) || 0)) : 0;
        const budgetVal = (mapped as any)['budget'] ? parseFloat((mapped as any)['budget']) || null : null;
        const revenueVal = (mapped as any)['company_annual_revenue'] ? parseFloat((mapped as any)['company_annual_revenue']) || null : null;

        if (email) {
          const existing = await queryOne<any>(
            'SELECT id FROM public.leads WHERE tenant_id=$1 AND lower(email)=$2 AND deleted_at IS NULL',
            [ctx.tenantId, email]
          );
          if (existing) {
            if (skipDuplicates && !updateExisting) { results.skipped++; continue; }
            if (updateExisting) {
              await query(
                `UPDATE public.leads SET first_name=$1,last_name=$2,phone=$3,mobile=$4,
                 title=$5,department=$6,company_name=$7,company_size=$8,company_industry=$9,
                 lead_status=$10,lifecycle_stage=$11,score=$12,budget=$13,authority_level=$14,
                 timeline=$15,country=$16,city=$17,state=$18,tags=$19,notes=$20,updated_at=now(),
                 website=$21,linkedin_url=$22,twitter_handle=$23,need_description=$24,
                 address_line1=$25,postal_code=$26,company_annual_revenue=$27
                 WHERE id=$28`,
                [
                  firstName, (mapped as any)['last_name'] || '', (mapped as any)['phone'] || null,
                  (mapped as any)['mobile'] || null, (mapped as any)['title'] || null,
                  (mapped as any)['department'] || null, (mapped as any)['company_name'] || null,
                  (mapped as any)['company_size'] || null, (mapped as any)['company_industry'] || null,
                  leadStatus, lifecycle, scoreVal, budgetVal, authority,
                  (mapped as any)['timeline'] || null, (mapped as any)['country'] || null,
                  (mapped as any)['city'] || null, (mapped as any)['state'] || null, tags,
                  (mapped as any)['notes']?.slice(0, 5000) || null,
                  (mapped as any)['website'] || null, (mapped as any)['linkedin_url'] || null,
                  (mapped as any)['twitter_handle'] || null, (mapped as any)['need_description']?.slice(0, 5000) || null,
                  (mapped as any)['address_line1'] || null, (mapped as any)['postal_code'] || null,
                  revenueVal, existing.id
                ]
              );
              results.updated++; continue;
            }
          }
        }

        insertBatch.push([
          ctx.tenantId, ctx.userId, (mapped as any)['assigned_to'] || null,
          firstName, (mapped as any)['last_name'] || '', email,
          (mapped as any)['phone'] || null, (mapped as any)['mobile'] || null,
          (mapped as any)['title'] || null, (mapped as any)['department'] || null,
          (mapped as any)['company_name'] || null, (mapped as any)['company_size'] || null,
          (mapped as any)['company_industry'] || null, (mapped as any)['company_website'] || null,
          revenueVal, (mapped as any)['lead_source'] || 'website', leadStatus,
          lifecycle, scoreVal, budgetVal, (mapped as any)['budget_currency'] || 'USD',
          authority, (mapped as any)['need_description']?.slice(0, 5000) || null,
          (mapped as any)['timeline'] || null,
          (mapped as any)['country'] || null, (mapped as any)['state'] || null,
          (mapped as any)['city'] || null, (mapped as any)['address_line1'] || null,
          (mapped as any)['address_line2'] || null, (mapped as any)['postal_code'] || null,
          (mapped as any)['timezone'] || null,
          (mapped as any)['website'] || null, (mapped as any)['linkedin_url'] || null,
          (mapped as any)['twitter_handle'] || null, (mapped as any)['facebook_url'] || null,
          (mapped as any)['utm_source'] || null, (mapped as any)['utm_medium'] || null,
          (mapped as any)['utm_campaign'] || null, (mapped as any)['utm_term'] || null,
          (mapped as any)['utm_content'] || null, (mapped as any)['referring_url'] || null,
          (mapped as any)['landing_page'] || null,
          tags, (mapped as any)['notes']?.slice(0, 5000) || null,
          (mapped as any)['internal_notes']?.slice(0, 5000) || null,
        ]);

        if (insertBatch.length >= BATCH_SIZE) {
          await executeBatch();
        }
      } catch (rowErr: any) {
        results.errors.push(`Row ${index + 2}: ${rowErr.message}`);
        results.skipped++;
      }
    }

    await executeBatch();

    // Log activity
    await query(
      `INSERT INTO public.activities (tenant_id,user_id,type,description,entity_type,entity_id,action)
       VALUES ($1,$2,'lead_created',$3,'bulk_import',gen_random_uuid(),'import_completed')`,
      [ctx.tenantId, ctx.userId, `Imported ${results.imported} leads (${results.updated} updated, ${results.skipped} skipped)`]
    );

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error('[leads/import]', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
