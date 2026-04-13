/**
 * NuCRM SaaS v2 — Massive Data Seeder
 * Seeds thousands of realistic contacts, leads, deals, companies, tasks, activities
 *
 * Usage:
 *   node --experimental-strip-types scripts/seed-massive-data.ts
 *
 * Options (env vars or args):
 *   TENANT_ID    — Target tenant (defaults to first found)
 *   USER_ID      — Owner user (defaults to first found)
 *   CONTACTS     — Number of contacts (default: 500)
 *   LEADS        — Number of leads (default: 200)
 *   DEALS        — Number of deals (default: 100)
 *   COMPANIES    — Number of companies (default: 50)
 *   TASKS        — Number of tasks (default: 150)
 */

import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  console.error('Example: DATABASE_URL=postgresql://postgres:password@localhost:5432/nucrm');
  process.exit(1);
}

// ─── Config ───────────────────────────────────────────────────────────
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: false,
});

const TENANT_ID = process.env['TENANT_ID'] || null;
const USER_ID = process.env['USER_ID'] || null;
const COUNTS = {
  contacts:  parseInt(process.env['CONTACTS'] || '500', 10),
  leads:     parseInt(process.env['LEADS'] || '200', 10),
  deals:     parseInt(process.env['DEALS'] || '100', 10),
  companies: parseInt(process.env['COMPANIES'] || '50', 10),
  tasks:     parseInt(process.env['TASKS'] || '150', 10),
};

// ─── Realistic Data Generators ────────────────────────────────────────
const FIRST_NAMES = ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Lisa','Daniel','Nancy','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley','Steven','Dorothy','Paul','Kimberly','Andrew','Emily','Joshua','Donna','Kenneth','Michelle','Kevin','Carol','Brian','Amanda','George','Melissa','Timothy','Deborah','Ronald','Stephanie','Edward','Rebecca','Jason','Sharon','Jeffrey','Laura','Ryan','Cynthia','Jacob','Kathleen','Gary','Amy','Nicholas','Angela','Eric','Shirley','Jonathan','Anna','Stephen','Brenda','Larry','Pamela','Justin','Emma','Scott','Nicole','Brandon','Helen','Benjamin','Samantha','Samuel','Katherine','Raymond','Christine','Gregory','Debra','Alexander','Rachel','Patrick','Carolyn','Frank','Janet','Dennis','Maria','Jerry','Heather','Tyler','Diane','Aaron','Ruth','Jose','Julie','Adam','Olivia','Nathan','Joyce','Henry','Virginia','Douglas','Victoria','Peter','Kelly','Zachary','Lauren','Noah','Christina'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'];
const COMPANIES = ['Acme Corp','TechFlow','DataSync','CloudNine','PixelForge','NexaBase','QuantumLeap','SwiftEdge','BlueHarbor','IronClad','NovaStar','ApexPoint','CrystalWave','EchoValley','FlexiCore','GridLine','Hyperion','InnoVista','JadePeak','Kinetic','Luminar','MetroGrid','Nimbus','OptiCore','PulseTech','Quasar','RapidAxis','SolarPeak','TitanEdge','UltraSync','Vertex','Windward','Xenon','YieldMax','Zenith','AlphaWave','BravoNet','CipherSoft','DeltaCore','EchoTech','FusionHub','GammaLine','HorizonX','Infinity','JetStream','Krypton','LogicWave','MatrixCore','NeonPeak','OmegaGrid','PrismTech','QuantumSoft','RadiantX','SigmaNet','TerraCore','UnityWave','VortexTech','WaveSync','XenoGrid','YellowPeak','ZephyrCore'];
const INDUSTRIES = ['Technology','Healthcare','Finance','Manufacturing','Retail','Education','Real Estate','Consulting','Media','Transportation','Energy','Agriculture','Telecommunications','Hospitality','Insurance','Legal','Construction','Automotive','Pharmaceuticals','Food & Beverage'];
const TITLES = ['CEO','CTO','CFO','COO','VP Engineering','VP Sales','VP Marketing','Director of Engineering','Head of Product','Engineering Manager','Senior Developer','Product Manager','Sales Manager','Marketing Director','Business Development Manager','Account Executive','Customer Success Manager','Operations Manager','HR Director','Data Scientist'];
const SOURCES = ['website','referral','linkedin','google_ads','cold_call','conference','twitter','facebook','partner','inbound_email','event','content_download','webinar','demo_request','outbound_email'];
const STAGES = ['new','contacted','qualified','unqualified','converted','lost'];
const DEAL_STAGES = ['lead','qualified','proposal','negotiation','closed_won','closed_lost'];
const TASK_TITLES = ['Follow up on proposal','Schedule demo call','Send pricing information','Review contract terms','Prepare presentation','Quarterly review','Update CRM records','Call to check interest','Send onboarding materials','Contract renewal discussion','Product training session','Handle support ticket','Invoice follow-up','Partnership exploration','Market research analysis'];
const LIFECYCLE = ['subscriber','lead','marketing_qualified_lead','sales_qualified_lead','opportunity','customer','evangelist'];

function rand(arr: any[]) { return arr[Math.floor(Math.random() * arr.length)]; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function randFloat(min: number, max: number) { return Math.random() * (max - min) + min; }
function pickN(arr: any[], n: number) { const s = new Set(); while (s.size < n && s.size < arr.length) s.add(rand(arr)); return Array.from(s); }
function randDate(daysBack: number) { const d = new Date(); d.setDate(d.getDate() - randInt(0, daysBack)); return d.toISOString(); }
function slug(name: string) { return name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 50); }

// ─── Seed Functions ───────────────────────────────────────────────────
let tenantId: string;
let userId: string;
let companyIds: string[] = [];

async function resolveTenantAndUser() {
  if (TENANT_ID) {
    tenantId = TENANT_ID;
  } else {
    const { rows } = await pool.query('SELECT id FROM public.tenants ORDER BY created_at DESC LIMIT 1');
    if (!rows[0]) throw new Error('No tenants found. Create a tenant first.');
    tenantId = rows[0].id;
    console.log(`  Using tenant: ${tenantId}`);
  }

  if (USER_ID) {
    userId = USER_ID;
  } else {
    const { rows } = await pool.query('SELECT id FROM public.users ORDER BY created_at DESC LIMIT 1');
    if (!rows[0]) throw new Error('No users found.');
    userId = rows[0].id;
    console.log(`  Using user: ${userId}`);
  }
}

async function seedCompanies() {
  console.log(`\n📦 Seeding ${COUNTS.companies} companies...`);
  const t0 = Date.now();
  const values: string[] = [];
  const params: any[] = [];
  let i = 0;
  
  while (i < COUNTS.companies) {
    const name = rand(COMPANIES) + ' ' + randInt(1, 999);
    const industry = rand(INDUSTRIES);
    const website = `https://${name.toLowerCase().replace(/[^a-z0-9]/g, '')}.com`;
    const companySize = rand(['1-10', '11-50', '51-200', '201-500', '501-1000', '1001-5000']);
    const annualRevenue = randInt(100000, 50000000);
    const phone = `+1${randInt(200,999)}${randInt(1000000,9999999)}`;
    const created = randDate(365);
    const city = rand(['New York', 'San Francisco', 'Chicago', 'Austin', 'Seattle', 'Denver', 'Boston', 'Miami', 'LA', 'Portland']);
    const state = rand(['CA', 'NY', 'TX', 'WA', 'IL', 'MA', 'FL', 'CO']);
    const country = 'US';
    const description = `A leading ${industry.toLowerCase()} company specializing in innovative solutions.`;
    
    values.push(`($${i * 13 + 1},$${i * 13 + 2},$${i * 13 + 3},$${i * 13 + 4},$${i * 13 + 5},$${i * 13 + 6},$${i * 13 + 7},$${i * 13 + 8},$${i * 13 + 9},$${i * 13 + 10},$${i * 13 + 11},$${i * 13 + 12},$${i * 13 + 13})`);
    params.push(tenantId, name, industry, companySize, website, phone, annualRevenue, userId, created, city, state, country, description);
    i++;
  }

  const { rows } = await pool.query(
    `INSERT INTO public.companies (tenant_id, name, industry, company_size, website, phone, annual_revenue, created_by, created_at, city, state, country, description)
     VALUES ${values.join(',\n')} RETURNING id`,
    params
  );
  companyIds = rows.map((r: any) => r.id);
  console.log(`  ✅ ${rows.length} companies in ${Date.now() - t0}ms`);
}

async function seedContacts() {
  console.log(`\n📦 Seeding ${COUNTS.contacts} contacts...`);
  const t0 = Date.now();
  const batchSize = 200;
  let seeded = 0;

  while (seeded < COUNTS.contacts) {
    const batch = Math.min(batchSize, COUNTS.contacts - seeded);
    const values: string[] = [];
    const params: any[] = [];
    
    for (let i = 0; i < batch; i++) {
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      const email = `${slug(firstName)}.${slug(lastName)}${randInt(1,99)}@${rand(['gmail.com','yahoo.com','outlook.com','company.io','tech.co','mail.org'])}`.toLowerCase();
      const phone = `+1${randInt(200,999)}${randInt(1000000,9999999)}`;
      const companyId = companyIds.length ? rand(companyIds) : null;
      const leadStatus = rand(['new', 'contacted', 'qualified', 'converted']);
      const source = rand(SOURCES);
      const score = randInt(0, 100);
      const tags = pickN(['vip', 'hot_lead', 'enterprise', 'startup', 'government', 'nonprofit', 'education'], randInt(0, 3));
      const city = rand(['New York', 'San Francisco', 'Chicago', 'Austin', 'Seattle', 'Denver', 'Boston', 'Miami', 'LA', 'Portland']);
      const country = 'US';
      const linkedin = `https://linkedin.com/in/${slug(firstName)}-${slug(lastName)}-${randInt(1,999)}`;
      const created = randDate(365);
      const notes = rand(['Met at conference', 'Inbound from website', 'Referred by existing customer', 'Cold outreach response']);

      const pIdx = i * 15;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},lower($${pIdx+4}),$${pIdx+5},$${pIdx+6},$${pIdx+7},$${pIdx+8},$${pIdx+9},$${pIdx+10},$${pIdx+11},$${pIdx+12},$${pIdx+13},$${pIdx+14},$${pIdx+15})`);
      params.push(tenantId, firstName, lastName, email, phone, city, country, tags, notes, linkedin, source, leadStatus, score, userId, created);
    }

    await pool.query(
      `INSERT INTO public.contacts (tenant_id, first_name, last_name, email, phone, city, country, tags, notes, linkedin_url, lead_source, lead_status, score, created_by, created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ ${COUNTS.contacts} contacts in ${Date.now() - t0}ms`);
}

async function seedLeads() {
  console.log(`\n📦 Seeding ${COUNTS.leads} leads...`);
  const t0 = Date.now();
  const batchSize = 200;
  let seeded = 0;

  while (seeded < COUNTS.leads) {
    const batch = Math.min(batchSize, COUNTS.leads - seeded);
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < batch; i++) {
      const firstName = rand(FIRST_NAMES);
      const lastName = rand(LAST_NAMES);
      const email = `${slug(firstName)}.${slug(lastName)}${randInt(1,99)}@${rand(['gmail.com','company.io','tech.co'])}`.toLowerCase();
      const phone = `+1${randInt(200,999)}${randInt(1000000,9999999)}`;
      const companyName = rand(COMPANIES) + ' ' + randInt(1, 999);
      const status = rand(STAGES.slice(0, 4));
      const source = rand(SOURCES);
      const score = randInt(0, 100);
      const title = rand(TITLES);
      const city = rand(['New York', 'San Francisco', 'Chicago', 'Austin', 'Seattle']);
      const state = rand(['CA', 'NY', 'TX', 'WA', 'IL']);
      const country = 'US';
      const created = randDate(180);

      const pIdx = i * 14;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},lower($${pIdx+4}),$${pIdx+5},$${pIdx+6},$${pIdx+7},$${pIdx+8},$${pIdx+9},$${pIdx+10},$${pIdx+11},$${pIdx+12},$${pIdx+13},$${pIdx+14})`);
      params.push(tenantId, firstName, lastName, email, phone, title, companyName, null, city, state, country, source, status, created);
    }

    await pool.query(
      `INSERT INTO public.leads (tenant_id, first_name, last_name, email, phone, title, company_name, assigned_to, city, state, country, lead_source, lead_status, created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ ${COUNTS.leads} leads in ${Date.now() - t0}ms`);
}

async function seedDeals() {
  console.log(`\n📦 Seeding ${COUNTS.deals} deals...`);
  const t0 = Date.now();
  const batchSize = 100;
  let seeded = 0;
  const dealStages = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];

  while (seeded < COUNTS.deals) {
    const batch = Math.min(batchSize, COUNTS.deals - seeded);
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < batch; i++) {
      const title = `${rand(['New','Enterprise','Partnership','Renewal','Expansion','Pilot'])} Deal #${randInt(1000, 9999)}`;
      const value = randInt(1000, 500000);
      const stageIdx = randInt(0, 3); // mostly early stages
      const stage = dealStages[stageIdx];
      const companyId = companyIds.length ? rand(companyIds) : null;
      const closeDate = randDate(randInt(-30, 180));
      const probability = [10, 25, 50, 75, 90, 100][stageIdx] || 10;
      const notes = rand(['Initial discussion phase', 'Proposal sent', 'Negotiating terms', 'Final review pending', 'Awaiting legal approval']);
      const currency = 'USD';
      const created = randDate(365);

      const pIdx = i * 10;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6},$${pIdx+7},$${pIdx+8},$${pIdx+9},$${pIdx+10})`);
      params.push(tenantId, title, value, stage, probability, companyId, closeDate, notes, userId, created);
    }

    await pool.query(
      `INSERT INTO public.deals (tenant_id, title, value, stage, probability, company_id, close_date, notes, created_by, created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ ${COUNTS.deals} deals in ${Date.now() - t0}ms`);
}

async function seedTasks() {
  console.log(`\n📦 Seeding ${COUNTS.tasks} tasks...`);
  const t0 = Date.now();
  const batchSize = 200;
  let seeded = 0;
  const priorities = ['low', 'medium', 'high'];

  while (seeded < COUNTS.tasks) {
    const batch = Math.min(batchSize, COUNTS.tasks - seeded);
    const values: string[] = [];
    const params: any[] = [];

    for (let i = 0; i < batch; i++) {
      const title = rand(TASK_TITLES) + ' #' + randInt(1, 999);
      const priority = rand(priorities);
      const completed = Math.random() < 0.3; // 30% completed
      const dueDate = randDate(randInt(-30, 60));
      const created = randDate(180);
      const description = rand(['Follow up with the client', 'Prepare documentation', 'Review progress', 'Schedule next steps']);

      const pIdx = i * 7;
      values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6},$${pIdx+7})`);
      params.push(tenantId, title, priority, completed, dueDate, userId, created);
    }

    await pool.query(
      `INSERT INTO public.tasks (tenant_id, title, priority, completed, due_date, created_by, created_at)
       VALUES ${values.join(',\n')}`,
      params
    );
    seeded += batch;
  }
  console.log(`  ✅ ${COUNTS.tasks} tasks in ${Date.now() - t0}ms`);
}

async function seedActivities() {
  console.log(`\n📦 Seeding activities...`);
  const t0 = Date.now();

  const { rows: contacts } = await pool.query('SELECT id FROM public.contacts WHERE tenant_id=$1 LIMIT 50', [tenantId]);
  const { rows: deals } = await pool.query('SELECT id FROM public.deals WHERE tenant_id=$1 LIMIT 30', [tenantId]);
  const contactIds = contacts.map(c => c.id);
  const dealIds = deals.map(d => d.id);

  if (!contactIds.length && !dealIds.length) { console.log('  ⏭️  No contacts/deals to link activities to'); return; }

  const activityTypes = ['note', 'call', 'email', 'meeting', 'task', 'deal_update'];
  const eventTypes = ['contact_created', 'deal_updated', 'note_added', 'call_logged', 'email_sent'];
  const notes = [
    'Discussed pricing options for enterprise plan.',
    'Interested in API integration capabilities.',
    'Follow up next week regarding implementation timeline.',
    'Requested demo for their engineering team.',
    'Currently evaluating competitors. Key differentiator: our support.',
    'Budget approved. Moving to procurement phase.',
    'Technical requirements sent. Waiting for security review.',
    'Scheduled onboarding call for next Monday.',
    'Champion identified: CTO is pushing for adoption.',
    'Competitor mentioned: Salesforce. Our advantage: simpler pricing.',
  ];

  const values: string[] = [];
  const params: any[] = [];
  const count = Math.min(200, contactIds.length * 3 + dealIds.length * 2);

  for (let i = 0; i < count; i++) {
    const type = rand(activityTypes);
    const contactId = contactIds.length ? rand(contactIds) : null;
    const dealId = dealIds.length ? rand(dealIds) : null;
    const description = rand(notes);
    const created = randDate(90);

    const pIdx = i * 7;
    values.push(`($${pIdx+1},$${pIdx+2},$${pIdx+3},$${pIdx+4},$${pIdx+5},$${pIdx+6},$${pIdx+7})`);
    params.push(tenantId, contactId, dealId, userId, type, description, created);
  }

  await pool.query(
    `INSERT INTO public.activities (tenant_id, contact_id, deal_id, user_id, type, description, created_at)
     VALUES ${values.join(',\n')}`,
    params
  );
  console.log(`  ✅ ${count} activities in ${Date.now() - t0}ms`);
}

// ─── Main ─────────────────────────────────────────────────────────────
async function main() {
  console.log('========================================');
  console.log('  NuCRM Massive Data Seeder');
  console.log('========================================');
  console.log(`  Contacts:  ${COUNTS.contacts}`);
  console.log(`  Leads:     ${COUNTS.leads}`);
  console.log(`  Deals:     ${COUNTS.deals}`);
  console.log(`  Companies: ${COUNTS.companies}`);
  console.log(`  Tasks:     ${COUNTS.tasks}`);

  const t0 = Date.now();

  await resolveTenantAndUser();

  await seedCompanies();
  await seedContacts();
  await seedLeads();
  await seedDeals();
  await seedTasks();
  await seedActivities();

  console.log(`\n========================================`);
  console.log(`  ✅ Seeding complete in ${(Date.now() - t0) / 1000}s`);
  console.log(`========================================`);

  // Show summary
  const summary = await pool.query(
    `SELECT 'contacts' as entity, count(*) FROM public.contacts WHERE tenant_id=$1
     UNION ALL SELECT 'leads', count(*) FROM public.leads WHERE tenant_id=$1
     UNION ALL SELECT 'deals', count(*) FROM public.deals WHERE tenant_id=$1
     UNION ALL SELECT 'companies', count(*) FROM public.companies WHERE tenant_id=$1
     UNION ALL SELECT 'tasks', count(*) FROM public.tasks WHERE tenant_id=$1
     UNION ALL SELECT 'activities', count(*) FROM public.activities WHERE tenant_id=$1`,
    [tenantId]
  );
  console.log('\n📊 Summary:');
  summary.rows.forEach(r => console.log(`  ${r.entity.padEnd(12)}: ${Number(r.count).toLocaleString()}`));

  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
