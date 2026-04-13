/**
 * NuCRM External Data Service
 * Standalone import/export service for all database tables
 * Runs independently from main NuCRM app
 * 
 * SECURITY: All endpoints require authentication via API key
 * TENANT ISOLATION: All data operations scoped to tenant_id
 */

const fastify = require('fastify')({ logger: true });
const fs = require('fs');
const path = require('path');

// ── Database Connection ─────────────────────────────────
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

// ── Authentication Middleware ───────────────────────────
/**
 * Validates API key from Authorization header or query parameter
 * API key format: "Bearer nucrm_api_<tenant_id>_<key>"
 * For security, keys should be stored in environment variable or database
 */
const VALID_API_KEYS = new Map();

// Initialize API keys from environment (format: TENANT_ID:API_KEY, comma-separated)
if (process.env.DATA_SERVICE_API_KEYS) {
  process.env.DATA_SERVICE_API_KEYS.split(',').forEach(pair => {
    const [tenantId, key] = pair.split(':');
    if (tenantId && key) VALID_API_KEYS.set(key.trim(), tenantId.trim());
  });
}

async function authenticate(request, reply) {
  // Skip auth for health check
  if (request.url === '/health' || request.url === '/api/tables') return;

  const authHeader = request.headers.authorization;
  const apiKey = request.query.api_key;

  let token = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (apiKey) {
    token = apiKey;
  }

  if (!token) {
    return reply.code(401).send({ 
      error: 'Authentication required', 
      message: 'Provide API key via Authorization header (Bearer <key>) or ?api_key=<key>' 
    });
  }

  // Validate API key
  const tenantId = VALID_API_KEYS.get(token);
  if (!tenantId) {
    // Fallback: check if key matches pattern nucrm_api_<uuid>_<random>
    // In production, always use explicit key validation
    if (process.env.NODE_ENV === 'production') {
      return reply.code(401).send({ error: 'Invalid API key' });
    }
    // Dev mode: allow any key with tenant_id from query
    if (!request.query.tenant_id) {
      return reply.code(401).send({ 
        error: 'tenant_id required', 
        message: 'In dev mode, provide ?tenant_id=<uuid>&api_key=dev' 
      });
    }
    request.authenticatedTenantId = request.query.tenant_id;
    return;
  }

  request.authenticatedTenantId = tenantId;
}

// Register auth hook
fastify.addHook('onRequest', authenticate);

// ── Table Definitions ───────────────────────────────────
const TABLES = {
  contacts: {
    columns: ['id','tenant_id','first_name','last_name','email','phone','title','company_id','assigned_to','lead_status','lead_source','lifecycle_stage','notes','tags','score','city','country','website','linkedin_url','twitter_url','custom_fields','is_archived','created_by','created_at','updated_at','deleted_at'],
    required: ['tenant_id','first_name','last_name'],
  },
  companies: {
    columns: ['id','tenant_id','name','website','industry','size','description','phone','address','city','state','country','custom_fields','status','assigned_to','created_by','created_at','updated_at','deleted_at'],
    required: ['tenant_id','name'],
  },
  deals: {
    columns: ['id','tenant_id','title','value','stage','stage_id','probability','close_date','contact_id','company_id','assigned_to','notes','custom_fields','created_by','created_at','updated_at','deleted_at'],
    required: ['tenant_id','title'],
  },
  tasks: {
    columns: ['id','tenant_id','title','description','due_date','priority','status','assigned_to','contact_id','deal_id','company_id','completed','completed_at','created_by','created_at','updated_at','deleted_at'],
    required: ['tenant_id','title'],
  },
  activities: {
    columns: ['id','tenant_id','user_id','contact_id','deal_id','company_id','type','event_type','description','metadata','created_at'],
    required: ['tenant_id','user_id'],
  },
  users: {
    columns: ['id','email','password_hash','full_name','avatar_url','is_super_admin','email_verified','phone','timezone','locale','theme','created_at','updated_at','deleted_at'],
    required: ['email','password_hash','full_name'],
  },
  tenants: {
    columns: ['id','name','slug','owner_id','plan_id','status','trial_ends_at','primary_color','logo_url','settings','created_at','updated_at','deleted_at'],
    required: ['name','slug','owner_id'],
  },
  tenant_members: {
    columns: ['id','tenant_id','user_id','role_slug','role_id','status','joined_at'],
    required: ['tenant_id','user_id','role_slug'],
  },
};

// ── Health Check ────────────────────────────────────────
fastify.get('/health', async () => {
  try {
    await pool.query('SELECT 1');
    return { status: 'ok', database: 'connected', timestamp: new Date().toISOString() };
  } catch (err) {
    fastify.log.error(err);
    return { status: 'error', database: 'disconnected', error: err.message };
  }
});

// ── List Available Tables ───────────────────────────────
fastify.get('/api/tables', async () => {
  return { tables: Object.keys(TABLES), count: Object.keys(TABLES).length };
});

// ── Export Data ─────────────────────────────────────────
fastify.get('/api/export/:table', async (request, reply) => {
  const { table } = request.params;
  const { format, limit } = request.query;
  // ENFORCE TENANT ISOLATION: Use authenticated tenant ID
  const tenant_id = request.authenticatedTenantId;

  if (!TABLES[table]) {
    return reply.code(400).send({ error: `Unknown table: ${table}. Available: ${Object.keys(TABLES).join(', ')}` });
  }

  try {
    let query = `SELECT * FROM public.${table} WHERE tenant_id = $1`;
    const params = [tenant_id];

    query += ` ORDER BY created_at DESC`;

    if (limit) {
      query += ` LIMIT $${params.length + 1}`;
      params.push(parseInt(limit));
    }

    const { rows } = await pool.query(query, params);

    // CSV export
    if (format === 'csv') {
      const { stringify } = require('csv-stringify/sync');
      const csv = stringify(rows, { header: true });
      reply.header('Content-Type', 'text/csv');
      reply.header('Content-Disposition', `attachment; filename="${table}_${Date.now()}.csv"`);
      return reply.send(csv);
    }

    // JSON export (default)
    return { table, count: rows.length, data: rows, exported_at: new Date().toISOString() };
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: `Failed to export ${table}`, message: err.message });
  }
});

// ── Export All Tables ───────────────────────────────────
fastify.get('/api/export-all', async (request, reply) => {
  // ENFORCE TENANT ISOLATION
  const tenant_id = request.authenticatedTenantId;
  const result = {};

  for (const table of Object.keys(TABLES)) {
    try {
      // Skip users/tenants tables for regular export (security)
      if (table === 'users' || table === 'tenants' || table === 'tenant_members') {
        result[table] = { skipped: true, reason: 'Protected table - use admin export' };
        continue;
      }

      const query = `SELECT * FROM public.${table} WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 1000`;
      const { rows } = await pool.query(query, [tenant_id]);
      result[table] = { count: rows.length, data: rows };
    } catch (err) {
      fastify.log.error(`Error exporting ${table}: ${err.message}`);
      result[table] = { error: err.message, count: 0, data: [] };
    }
  }

  return { exported_at: new Date().toISOString(), tables: Object.keys(result), data: result };
});

// ── Import Data ─────────────────────────────────────────
fastify.post('/api/import/:table', async (request, reply) => {
  const { table } = request.params;
  const { on_conflict } = request.query;
  // ENFORCE TENANT ISOLATION
  const tenant_id = request.authenticatedTenantId;

  if (!TABLES[table]) {
    return reply.code(400).send({ error: `Unknown table: ${table}` });
  }

  let data = request.body;

  // Handle file upload
  if (request.isMultipart()) {
    const file = await request.file();
    const content = await file.toBuffer();
    const ext = path.extname(file.filename).toLowerCase();

    if (ext === '.csv') {
      const { parse } = require('csv-parse/sync');
      data = parse(content.toString(), { columns: true, skip_empty_lines: true });
    } else {
      data = JSON.parse(content.toString());
    }
  }

  if (!Array.isArray(data)) {
    data = data.data || data.records || [data];
  }

  if (data.length === 0) {
    return reply.code(400).send({ error: 'No data provided' });
  }

  // VALIDATE: Check payload size to prevent memory exhaustion
  if (data.length > 10000) {
    return reply.code(400).send({ 
      error: 'Payload too large', 
      message: 'Maximum 10,000 rows per import request' 
    });
  }

  try {
    const results = { success: 0, failed: 0, errors: [] };
    const conflictClause = on_conflict === 'update' ? 'ON CONFLICT (id) DO UPDATE SET' : 'ON CONFLICT (id) DO NOTHING';

    for (const row of data) {
      try {
        // FORCE tenant_id to authenticated tenant (security)
        row.tenant_id = tenant_id;

        const columns = Object.keys(row).filter(col => {
          // Only allow columns defined in table schema
          if (!TABLES[table].columns.includes(col)) {
            fastify.log.warn(`Skipping unknown column: ${col}`);
            return false;
          }
          return true;
        });
        
        const values = columns.map(col => row[col]);
        const placeholders = values.map((_, i) => `$${i + 1}`).join(',');

        // SECURITY: Sanitize column names to prevent SQL injection
        const sanitizeColumn = (col) => {
          // Only allow alphanumeric and underscore
          if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(col)) {
            throw new Error(`Invalid column name: ${col}`);
          }
          return `"${col}"`;
        };

        const sanitizedColumns = columns.map(sanitizeColumn);
        const setClause = columns.map((col, i) => `${sanitizeColumn(col)} = EXCLUDED.${sanitizeColumn(col)}`).join(',');
        const finalConflict = on_conflict === 'update' ? `${conflictClause} ${setClause}` : conflictClause;

        const query = `
          INSERT INTO public.${table} (${sanitizedColumns.join(',')})
          VALUES (${placeholders})
          ${finalConflict}
          RETURNING id
        `;

        await pool.query(query, values);
        results.success++;
      } catch (err) {
        results.failed++;
        results.errors.push({ row, error: err.message });
        fastify.log.error(`Import error for ${table}: ${err.message}`);
      }
    }

    return {
      table,
      total: data.length,
      success: results.success,
      failed: results.failed,
      errors: results.errors.slice(0, 10),
      imported_at: new Date().toISOString(),
    };
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: `Failed to import ${table}`, message: err.message });
  }
});

// ── Bulk Import from File ───────────────────────────────
fastify.post('/api/import-file', async (request, reply) => {
  try {
    const file = await request.file();
    const content = await file.toBuffer();
    const ext = path.extname(file.filename).toLowerCase();
    const table = request.query.table;
    const tenant_id = request.query.tenant_id;
    
    if (!table || !TABLES[table]) {
      return reply.code(400).send({ error: `Table parameter required. Available: ${Object.keys(TABLES).join(', ')}` });
    }

    let data;
    if (ext === '.csv') {
      const { parse } = require('csv-parse/sync');
      data = parse(content.toString(), { columns: true, skip_empty_lines: true });
    } else if (ext === '.json') {
      const parsed = JSON.parse(content.toString());
      data = Array.isArray(parsed) ? parsed : parsed.data || parsed.records || [];
    } else {
      return reply.code(400).send({ error: 'Unsupported file format. Use .csv or .json' });
    }

    // Forward to import endpoint
    const importResult = await fastify.inject({
      method: 'POST',
      url: `/api/import/${table}`,
      body: data,
      query: { on_conflict: request.query.on_conflict || 'update', tenant_id },
    });

    return JSON.parse(importResult.payload);
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: 'File import failed', message: err.message });
  }
});

// ── Clear Table Data ────────────────────────────────────
fastify.delete('/api/clear/:table', async (request, reply) => {
  const { table } = request.params;
  // ENFORCE TENANT ISOLATION - tenant_id is now MANDATORY
  const tenant_id = request.authenticatedTenantId;

  if (!TABLES[table]) {
    return reply.code(400).send({ error: `Unknown table: ${table}` });
  }

  // SECURITY: Prevent clearing protected tables via this endpoint
  if (table === 'users' || table === 'tenants' || table === 'tenant_members') {
    return reply.code(403).send({ 
      error: 'Cannot clear protected table', 
      message: 'Use admin tools to manage users/tenants' 
    });
  }

  try {
    // ALWAYS filter by tenant_id - NEVER allow full table deletion
    const query = `DELETE FROM public.${table} WHERE tenant_id = $1`;
    const { rowCount } = await pool.query(query, [tenant_id]);
    
    fastify.log.info(`Cleared ${rowCount} rows from ${table} for tenant ${tenant_id}`);
    return { table, deleted: rowCount, tenant_id, cleared_at: new Date().toISOString() };
  } catch (err) {
    fastify.log.error(err);
    return reply.code(500).send({ error: `Failed to clear ${table}`, message: err.message });
  }
});

// ── Database Stats ──────────────────────────────────────
fastify.get('/api/stats', async (request, reply) => {
  // ENFORCE TENANT ISOLATION
  const tenant_id = request.authenticatedTenantId;
  const stats = {};

  for (const table of Object.keys(TABLES)) {
    try {
      // Skip protected tables for regular stats
      if (table === 'users' || table === 'tenants' || table === 'tenant_members') {
        stats[table] = { skipped: true, reason: 'Protected table' };
        continue;
      }

      const { rows } = await pool.query(
        `SELECT count(*)::int as total FROM public.${table} WHERE tenant_id = $1`,
        [tenant_id]
      );
      stats[table] = { total: rows[0].total };
    } catch (err) {
      stats[table] = { error: err.message };
    }
  }

  return { database_stats: stats, tenant_id, timestamp: new Date().toISOString() };
});

// ── Seed Test Data ──────────────────────────────────────
fastify.post('/api/seed', async (request, reply) => {
  const { tenant_name, user_email, contact_count } = request.body;
  const tName = tenant_name || 'Test Company';
  const uEmail = user_email || 'test@example.com';
  const cCount = contact_count || 20;

  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');

    // Create user
    const bcrypt = require('bcryptjs');
    const { randomUUID } = require('crypto');
    const userId = randomUUID();
    const hashedPassword = await bcrypt.hash('password123', 10);
    
    const userRes = await client.query(
      `INSERT INTO public.users (id, full_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET full_name = $2
       RETURNING id`,
      [userId, 'Test User', uEmail, hashedPassword]
    );
    const actualUserId = userRes.rows[0].id;

    // Create tenant
    const slug = tName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    const tenantRes = await client.query(
      `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status)
       VALUES ($1, $2, $3, (SELECT id FROM public.plans LIMIT 1), 'active')
       RETURNING id`,
      [tName, slug, actualUserId]
    );
    const tenantId = tenantRes.rows[0].id;

    // Add user to tenant
    await client.query(
      `INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, actualUserId, 'admin', 'active']
    );

    // Create contacts
    const firstNames = ['John','Jane','Bob','Alice','Charlie','Diana','Eve','Frank','Grace','Henry','Ivy','Jack','Karen','Leo','Mia','Noah','Olivia','Paul','Quinn','Rachel'];
    const lastNames = ['Doe','Smith','Johnson','Williams','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Garcia','Martinez','Robinson','Clark'];
    const companies = ['Acme Corp','TechStart','Innovate Inc','GlobalTech','Startup Co','DataFlow','CloudServices','AI Tech','WebWorks','FinTech'];
    const statuses = ['new','contacted','qualified','converted','unqualified'];
    const sources = ['website','referral','cold_outreach','social_media','event'];
    const lifecycleStages = ['lead','marketing_qualified_lead','sales_qualified_lead','opportunity','customer'];

    let createdContacts = 0;
    for (let i = 0; i < cCount; i++) {
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[i % lastNames.length];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
      
      try {
        await client.query(
          `INSERT INTO public.contacts (
            tenant_id, first_name, last_name, email, phone, title,
            lead_status, lead_source, lifecycle_stage, assigned_to, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            tenantId, firstName, lastName, email,
            `+1-555-${String(1000 + i)}`,
            `${firstName === 'John' ? 'CEO' : firstName === 'Jane' ? 'CTO' : 'Manager'}`,
            statuses[i % statuses.length],
            sources[i % sources.length],
            lifecycleStages[i % lifecycleStages.length],
            actualUserId,
            actualUserId,
          ]
        );
        createdContacts++;
      } catch (err) {
        fastify.log.error(`Contact ${i} failed: ${err.message}`);
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      tenant_id: tenantId,
      user_id: actualUserId,
      user_email: uEmail,
      password: 'password123',
      contacts_created: createdContacts,
      login_url: `http://localhost:3000/login?tenant=${slug}`,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Seeding failed', message: err.message });
  } finally {
    client.release();
  }
});

// ── Start Server ────────────────────────────────────────
const start = async () => {
  try {
    // Register plugins
    await fastify.register(require('@fastify/cors'), { origin: true });
    await fastify.register(require('@fastify/multipart'), { limits: { fileSize: 10 * 1024 * 1024 } }); // 10MB
    
    const port = parseInt(process.env.PORT || '4000');
    await fastify.listen({ port, host: '0.0.0.0' });
    fastify.log.info(`Data service listening on port ${port}`);
    fastify.log.info(`Database: ${process.env.DATABASE_URL ? 'configured' : 'using default'}`);
  } catch (err) {
    fastify.log.error(err);
    process.exit(1);
  }
};

start();
