#!/usr/bin/env node

/**
 * NuCRM SaaS - Massive Data Seeder
 * Creates large amounts of test data for all features
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const { randomBytes } = require('crypto');
const { createHash } = require('crypto');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL !== 'false' ? { rejectUnauthorized: false } : false,
});

function generateId() { return randomBytes(16).toString('hex'); }
function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + salt).digest('hex');
  return `${salt}:${hash}`;
}
function randomDate(daysBack = 365) {
  const d = new Date(); d.setDate(d.getDate() - Math.floor(Math.random() * daysBack)); return d.toISOString();
}
function randomElement(arr) { return arr[Math.floor(Math.random() * arr.length)]; }

const FIRST_NAMES = ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','William','Elizabeth','David','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Daniel','Lisa','Matthew','Nancy','Anthony','Betty','Mark','Margaret','Donald','Sandra','Steven','Ashley','Paul','Dorothy','Andrew','Kimberly','Joshua','Emily','Kenneth','Donna'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores'];
const COMPANY_NAMES = ['TechCorp','InnovateIO','DataFlow','CloudSync','PixelForge','CodeBase','NetPrime','WebScale','ByteWorks','CyberLink','SoftServe','DataVault','AI Labs','QuantumLeap','NeuralNet','BlockChain','SmartGrid','EcoTech','GreenPower','FutureWave','DigitalEdge','CloudPeak','DataMine','AppForge','TechBridge'];
const INDUSTRIES = ['Technology','Finance','Healthcare','Retail','Manufacturing','Education','Consulting','Media','Telecom','Energy','Real Estate','Logistics','Automotive','Food & Beverage','Construction','Insurance'];
const TITLES = ['CEO','CTO','CFO','VP Sales','VP Marketing','Director','Manager','Lead Developer','Sales Manager','Product Manager','Engineering Manager','Head of Growth','Business Analyst','Account Executive','Software Engineer'];
const CITIES = ['New York','San Francisco','Los Angeles','Chicago','Boston','Seattle','Austin','Denver','Miami','Atlanta','Portland','Dallas','Nashville','Phoenix','Philadelphia'];
const LEAD_STATUSES = ['new','contacted','qualified','unqualified','converted','lost'];
const LEAD_SOURCES = ['website','referral','linkedin','cold_call','trade_show','google_ads','facebook_ads','email_campaign','partner','inbound'];
const DEAL_STAGES = ['lead','qualified','proposal','negotiation','won','lost'];
const DEAL_PRIORITIES = ['low','medium','high','urgent'];
const TASK_PRIORITIES = ['low','medium','high'];
const ACTIVITY_TYPES = ['note','call','email','meeting','task','deal_update'];
const PIPELINES = ['Sales Pipeline','Enterprise Deals','Partner Channel','Inbound Leads','Outbound'];

async function query(sql, params) {
  return pool.query(sql, params);
}

async function seed() {
  console.log('🚀 Starting massive data seeding...\n');

  // Get all tenants
  const { rows: tenants } = await query('SELECT id,name,slug FROM public.tenants');
  if (!tenants.length) { console.error('No tenants found! Run seed-demo-data.js first.'); process.exit(1); }
  console.log(`Found ${tenants.length} tenants\n`);

  // Get all users per tenant
  const tenantUsers = {};
  for (const t of tenants) {
    const { rows: users } = await query(
      'SELECT u.id,u.email,u.full_name FROM public.users u JOIN public.tenant_members tm ON tm.user_id=u.id WHERE tm.tenant_id=$1 AND tm.status=\'active\'',
      [t.id]
    );
    tenantUsers[t.id] = users;
  }

  // ── Create more companies ──
  console.log('Creating companies...');
  let companyCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const userId = users.length ? users[0].id : null;
    for (let i = 0; i < 25; i++) {
      const companyId = generateId();
      const name = `${randomElement(COMPANY_NAMES)} ${String.fromCharCode(65 + (i % 26))}${Math.floor(Math.random() * 100)}`;
      await query(
        `INSERT INTO public.companies (id, tenant_id, name, industry, website, phone, city, country, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [companyId, tenant.id, name, randomElement(INDUSTRIES), `https://${name.toLowerCase().replace(/[^a-z]/g,'')}.com`, '+1-555-0100', randomElement(CITIES), 'USA', userId, randomDate(180)]
      ).catch(() => {});
      companyCount++;
    }
  }
  console.log(`✓ Created ${companyCount} companies\n`);

  // ── Create contacts ──
  console.log('Creating contacts...');
  let contactCount = 0;
  const allContactIds = {};
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const { rows: companies } = await query('SELECT id,name FROM public.companies WHERE tenant_id=$1', [tenant.id]);
    allContactIds[tenant.id] = [];
    for (let i = 0; i < 50; i++) {
      const contactId = generateId();
      const firstName = randomElement(FIRST_NAMES);
      const lastName = randomElement(LAST_NAMES);
      const company = companies.length ? randomElement(companies) : null;
      await query(
        `INSERT INTO public.contacts (id, tenant_id, first_name, last_name, email, phone, company_id, lead_status, lifecycle_stage, city, country, job_title, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [contactId, tenant.id, firstName, lastName, `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`, `+1-555-${String(1000 + i).slice(1)}`, company?.id || null, randomElement(LEAD_STATUSES), randomElement(['subscriber','lead','mql','sql','opportunity','customer']), randomElement(CITIES), 'USA', randomElement(TITLES), randomDate(120)]
      ).catch(() => {});
      allContactIds[tenant.id].push(contactId);
      contactCount++;
    }
  }
  console.log(`✓ Created ${contactCount} contacts\n`);

  // ── Create leads ──
  console.log('Creating leads...');
  let leadCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const { rows: companies } = await query('SELECT id,name FROM public.companies WHERE tenant_id=$1', [tenant.id]);
    for (let i = 0; i < 40; i++) {
      const leadId = generateId();
      const firstName = randomElement(FIRST_NAMES);
      const lastName = randomElement(LAST_NAMES);
      const company = companies.length ? randomElement(companies) : null;
      const assignedTo = users.length ? randomElement(users).id : null;
      const createdBy = users.length ? randomElement(users).id : null;
      await query(
        `INSERT INTO public.leads (id, tenant_id, first_name, last_name, email, phone, company_name, lead_status, lead_source, score, city, country, budget, assigned_to, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
        [leadId, tenant.id, firstName, lastName, `${firstName.toLowerCase()}.${lastName.toLowerCase()}.lead${i}@example.com`, `+1-555-${String(2000 + i).slice(1)}`, company?.name || null, randomElement(LEAD_STATUSES), randomElement(LEAD_SOURCES), Math.floor(Math.random() * 100), randomElement(CITIES), 'USA', Math.floor(Math.random() * 500000), assignedTo, createdBy, randomDate(60)]
      );
      leadCount++;
    }
  }
  console.log(`✓ Created ${leadCount} leads\n`);

  // ── Create deals ──
  console.log('Creating deals...');
  let dealCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const contactIds = allContactIds[tenant.id] || [];
    const { rows: companies } = await query('SELECT id,name FROM public.companies WHERE tenant_id=$1', [tenant.id]);
    for (let i = 0; i < 30; i++) {
      const dealId = generateId();
      const contactId = contactIds.length ? randomElement(contactIds) : null;
      const company = companies.length ? randomElement(companies) : null;
      const assignedTo = users.length ? randomElement(users).id : null;
      const value = Math.floor(Math.random() * 500000) + 10000;
      const stage = randomElement(DEAL_STAGES);
      const closeDate = new Date(); closeDate.setDate(closeDate.getDate() + Math.floor(Math.random() * 180) - 30);
      await query(
        `INSERT INTO public.deals (id, tenant_id, title, value, stage, probability, close_date, contact_id, company_id, assigned_to, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [dealId, tenant.id, `Deal ${company?.name || 'Project'} ${String.fromCharCode(65 + (i % 26))}`, value, stage, Math.floor(Math.random() * 80) + 10, closeDate.toISOString().split('T')[0], contactId, company?.id || null, assignedTo, randomDate(90)]
      );
      dealCount++;
    }
  }
  console.log(`✓ Created ${dealCount} deals\n`);

  // ── Create tasks ──
  console.log('Creating tasks...');
  let taskCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const contactIds = allContactIds[tenant.id] || [];
    const taskTitles = ['Follow up call','Send proposal','Schedule demo','Review contract','Send invoice','Prepare presentation','Check references','Update CRM','Send thank you email','Quarterly review'];
    for (let i = 0; i < 30; i++) {
      const taskId = generateId();
      const contactId = contactIds.length ? randomElement(contactIds) : null;
      const assignedTo = users.length ? randomElement(users).id : null;
      const completed = Math.random() > 0.6;
      const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + Math.floor(Math.random() * 60) - 20);
      await query(
        `INSERT INTO public.tasks (id, tenant_id, title, description, priority, due_date, completed, contact_id, assigned_to, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [taskId, tenant.id, randomElement(taskTitles), `Task description for ${contactId ? 'contact' : 'general task'}`, randomElement(TASK_PRIORITIES), dueDate.toISOString().split('T')[0], completed, contactId, assignedTo, randomDate(60)]
      );
      taskCount++;
    }
  }
  console.log(`✓ Created ${taskCount} tasks\n`);

  // ── Create activities ──
  console.log('Creating activities...');
  let activityCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const contactIds = allContactIds[tenant.id] || [];
    for (let i = 0; i < 60; i++) {
      const contactId = contactIds.length ? randomElement(contactIds) : null;
      const userId = users.length ? randomElement(users).id : null;
      const type = randomElement(ACTIVITY_TYPES);
      const descriptions = {
        note: 'Left a note about the conversation',
        call: 'Had a productive phone call',
        email: 'Sent follow-up email with proposal',
        meeting: 'Scheduled demo meeting for next week',
        task: 'Completed follow-up task',
        deal_update: 'Updated deal stage and value',
      };
      await query(
        `INSERT INTO public.activities (tenant_id, contact_id, user_id, type, description, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [tenant.id, contactId, userId, type, descriptions[type], randomDate(30)]
      );
      activityCount++;
    }
  }
  console.log(`✓ Created ${activityCount} activities\n`);

  // ── Create notes ──
  console.log('Creating notes...');
  let noteCount = 0;
  for (const tenant of tenants) {
    const users = tenantUsers[tenant.id] || [];
    const contactIds = allContactIds[tenant.id] || [];
    const noteTexts = ['Interested in enterprise plan','Needs technical demo','Budget approved for Q2','Decision maker is CTO','Competitor evaluation in progress','Follow up next month','Sent pricing details','Positive feedback on product','Requested custom integration','Waiting for internal approval'];
    for (let i = 0; i < 20; i++) {
      const contactId = contactIds.length ? randomElement(contactIds) : null;
      const userId = users.length ? randomElement(users).id : null;
      await query(
        `INSERT INTO public.notes (id, tenant_id, contact_id, user_id, content, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [generateId(), tenant.id, contactId, userId, randomElement(noteTexts), randomDate(30)]
      );
      noteCount++;
    }
  }
  console.log(`✓ Created ${noteCount} notes\n`);

  // ── Create pipelines ──
  console.log('Creating pipelines...');
  for (const tenant of tenants) {
    for (const name of PIPELINES) {
      await query(
        `INSERT INTO public.pipelines (tenant_id, name, is_default, created_at)
         VALUES ($1,$2,$3,$4)`,
        [tenant.id, `${name} - ${tenant.name}`, name === 'Sales Pipeline', randomDate(180)]
      ).catch(() => {});
    }
  }
  console.log('✓ Created pipelines\n');

  console.log('🎉 Massive data seeding completed!');
  console.log('\n📊 Summary:');
  console.log(`   - ${companyCount} companies`);
  console.log(`   - ${contactCount} contacts`);
  console.log(`   - ${leadCount} leads`);
  console.log(`   - ${dealCount} deals`);
  console.log(`   - ${taskCount} tasks`);
  console.log(`   - ${activityCount} activities`);
  console.log(`   - ${noteCount} notes`);
}

seed().catch(e => { console.error('❌ Error:', e); process.exit(1); }).finally(() => pool.end());
