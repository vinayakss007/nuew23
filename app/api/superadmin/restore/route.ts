import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { query, queryOne } from '@/lib/db/client';
import { existsSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';

/**
 * Safely run pg_restore with input validation.
 * All parameters are validated to prevent command injection.
 */
async function runPgRestore(inputPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || (!dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://'))) {
    throw new Error('Invalid DATABASE_URL format');
  }

  if (!existsSync(inputPath)) {
    throw new Error(`Backup file not found: ${inputPath}`);
  }

  // Validate path is in allowed directories
  const allowedDirs = ['/tmp', process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups'];
  const isAllowed = allowedDirs.some(dir => inputPath.startsWith(dir));
  if (!isAllowed) {
    throw new Error('Restore path not in allowed directories');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pg_restore', [
      `--dbname=${dbUrl}`,
      '--no-owner',
      '--no-acl',
      '--clean',
      '--if-exists',
      inputPath,
    ], {
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_restore failed with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

// GET: list available backups for restore
export async function GET(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const backups = await query(
      `SELECT id, backup_type, status, size_bytes, storage_path, storage_type,
              duration_ms, created_at, completed_at, expires_at, metadata
       FROM public.backup_records
       WHERE status='completed'
       ORDER BY completed_at DESC LIMIT 30`
    );
    return NextResponse.json({ data: backups.rows });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

// POST: restore from a specific backup
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    if (!ctx.isSuperAdmin) return NextResponse.json({ error: 'Super admin required' }, { status: 403 });

    const { backup_id, confirm_restore } = await request.json();
    if (!backup_id) return NextResponse.json({ error: 'backup_id required' }, { status: 400 });
    if (!confirm_restore) {
      return NextResponse.json({
        error: 'Set confirm_restore: true to proceed. WARNING: This will overwrite all current data.',
        warning: true,
      }, { status: 400 });
    }

    const backup = await queryOne<any>(
      'SELECT id, backup_type, status, size_bytes, storage_path, storage_type, created_at FROM public.backup_records WHERE id=$1 AND status=$2',
      [backup_id, 'completed']
    );
    if (!backup) return NextResponse.json({ error: 'Backup not found' }, { status: 404 });

    const t0 = Date.now();

    // Log the restore attempt
    await query(
      `INSERT INTO public.error_logs (level, code, message)
       VALUES ('warn', 'RESTORE_INITIATED', $1)`,
      [`Database restore initiated from backup: ${backup.storage_path} by user ${ctx.userId}`]
    );

    let localPath = backup.storage_path;
    let tempFileCreated = false;

    // Download from S3 if needed (using AWS SDK instead of exec)
    if (['s3', 's3_r2'].includes(backup.storage_type)) {
      const { S3Client, GetObjectCommand } = await import('@aws-sdk/client-s3');
      const { writeFile } = await import('fs/promises');

      const tempPath = `/tmp/restore_${backup.id}.dump`;
      const s3Client = new S3Client({
        region: process.env.AWS_REGION || 'us-east-1',
        endpoint: process.env.AWS_ENDPOINT_URL || undefined,
      });

      const response = await s3Client.send(new GetObjectCommand({
        Bucket: process.env.BACKUP_BUCKET,
        Key: backup.storage_path,
      }));

      const fileBuffer = await response.Body?.transformToByteArray();
      if (!fileBuffer) {
        throw new Error('Failed to download backup from S3');
      }

      await writeFile(tempPath, fileBuffer);
      localPath = tempPath;
      tempFileCreated = true;
    }

    if (!existsSync(localPath)) {
      return NextResponse.json({ error: `Backup file not found: ${localPath}` }, { status: 404 });
    }

    // Restore using pg_restore with safe parameterized execution
    await runPgRestore(localPath);

    // Cleanup temp file
    if (tempFileCreated && existsSync(localPath)) {
      unlinkSync(localPath);
    }

    const durationMs = Date.now() - t0;

    // Log success
    await query(
      `INSERT INTO public.error_logs (level, code, message)
       VALUES ('info', 'RESTORE_COMPLETED', $1)`,
      [`Database restore completed from ${backup.storage_path} in ${durationMs}ms`]
    ).catch(() => {});

    return NextResponse.json({
      ok: true,
      message: `Database restored from backup: ${backup.storage_path}`,
      duration_ms: durationMs,
    });
  } catch (err: any) {
    console.error('[restore]', err);
    await query(
      `INSERT INTO public.error_logs (level, code, message, stack)
       VALUES ('fatal', 'RESTORE_FAILED', $1, $2)`,
      [err.message, err.stack?.slice(0, 2000)]
    ).catch(() => {});
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
