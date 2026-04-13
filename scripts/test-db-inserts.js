#!/usr/bin/env node
/**
 * NuCRM SaaS - Direct Database Test
 * Tests if tenant_id is being set correctly in inserts
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://postgres:postgres123@localhost:5432/nucrm';

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  log(`\n${'═'.repeat(60)}`, 'cyan');
  log(` ${title}`, 'cyan');
  log(`${'═'.repeat(60)}`, 'cyan');
}

const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randId = () => Math.random().toString(36).substring(2, 10);

const FIRST_NAMES = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emma', 'Chris', 'Lisa', 'Tom', 'Amy'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor'];
const COMPANY_NAMES = ['Acme Corp', 'TechStart', 'GlobalInc', 'DataFlow', 'CloudBase', 'NetWorks', 'SoftLab', 'Webify'];

async function main() {
  log('\n╔═══════════════════════════════════════════════════════════╗', 'cyan');
  log('║     NuCRM SaaS - Direct Database Insert Test             ║', 'cyan');
  log('╚═══════════════════════════════════════════════════════════╝', 'cyan');

  const pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

  try {
    // Get existing tenant and user
    section('1. Getting Tenant & User Context');
    const context = await pool.query(`
      SELECT u.id as user_id, u.email, tm.tenant_id, r.slug as role_slug
      FROM public.users u
      JOIN public.tenant_members tm ON tm.user_id = u.id AND tm.status = 'active'
      JOIN public.roles r ON r.id = tm.role_id
      LIMIT 1
    `);
    
    if (context.rows.length === 0) {
      log('  ✗ No active user/tenant found!', 'red');
      process.exit(1);
    }
    
    const { user_id, tenant_id, email, role_slug } = context.rows[0];
    log(`  ✓ User: ${email} (${user_id})`, 'green');
    log(`  ✓ Tenant: ${tenant_id}`, 'green');
    log(`  ✓ Role: ${role_slug}`, 'green');

    const results = { passed: 0, failed: 0 };
    const createdIds = { companies: [], contacts: [], deals: [], tasks: [] };

    // Test Companies
    section('2. Testing Companies (with tenant_id)');
    for (let i = 0; i < 2; i++) {
      const name = `${rand(COMPANY_NAMES)} ${randId()}`;
      try {
        const res = await pool.query(`
          INSERT INTO public.companies (tenant_id, created_by, name, website, industry, employees, annual_revenue, phone, tags, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, tenant_id, name
        `, [tenant_id, user_id, name, `https://company${i}.com`, 'Technology', 50, 1000000, '+1-555-0000', ['test'], {}]);
        
        const row = res.rows[0];
        if (row.tenant_id === tenant_id) {
          log(`  ✓ Company created: ${row.name} (tenant_id: ${row.tenant_id})`, 'green');
          createdIds.companies.push(row.id);
          results.passed++;
        } else {
          log(`  ✗ Company created with WRONG tenant_id: ${row.tenant_id}`, 'red');
          results.failed++;
        }
      } catch (err) {
        log(`  ✗ Failed to create company: ${err.message}`, 'red');
        results.failed++;
      }
    }

    // Test Contacts
    section('3. Testing Contacts (with tenant_id)');
    for (let i = 0; i < 3; i++) {
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      try {
        const res = await pool.query(`
          INSERT INTO public.contacts (tenant_id, created_by, assigned_to, first_name, last_name, email, phone, lead_status, tags, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, tenant_id, first_name, last_name
        `, [tenant_id, user_id, user_id, firstName, lastName, `test.${randId()}@example.com`, '+1-555-0000', 'new', ['test'], {}]);
        
        const row = res.rows[0];
        if (row.tenant_id === tenant_id) {
          log(`  ✓ Contact created: ${row.first_name} ${row.last_name} (tenant_id: ${row.tenant_id})`, 'green');
          createdIds.contacts.push(row.id);
          results.passed++;
        } else {
          log(`  ✗ Contact created with WRONG tenant_id: ${row.tenant_id}`, 'red');
          results.failed++;
        }
      } catch (err) {
        log(`  ✗ Failed to create contact: ${err.message}`, 'red');
        results.failed++;
      }
    }

    // Test Deals
    section('4. Testing Deals (with tenant_id)');
    for (let i = 0; i < 2; i++) {
      const name = `Deal ${randId()}`;
      try {
        const res = await pool.query(`
          INSERT INTO public.deals (tenant_id, created_by, name, contact_id, company_id, value, stage, probability, tags, custom_fields)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          RETURNING id, tenant_id, name
        `, [tenant_id, user_id, name, createdIds.contacts[0] || null, createdIds.companies[0] || null, 10000, 'lead', 25, ['test'], {}]);
        
        const row = res.rows[0];
        if (row.tenant_id === tenant_id) {
          log(`  ✓ Deal created: ${row.name} (tenant_id: ${row.tenant_id})`, 'green');
          createdIds.deals.push(row.id);
          results.passed++;
        } else {
          log(`  ✗ Deal created with WRONG tenant_id: ${row.tenant_id}`, 'red');
          results.failed++;
        }
      } catch (err) {
        log(`  ✗ Failed to create deal: ${err.message}`, 'red');
        results.failed++;
      }
    }

    // Test Tasks
    section('5. Testing Tasks (with tenant_id)');
    for (let i = 0; i < 2; i++) {
      const title = `Task ${randId()}`;
      try {
        const res = await pool.query(`
          INSERT INTO public.tasks (tenant_id, created_by, assigned_to, title, description, due_date, priority, status, tags)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          RETURNING id, tenant_id, title
        `, [tenant_id, user_id, user_id, title, 'Test task', new Date().toISOString(), 'medium', 'pending', ['test']]);
        
        const row = res.rows[0];
        if (row.tenant_id === tenant_id) {
          log(`  ✓ Task created: ${row.title} (tenant_id: ${row.tenant_id})`, 'green');
          createdIds.tasks.push(row.id);
          results.passed++;
        } else {
          log(`  ✗ Task created with WRONG tenant_id: ${row.tenant_id}`, 'red');
          results.failed++;
        }
      } catch (err) {
        log(`  ✗ Failed to create task: ${err.message}`, 'red');
        results.failed++;
      }
    }

    // Test Notes
    section('6. Testing Notes (with tenant_id)');
    if (createdIds.contacts.length > 0) {
      try {
        const res = await pool.query(`
          INSERT INTO public.notes (tenant_id, created_by, contact_id, content)
          VALUES ($1, $2, $3, $4)
          RETURNING id, tenant_id
        `, [tenant_id, user_id, createdIds.contacts[0], 'Test note']);
        
        const row = res.rows[0];
        if (row.tenant_id === tenant_id) {
          log(`  ✓ Note created (tenant_id: ${row.tenant_id})`, 'green');
          results.passed++;
        } else {
          log(`  ✗ Note created with WRONG tenant_id: ${row.tenant_id}`, 'red');
          results.failed++;
        }
      } catch (err) {
        log(`  ✗ Failed to create note: ${err.message}`, 'red');
        results.failed++;
      }
    } else {
      log('  ⚠️  Skipped (no contacts)', 'yellow');
    }

    // Test Meetings
    section('7. Testing Meetings (with tenant_id)');
    try {
      const res = await pool.query(`
        INSERT INTO public.meetings (tenant_id, created_by, title, description, start_time, end_time, location, status)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING id, tenant_id, title
      `, [tenant_id, user_id, 'Test Meeting', 'Automated test', new Date().toISOString(), new Date(Date.now() + 3600000).toISOString(), 'Virtual', 'scheduled']);
      
      const row = res.rows[0];
      if (row.tenant_id === tenant_id) {
        log(`  ✓ Meeting created: ${row.title} (tenant_id: ${row.tenant_id})`, 'green');
        results.passed++;
      } else {
        log(`  ✗ Meeting created with WRONG tenant_id: ${row.tenant_id}`, 'red');
        results.failed++;
      }
    } catch (err) {
      log(`  ✗ Failed to create meeting: ${err.message}`, 'red');
      results.failed++;
    }

    // Summary
    section('Test Summary');
    const total = results.passed + results.failed;
    log(`\n  Total Tests: ${total}`, 'cyan');
    log(`  ✓ Passed: ${results.passed}`, 'green');
    log(`  ✗ Failed: ${results.failed}`, 'red');
    
    if (results.failed > 0) {
      log('\n⚠️  Some inserts have tenant_id issues!', 'red');
      log('\n🔧 FIX: Edit lib/db/client.ts and remove tenant_id, created_by from PROTECTED set', 'yellow');
      process.exit(1);
    } else {
      log('\n✅ All inserts have correct tenant_id! Database is working correctly.', 'green');
      process.exit(0);
    }

  } finally {
    await pool.end();
  }
}

main().catch(err => {
  log(`\nFatal error: ${err.message}`, 'red');
  log(err.stack, 'red');
  process.exit(1);
});
