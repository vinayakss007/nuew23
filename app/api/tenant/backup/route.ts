import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryMany } from '@/lib/db/client';

/**
 * GET /api/tenant/backup
 * List backup history for the current tenant.
 * Shows both tenant-specific and global backups.
 */
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;

    // FIX CRITICAL-05: Added tenant_id filter to prevent cross-tenant data leak
    const backups = await queryMany(
      `SELECT id, backup_type, status, size_bytes, storage_path, storage_type,
              duration_ms, error_message, initiated_auto, created_at, completed_at
       FROM public.backup_records
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT 50`,
      [ctx.tenantId]
    );

    return NextResponse.json({ backups });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

/**
 * POST /api/tenant/backup
 * Trigger a manual backup for the current tenant.
 * Validates that backup config exists, then runs pg_dump and uploads to S3.
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 });
    }

    // Check tenant backup config exists
    const configRow = await query(
      `SELECT key, value FROM public.platform_settings WHERE key = $1`,
      [`tenant_backup_config:${ctx.tenantId}`]
    );

    let config: Record<string, string> = {};
    for (const row of configRow.rows) {
      config[row.key] = row.value;
    }

    const hasConfig = config[`tenant_backup_config:${ctx.tenantId}`];
    if (!hasConfig) {
      return NextResponse.json(
        { error: 'Backup storage not configured. Save your object storage settings first.' },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const backupType = body.backup_type === 'schema' ? 'schema' : 'full';

    // We delegate to the cron backup route which has the full pg_dump + S3 logic.
    // The cron route uses platform env vars for S3; for tenant-level, we'd need
    // a separate implementation. For now, we create the backup record and
    // call the internal backup logic.

    // For a proper implementation, the backup cron route should be refactored to
    // accept tenant-specific S3 config. Here we do a simplified version:
    // create the backup record so it shows in history.
    const { rows: [backup] } = await query(
      `INSERT INTO public.backup_records (tenant_id, backup_type, status, initiated_by, initiated_auto, expires_at)
       VALUES ($1, $2, 'running', $3, false, now() + interval '30 days')
       RETURNING id, backup_type, status, initiated_auto, created_at`,
      [ctx.tenantId, backupType, ctx.userId]
    );

    // Run backup using the cron endpoint (which uses server-level S3 config)
    // FIX MEDIUM-06: Add timeout and ensure backup record is updated on ANY failure
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 min timeout

      const cronRes = await fetch(`${baseUrl}/api/cron/backup?type=${backupType}`, {
        method: 'POST',
        headers: { 'x-cron-secret': process.env.CRON_SECRET || '' },
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      if (cronRes.ok) {
        const cronData = await cronRes.json();
        await query(
          `UPDATE public.backup_records SET status='completed', completed_at=now(), size_bytes=$1 WHERE id=$2`,
          [cronData.size_bytes || 0, backup.id]
        );
        return NextResponse.json({
          ok: true,
          backup: { ...backup, ...cronData },
          message: 'Backup completed successfully',
        });
      } else {
        const cronError = await cronRes.json().catch(() => ({}));
        await query(
          `UPDATE public.backup_records SET status='failed', error_message=$1, completed_at=now() WHERE id=$2`,
          [cronError.error || 'Backup cron returned error', backup.id]
        );
        return NextResponse.json({ error: cronError.error || 'Backup failed' }, { status: 500 });
      }
    } catch (cronErr: any) {
      // FIX MEDIUM-06: Mark backup as failed on ANY error (timeout, network, etc.)
      const errorMsg = cronErr.name === 'AbortError' 
        ? 'Backup timed out after 5 minutes' 
        : cronErr.message.slice(0, 500);
      await query(
        `UPDATE public.backup_records SET status='failed', error_message=$1, completed_at=now() WHERE id=$2`,
        [errorMsg, backup.id]
      );
      return NextResponse.json({ error: 'Failed to run backup: ' + errorMsg }, { status: 500 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
