/**
 * NuCRM SaaS v2 — Advanced Data Seeder
 * Seeds sequences, automations, notifications, email templates,
 * forms, roles, and more — matching ACTUAL database schema.
 *
 * Usage: npx tsx scripts/seed-advanced.ts
 */

import { Pool } from 'pg';

const databaseUrl = process.env['DATABASE_URL'];
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Example: DATABASE_URL=postgresql://postgres:password@localhost:5432/nucrm');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: false,
});

const TENANT_ID = process.env['TENANT_ID'] || null;
const USER_ID = process.env['USER_ID'] || null;

let tenantId: string;
let userId: string;
let contactIds: string[] = [];
let dealIds: string[] = [];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randDate(daysBack: number) { const d = new Date(); d.setDate(d.getDate() - randInt(0, daysBack)); return d.toISOString(); }

async function resolveIds() {
  if (TENANT_ID) { tenantId = TENANT_ID; }
  else {
    const { rows } = await pool.query('SELECT id FROM public.tenants ORDER BY created_at DESC LIMIT 1');
    tenantId = rows[0]!.id;
  }
  if (USER_ID) { userId = USER_ID; }
  else {
    const { rows } = await pool.query('SELECT id FROM public.users ORDER BY created_at DESC LIMIT 1');
    userId = rows[0]!.id;
  }

  const c = await pool.query('SELECT id FROM public.contacts WHERE tenant_id=$1 LIMIT 2000', [tenantId]);
  contactIds = c.rows.map(r => r.id);
  const d = await pool.query('SELECT id FROM public.deals WHERE tenant_id=$1 LIMIT 500', [tenantId]);
  dealIds = d.rows.map(r => r.id);

  console.log(`  Tenant: ${tenantId}, User: ${userId}`);
  console.log(`  Contacts: ${contactIds.length}, Deals: ${dealIds.length}`);
}

async function seedSequences() {
  console.log('\n📦 Seeding sequences...');
  const t0 = Date.now();
  const seqs = [
    { name: 'New Lead Onboarding', steps: 5 },
    { name: 'Follow-Up Campaign', steps: 4 },
    { name: 'Post-Demo Nurture', steps: 6 },
    { name: 'Trial Conversion', steps: 7 },
    { name: 'Customer Check-In', steps: 3 },
    { name: 'Webinar Invite', steps: 4 },
    { name: 'Product Launch', steps: 5 },
    { name: 'Churn Prevention', steps: 6 },
    { name: 'Partnership Outreach', steps: 4 },
    { name: 'Event Follow-Up', steps: 5 },
  ];

  const values = seqs.map((s, i) => {
    const p = i * 9;
    return `($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9})`;
  });
  const params = seqs.flatMap((s, i) => [
    tenantId, s.name, s.name, JSON.stringify(Array.from({ length: s.steps }, (_, j) => ({ step: j + 1, type: 'email', delay_days: j + 1 }))), true, 0, userId, randDate(30), randDate(30)
  ]);

  await pool.query(
    `INSERT INTO public.sequences (tenant_id,name,description,steps,is_active,enroll_count,created_by,created_at,updated_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${seqs.length} sequences in ${Date.now() - t0}ms`);
}

async function seedEmailTemplates() {
  console.log('\n📦 Seeding email templates...');
  const t0 = Date.now();
  const templates = [
    { name: 'Welcome Email', subject: 'Welcome to {{company_name}}!', category: 'onboarding' },
    { name: 'Follow-Up After Meeting', subject: 'Great connecting with you, {{first_name}}', category: 'follow_up' },
    { name: 'Proposal Sent', subject: 'Your proposal from {{company_name}}', category: 'sales' },
    { name: 'Contract Renewal', subject: 'Time to renew your subscription', category: 'retention' },
    { name: 'Event Invitation', subject: 'You\'re invited: {{event_name}}', category: 'events' },
    { name: 'Product Update', subject: 'What\'s new at {{company_name}}', category: 'product' },
    { name: 'Thank You Note', subject: 'Thank you for your time, {{first_name}}', category: 'follow_up' },
    { name: 'Invoice Reminder', subject: 'Invoice #{{invoice_id}} is due', category: 'billing' },
    { name: 'Churn Prevention', subject: 'We\'d love to keep you, {{first_name}}', category: 'retention' },
    { name: 'Case Study Request', subject: 'Would you share your success story?', category: 'marketing' },
    { name: 'Quarterly Review', subject: 'Q{{quarter}} review for {{company_name}}', category: 'sales' },
    { name: 'Holiday Greeting', subject: 'Happy Holidays from {{company_name}}!', category: 'relationship' },
  ];

  const values = templates.map((t, i) => {
    const p = i * 10;
    return `($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10})`;
  });
  const params = templates.flatMap(t => [
    tenantId, userId, t.name, t.subject,
    `<p>Hi {{first_name}},</p><p>${t.subject}</p><p>Best,<br/>{{sender_name}}</p>`,
    t.subject.replace(/{{.*?}}/g, ''),
    t.category, JSON.stringify(['first_name', 'company_name', 'sender_name']),
    randDate(60), randDate(30)
  ]);

  await pool.query(
    `INSERT INTO public.email_templates (tenant_id,user_id,name,subject,html_body,text_body,category,variables,created_at,updated_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${templates.length} email templates in ${Date.now() - t0}ms`);
}

async function seedForms() {
  console.log('\n📦 Seeding forms...');
  const t0 = Date.now();
  const forms = [
    { name: 'Contact Us', slug: 'contact-us', desc: 'General contact form', fields: 5 },
    { name: 'Demo Request', slug: 'demo-request', desc: 'Request a product demo', fields: 7 },
    { name: 'Newsletter Signup', slug: 'newsletter', desc: 'Subscribe to newsletter', fields: 3 },
    { name: 'Event Registration', slug: 'event-reg', desc: 'Register for events', fields: 8 },
    { name: 'Partnership Inquiry', slug: 'partnership', desc: 'Partnership applications', fields: 6 },
    { name: 'Support Ticket', slug: 'support', desc: 'Submit a support request', fields: 5 },
    { name: 'Feedback Survey', slug: 'feedback', desc: 'Customer feedback survey', fields: 10 },
    { name: 'Free Trial Signup', slug: 'free-trial', desc: 'Start a free trial', fields: 6 },
  ];

  const values = forms.map((f, i) => {
    const p = i * 10;
    return `($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10})`;
  });
  const params = forms.flatMap(f => [
    tenantId, f.name, f.slug, f.desc,
    JSON.stringify([
      { key: 'first_name', label: 'First Name', type: 'text', required: true },
      { key: 'last_name', label: 'Last Name', type: 'text', required: true },
      { key: 'email', label: 'Email', type: 'email', required: true },
      { key: 'phone', label: 'Phone', type: 'tel', required: false },
      { key: 'company', label: 'Company', type: 'text', required: false },
    ]),
    JSON.stringify({ theme: 'light', redirect_url: '/thank-you', success_message: 'Thank you!' }),
    true, 0, userId, randDate(90)
  ]);

  await pool.query(
    `INSERT INTO public.forms (tenant_id,name,slug,description,fields,settings,is_active,submission_count,created_by,created_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${forms.length} forms in ${Date.now() - t0}ms`);
}

async function seedRoles() {
  console.log('\n📦 Seeding roles...');
  const t0 = Date.now();
  const roles = [
    { name: 'Sales Rep', slug: 'sales_rep', desc: 'Standard sales role' },
    { name: 'Sales Manager', slug: 'sales_manager', desc: 'Sales team manager' },
    { name: 'Marketing', slug: 'marketing', desc: 'Marketing team member' },
    { name: 'Support', slug: 'support', desc: 'Customer support' },
    { name: 'Viewer', slug: 'viewer', desc: 'Read-only access' },
  ];

  const values = roles.map((r, i) => {
    const p = i * 8;
    return `($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8})`;
  });
  const params = roles.flatMap((r, i) => [
    tenantId, r.name, r.slug, r.desc, false,
    JSON.stringify({
      'contacts.read': true, 'contacts.edit': i < 3, 'deals.read': true,
      'deals.edit': i < 3, 'tasks.read': true, 'tasks.edit': i < 4,
      'reports.view': i < 3, 'admin.access': i === 1,
    }),
    i, randDate(60)
  ]);

  await pool.query(
    `INSERT INTO public.roles (tenant_id,name,slug,description,permissions,created_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${roles.length} roles in ${Date.now() - t0}ms`);
}

async function seedAutomations() {
  console.log('\n📦 Seeding automations...');
  const t0 = Date.now();
  const automations = [
    { name: 'Auto-assign new leads', trigger: 'lead.created' },
    { name: 'Welcome email on contact', trigger: 'contact.created' },
    { name: 'Notify on deal stage change', trigger: 'deal.stage_changed' },
    { name: 'Task on deal won', trigger: 'deal.won' },
    { name: 'Move stale leads', trigger: 'deal.stale' },
    { name: 'Duplicate detection', trigger: 'contact.created' },
    { name: 'Score update on email open', trigger: 'email.opened' },
    { name: 'Tag high-value contacts', trigger: 'contact.updated' },
    { name: 'Trial expiry reminder', trigger: 'trial.expiring' },
    { name: 'Invoice overdue alert', trigger: 'invoice.overdue' },
  ];

  const values = automations.map((a, i) => {
    const p = i * 14;
    return `($${p+1},$${p+2},$${p+3},$${p+4},$${p+5},$${p+6},$${p+7},$${p+8},$${p+9},$${p+10},$${p+11},$${p+12},$${p+13},$${p+14})`;
  });
  const params = automations.flatMap(a => [
    tenantId, a.name, '', true, a.trigger,
    JSON.stringify({ delay: 0, conditions: [] }),
    JSON.stringify([
      { type: 'send_notification', config: { message: `Automation triggered: ${a.name}` } },
    ]),
    JSON.stringify([]), 0, null, null, userId, randDate(60), randDate(30)
  ]);

  await pool.query(
    `INSERT INTO public.automations (tenant_id,name,description,is_active,trigger_type,trigger_config,actions,conditions,run_count,last_run_at,last_error,created_by,created_at,updated_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${automations.length} automations in ${Date.now() - t0}ms`);
}

async function seedNotifications() {
  console.log('\n📦 Seeding 500 notifications...');
  const t0 = Date.now();
  const types = ['task_assigned', 'task_due', 'task_overdue', 'deal_stage', 'deal_assigned', 'deal_won', 'contact_assigned', 'mention', 'invite_accepted', 'team_joined', 'limit_warning', 'trial_expiring'];
  const titles = [
    'New task assigned to you',
    'Task due today: Follow up with Acme',
    'Overdue task: Send proposal to TechCorp',
    'Deal "Enterprise License" moved to Negotiation',
    'You\'ve been assigned to Global Industries deal',
    'Deal "Partnership Agreement" has been WON! 🎉',
    'New contact assigned: Jane Doe from StartupIO',
    'You were mentioned in a note',
    'Sarah accepted your invitation',
    'New team member joined: John Smith',
    'Contact limit at 80% — consider upgrading',
    'Your trial expires in 3 days',
  ];

  const batchSize = 100;
  let seeded = 0;
  const total = 500;

  while (seeded < total) {
    const batch = Math.min(batchSize, total - seeded);
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < batch; i++) {
      const type = rand(types);
      const title = rand(titles);
      const isRead = Math.random() < 0.4;
      const created = randDate(30);

      const pIdx = i * 8;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6},$${pIdx+7},$${pIdx+8})`);
      params.push(tenantId, userId, type, title, '', null, isRead, created);
    }

    await pool.query(
      `INSERT INTO public.notifications (tenant_id,user_id,type,title,body,link,is_read,created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ 500 notifications in ${Date.now() - t0}ms`);
}

async function seedMoreActivities() {
  console.log('\n📦 Seeding 5000 more activities...');
  const t0 = Date.now();
  const types = ['note', 'call', 'email', 'meeting', 'task', 'deal_update'];
  const descriptions = [
    'Discussed pricing for enterprise plan.',
    'Follow-up call scheduled for next week.',
    'Sent product demo recording.',
    'Meeting with CTO about integration requirements.',
    'Updated deal value based on new scope.',
    'Received positive feedback on proposal.',
    'Negotiating contract terms — legal review pending.',
    'Competitor mentioned: evaluating options.',
    'Decision timeline: end of next quarter.',
    'Champion identified: VP of Engineering.',
    'Technical requirements document shared.',
    'Budget approval received from CFO.',
    'Security review initiated by IT team.',
    'Pilot program proposed for Q2.',
    'Partnership opportunity discussed.',
    'Contract signed — onboarding starts Monday.',
    'Renewal discussion scheduled.',
    'Product roadmap shared with stakeholder.',
    'Customer health score reviewed — all green.',
    'Expansion opportunity identified in marketing dept.',
  ];

  const batchSize = 500;
  let seeded = 0;
  const total = 5000;

  while (seeded < total) {
    const batch = Math.min(batchSize, total - seeded);
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < batch; i++) {
      const type = rand(types);
      const contactId = contactIds.length ? rand(contactIds) : null;
      const dealId = dealIds.length ? rand(dealIds) : null;
      const desc = rand(descriptions);
      const created = randDate(180);
      const meta = JSON.stringify({ source: 'manual', duration_min: randInt(5, 60) });

      const pIdx = i * 7;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6},$${pIdx+7})`);
      params.push(tenantId, contactId, dealId, userId, type, desc, created);
    }

    await pool.query(
      `INSERT INTO public.activities (tenant_id, contact_id, deal_id, user_id, type, description, created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ 5000 activities in ${Date.now() - t0}ms`);
}

async function main() {
  console.log('========================================');
  console.log('  NuCRM Advanced Data Seeder');
  console.log('========================================');

  await resolveIds();
  await seedSequences();
  await seedEmailTemplates();
  // Forms already exist — skip
  // await seedForms();
  // Roles already exist — skip
  // await seedRoles();
  await seedAutomations();
  await seedNotifications();
  await seedMoreActivities();

  const summary = await pool.query(
    `SELECT 'contacts' as entity, count(*) FROM public.contacts WHERE tenant_id=$1
     UNION ALL SELECT 'leads', count(*) FROM public.leads WHERE tenant_id=$1
     UNION ALL SELECT 'deals', count(*) FROM public.deals WHERE tenant_id=$1
     UNION ALL SELECT 'companies', count(*) FROM public.companies WHERE tenant_id=$1
     UNION ALL SELECT 'tasks', count(*) FROM public.tasks WHERE tenant_id=$1
     UNION ALL SELECT 'activities', count(*) FROM public.activities WHERE tenant_id=$1
     UNION ALL SELECT 'sequences', count(*) FROM public.sequences WHERE tenant_id=$1
     UNION ALL SELECT 'email_templates', count(*) FROM public.email_templates WHERE tenant_id=$1
     UNION ALL SELECT 'forms', count(*) FROM public.forms WHERE tenant_id=$1
     UNION ALL SELECT 'roles', count(*) FROM public.roles WHERE tenant_id=$1
     UNION ALL SELECT 'automations', count(*) FROM public.automations WHERE tenant_id=$1
     UNION ALL SELECT 'notifications', count(*) FROM public.notifications WHERE tenant_id=$1`,
    [tenantId]
  );

  console.log('\n========================================');
  console.log('  📊 Final Data Summary');
  console.log('========================================');
  summary.rows.forEach(r => console.log(`  ${r.entity.padEnd(20)}: ${Number(r.count).toLocaleString()}`));

  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
