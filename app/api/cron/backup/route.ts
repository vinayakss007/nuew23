import { verifySecret } from '@/lib/crypto';
import { NextRequest, NextResponse } from 'next/server';
import { query, queryOne } from '@/lib/db/client';
import { alertSuperAdmin } from '@/lib/email/service';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { statSync, writeFileSync } from 'fs';
import { spawn } from 'child_process';
import { Pool } from 'pg';

const exec = promisify(execCb);

/**
 * Safely run pg_dump with input validation.
 * All parameters are validated against allowlists to prevent command injection.
 */
async function runPgDump(backupType: 'full' | 'schema', outputPath: string): Promise<void> {
  // Validate DATABASE_URL format
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    throw new Error('Invalid DATABASE_URL format');
  }

  // Validate backup type
  if (!['full', 'schema'].includes(backupType)) {
    throw new Error('Invalid backup type');
  }

  // Validate output path - must be a safe absolute path
  if (!outputPath.startsWith('/tmp/') && !outputPath.startsWith(process.env.BACKUP_LOCAL_DIR || '/invalid')) {
    throw new Error('Invalid output path');
  }

  const args = [
    dbUrl,
    '--no-owner',
    '--no-acl',
    '--format=custom',
    '--compress=9',
    '-f', outputPath,
  ];

  if (backupType === 'schema') {
    args.push('--schema-only');
  }

  return new Promise((resolve, reject) => {
    const child = spawn('pg_dump', args, {
      timeout: 600_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stderr = '';
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`pg_dump failed with code ${code}: ${stderr.slice(0, 500)}`));
    });
  });
}

/**
 * Safely run pg_restore with input validation.
 */
async function runPgRestore(inputPath: string): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith('postgresql://') && !dbUrl.startsWith('postgres://')) {
    throw new Error('Invalid DATABASE_URL format');
  }

  // Validate input path exists and is a file
  if (!existsSync(inputPath)) {
    throw new Error(`Backup file not found: ${inputPath}`);
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

/**
 * Safely run pg_dump --version
 */
async function getPgDumpVersion(): Promise<string> {
  try {
    const { stdout } = await exec('pg_dump --version');
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

// Called daily by cron — runs pg_dump, uploads to S3/R2 or keeps local
export async function POST(request: NextRequest) {
  const secret = request.headers.get('x-cron-secret');
  if (!verifySecret(secret, process.env.CRON_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const backupType = new URL(request.url).searchParams.get('type') || 'full';
  const t0 = Date.now();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `nucrm_${backupType}_${timestamp}.dump`;
  const localDir = process.env.BACKUP_LOCAL_DIR || '/tmp/nucrm-backups';
  const localPath = `${localDir}/${filename}`;

  // Create backup record
  const { rows: [backup] } = await query(
    `INSERT INTO public.backup_records (backup_type, status, initiated_auto, expires_at)
     VALUES ($1, 'running', true, now() + interval '30 days') RETURNING id`,
    [backupType]
  );

  try {
    // Ensure local backup dir exists
    if (!existsSync(localDir)) mkdirSync(localDir, { recursive: true });

    // Run pg_dump with safe parameterized execution
    await runPgDump(backupType as 'full' | 'schema', localPath);

    const sizeBytes = statSync(localPath).size;
    const durationMs = Date.now() - t0;

    let storagePath = localPath;
    let storageType = 'local';

    // Upload to S3/R2 if configured (using AWS SDK instead of exec)
    if (process.env.BACKUP_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
      try {
        const { S3Client, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } = await import('@aws-sdk/client-s3');
        const { readFile } = await import('fs/promises');

        const s3Client = new S3Client({
          region: process.env.AWS_REGION || 'us-east-1',
          endpoint: process.env.AWS_ENDPOINT_URL || undefined,
        });

        const fileContent = await readFile(localPath);
        const s3Key = `backups/${filename}`;

        await s3Client.send(new PutObjectCommand({
          Bucket: process.env.BACKUP_BUCKET,
          Key: s3Key,
          Body: fileContent,
          StorageClass: 'STANDARD_IA',
        }));

        storagePath = s3Key;
        storageType = process.env.AWS_ENDPOINT_URL?.includes('r2') ? 's3_r2' : 's3';

        // Delete local after successful upload
        unlinkSync(localPath);

        // Purge old S3 backups beyond retention
        const retention = parseInt(process.env.BACKUP_RETENTION_DAYS || '30');
        const cutoff = new Date(Date.now() - retention * 86400000);

        const listResp = await s3Client.send(new ListObjectsV2Command({
          Bucket: process.env.BACKUP_BUCKET,
          Prefix: 'backups/',
        }));

        const oldKeys = (listResp.Contents || [])
          .filter(obj => obj.LastModified && obj.LastModified < cutoff && obj.Key)
          .map(obj => ({ Key: obj.Key! }));

        if (oldKeys.length > 0) {
          await s3Client.send(new DeleteObjectsCommand({
            Bucket: process.env.BACKUP_BUCKET,
            Delete: { Objects: oldKeys },
          })).catch(() => {});
        }
      } catch (uploadErr: any) {
        console.error('[backup] S3 upload failed, keeping local:', uploadErr.message);
        storageType = 'local';
      }
    }

    // Mark completed
    await query(
      `UPDATE public.backup_records
       SET status='completed', size_bytes=$1, storage_path=$2, storage_type=$3,
           duration_ms=$4, completed_at=now(),
           metadata=jsonb_build_object('pg_version', $5, 'backup_type', $6)
       WHERE id=$7`,
      [sizeBytes, storagePath, storageType, durationMs,
       await getPgDumpVersion(),
       backupType, backup.id]
    );

    // Clear any backup alerts
    await query(
      `UPDATE public.backup_alerts SET resolved=true WHERE alert_type='no_backup' AND resolved=false`
    ).catch(() => {});

    console.log(`[backup] completed: ${filename} (${(sizeBytes/1024/1024).toFixed(1)}MB, ${durationMs}ms)`);
    return NextResponse.json({
      ok: true, filename, size_bytes: sizeBytes, duration_ms: durationMs, storage: storageType,
    });

  } catch (err: any) {
    const durationMs = Date.now() - t0;
    console.error('[backup] FAILED:', err.message);

    await query(
      `UPDATE public.backup_records SET status='failed', error_message=$1, duration_ms=$2 WHERE id=$3`,
      [err.message.slice(0, 500), durationMs, backup.id]
    );

    // Log to error_logs
    await query(
      `INSERT INTO public.error_logs (level, code, message, stack)
       VALUES ('fatal', 'BACKUP_FAILED', $1, $2)`,
      [`Automated backup failed: ${err.message}`, err.stack?.slice(0, 2000)]
    ).catch(() => {});

    // Alert super admin
    await alertSuperAdmin(
      'CRITICAL: Automated Database Backup FAILED',
      `Time: ${new Date().toISOString()}\nError: ${err.message}\n\nManual backup required immediately:\n1. Check database connection\n2. Check disk space\n3. Run backup manually from superadmin console`
    ).catch(() => {});

    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
