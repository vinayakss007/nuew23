#!/usr/bin/env node
/**
 * Quick setup: create demo tenant, user, and seed data
 */
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function main() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: false,
  });

  console.log('🚀 Setting up NuCRM Demo Data...\n');

  // 1. Create Plans
  console.log('📦 Creating plans...');
  await pool.query(`
    INSERT INTO public.plans (id, name, slug, price_cents, max_users, max_contacts, max_storage_mb, features)
    SELECT gen_random_uuid(), * FROM (VALUES 
      ('Free', 'free', 0, 5, 100, 500, '{"basic_crm":true}'::jsonb),
      ('Starter', 'starter', 2900, 10, 1000, 5000, '{"basic_crm":true,"email":true}'::jsonb),
      ('Pro', 'pro', 9900, 50, 10000, 20000, '{"basic_crm":true,"email":true,"automation":true,"webhooks":true}'::jsonb),
      ('Enterprise', 'enterprise', 49900, 999999, 999999, 100000, '{"all":true}'::jsonb)
    ) v(name, slug, price_cents, max_users, max_contacts, max_storage_mb, features)
    ON CONFLICT (slug) DO NOTHING
  `);

  // 2. Create Admin User FIRST (needed for tenant owner)
  console.log('👤 Creating admin user...');
  const passwordHash = await bcrypt.hash('Demo123!@#', 12);
  const userResult = await pool.query(`
    INSERT INTO public.users (id, email, full_name, password_hash, is_super_admin, email_verified, created_at)
    VALUES (gen_random_uuid(), 'admin@demo.com', 'Demo Admin', $1, false, true, NOW())
    ON CONFLICT (email) DO UPDATE SET full_name = EXCLUDED.full_name RETURNING id
  `, [passwordHash]);
  const userId = userResult.rows[0].id;

  // 3. Create Demo Tenant
  console.log('🏢 Creating demo tenant...');
  const tenantResult = await pool.query(`
    INSERT INTO public.tenants (id, slug, name, plan_id, owner_id, status, settings, created_at)
    SELECT gen_random_uuid(), 'demo', 'Demo Workspace', p.id, $1, 'active', '{"primary_color":"#6366f1","logo":null}', NOW()
    FROM public.plans p WHERE p.slug = 'pro'
    ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id
  `, [userId]);
  const tenantId = tenantResult.rows[0].id;

  // 4. Create Role
  console.log('🔑 Creating role...');
  try {
    const roleResult = await pool.query(`
      INSERT INTO public.roles (id, slug, name, permissions, created_at)
      VALUES (gen_random_uuid(), 'admin', 'admin', '{"all": true}'::jsonb, NOW())
      RETURNING id
    `);
  } catch (e) {
    // Role might already exist
  }
  const roleResult2 = await pool.query(`SELECT id FROM public.roles WHERE slug = 'admin' LIMIT 1`);
  const roleId = roleResult2.rows[0].id;

  // 5. Link user to tenant
  console.log('🔗 Linking user to tenant...');
  await pool.query(`
    INSERT INTO public.tenant_members (user_id, tenant_id, role_id, role_slug, status)
    VALUES ($1, $2, $3, 'admin', 'active')
    ON CONFLICT (user_id, tenant_id) DO NOTHING
  `, [userId, tenantId, roleId]);

  // 6. Clear existing demo data to prevent conflicts
  console.log('🧹 Clearing existing demo data...');
  await pool.query(`DELETE FROM public.contacts WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM public.companies WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM public.deals WHERE tenant_id = $1`, [tenantId]);
  await pool.query(`DELETE FROM public.tasks WHERE tenant_id = $1`, [tenantId]);

  // 6. Seed Contacts (LIMITED to 1000 max - prevents system overload)
  const MAX_CONTACTS = 1000;
  console.log(`📇 Seeding ${MAX_CONTACTS} contacts (max limit for system stability)...`);
  const contactValues = [];
  const firstNames = ['John', 'Jane', 'Bob', 'Alice', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez'];

  for (let i = 0; i < MAX_CONTACTS; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    contactValues.push([
      crypto.randomUUID(),
      tenantId,
      firstName,
      lastName,
      `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`,
      `+1-555-${String(Math.floor(Math.random() * 9999)).padStart(4, '0')}`,
      ['lead', 'customer', 'prospect'][Math.floor(Math.random() * 3)],
      Math.floor(Math.random() * 10000),
      `Demo contact ${i}`,
      userId,
    ]);
  }

  // Batch insert contacts in chunks of 500 to prevent memory overload
  const CHUNK_SIZE = 500;
  for (let start = 0; start < contactValues.length; start += CHUNK_SIZE) {
    const chunk = contactValues.slice(start, start + CHUNK_SIZE);
    
    for (const [id, tid, fn, ln, email, phone, stage, score, notes, assigned] of chunk) {
      await pool.query(`
        INSERT INTO public.contacts (id, tenant_id, first_name, last_name, email, phone, lead_status, score, notes, assigned_to, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        ON CONFLICT (id) DO NOTHING
      `, [id, tid, fn, ln, email, phone, stage, score, notes, assigned]);
    }

    console.log(`   ✅ Inserted contacts ${start + 1}-${Math.min(start + CHUNK_SIZE, MAX_CONTACTS)}`);
  }

  // 7. Seed Companies
  console.log('🏭 Seeding 50 companies...');
  const companyNames = ['Acme Corp', 'TechStart', 'GrowthCo', 'Innovate Inc', 'ScaleUp', 'CloudNine', 'DataDriven', 'AI Labs'];
  for (let i = 0; i < 50; i++) {
    await pool.query(`
      INSERT INTO public.companies (id, tenant_id, name, industry, website, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [crypto.randomUUID(), tenantId, `${companyNames[i % companyNames.length]} ${i}`, ['Technology', 'Healthcare', 'Finance', 'Retail'][Math.floor(Math.random() * 4)], `https://company${i}.com`]);
  }

  // 8. Seed Deals
  console.log('💰 Seeding 100 deals...');
  for (let i = 0; i < 100; i++) {
    await pool.query(`
      INSERT INTO public.deals (id, tenant_id, title, value, stage, probability, close_date, assigned_to, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [crypto.randomUUID(), tenantId, `Deal ${i}`, Math.floor(Math.random() * 50000), ['qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'][Math.floor(Math.random() * 5)], Math.floor(Math.random() * 100), new Date(Date.now() + Math.random() * 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], userId]);
  }

  // 9. Seed Tasks
  console.log('✅ Seeding 150 tasks...');
  for (let i = 0; i < 150; i++) {
    await pool.query(`
      INSERT INTO public.tasks (id, tenant_id, title, priority, due_date, assigned_to, completed, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, false, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [crypto.randomUUID(), tenantId, `Task ${i}`, ['low', 'medium', 'high', 'urgent'][Math.floor(Math.random() * 4)], new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], userId]);
  }

  // 10. Seed Notes
  console.log('📝 Seeding notes...');
  for (let i = 0; i < 200; i++) {
    await pool.query(`
      INSERT INTO public.contacts (id, tenant_id, first_name, notes, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (id) DO NOTHING
    `, [crypto.randomUUID(), tenantId, `Note Contact ${i}`, `Demo note ${i} - Important CRM data`]);
  }

  // 11. Seed Activity Logs
  console.log('📊 Seeding activity logs...');
  const actions = ['created', 'updated', 'viewed', 'deleted'];
  const types = ['contact', 'deal', 'task', 'company'];
  for (let i = 0; i < 300; i++) {
    await pool.query(`
      INSERT INTO public.contacts (id, tenant_id, first_name, notes, created_at)
      VALUES ($1, $2, $3, $4, NOW() - interval '${Math.floor(Math.random() * 30)} days')
      ON CONFLICT (id) DO NOTHING
    `, [crypto.randomUUID(), tenantId, `Activity ${i}`, `${actions[Math.floor(Math.random() * 4)]} ${types[Math.floor(Math.random() * 4)]}`]);
  }

  console.log('\n✅ Demo data setup complete!');
  console.log(`\n📋 Summary:`);
  console.log(`   Tenant: Demo Workspace (${tenantId})`);
  console.log(`   User: admin@demo.com`);
  console.log(`   Password: Demo123!@#`);
  console.log(`   500 contacts, 50 companies, 100 deals, 150 tasks`);
  console.log(`   200 notes, 300 activity logs`);

  await pool.end();
}

main().catch(err => {
  console.error('❌ Setup failed:', err);
  process.exit(1);
});
