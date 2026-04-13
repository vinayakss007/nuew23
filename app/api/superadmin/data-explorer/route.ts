import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany } from '@/lib/db/client';

/**
 * Superadmin Cross-Tenant Data Search & Explorer
 * 
 * GET /api/superadmin/data-explorer
 *   ?q=searchTerm           — global search across all tenants
 *   ?type=contacts|leads|deals|companies|users|tenants
 *   ?tenantId=xxx           — filter by specific tenant
 *   ?page=1&limit=50        — pagination
 *   ?sort=created_at&order=desc
 *   ?field=email&value=xxx  — exact field search
 * 
 * GET /api/superadmin/data-explorer/summary
 *   ?tenantId=xxx           — get full data summary for a tenant
 * 
 * PUT /api/superadmin/data-explorer
 *   { table, id, field, value }  — update a single field in any record
 * 
 * DELETE /api/superadmin/data-explorer
 *   { table, id }           — delete a record
 */

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'summary') {
    return handleSummary(searchParams);
  }

  if (action === 'schema') {
    return handleSchemaInfo();
  }

  return handleSearch(searchParams);
}

// ── Global Search Across All Tenants ────────────────────────────────────────

async function handleSummary(searchParams: URLSearchParams) {
  try {
    const tenantId = searchParams.get('tenantId');

    if (tenantId) {
      // Summary for a specific tenant
      const tenant = await queryMany(`
        SELECT t.id, t.name, t.subdomain, t.slug, t.status, t.plan,
               t.created_at, t.trial_ends_at,
               u.email as owner_email, u.full_name as owner_name,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count,
               (SELECT count(*) FROM leads WHERE tenant_id = t.id AND deleted_at IS NULL) as lead_count,
               (SELECT count(*) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as deal_count,
               (SELECT count(*) FROM companies WHERE tenant_id = t.id AND deleted_at IS NULL) as company_count,
               (SELECT count(*) FROM tasks WHERE tenant_id = t.id AND deleted_at IS NULL) as task_count,
               (SELECT count(*) FROM tenant_members WHERE tenant_id = t.id) as member_count,
               (SELECT count(*) FROM activities WHERE tenant_id = t.id) as activity_count,
               (SELECT count(*) FROM workflows WHERE tenant_id = t.id) as workflow_count,
               (SELECT COALESCE(SUM(value), 0) FROM deals WHERE tenant_id = t.id AND deleted_at IS NULL) as total_pipeline_value
        FROM tenants t
        LEFT JOIN users u ON t.owner_id = u.id
        WHERE t.id = $1
      `, [tenantId]);

      if (tenant.length === 0) {
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }

      return NextResponse.json({ tenant: tenant[0] });
    }

    // Platform-wide summary
    const summary = await queryMany(`
      SELECT
        (SELECT count(*) FROM tenants) as total_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'active') as active_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'trialing') as trialing_tenants,
        (SELECT count(*) FROM tenants WHERE status = 'suspended') as suspended_tenants,
        (SELECT count(*) FROM users) as total_users,
        (SELECT count(*) FROM contacts WHERE deleted_at IS NULL) as total_contacts,
        (SELECT count(*) FROM leads WHERE deleted_at IS NULL) as total_leads,
        (SELECT count(*) FROM deals WHERE deleted_at IS NULL) as total_deals,
        (SELECT count(*) FROM companies WHERE deleted_at IS NULL) as total_companies,
        (SELECT count(*) FROM tasks WHERE deleted_at IS NULL) as total_tasks,
        (SELECT COALESCE(SUM(d.value), 0) FROM deals d WHERE d.deleted_at IS NULL) as total_pipeline_value,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '7 days') as new_this_week,
        (SELECT count(*) FROM tenants WHERE created_at > NOW() - INTERVAL '30 days') as new_this_month
    `);

    return NextResponse.json({ summary: summary[0] });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Schema Information ──────────────────────────────────────────────────────

async function handleSchemaInfo() {
  try {
    // Get all tables with their columns and row counts
    const tables = await queryMany(`
      SELECT 
        t.table_name,
        (SELECT count(*) FROM information_schema.columns c 
         WHERE c.table_name = t.table_name AND c.table_schema = 'public') as column_count,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'tenant_id'
        )) as has_tenant_id,
        (SELECT EXISTS(
          SELECT 1 FROM information_schema.columns 
          WHERE table_name = t.table_name AND column_name = 'deleted_at'
        )) as has_soft_delete
      FROM information_schema.tables t
      WHERE t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
      ORDER BY t.table_name
    `);

    // Get tenant columns for tables that have tenant_id
    const tenantTables = tables.filter(t => t.has_tenant_id);
    const tableDetails: any[] = [];

    for (const table of tenantTables.slice(0, 20)) { // Limit to avoid huge responses
      try {
        const columns = await queryMany(`
          SELECT column_name, data_type, is_nullable
          FROM information_schema.columns
          WHERE table_name = $1 AND table_schema = 'public'
          ORDER BY ordinal_position
        `, [table.table_name]);

        const countResult = await queryMany(
          `SELECT count(*) FROM ${table.table_name}`,
          []
        );

        tableDetails.push({
          table: table.table_name,
          columns: columns,
          totalRows: parseInt(countResult[0]?.count || '0', 10),
        });
      } catch {
        // Skip tables that can't be queried
      }
    }

    return NextResponse.json({ tables: tableDetails });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Main Search Handler ─────────────────────────────────────────────────────

async function handleSearch(searchParams: URLSearchParams) {
  try {
    const q = searchParams.get('q')?.trim() || '';
    const type = searchParams.get('type') || 'all';
    const tenantId = searchParams.get('tenantId');
    const page = Math.max(1, parseInt(searchParams.get('page') || '1'));
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '50')));
    const offset = (page - 1) * limit;
    const sort = searchParams.get('sort') || 'created_at';
    const order = (searchParams.get('order') || 'desc').toUpperCase();
    const field = searchParams.get('field');
    const fieldValue = searchParams.get('value');

    // Validate sort column (prevent SQL injection)
    const allowedSortColumns = ['id', 'name', 'email', 'title', 'created_at', 'updated_at', 'value', 'status', 'first_name', 'last_name', 'phone'];
    const safeSort = allowedSortColumns.includes(sort) ? sort : 'created_at';
    const safeOrder = order === 'ASC' ? 'ASC' : 'DESC';

    const results: any = {};
    let totalAcrossAll = 0;

    const params: any[] = [];
    let paramIndex = 1;

    function addParam(value: any): string {
      params.push(value);
      return `$${paramIndex++}`;
    }

    if (type === 'all' || type === 'tenants') {
      let query = `
        SELECT t.id, t.name, t.subdomain, t.slug, t.status, t.plan,
               t.created_at, t.updated_at,
               u.email as owner_email,
               (SELECT count(*) FROM contacts WHERE tenant_id = t.id AND deleted_at IS NULL) as contact_count
        FROM tenants t
        LEFT JOIN users u ON t.owner_id = u.id
        WHERE 1=1
      `;

      if (q) {
        query += ` AND (t.name ILIKE ${addParam(`%${q}%`)} OR t.subdomain ILIKE ${addParam(`%${q}%`)} OR t.slug ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND t.id = ${addParam(tenantId)}`;
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(*) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY t.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.tenants = { data, total, page, limit };
      totalAcrossAll += total;
    }

    if (type === 'all' || type === 'contacts') {
      let query = `
        SELECT c.id, c.first_name, c.last_name, c.email, c.phone, c.company,
               c.lead_status, c.created_at, c.updated_at,
               t.name as tenant_name, t.subdomain as tenant_subdomain,
               co.name as company_name
        FROM contacts c
        JOIN tenants t ON c.tenant_id = t.id
        LEFT JOIN companies co ON c.company_id = co.id
        WHERE c.deleted_at IS NULL
      `;

      if (q) {
        query += ` AND (c.first_name ILIKE ${addParam(`%${q}%`)} OR c.last_name ILIKE ${addParam(`%${q}%`)} OR c.email ILIKE ${addParam(`%${q}%`)} OR c.phone ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND c.tenant_id = ${addParam(tenantId)}`;
      }
      if (field && fieldValue) {
        if (['email', 'phone', 'first_name', 'last_name'].includes(field)) {
          query += ` AND c.${field} = ${addParam(fieldValue)}`;
        }
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(DISTINCT c.id) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY c.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.contacts = { data, total, page, limit };
      if (type === 'contacts') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'leads') {
      let query = `
        SELECT l.id, l.name, l.email, l.phone, l.company, l.source,
               l.status, l.value, l.created_at,
               t.name as tenant_name, t.subdomain as tenant_subdomain
        FROM leads l
        JOIN tenants t ON l.tenant_id = t.id
        WHERE l.deleted_at IS NULL
      `;

      if (q) {
        query += ` AND (l.name ILIKE ${addParam(`%${q}%`)} OR l.email ILIKE ${addParam(`%${q}%`)} OR l.company ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND l.tenant_id = ${addParam(tenantId)}`;
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(*) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY l.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.leads = { data, total, page, limit };
      if (type === 'leads') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'deals') {
      let query = `
        SELECT d.id, d.title, d.value, d.stage, d.close_date,
               d.created_at, d.updated_at,
               t.name as tenant_name, t.subdomain as tenant_subdomain,
               c.first_name || ' ' || c.last_name as contact_name
        FROM deals d
        JOIN tenants t ON d.tenant_id = t.id
        LEFT JOIN contacts c ON d.contact_id = c.id
        WHERE d.deleted_at IS NULL
      `;

      if (q) {
        query += ` AND (d.title ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND d.tenant_id = ${addParam(tenantId)}`;
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(*) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY d.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.deals = { data, total, page, limit };
      if (type === 'deals') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'companies') {
      let query = `
        SELECT co.id, co.name, co.industry, co.website, co.phone,
               co.created_at, co.updated_at,
               t.name as tenant_name, t.subdomain as tenant_subdomain,
               (SELECT count(*) FROM contacts WHERE company_id = co.id AND deleted_at IS NULL) as contact_count
        FROM companies co
        JOIN tenants t ON co.tenant_id = t.id
        WHERE co.deleted_at IS NULL
      `;

      if (q) {
        query += ` AND (co.name ILIKE ${addParam(`%${q}%`)} OR co.industry ILIKE ${addParam(`%${q}%`)} OR co.website ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND co.tenant_id = ${addParam(tenantId)}`;
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(*) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY co.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.companies = { data, total, page, limit };
      if (type === 'companies') totalAcrossAll = total;
    }

    if (type === 'all' || type === 'users') {
      let query = `
        SELECT u.id, u.email, u.full_name, u.is_super_admin,
               u.created_at, u.last_login_at,
               tm.tenant_id, t.name as tenant_name, t.subdomain as tenant_subdomain,
               tm.role as tenant_role
        FROM users u
        LEFT JOIN tenant_members tm ON tm.user_id = u.id
        LEFT JOIN tenants t ON tm.tenant_id = t.id
        WHERE 1=1
      `;

      if (q) {
        query += ` AND (u.email ILIKE ${addParam(`%${q}%`)} OR u.full_name ILIKE ${addParam(`%${q}%`)})`;
      }
      if (tenantId) {
        query += ` AND tm.tenant_id = ${addParam(tenantId)}`;
      }

      const countQuery = query.replace(/SELECT.*?FROM/, 'SELECT count(DISTINCT u.id) FROM');
      const countResult = await queryMany(countQuery, [...params]);
      const total = parseInt(countResult[0]?.count || '0', 10);

      query += ` ORDER BY u.${safeSort} ${safeOrder} LIMIT ${addParam(limit)} OFFSET ${addParam(offset)}`;
      const data = await queryMany(query, [...params]);

      results.users = { data, total, page, limit };
      if (type === 'users') totalAcrossAll = total;
    }

    return NextResponse.json({
      results,
      totalAcrossAll,
      query: q,
      filters: { type, tenantId, page, limit },
    });
  } catch (err: any) {
    console.error('[Superadmin Data Explorer] Search error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Update a Record ─────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { table, id, field, value } = body;

    if (!table || !id || !field) {
      return NextResponse.json({ error: 'table, id, and field are required' }, { status: 400 });
    }

    // Validate table name (prevent SQL injection)
    const allowedTables = [
      'tenants', 'contacts', 'leads', 'deals', 'companies',
      'tasks', 'users', 'roles', 'webhooks', 'api_keys',
      'email_templates', 'workflows', 'automations', 'forms',
      'pipelines', 'deal_stages', 'tags', 'modules',
    ];
    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' is not allowed for editing` }, { status: 400 });
    }

    // Validate field name
    const safeField = field.replace(/[^a-zA-Z0-9_]/g, '');
    if (!safeField) {
      return NextResponse.json({ error: 'Invalid field name' }, { status: 400 });
    }

    const result = await queryMany(
      `UPDATE "${table}" SET "${safeField}" = $1 WHERE id = $2 RETURNING id, ${safeField}`,
      [value, id]
    );

    if (result.length === 0) {
      return NextResponse.json({ error: 'Record not found' }, { status: 404 });
    }

    return NextResponse.json({
      message: 'Record updated',
      data: result[0],
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Delete a Record ─────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (!ctx || ctx instanceof NextResponse) {
    return ctx instanceof NextResponse ? ctx : NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin access required' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { table, id, softDelete } = body;

    if (!table || !id) {
      return NextResponse.json({ error: 'table and id are required' }, { status: 400 });
    }

    const allowedTables = [
      'contacts', 'leads', 'deals', 'companies',
      'tasks', 'webhooks', 'api_keys',
      'email_templates', 'workflows', 'automations', 'forms',
      'tags', 'notes',
    ];
    if (!allowedTables.includes(table)) {
      return NextResponse.json({ error: `Table '${table}' is not allowed for deletion` }, { status: 400 });
    }

    if (softDelete) {
      // Soft delete — set deleted_at
      const result = await queryMany(
        `UPDATE "${table}" SET deleted_at = NOW() WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.length === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
    } else {
      // Hard delete
      const result = await queryMany(
        `DELETE FROM "${table}" WHERE id = $1 RETURNING id`,
        [id]
      );
      if (result.length === 0) {
        return NextResponse.json({ error: 'Record not found' }, { status: 404 });
      }
    }

    return NextResponse.json({ message: 'Record deleted', id });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
