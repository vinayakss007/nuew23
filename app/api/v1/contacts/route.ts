/**
 * GET /api/v1/contacts - List contacts
 * POST /api/v1/contacts - Create contact
 */

import { NextRequest, NextResponse } from 'next/server';
import { queryMany, queryOne, buildInsert } from '@/lib/db/client';
import { requireAuth } from '@/lib/auth/require-auth';
import { rateLimiter, limiters } from '@/lib/rate-limit';
import { handleError, ValidationError, NotFoundError } from '@/lib/errors';
import { devLogger } from '@/lib/dev-logger';

/**
 * GET /api/v1/contacts
 * List all contacts for current tenant
 */
export async function GET(request: NextRequest) {
  try {
    // Authenticate and get tenant context
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    // Rate limiting
    const rateCheck = await limiters.contacts.check(`contacts:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429, headers: { 'Retry-After': String(rateCheck.reset) } }
      );
    }

    // Parse query params
    const { searchParams } = new URL(request.url);
    const limit = parseInt(searchParams.get('limit') || '50');
    const offset = parseInt(searchParams.get('offset') || '0');
    const search = searchParams.get('search') || '';

    // Build query with tenant isolation
    let sql = `
      SELECT c.*, e.email, e.phone, p.company_name
      FROM public.contacts c
      LEFT JOIN public.contact_emails e ON e.contact_id = c.id AND e.is_primary = true
      LEFT JOIN public.companies p ON p.id = c.company_id
      WHERE c.tenant_id = $1
        AND c.deleted_at IS NULL
    `;
    
    const params: any[] = [ctx.tenantId];
    
    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (c.first_name ILIKE $${params.length} OR c.last_name ILIKE $${params.length} OR c.email ILIKE $${params.length})`;
    }
    
    sql += ` ORDER BY c.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const contacts = await queryMany(sql, params);

    // Get total count
    const countSql = `
      SELECT count(*)::int as count
      FROM public.contacts
      WHERE tenant_id = $1 AND deleted_at IS NULL
    `;
    const countResult = await queryOne<{ count: number }>(countSql, [ctx.tenantId]);

    devLogger.request('GET', '/api/v1/contacts', 200, 0, undefined, ctx.userId);

    return NextResponse.json({
      data: contacts,
      pagination: {
        total: countResult?.count || 0,
        limit,
        offset,
        hasMore: (countResult?.count || 0) > offset + limit,
      },
    });
  } catch (error) {
    devLogger.error(error as Error, 'GET /api/v1/contacts');
    return handleError(error);
  }
}

/**
 * POST /api/v1/contacts
 * Create a new contact
 */
export async function POST(request: NextRequest) {
  try {
    const ctx = await requireAuth(request);
    if (ctx instanceof NextResponse) return ctx;
    
    // Rate limiting
    const rateCheck = await limiters.contacts.check(`contacts:${ctx.tenantId}`);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: 'Rate limit exceeded', code: 'RATE_LIMIT_EXCEEDED' },
        { status: 429 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.first_name || !body.last_name) {
      throw new ValidationError('first_name and last_name are required');
    }

    if (!body.email) {
      throw new ValidationError('email is required');
    }

    // Insert contact
    const contactData = {
      tenant_id: ctx.tenantId,
      created_by: ctx.userId,
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone,
      company_id: body.company_id,
      title: body.title,
      owner_id: body.owner_id || ctx.userId,
      source: body.source || 'manual',
      status: body.status || 'new',
    };

    const insert = buildInsert('contacts', contactData);
    const result = await queryOne(insert.sql, insert.values);

    if (!result) {
      throw new Error('Failed to create contact');
    }

    devLogger.request('POST', '/api/v1/contacts', 201, 0, undefined, ctx.userId);

    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) {
    devLogger.error(error as Error, 'POST /api/v1/contacts');
    return handleError(error);
  }
}
