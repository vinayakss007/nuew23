import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { checkRateLimit } from '@/lib/rate-limit';

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0]!.split(',').map(h => h.trim().toLowerCase().replace(/[^a-z0-9_]/g,'_'));
  return lines.slice(1).map(line => {
    const values = parseCSVLine(line);
    return Object.fromEntries(headers.map((h, i) => [h, values[i]?.trim() ?? '']));
  });
}
function parseCSVLine(line: string): string[] {
  const result: string[] = []; let current = ''; let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (inQuotes && line[i+1] === '"') { current += '"'; i++; } else inQuotes = !inQuotes; }
    else if (line[i] === ',' && !inQuotes) { result.push(current); current = ''; }
    else current += line[i];
  }
  result.push(current); return result;
}
const COLUMN_MAP: Record<string, string> = {
  // Names
  'first_name':'first_name','firstname':'first_name','first name':'first_name',
  'last_name':'last_name','lastname':'last_name','last name':'last_name','surname':'last_name',
  'full_name':'full_name','fullname':'full_name','name':'full_name',
  // Contact
  'email':'email','email_address':'email','emailaddress':'email',
  'phone':'phone','phone_number':'phone','mobile':'phone','telephone':'phone','fax':'phone',
  // Company
  'company':'company_name','company_name':'company_name','organization':'company_name','org':'company_name',
  'job_title':'title','title':'title','position':'title','role':'title',
  // Address
  'address':'address','street':'address','street_address':'address',
  'city':'city','state':'state','province':'state','region':'state',
  'country':'country','postal_code':'postal_code','zipcode':'postal_code','zip':'postal_code',
  // Web/Social
  'website':'website','url':'website','linkedin':'linkedin_url','linkedin_url':'linkedin_url',
  'twitter':'twitter_url','twitter_url':'twitter_url','facebook':'facebook_url','facebook_url':'facebook_url',
  // Lead info
  'lead_source':'lead_source','source':'lead_source',
  'lead_status':'lead_status','status':'lead_status',
  'score':'score','rating':'score',
  // Other
  'notes':'notes','note':'notes','description':'notes','comments':'notes',
  'tags':'tags','tag':'tags',
  'lifecycle_stage':'lifecycle_stage','stage':'lifecycle_stage',
  'assigned_to':'assigned_to','owner':'assigned_to',
  'industry':'industry','department':'department',
  'annual_revenue':'annual_revenue','revenue':'annual_revenue',
  'number_of_employees':'number_of_employees','employees':'number_of_employees',
};
const VALID_STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];

export async function POST(request: NextRequest) {
  try {
    const limited = await checkRateLimit(request, { action:'csv_import', max:10, windowMinutes:60 });
    if (limited) return limited;

    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const deny = requirePerm(ctx, 'contacts.import' as any);
    if (deny) return deny;

    const body = await request.json();
    const { csv, skipDuplicates = true, updateExisting = false } = body;
    if (!csv) return NextResponse.json({ error:'csv field required' }, { status:400 });

    const rows = parseCSV(csv);
    if (!rows.length) return NextResponse.json({ error:'No data rows found in CSV' }, { status:400 });
    if (rows.length > 50000) return NextResponse.json({ error:'CSV too large (max 50,000 rows)' }, { status:400 });

    // Plan limits check — use SELECT FOR UPDATE to prevent concurrent imports exceeding limit
    const { rows: [tenantInfo] } = await query<any>(
      `SELECT t.current_contacts, p.max_contacts FROM public.tenants t JOIN public.plans p ON p.id=t.plan_id WHERE t.id=$1 FOR UPDATE`,
      [ctx.tenantId]
    );
    if (tenantInfo?.max_contacts > 0 && (tenantInfo.current_contacts + rows.length) > tenantInfo.max_contacts) {
      return NextResponse.json({ error:`Import would exceed plan limit of ${tenantInfo.max_contacts} contacts.` }, { status:403 });
    }

    // FIX MEDIUM-08: Add size limit to company cache to prevent memory exhaustion
    const MAX_COMPANY_CACHE = 5000;
    const companyCache: Record<string, string> = {};
    const getOrCreateCompany = async (name: string): Promise<string | null> => {
      if (!name?.trim()) return null;
      const key = name.toLowerCase().trim();
      if (companyCache[key]) return companyCache[key];
      
      // Evict oldest entries if cache exceeds limit
      const cacheKeys = Object.keys(companyCache);
      if (cacheKeys.length >= MAX_COMPANY_CACHE && cacheKeys[0]) {
        delete companyCache[cacheKeys[0]];
      }
      
      let co = await queryOne<any>('SELECT id FROM public.companies WHERE tenant_id=$1 AND lower(name)=$2 AND deleted_at IS NULL', [ctx.tenantId, key]);
      if (!co) {
        const { rows:[c] } = await query('INSERT INTO public.companies (tenant_id,name,created_by) VALUES ($1,$2,$3) RETURNING id', [ctx.tenantId, name.trim(), ctx.userId]);
        co = c;
      }
      companyCache[key] = co.id; return co.id;
    };

    const results = { imported:0, updated:0, skipped:0, errors:[] as string[] };
    // FIX HIGH-09: Batch inserts for better performance
    const BATCH_SIZE = 500;
    const insertBatch: any[][] = [];

    const executeBatch = async () => {
      if (insertBatch.length === 0) return;
      
      // Build batch INSERT query
      const values = insertBatch.flat();
      const rowCount = insertBatch.length;
      const colCount = insertBatch[0]?.length ?? 25;
      const valuePlaceholders = insertBatch.map((_, rowIdx) => {
        return `(${Array.from({length: colCount}, (_, colIdx) => `$${rowIdx * colCount + colIdx + 1}`).join(',')})`;
      }).join(',');

      await query(
        `INSERT INTO public.contacts (tenant_id,created_by,assigned_to,first_name,last_name,email,phone,company_id,
         lead_status,lead_source,notes,city,country,state,address,postal_code,website,linkedin_url,twitter_url,
         tags,title,score,lifecycle_stage,industry)
         VALUES ${valuePlaceholders}`,
        values
      );
      results.imported += rowCount;
      insertBatch.length = 0;
    };

    for (const [index, row] of rows.entries()) {
      try {
        const mapped: Record<string,string> = {};
        for (const [key, val] of Object.entries(row)) {
          const dbCol = COLUMN_MAP[key.toLowerCase().trim()];
          if (dbCol && val) mapped[dbCol] = val;
        }
        const firstName = (mapped as any)['first_name']?.trim();
        if (!firstName) { results.errors.push(`Row ${index+2}: first_name is required`); results.skipped++; continue; }
        const email = (mapped as any)['email']?.toLowerCase().trim() || null;
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          results.errors.push(`Row ${index+2}: invalid email "${email}"`); results.skipped++; continue;
        }
        const companyId = await getOrCreateCompany((mapped as any)['company_name'] || '');
        const leadStatus = VALID_STATUSES.includes((mapped as any)['lead_status']) ? (mapped as any)['lead_status'] : 'new';
        const tags = (mapped as any)['tags'] ? (mapped as any)['tags'].split(/[;|]/).map((t: string) => t.trim()).filter(Boolean) : [];
        const scoreVal = (mapped as any)['score'] ? parseInt((mapped as any)['score']) : null;

        if (email) {
          const existing = await queryOne<any>(
            'SELECT id FROM public.contacts WHERE tenant_id=$1 AND email=$2 AND deleted_at IS NULL',
            [ctx.tenantId, email]
          );
          if (existing) {
            if (skipDuplicates && !updateExisting) { results.skipped++; continue; }
            if (updateExisting) {
              await query(
                `UPDATE public.contacts SET first_name=$1,last_name=$2,phone=$3,company_id=$4,
                 lead_status=$5,lead_source=$6,notes=$7,city=$8,country=$9,tags=$10,updated_at=now(),
                 title=$11,address=$12,state=$13,postal_code=$14,website=$15,linkedin_url=$16,
                 twitter_url=$16,score=$18,lifecycle_stage=$19,industry=$20
                 WHERE id=$21`,
                [firstName, (mapped as any)['last_name']||'', (mapped as any)['phone']||null, companyId, leadStatus,
                 (mapped as any)['lead_source']||null, (mapped as any)['notes']||null, (mapped as any)['city']||null, (mapped as any)['country']||null, tags,
                 (mapped as any)['title']||null, (mapped as any)['address']||null, (mapped as any)['state']||null,
                 (mapped as any)['postal_code']||null, (mapped as any)['website']||null, (mapped as any)['linkedin_url']||null,
                 (mapped as any)['twitter_url']||null, (mapped as any)['score']||null, (mapped as any)['lifecycle_stage']||null,
                 (mapped as any)['industry']||null, existing.id]
              );
              results.updated++; continue;
            }
          }
        }
        
        // Add to batch instead of inserting immediately
        insertBatch.push([
          ctx.tenantId, ctx.userId, ctx.userId, firstName, (mapped as any)['last_name']||'', email, (mapped as any)['phone']||null,
          companyId, leadStatus, (mapped as any)['lead_source']||null, (mapped as any)['notes']?.slice(0,5000)||null,
          (mapped as any)['city']||null, (mapped as any)['country']||null, (mapped as any)['state']||null,
          (mapped as any)['address']||null, (mapped as any)['postal_code']||null, (mapped as any)['website']||null,
          (mapped as any)['linkedin_url']||null, (mapped as any)['twitter_url']||null, tags,
          (mapped as any)['title']||null, scoreVal, (mapped as any)['lifecycle_stage']||null,
          (mapped as any)['industry']||null
        ]);

        // Execute batch when full
        if (insertBatch.length >= BATCH_SIZE) {
          await executeBatch();
        }
      } catch (rowErr: any) {
        results.errors.push(`Row ${index+2}: ${rowErr.message}`);
        results.skipped++;
      }
    }
    
    // Execute remaining batch
    await executeBatch();
    // REL-007 FIX: Update current_contacts counter after import
    if (results.imported > 0) {
      await query(
        `UPDATE public.tenants SET current_contacts = current_contacts + $1, updated_at = now() WHERE id=$2`,
        [results.imported, ctx.tenantId]
      );
    }
    // FIX: Added entity_type, entity_id, action to match activities table NOT NULL columns
    await query(
      `INSERT INTO public.activities (tenant_id,user_id,type,description,entity_type,entity_id,action)
       VALUES ($1,$2,'contact_created',$3,'bulk_import',gen_random_uuid(),'import_completed')`,
      [ctx.tenantId, ctx.userId, `Imported ${results.imported} contacts (${results.updated} updated, ${results.skipped} skipped)`]
    );
    return NextResponse.json({ ok:true, results });
  } catch (err: any) {
    console.error('[contacts/import]', err);
    return NextResponse.json({ error:err.message }, { status:500 });
  }
}
