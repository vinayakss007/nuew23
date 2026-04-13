/**
 * GET /api/v1/contacts/[id] - Get contact by ID
 * PUT /api/v1/contacts/[id] - Update contact
 * DELETE /api/v1/contacts/[id] - Delete contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryOne, buildUpdate, query } from '@/lib/db/client';
import { requireAuth } from '@/lib/auth/require-auth';
import { handleError, NotFoundError, ForbiddenError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/v1/contacts/[id]
 */
export async function GET(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    const contact = await queryOne(
      `SELECT c.*, e.email, e.phone, p.company_name
       FROM public.contacts c
       LEFT JOIN public.contact_emails e ON e.contact_id = c.id AND e.is_primary = true
       LEFT JOIN public.companies p ON p.id = c.company_id
       WHERE c.id = $1 AND c.tenant_id = $2 AND c.deleted_at IS NULL`,
      [id, ctx.tenantId]
    );

    if (!contact) {
      throw new NotFoundError('Contact');
    }

    devLogger.request('GET', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: contact });
  } catch (error) {
    devLogger.error(error as Error, `GET /api/v1/contacts/${(await params).id}`);
    return handleError(error);
  }
}

/**
 * PUT /api/v1/contacts/[id]
 */
export async function PUT(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;
    const body = await request.json();

    // Verify contact exists and belongs to tenant
    const existing = await queryOne(
      'SELECT id, tenant_id, first_name, last_name, email, phone, company_name, title, avatar_url, tags, lead_status, score, lifecycle_stage, lead_source, owner_id, custom_fields, created_at, updated_at, last_contacted_at, deleted_at FROM public.contacts WHERE id = $1 AND tenant_id = $2',
      [id, ctx.tenantId]
    );

    if (!existing) {
      throw new NotFoundError('Contact');
    }

    // Update allowed fields
    const updateData: any = {};
    const allowedFields = ['first_name', 'last_name', 'email', 'phone', 'company_id', 'title', 'owner_id', 'status', 'source'];
    
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateData[field] = body[field];
      }
    }

    const update = buildUpdate('contacts', updateData, { id, tenant_id: ctx.tenantId });
    const result = await queryOne(update.sql, update.values);

    devLogger.request('PUT', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    return NextResponse.json({ data: result });
  } catch (error) {
    devLogger.error(error as Error, `PUT /api/v1/contacts/${(await params).id}`);
    return handleError(error);
  }
}

/**
 * DELETE /api/v1/contacts/[id]
 * Soft delete
 */
export async function DELETE(request: NextRequest, { params }: any) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    const { id } = await params;

    // Soft delete - set deleted_at
    const result = await query(
      `UPDATE public.contacts 
       SET deleted_at = now(), deleted_by = $1 
       WHERE id = $2 AND tenant_id = $3 AND deleted_at IS NULL`,
      [ctx.userId, id, ctx.tenantId]
    );

    if ((result.rowCount || 0) === 0) {
      throw new NotFoundError('Contact');
    }

    devLogger.request('DELETE', `/api/v1/contacts/${id}`, 200, 0, undefined, ctx.userId);

    return NextResponse.json({ success: true });
  } catch (error) {
    devLogger.error(error as Error, `DELETE /api/v1/contacts/${(await params).id}`);
    return handleError(error);
  }
}
