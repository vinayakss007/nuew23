import { NextRequest, NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth/middleware';
import { queryMany, queryOne } from '@/lib/db/client';

/**
 * Dynamic Custom Fields API
 * 
 * This is the KEY to the "no migration" approach:
 * - Tenants define custom fields here
 * - Values are stored in JSONB metadata — no ALTER TABLE needed
 * - Features register themselves automatically
 * - New features work INSTANTLY without any database changes
 * 
 * Endpoints:
 *   GET    /api/tenant/custom-fields?entityType=contact     — List custom fields
 *   POST   /api/tenant/custom-fields                        — Create custom field
 *   PUT    /api/tenant/custom-fields/:id                    — Update custom field
 *   DELETE /api/tenant/custom-fields/:id                    — Delete custom field
 *   POST   /api/tenant/custom-fields/:entityType/:id/value  — Set a custom field value
 *   GET    /api/tenant/custom-fields/:entityType/:id/values — Get all custom field values
 * 
 * Feature Registration:
 *   POST   /api/tenant/custom-fields/register-feature        — Register a feature
 *   GET    /api/tenant/custom-fields/features                — List registered features
 */

// ── GET: List custom fields for an entity type ──────────────────────────────

export async function GET(req: NextRequest) {
  try {
    const ctx = await requireAuth(req);
    if (ctx instanceof NextResponse) return ctx;

    const { searchParams } = new URL(req.url);
    const entityType = searchParams.get('entityType');
    const action = searchParams.get('action');

    // List registered features
    if (action === 'features') {
      const features = await queryMany(
        `SELECT * FROM feature_registry WHERE enabled = true ORDER BY registered_at DESC`
      );
      return NextResponse.json({ features });
    }

    // Get all custom field values for a specific entity
    if (action === 'values') {
      const entityId = searchParams.get('entityId');
      if (!entityId || !entityType) {
        return NextResponse.json({ error: 'entityType and entityId required' }, { status: 400 });
      }

      const tableName = getTableName(entityType);
      if (!tableName) {
        return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
      }

      const result = await queryOne(
        `SELECT id, metadata FROM public.${tableName} WHERE id = $1 AND tenant_id = $2`,
        [entityId, ctx.tenantId]
      );

      if (!result) {
        return NextResponse.json({ error: 'Entity not found' }, { status: 404 });
      }

      // Get field definitions to provide labels/types
      const fieldDefs = await queryMany(
        `SELECT field_key, field_label, field_type, field_options FROM custom_field_defs
         WHERE tenant_id = $1 AND entity_type = $2
         ORDER BY display_order`,
        [ctx.tenantId, entityType]
      );

      const fieldMap: Record<string, any> = {};
      for (const def of fieldDefs) {
        fieldMap[def.field_key] = {
          label: def.field_label,
          type: def.field_type,
          options: def.field_options,
          value: (result.metadata || {})[def.field_key] ?? null,
        };
      }

      // Also include any metadata keys that don't have field definitions
      const metadata = result.metadata || {};
      for (const [key, value] of Object.entries(metadata)) {
        if (!fieldMap[key]) {
          fieldMap[key] = {
            label: key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
            type: typeof value,
            value,
          };
        }
      }

      return NextResponse.json({ entityId, entityType, fields: fieldMap });
    }

    // List custom field definitions
    if (!entityType) {
      // Return all entity types available
      return NextResponse.json({
        entityTypes: ['contact', 'deal', 'company', 'lead', 'task'],
        hint: 'Add ?entityType=contact to list custom fields',
      });
    }

    const fields = await queryMany(
      `SELECT * FROM custom_field_defs
       WHERE tenant_id = $1 AND entity_type = $2
       ORDER BY display_order`,
      [ctx.tenantId, entityType]
    );

    return NextResponse.json({ entityType, fields });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ── POST: Create custom field or set value or register feature ──────────────

export async function POST(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  // Register a feature (auto-schema evolution)
  if (action === 'register-feature') {
    if (!ctx.isSuperAdmin) {
      return NextResponse.json({ error: 'Super admin only' }, { status: 403 });
    }

    const body = await req.json();
    const { featureName, description, version, metadataKeys, entities, requiresTables } = body;

    if (!featureName) {
      return NextResponse.json({ error: 'featureName is required' }, { status: 400 });
    }

    await queryMany(
      `SELECT public.register_feature($1, $2, $3, $4, $5, $6)`,
      [
        featureName,
        description || null,
        version || '1.0.0',
        metadataKeys ? JSON.stringify(metadataKeys) : '[]',
        entities ? JSON.stringify(entities) : '[]',
        requiresTables ? JSON.stringify(requiresTables) : '[]',
      ]
    );

    return NextResponse.json({
      message: `Feature '${featureName}' registered`,
      feature: { featureName, description, version, metadataKeys, entities, requiresTables },
    });
  }

  // Set a custom field value on an entity
  if (action === 'set-value') {
    const body = await req.json();
    const { entityType, entityId, fieldKey, value } = body;

    if (!entityType || !entityId || !fieldKey) {
      return NextResponse.json({ error: 'entityType, entityId, and fieldKey are required' }, { status: 400 });
    }

    const tableName = getTableName(entityType);
    if (!tableName) {
      return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
    }

    // Verify ownership
    const entity = await queryOne(
      `SELECT id FROM public.${tableName} WHERE id = $1 AND tenant_id = $2`,
      [entityId, ctx.tenantId]
    );
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found or not owned' }, { status: 404 });
    }

    // Update metadata JSONB column
    await queryMany(
      `UPDATE public.${tableName} 
       SET metadata = jsonb_set(
         COALESCE(metadata, '{}'::jsonb),
         ARRAY[$1],
         to_jsonb($2),
         true
       )
       WHERE id = $3`,
      [fieldKey, value, entityId]
    );

    return NextResponse.json({
      message: `Custom field '${fieldKey}' set on ${entityType}`,
      entityType,
      entityId,
      fieldKey,
      value,
    });
  }

  // Bulk set multiple custom fields at once
  if (action === 'set-bulk') {
    const body = await req.json();
    const { entityType, entityId, fields } = body;

    if (!entityType || !entityId || !fields || typeof fields !== 'object') {
      return NextResponse.json({ error: 'entityType, entityId, and fields object are required' }, { status: 400 });
    }

    const tableName = getTableName(entityType);
    if (!tableName) {
      return NextResponse.json({ error: `Unknown entity type: ${entityType}` }, { status: 400 });
    }

    const entity = await queryOne(
      `SELECT metadata FROM public.${tableName} WHERE id = $1 AND tenant_id = $2`,
      [entityId, ctx.tenantId]
    );
    if (!entity) {
      return NextResponse.json({ error: 'Entity not found or not owned' }, { status: 404 });
    }

    const mergedMetadata = {
      ...((entity.metadata as Record<string, any>) || {}),
      ...fields,
    };

    await queryMany(
      `UPDATE public.${tableName} SET metadata = $1 WHERE id = $2`,
      [JSON.stringify(mergedMetadata), entityId]
    );

    return NextResponse.json({
      message: `${Object.keys(fields).length} custom fields set on ${entityType}`,
      entityType,
      entityId,
      fields,
    });
  }

  // Create a custom field definition
  const body = await req.json();
  const { entityType, fieldKey, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, defaultValue, displayOrder } = body;

  if (!entityType || !fieldKey || !fieldLabel) {
    return NextResponse.json({ error: 'entityType, fieldKey, and fieldLabel are required' }, { status: 400 });
  }

  const validTypes = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'email', 'phone', 'currency', 'json'];
  const safeType = validTypes.includes(fieldType) ? fieldType : 'text';

  const existing = await queryOne(
    `SELECT id FROM custom_field_defs WHERE tenant_id = $1 AND entity_type = $2 AND field_key = $3`,
    [ctx.tenantId, entityType, fieldKey]
  );

  if (existing) {
    return NextResponse.json({ error: `Field '${fieldKey}' already exists for ${entityType}` }, { status: 409 });
  }

  const result = await queryOne(
    `INSERT INTO custom_field_defs 
     (tenant_id, entity_type, field_key, field_label, field_type, field_options, is_required, is_searchable, default_value, display_order)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      ctx.tenantId,
      entityType,
      fieldKey.replace(/[^a-z0-9_]/gi, '_').toLowerCase(),
      fieldLabel,
      safeType,
      fieldOptions ? JSON.stringify(fieldOptions) : null,
      isRequired || false,
      isSearchable !== false,
      defaultValue || null,
      displayOrder || 0,
    ]
  );

  return NextResponse.json({
    message: `Custom field '${fieldKey}' created for ${entityType}`,
    field: result,
  }, { status: 201 });
}

// ── PUT: Update custom field definition ─────────────────────────────────────

export async function PUT(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const body = await req.json();
  const { fieldId, fieldLabel, fieldType, fieldOptions, isRequired, isSearchable, displayOrder } = body;

  if (!fieldId) {
    return NextResponse.json({ error: 'fieldId is required' }, { status: 400 });
  }

  // Build dynamic update (only update provided fields)
  const updates: string[] = [];
  const values: any[] = [];
  let paramIndex = 1;

  if (fieldLabel !== undefined) {
    updates.push(`field_label = $${paramIndex}`);
    values.push(fieldLabel);
    paramIndex++;
  }
  if (fieldType !== undefined) {
    const validTypes = ['text', 'number', 'date', 'select', 'multiselect', 'boolean', 'url', 'email', 'phone', 'currency', 'json'];
    if (validTypes.includes(fieldType)) {
      updates.push(`field_type = $${paramIndex}`);
      values.push(fieldType);
      paramIndex++;
    }
  }
  if (fieldOptions !== undefined) {
    updates.push(`field_options = $${paramIndex}`);
    values.push(JSON.stringify(fieldOptions));
    paramIndex++;
  }
  if (isRequired !== undefined) {
    updates.push(`is_required = $${paramIndex}`);
    values.push(isRequired);
    paramIndex++;
  }
  if (isSearchable !== undefined) {
    updates.push(`is_searchable = $${paramIndex}`);
    values.push(isSearchable);
    paramIndex++;
  }
  if (displayOrder !== undefined) {
    updates.push(`display_order = $${paramIndex}`);
    values.push(displayOrder);
    paramIndex++;
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: 'No fields to update' }, { status: 400 });
  }

  updates.push(`updated_at = NOW()`);
  values.push(ctx.tenantId);

  const result = await queryOne(
    `UPDATE custom_field_defs SET ${updates.join(', ')} WHERE id = $${paramIndex} AND tenant_id = $${paramIndex + 1} RETURNING *`,
    [...values]
  );

  if (!result) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  return NextResponse.json({ message: 'Field updated', field: result });
}

// ── DELETE: Remove custom field definition ──────────────────────────────────

export async function DELETE(req: NextRequest) {
  const ctx = await requireAuth(req);
  if (ctx instanceof NextResponse) return ctx;

  const { searchParams } = new URL(req.url);
  const fieldId = searchParams.get('fieldId');
  const fieldKey = searchParams.get('fieldKey');
  const entityType = searchParams.get('entityType');

  if (!fieldId && (!fieldKey || !entityType)) {
    return NextResponse.json({ error: 'fieldId OR (fieldKey + entityType) required' }, { status: 400 });
  }

  let result;
  if (fieldId) {
    result = await queryOne(
      `DELETE FROM custom_field_defs WHERE id = $1 AND tenant_id = $2 RETURNING *`,
      [fieldId, ctx.tenantId]
    );
  } else {
    result = await queryOne(
      `DELETE FROM custom_field_defs WHERE tenant_id = $1 AND entity_type = $2 AND field_key = $3 RETURNING *`,
      [ctx.tenantId, entityType, fieldKey]
    );
  }

  if (!result) {
    return NextResponse.json({ error: 'Field not found' }, { status: 404 });
  }

  // Note: We do NOT remove the key from entity metadata.
  // Data is preserved — only the field definition is removed.
  // This follows the "no data destruction" policy.

  return NextResponse.json({ message: `Field '${result.field_key}' deleted (data preserved in metadata)`, field: result });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function getTableName(entityType: string): string | null {
  const map: Record<string, string> = {
    contact: 'contacts',
    company: 'companies',
    deal: 'deals',
    lead: 'leads',
    task: 'tasks',
    user: 'users',
    tenant: 'tenants',
  };
  return map[entityType] || null;
}
