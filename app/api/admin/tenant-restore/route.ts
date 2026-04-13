import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requireAuth } from '@/lib/auth/middleware';
import { TenantDataExporter } from '@/lib/tenant-data-export';
import { TenantDataImporter } from '@/lib/tenant-data-import';

/**
 * Per-tenant backup/restore API
 * 
 * GET    /api/admin/tenant-restore?tenantId=xxx  → Get backup info for a tenant
 * POST   /api/admin/tenant-restore                → Backup a tenant's data
 * PUT    /api/admin/tenant-restore                → Restore a tenant's data from backup
 * DELETE /api/admin/tenant-restore?backupId=xxx   → Delete a tenant backup
 */

export async function GET(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const tenantId = searchParams.get('tenantId');
  const listBackups = searchParams.get('listBackups');
  const backupId = searchParams.get('backupId');

  try {
    // List all tenants with backup status
    if (!tenantId && !listBackups) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query(`
        SELECT 
          t.id, t.name, t.subdomain, t.slug, t.created_at,
          t.owner_id,
          u.email as owner_email,
          (SELECT COUNT(*) FROM tenant_backup_records WHERE tenant_id = t.id AND status = 'completed') as backup_count,
          (SELECT MAX(created_at) FROM tenant_backup_records WHERE tenant_id = t.id AND status = 'completed') as last_backup
        FROM tenants t
        LEFT JOIN users u ON t.owner_id = u.id
        ORDER BY t.created_at DESC
      `);
      await pool.end();
      return NextResponse.json({ tenants: result.rows });
    }

    // List backups for a specific tenant
    if (listBackups && tenantId) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query(
        `SELECT * FROM tenant_backup_records 
         WHERE tenant_id = $1 
         ORDER BY created_at DESC 
         LIMIT 50`,
        [tenantId]
      );
      await pool.end();
      return NextResponse.json({ backups: result.rows });
    }

    // Get details of a specific backup
    if (backupId) {
      const pool = new Pool({ connectionString: process.env.DATABASE_URL });
      const result = await pool.query(
        `SELECT tb.*, t.name as tenant_name, t.slug as tenant_slug
         FROM tenant_backup_records tb
         JOIN tenants t ON tb.tenant_id = t.id
         WHERE tb.id = $1`,
        [backupId]
      );
      await pool.end();
      if (result.rows.length === 0) {
        return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
      }
      return NextResponse.json({ backup: result.rows[0] });
    }

    return NextResponse.json({ error: 'Missing tenantId or listBackups parameter' }, { status: 400 });
  } catch (err: any) {
    console.error('[Tenant Restore GET] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { tenantId, includeTables, backupNote } = body;

    if (!tenantId) {
      return NextResponse.json({ error: 'tenantId is required' }, { status: 400 });
    }

    // Verify tenant exists
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const tenantResult = await pool.query(
      'SELECT id, name, subdomain, slug FROM tenants WHERE id = $1',
      [tenantId]
    );
    if (tenantResult.rows.length === 0) {
      await pool.end();
      return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
    }
    const tenant = tenantResult.rows[0];

    // Create backup record
    const backupResult = await pool.query(
      `INSERT INTO tenant_backup_records 
       (tenant_id, status, initiated_by, backup_note, include_tables, created_at)
       VALUES ($1, 'running', $2, $3, $4, NOW())
       RETURNING *`,
      [tenantId, ctx.userId, backupNote || null, includeTables ? JSON.stringify(includeTables) : null]
    );
    const backupRecord = backupResult.rows[0];

    await pool.end();

    // Start async backup (don't await — return immediately with backup ID)
    performTenantBackup(backupRecord.id, tenantId, includeTables).catch((err) => {
      console.error(`[Tenant Backup ${backupRecord.id}] Failed:`, err);
    });

    return NextResponse.json({
      message: 'Backup started',
      backupId: backupRecord.id,
      tenant: { id: tenant.id, name: tenant.name, subdomain: tenant.subdomain },
    });
  } catch (err: any) {
    console.error('[Tenant Restore POST] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  try {
    const body = await req.json();
    const { backupId, tenantId, confirmRestore, restoreOptions } = body;

    if (!confirmRestore) {
      return NextResponse.json({
        error: 'confirmRestore must be true',
        safetyCheck: 'You must explicitly confirm the restore operation',
      }, { status: 400 });
    }

    if (!backupId && !tenantId) {
      return NextResponse.json({ error: 'backupId or tenantId is required' }, { status: 400 });
    }

    const pool = new Pool({ connectionString: process.env.DATABASE_URL });

    // If backupId provided, restore from that specific backup
    if (backupId) {
      const backupResult = await pool.query(
        `SELECT * FROM tenant_backup_records WHERE id = $1 AND status = 'completed'`,
        [backupId]
      );
      if (backupResult.rows.length === 0) {
        await pool.end();
        return NextResponse.json({ error: 'Backup not found or not completed' }, { status: 404 });
      }
      const backup = backupResult.rows[0];
      const targetTenantId = backup.tenant_id;

      // Verify tenant still exists
      const tenantResult = await pool.query(
        'SELECT id, name, subdomain FROM tenants WHERE id = $1',
        [targetTenantId]
      );
      if (tenantResult.rows.length === 0) {
        await pool.end();
        return NextResponse.json({ error: 'Tenant no longer exists' }, { status: 404 });
      }

      await pool.end();

      // Start async restore
      const restoreRecord = await performTenantRestore(
        backupId,
        targetTenantId,
        restoreOptions || {}
      );

      return NextResponse.json({
        message: 'Restore started',
        restoreId: restoreRecord.id,
        tenant: tenantResult.rows[0],
      });
    }

    // If tenantId provided, restore from latest backup
    if (tenantId) {
      const latestBackup = await pool.query(
        `SELECT * FROM tenant_backup_records 
         WHERE tenant_id = $1 AND status = 'completed' 
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId]
      );
      if (latestBackup.rows.length === 0) {
        await pool.end();
        return NextResponse.json({ error: 'No completed backup found for this tenant' }, { status: 404 });
      }

      const tenantResult = await pool.query(
        'SELECT id, name, subdomain FROM tenants WHERE id = $1',
        [tenantId]
      );
      if (tenantResult.rows.length === 0) {
        await pool.end();
        return NextResponse.json({ error: 'Tenant not found' }, { status: 404 });
      }

      await pool.end();

      const restoreRecord = await performTenantRestore(
        latestBackup.rows[0].id,
        tenantId,
        restoreOptions || {}
      );

      return NextResponse.json({
        message: 'Restore started from latest backup',
        restoreId: restoreRecord.id,
        tenant: tenantResult.rows[0],
      });
    }

    await pool.end();
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
  } catch (err: any) {
    console.error('[Tenant Restore PUT] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;
  if (!ctx.isSuperAdmin) {
    return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const backupId = searchParams.get('backupId');

  if (!backupId) {
    return NextResponse.json({ error: 'backupId is required' }, { status: 400 });
  }

  try {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    const result = await pool.query(
      'DELETE FROM tenant_backup_records WHERE id = $1 RETURNING *',
      [backupId]
    );
    await pool.end();

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'Backup not found' }, { status: 404 });
    }

    return NextResponse.json({ message: 'Backup deleted', backupId });
  } catch (err: any) {
    console.error('[Tenant Restore DELETE] Error:', err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── Background Backup Function ──────────────────────────────────────────────

async function performTenantBackup(backupId: string, tenantId: string, includeTables?: string[]) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const startTime = Date.now();

  try {
    const exporter = new TenantDataExporter(pool, tenantId);
    const result = await exporter.exportAll(includeTables);

    const duration = Date.now() - startTime;

    await pool.query(
      `UPDATE tenant_backup_records 
       SET status = 'completed',
           data_size = $1,
           table_count = $2,
           record_count = $3,
           backup_data = $4,
           duration_ms = $5,
           completed_at = NOW()
       WHERE id = $6`,
      [result.dataSize, result.tableCount, result.totalRecords, JSON.stringify(result.tables), duration, backupId]
    );

    console.log(`[Tenant Backup ${backupId}] Completed: ${result.tableCount} tables, ${result.totalRecords} records, ${result.dataSize} bytes`);
  } catch (err: any) {
    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE tenant_backup_records 
       SET status = 'failed', error_message = $1, duration_ms = $2, completed_at = NOW()
       WHERE id = $3`,
      [err.message, duration, backupId]
    );
    throw err;
  } finally {
    await pool.end();
  }
}

// ── Background Restore Function ─────────────────────────────────────────────

async function performTenantRestore(backupId: string, tenantId: string, options: any = {}) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });

  // Create restore record
  const restoreResult = await pool.query(
    `INSERT INTO tenant_restore_records 
     (backup_id, tenant_id, status, restore_options, initiated_at)
     VALUES ($1, $2, 'running', $3, NOW())
     RETURNING *`,
    [backupId, tenantId, JSON.stringify(options)]
  );
  const restoreRecord = restoreResult.rows[0];
  await pool.end();

  // Run restore in background
  runTenantRestore(restoreRecord.id, backupId, tenantId, options).catch((err) => {
    console.error(`[Tenant Restore ${restoreRecord.id}] Failed:`, err);
  });

  return restoreRecord;
}

async function runTenantRestore(restoreId: string, backupId: string, tenantId: string, options: any = {}) {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const startTime = Date.now();
  const { deleteExisting = false, skipTables = [] } = options;

  try {
    // Get backup data
    const backupResult = await pool.query(
      `SELECT * FROM tenant_backup_records WHERE id = $1 AND status = 'completed'`,
      [backupId]
    );
    if (backupResult.rows.length === 0) {
      throw new Error('Backup not found or not completed');
    }
    const backup = backupResult.rows[0];
    const tables = JSON.parse(backup.backup_data);

    const importer = new TenantDataImporter(pool, tenantId);

    if (deleteExisting) {
      await importer.deleteExistingData(skipTables);
    }

    const result = await importer.importAll(tables);

    const duration = Date.now() - startTime;

    await pool.query(
      `UPDATE tenant_restore_records 
       SET status = 'completed',
           tables_restored = $1,
           records_restored = $2,
           duration_ms = $3,
           completed_at = NOW()
       WHERE id = $4`,
      [result.tablesRestored, result.recordsRestored, duration, restoreId]
    );

    console.log(`[Tenant Restore ${restoreId}] Completed: ${result.tablesRestored} tables, ${result.recordsRestored} records restored`);
  } catch (err: any) {
    const duration = Date.now() - startTime;
    await pool.query(
      `UPDATE tenant_restore_records 
       SET status = 'failed', error_message = $1, duration_ms = $3, completed_at = NOW()
       WHERE id = $4`,
      [err.message, {}, duration, restoreId]
    );
    throw err;
  } finally {
    await pool.end();
  }
}
