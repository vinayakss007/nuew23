/**
 * NuCRM — Bulk Data Seeder
 * Loads ALL sample CSV files into the database at once.
 *
 * Usage:
 *   npx tsx scripts/seed-all-data.ts
 *   npx tsx scripts/seed-all-data.ts --tenant-id <uuid>
 */

import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
import { Pool } from 'pg';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const C = {
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  blue:   '\x1b[36m',
  red:    '\x1b[31m',
  gray:   '\x1b[90m',
  bold:   '\x1b[1m',
  reset:  '\x1b[0m',
};
const ok   = (m: string) => console.log(`  ${C.green}✅${C.reset} ${m}`);
const skip = (m: string) => console.log(`  ${C.yellow}⏭️ ${C.reset}${C.gray}${m}${C.reset}`);
const info = (m: string) => console.log(`  ${C.gray}ℹ️ ${C.reset}${C.gray}${m}${C.reset}`);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
});

// ── Parse CSV ─────────────────────────────────────────────
function parseCSV(text: string): Record<string, string>[] {
  const allLines: string[] = text.trim().split('\n');
  const lines: string[] = allLines
    .map((l: string) => l.trim())
    .filter((l: string) => l.length > 0 && !l.startsWith('#'));
  if (lines.length < 2) return [];
  const headerLine: string = lines[0] as string;
  const headers: string[] = headerLine.split(',').map((h: string) => h.trim());
  return lines.slice(1).map((line: string) => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQuotes = !inQuotes; continue; }
      if (ch === ',' && !inQuotes) { values.push(current.trim()); current = ''; continue; }
      current += ch;
    }
    values.push(current.trim());
    const row: Record<string, string> = {};
    headers.forEach((h: string, i: number) => { row[h] = values[i] ?? ''; });
    return row;
  });
}

// ── Seed Functions ────────────────────────────────────────
async function seedTable(table: string, rows: Record<string, string>[], tenantId: string, userId: string) {
  if (!rows.length) { skip(`${table}: no rows`); return; }

  const columnMap: Record<string, Record<string, string>> = {
    contacts: {
      first_name: 'first_name', last_name: 'last_name', email: 'email',
      phone: 'phone', title: 'title', company_name: 'company_name',
      lead_status: 'lead_status', lead_source: 'lead_source',
      lifecycle_stage: 'lifecycle_stage', score: 'score',
      city: 'city', country: 'country', website: 'website',
      linkedin_url: 'linkedin_url', tags: 'tags', notes: 'notes',
    },
    leads: {
      first_name: 'first_name', last_name: 'last_name', email: 'email',
      phone: 'phone', title: 'title', company_name: 'company_name',
      company_size: 'company_size', company_industry: 'company_industry',
      lead_status: 'lead_status', lead_source: 'lead_source',
      lifecycle_stage: 'lifecycle_stage', budget: 'budget',
      authority_level: 'authority_level', country: 'country',
      state: 'state', city: 'city', website: 'website',
      utm_source: 'utm_source', utm_campaign: 'utm_campaign',
      tags: 'tags', notes: 'notes',
    },
    companies: {
      name: 'name', website: 'website', industry: 'industry',
      size: 'size', phone: 'phone', address: 'address',
      status: 'status', description: 'notes',
    },
    deals: {
      title: 'title', value: 'value', stage: 'stage',
      probability: 'probability', close_date: 'close_date', notes: 'notes',
    },
    tasks: {
      title: 'title', description: 'description', due_date: 'due_date',
      priority: 'priority', status: 'status',
    },
  };

  const cols = columnMap[table];
  if (!cols) { skip(`${table}: not mapped`); return; }

  const colNames = Object.keys(cols);
  const dbCols = Object.values(cols);

  let inserted = 0;
  let skipped = 0;

  for (const row of rows) {
    try {
      const values = colNames.map(c => {
        const v = row[c];
        if (!v || v === '') return null;
        // Convert "tag1,tag2" to JSON array ["tag1","tag2"]
        if (c === 'tags') {
          const tags = v.replace(/^"|"$/g, '').split(',').map((t: string) => t.trim()).filter(Boolean);
          return JSON.stringify(tags);
        }
        return v;
      });

      // Check for email duplicates on contacts/leads
      const emailVal = row['email'];
      if ((table === 'contacts' || table === 'leads') && emailVal) {
        const dup = await pool.query(
          `SELECT id FROM public.${table} WHERE tenant_id=$1 AND lower(email)=lower($2) AND deleted_at IS NULL`,
          [tenantId, emailVal]
        );
        if (dup.rows.length > 0) { skipped++; continue; }
      }

      const placeholders = dbCols.map((_, i) => `$${i + 3}`).join(',');
      const sql = `INSERT INTO public.${table} (${dbCols.join(',')}, tenant_id, created_by)
                   VALUES (${placeholders}, $1, $2) RETURNING id`;

      await pool.query(sql, [tenantId, userId, ...values]);
      inserted++;
    } catch (e: any) {
      if (e.message?.includes('duplicate') || e.message?.includes('unique') || e.message?.includes('already exists')) {
        skipped++;
      } else {
        info(`${table} error: ${e.message?.slice(0, 100)}`);
      }
    }
  }

  ok(`${table}: ${inserted} inserted, ${skipped} skipped (total ${rows.length} rows)`);
}

// ── Main ──────────────────────────────────────────────────
async function main() {
  console.log(`\n${C.bold}═══════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  NuCRM — Bulk Data Seeder${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════${C.reset}\n`);

  // Check DB
  await pool.query('SELECT 1');
  ok('Database connected');

  // Find or create tenant and get user ID
  let tenantId: string = process.argv.includes('--tenant-id')
    ? process.argv[process.argv.indexOf('--tenant-id') + 1] as string
    : '';

  let userId: string = '';

  if (!tenantId) {
    // Try to find first active tenant
    const t = await pool.query('SELECT id, owner_id FROM public.tenants WHERE deleted_at IS NULL LIMIT 1');
    if (t.rows.length > 0) {
      tenantId = t.rows[0].id;
      userId = t.rows[0].owner_id;
      info(`Using existing tenant: ${tenantId}`);
    } else {
      // Create a demo tenant
      userId = randomUUID();
      const hashed = '$2a$10$demo';
      await pool.query(
        `INSERT INTO public.users (id, full_name, email, password_hash, is_super_admin)
         VALUES ($1, $2, $3, $4, true)
         ON CONFLICT (email) DO UPDATE SET full_name = $2
         RETURNING id`,
        [userId, 'Demo User', 'demo@nucrm.local', hashed]
      );

      const tr = await pool.query(
        `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status)
         VALUES ($1, $2, $3, (SELECT id FROM public.plans LIMIT 1), 'active')
         RETURNING id`,
        ['Demo Company', 'demo-company-' + Date.now(), userId]
      );
      tenantId = tr.rows[0].id;

      await pool.query(
        `INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status)
         VALUES ($1, $2, 'admin', 'active')
         ON CONFLICT DO NOTHING`,
        [tenantId, userId]
      );
      ok(`Created demo tenant: ${tenantId}`);
    }
  } else {
    const t = await pool.query('SELECT owner_id FROM public.tenants WHERE id=$1', [tenantId]);
    userId = t.rows[0]?.owner_id;
    if (!userId) {
      const u = await pool.query('SELECT id FROM public.users LIMIT 1');
      userId = u.rows[0]?.id;
    }
  }

  info(`Using user ID for created_by: ${userId}`);

  // Load and seed all CSV files
  const dataDir = join(__dirname, '..', 'sample-data');
  const files = ['contacts.csv', 'leads.csv', 'companies.csv', 'deals.csv', 'tasks.csv'];

  for (const file of files) {
    try {
      const content = await readFile(join(dataDir, file), 'utf8');
      const rows = parseCSV(content);
      const table = file.replace('.csv', '');
      await seedTable(table, rows, tenantId, userId);
    } catch (e: any) {
      if (e.code === 'ENOENT') {
        skip(`${file}: not found (put in sample-data/)`);
      } else {
        console.error(`${C.red}❌${C.reset} ${file}: ${e.message}`);
      }
    }
  }

  // Summary
  const tables = ['contacts', 'leads', 'companies', 'deals', 'tasks'];
  console.log(`\n${C.bold}═══════════════════════════════════════════════${C.reset}`);
  console.log(`${C.bold}  Seed Complete${C.reset}`);
  console.log(`${C.bold}═══════════════════════════════════════════════${C.reset}\n`);

  for (const t of tables) {
    const r = await pool.query(`SELECT count(*)::int FROM public.${t} WHERE tenant_id=$1`, [tenantId]);
    info(`${t}: ${r.rows[0].count} records`);
  }
  console.log(`\n  ${C.green}Tenant ID: ${tenantId}${C.reset}\n`);

  await pool.end();
}

main().catch(e => {
  console.error(`${C.red}FATAL:${C.reset} ${e.message}`);
  process.exit(1);
});
