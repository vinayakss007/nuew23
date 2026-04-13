/**
 * File Attachments API
 * POST /api/tenant/files  (multipart/form-data)
 *   Fields: file, resource_type (contact|deal|company|task), resource_id
 *   Storage: local disk in dev, S3/R2 in production
 *
 * GET /api/tenant/files?resource_type=contact&resource_id=uuid
 *   Returns list of attachments for a record
 *
 * DELETE /api/tenant/files?id=uuid
 */
import { NextRequest, NextResponse } from 'next/server';
import { requireAuth, requirePerm } from '@/lib/auth/middleware';
import { queryMany, query, queryOne } from '@/lib/db/client';
import { logAudit } from '@/lib/audit';
import { writeFile, mkdir } from 'fs/promises';
import { join, extname } from 'path';
import { randomBytes } from 'crypto';

const ALLOWED_TYPES = new Set([
  'image/jpeg','image/png','image/gif','image/webp','image/svg+xml',
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv',
]);

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
const RESOURCE_TYPES = ['contact','deal','company','task','note'];

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const { searchParams } = new URL(req.url);
    const resource_type = searchParams.get('resource_type');
    const resource_id   = searchParams.get('resource_id');
    if (!resource_type || !resource_id) return NextResponse.json({ error: 'resource_type and resource_id required' }, { status: 400 });

    const files = await queryMany(
      `SELECT id, filename, original_name, mime_type, size_bytes, storage_type, created_at,
              u.full_name as uploaded_by_name
       FROM public.file_attachments fa
       JOIN public.users u ON u.id = fa.uploaded_by
       WHERE fa.tenant_id=$1 AND fa.resource_type=$2 AND fa.resource_id=$3
       ORDER BY fa.created_at DESC`,
      [ctx.tenantId, resource_type, resource_id]
    );
    return NextResponse.json({ data: files });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const formData = await req.formData();
    const file         = formData.get('file') as File | null;
    const resource_type = formData.get('resource_type') as string | null;
    const resource_id   = formData.get('resource_id') as string | null;

    if (!file) return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    if (!resource_type || !RESOURCE_TYPES.includes(resource_type)) {
      return NextResponse.json({ error: `resource_type must be one of: ${RESOURCE_TYPES.join(', ')}` }, { status: 400 });
    }
    if (!resource_id) return NextResponse.json({ error: 'resource_id required' }, { status: 400 });
    if (file.size > MAX_FILE_SIZE) return NextResponse.json({ error: 'File too large (max 25 MB)' }, { status: 413 });
    if (!ALLOWED_TYPES.has(file.type)) {
      return NextResponse.json({ error: 'File type not allowed' }, { status: 415 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // Check plan storage quota (rough check)
    const usage = await queryOne<any>(
      'SELECT storage_used_bytes FROM public.tenants WHERE id=$1',
      [ctx.tenantId]
    );
    const usedGb = (usage?.storage_used_bytes ?? 0) / (1024 ** 3);
    // Get plan limit
    const plan = await queryOne<any>(
      'SELECT max_storage_gb FROM public.plans p JOIN public.tenants t ON t.plan_id=p.id WHERE t.id=$1',
      [ctx.tenantId]
    );
    if (plan && plan.max_storage_gb > 0 && usedGb >= plan.max_storage_gb) {
      return NextResponse.json({ error: `Storage limit (${plan.max_storage_gb} GB) reached. Upgrade your plan.` }, { status: 403 });
    }

    let storagePath: string;
    let storageType = 'local';

    const ext = extname(file.name).toLowerCase() || '.bin';
    const filename = `${randomBytes(16).toString('hex')}${ext}`;

    // S3/R2 upload if configured
    const useS3 = !!(process.env.AWS_ACCESS_KEY_ID || process.env.R2_ACCESS_KEY_ID);
    if (useS3) {
      // S3/R2 upload via fetch (lightweight, no AWS SDK)
      const bucket   = process.env.R2_BUCKET || process.env.AWS_S3_BUCKET || 'nucrm-files';
      const region   = process.env.AWS_REGION || 'auto';
      const endpoint = process.env.R2_ACCOUNT_ID
        ? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
        : `https://s3.${region}.amazonaws.com`;
      const key = `${ctx.tenantId}/${resource_type}/${resource_id}/${filename}`;
      const uploadUrl = `${endpoint}/${bucket}/${key}`;
      storagePath = key;
      storageType = process.env.R2_ACCOUNT_ID ? 'r2' : 's3';
      // Pre-signed upload would normally go here — simplified for now
      // In production, use @aws-sdk/client-s3 or Cloudflare Workers Binding
      console.warn('[files] S3/R2 upload not yet implemented — storing locally');
      storageType = 'local';
    }

    // Local storage (dev + fallback)
    const uploadDir = join(process.cwd(), 'uploads', ctx.tenantId, resource_type, resource_id);
    await mkdir(uploadDir, { recursive: true });
    const localPath = join(uploadDir, filename);
    await writeFile(localPath, buffer);
    storagePath = `uploads/${ctx.tenantId}/${resource_type}/${resource_id}/${filename}`;

    // Save to DB
    const { rows:[attachment] } = await query(
      `INSERT INTO public.file_attachments
         (tenant_id, uploaded_by, resource_type, resource_id, filename, original_name, mime_type, size_bytes, storage_path, storage_type)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [ctx.tenantId, ctx.userId, resource_type, resource_id, filename,
       file.name.slice(0, 255), file.type, file.size, storagePath, storageType]
    );

    // Update storage usage
    await query(
      'UPDATE public.tenants SET storage_used_bytes=storage_used_bytes+$1 WHERE id=$2',
      [file.size, ctx.tenantId]
    ).catch(() => {});

    await logAudit({
      tenantId: ctx.tenantId, userId: ctx.userId,
      action: 'upload', resourceType: 'file', resourceId: attachment.id,
      newData: { original_name: file.name, size: file.size, resource_type, resource_id },
    });

    return NextResponse.json({ data: attachment }, { status: 201 });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}

export async function DELETE(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;
    const id = new URL(req.url).searchParams.get('id');
    if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

    const file = await queryOne<any>(
      'SELECT id, tenant_id, name, mime_type, size, url, uploaded_by, created_at FROM public.file_attachments WHERE id=$1 AND tenant_id=$2',
      [id, ctx.tenantId]
    );
    if (!file) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    // Delete from DB
    await query('DELETE FROM public.file_attachments WHERE id=$1', [id]);
    // Update storage usage
    await query(
      'UPDATE public.tenants SET storage_used_bytes=GREATEST(0,storage_used_bytes-$1) WHERE id=$2',
      [file.size_bytes, ctx.tenantId]
    ).catch(() => {});

    await logAudit({ tenantId: ctx.tenantId, userId: ctx.userId, action:'delete', resourceType:'file', resourceId: id });
    return NextResponse.json({ ok: true });
  } catch (err: any) { return NextResponse.json({ error: err.message }, { status: 500 }); }
}
