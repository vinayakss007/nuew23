/**
 * Quick test data seeder for NuCRM
 * Creates: 1 tenant, 1 user, 20 sample contacts
 */

import { Pool } from 'pg';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({ connectionString: databaseUrl, ssl: false });

async function main() {
  console.log('🌱 Creating test data...\n');

  // Create user first (needed as owner)
  const userId = require('crypto').randomUUID();
  const bcrypt = require('bcryptjs');
  const hashedPassword = await bcrypt.hash('password123', 10);
  
  const userRes = await pool.query(
    `INSERT INTO public.users (id, full_name, email, password_hash)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO UPDATE SET full_name = $2, password_hash = $4
     RETURNING id`,
    [userId, 'Test User', 'test@example.com', hashedPassword]
  );
  const actualUserId = userRes.rows[0].id;
  console.log(`✅ User created: test@example.com / password123`);

  // Create tenant
  const tenantRes = await pool.query(
    `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status)
     VALUES ($1, $2, $3, (SELECT id FROM public.plans LIMIT 1), 'active')
     ON CONFLICT (slug) DO UPDATE SET name = $1
     RETURNING id`,
    ['Test Company', 'test-company', actualUserId]
  );
  const tenantId = tenantRes.rows[0].id;
  console.log(`✅ Tenant created: ${tenantId}`);

  // Add user to tenant as admin
  await pool.query(
    `INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT DO NOTHING`,
    [tenantId, actualUserId, 'admin', 'active']
  );
  console.log(`✅ User added to tenant as admin`);

  // Create 20 sample contacts
  const contacts = [
    { first: 'John', last: 'Doe', email: 'john.doe@example.com', company: 'Acme Corp', status: 'new' },
    { first: 'Jane', last: 'Smith', email: 'jane.smith@techstart.io', company: 'TechStart', status: 'qualified' },
    { first: 'Bob', last: 'Johnson', email: 'bob@innovate.com', company: 'Innovate Inc', status: 'contacted' },
    { first: 'Alice', last: 'Williams', email: 'alice@globaltech.com', company: 'GlobalTech', status: 'converted' },
    { first: 'Charlie', last: 'Brown', email: 'charlie@startup.co', company: 'Startup Co', status: 'new' },
    { first: 'Diana', last: 'Prince', email: 'diana@themyscira.com', company: 'Themyscira Ltd', status: 'qualified' },
    { first: 'Eve', last: 'Davis', email: 'eve@designstudio.com', company: 'Design Studio', status: 'new' },
    { first: 'Frank', last: 'Miller', email: 'frank@cloudservices.io', company: 'Cloud Services', status: 'contacted' },
    { first: 'Grace', last: 'Lee', email: 'grace@dataflow.com', company: 'DataFlow', status: 'qualified' },
    { first: 'Henry', last: 'Wilson', email: 'henry@webworks.com', company: 'WebWorks', status: 'new' },
    { first: 'Ivy', last: 'Chen', email: 'ivy@aitech.com', company: 'AI Tech', status: 'converted' },
    { first: 'Jack', last: 'Taylor', email: 'jack@mobilefirst.io', company: 'Mobile First', status: 'new' },
    { first: 'Karen', last: 'Martinez', email: 'karen@salesforce.com', company: 'SalesForce', status: 'contacted' },
    { first: 'Leo', last: 'Anderson', email: 'leo@analytics.com', company: 'Analytics Pro', status: 'qualified' },
    { first: 'Mia', last: 'Thomas', email: 'mia@ecommerce.com', company: 'E-Commerce Plus', status: 'new' },
    { first: 'Noah', last: 'Jackson', email: 'noah@fintech.io', company: 'FinTech Solutions', status: 'converted' },
    { first: 'Olivia', last: 'White', email: 'olivia@healthtech.com', company: 'HealthTech', status: 'new' },
    { first: 'Paul', last: 'Harris', email: 'paul@logistics.com', company: 'Logistics Inc', status: 'contacted' },
    { first: 'Quinn', last: 'Clark', email: 'quinn@edtech.com', company: 'EdTech', status: 'qualified' },
    { first: 'Rachel', last: 'Lewis', email: 'rachel@marketing.io', company: 'Marketing Pro', status: 'new' },
  ];

  console.log(`\n📦 Creating ${contacts.length} contacts...`);
  
  for (const c of contacts) {
    // Create company
    const companyRes = await pool.query(
      `INSERT INTO public.companies (tenant_id, name)
       VALUES ($1, $2)
       RETURNING id`,
      [tenantId, c.company]
    );
    const companyId = companyRes.rows[0].id;

    // Create contact
    await pool.query(
      `INSERT INTO public.contacts (
        tenant_id, first_name, last_name, email, phone, title, company_id,
        lead_status, lead_source, lifecycle_stage, assigned_to, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      ON CONFLICT DO NOTHING`,
      [
        tenantId, c.first, c.last, c.email,
        `+1-555-${String(Math.floor(Math.random()*9000)+1000)}`,
        `${c.first === 'John' ? 'CEO' : c.first === 'Jane' ? 'CTO' : 'Manager'}`,
        companyId, c.status,
        ['website', 'referral', 'cold_outreach', 'social_media'][Math.floor(Math.random()*4)],
        ['lead', 'marketing_qualified_lead', 'sales_qualified_lead', 'opportunity', 'customer'][Math.floor(Math.random()*5)],
        userId, userId
      ]
    );
    console.log(`  ✓ ${c.first} ${c.last} (${c.email})`);
  }

  console.log(`\n✅ Done! Login with:`);
  console.log(`   Email: test@example.com`);
  console.log(`   Password: password123`);
  console.log(`\n   Access contacts at: http://localhost:3000/tenant/contacts`);
  
  await pool.end();
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
