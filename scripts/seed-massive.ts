/**
 * NuCRM — Massive Data Seeder
 * Seeds contacts, leads, deals, companies, tasks, activities
 */
import { Pool } from 'pg';

const DB = process.env.DATABASE_URL || 'postgresql://postgres:postgres123@localhost:5432/nucrm';
const pool = new Pool({ connectionString: DB, ssl: false });

const FN = ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Emma','Liam','Olivia','Noah','Ava','Lucas','Sophia','Mason','Isabella','Ethan','Mia','Logan','Charlotte','Alexander','Amelia','Daniel','Harper','Henry','Evelyn','Sebastian','Abigail','Jack','Emily','Aiden','Ella','Owen','Scarlett','Samuel','Grace','Ryan','Chloe','Nathan','Victoria','Caleb','Riley','Isaac','Luna','Leo','Aria','Luke','Maya','Jayden','Layla','Dylan','Aurora'];
const LN = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts'];
const COMPANIES = ['Acme Corp','TechStart','DataFlow','CloudNine','ByteWorks','PixelLab','CodeCraft','NetPulse','AppForge','ByteSprint','WebScale','InfoSync','DigiCore','CyberPeak','LogicWave','SmartOps','QuickByte','DataVault','NetForge','AppSphere'];
const SOURCES = ['website','linkedin','referral','cold_call','conference','google_ads','facebook','twitter','newsletter','webinar'];
const STATUSES = ['new','contacted','qualified','proposal','negotiation','won','lost'];
const STAGES = ['lead','qualified','proposal','negotiation','won','lost'];
const PRIORITY = ['low','medium','high','urgent'];
const LEAD_SRC = ['website','referral','linkedin','cold_call','conference','google_ads'];

let tenantId: string, userId: string;

const rand = <T>(a: T[]): T => a[Math.floor(Math.random() * a.length)]!;
const ri = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const rd = (days: number) => { const d = new Date(); d.setDate(d.getDate() - ri(0, days)); return d.toISOString(); };

async function main() {
  console.log('🚀 Starting massive data seed...\n');

  // Get tenant/user
  const t = await pool.query('SELECT id FROM public.tenants ORDER BY created_at DESC LIMIT 1');
  tenantId = t.rows[0].id;
  const u = await pool.query('SELECT id FROM public.users ORDER BY created_at DESC LIMIT 1');
  userId = u.rows[0].id;
  console.log(`  Tenant: ${tenantId}\n  User: ${userId}\n`);

  // ── Companies ──
  console.log('📦 Seeding 50 companies...');
  for (let i = 0; i < 50; i++) {
    await pool.query(
      `INSERT INTO public.companies(tenant_id,name,website,industry,size,created_at)
       VALUES($1,$2,$3,$4,$5,$6)`,
      [tenantId, `${rand(COMPANIES)} ${i}`, `https://company${i}.com`, rand(['tech','healthcare','finance','retail']), ri(10,5000), rd(90)]
    );
  }
  const companies = await pool.query('SELECT id FROM public.companies WHERE tenant_id=$1', [tenantId]);
  const compIds = companies.rows.map((r: any) => r.id);
  console.log(`  ✅ ${compIds.length} companies\n`);

  // ── Contacts ──
  console.log('📦 Seeding 200 contacts...');
  for (let i = 0; i < 200; i++) {
    const fn = rand(FN), ln = rand(LN);
    await pool.query(
      `INSERT INTO public.contacts(tenant_id,first_name,last_name,email,phone,company_id,lead_status,created_at,last_activity_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, fn, ln, `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@email.com`, `+1${ri(200,999)}${ri(100,999)}${ri(1000,9999)}`, rand(compIds), rand(STATUSES), rd(60), rd(5)]
    );
  }
  const contacts = await pool.query('SELECT id FROM public.contacts WHERE tenant_id=$1', [tenantId]);
  const cIds = contacts.rows.map((r: any) => r.id);
  console.log(`  ✅ ${cIds.length} contacts\n`);

  // ── Leads ──
  console.log('📦 Seeding 150 leads...');
  for (let i = 0; i < 150; i++) {
    const fn = rand(FN), ln = rand(LN);
    await pool.query(
      `INSERT INTO public.leads(tenant_id,first_name,last_name,email,phone,company_name,lead_source,lead_status,lifecycle_stage,budget,score,authority_level,country,city,created_at,last_activity_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
      [tenantId, fn, ln, `${fn.toLowerCase()}.${ln.toLowerCase()}${i}@lead.com`, `+1${ri(200,999)}${ri(100,999)}${ri(1000,9999)}`, rand(COMPANIES), rand(LEAD_SRC), rand(STATUSES), rand(STAGES), ri(1000,100000), ri(0,100), rand(['decision_maker','influencer','unknown']), rand(['US','UK','CA','DE','AU']), rand(['New York','London','Toronto','Berlin','Sydney']), rd(45), rd(3)]
    );
  }
  const leads = await pool.query('SELECT count(*) FROM public.leads WHERE tenant_id=$1', [tenantId]);
  console.log(`  ✅ ${leads.rows[0].count} leads\n`);

  // ── Deals ──
  console.log('📦 Seeding 100 deals...');
  const dealStages = await pool.query('SELECT id,name FROM public.deal_stages WHERE tenant_id=$1', [tenantId]);
  const stageIds = dealStages.rows.map((r: any) => r.id);
  for (let i = 0; i < 100; i++) {
    await pool.query(
      `INSERT INTO public.deals(tenant_id,title,value,stage,contact_id,company_id,close_date,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tenantId, `Deal ${i+1} - ${rand(COMPANIES)}`, ri(1000,500000), rand(stageIds.length ? stageIds : [{id:null}]).id || null, rand(cIds), rand(compIds), rd(-30), rd(30)]
    );
  }
  const deals = await pool.query('SELECT count(*) FROM public.deals WHERE tenant_id=$1', [tenantId]);
  console.log(`  ✅ ${deals.rows[0].count} deals\n`);

  // ── Tasks ──
  console.log('📦 Seeding 150 tasks...');
  for (let i = 0; i < 150; i++) {
    await pool.query(
      `INSERT INTO public.tasks(tenant_id,title,due_date,priority,completed,contact_id,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [tenantId, `Task ${i+1}: ${rand(['Follow up','Send proposal','Schedule demo','Review contract','Update CRM','Call client'])}`, rd(-10), rand(PRIORITY), Math.random()>0.7, rand(cIds), rd(30)]
    );
  }
  const tasks = await pool.query('SELECT count(*) FROM public.tasks WHERE tenant_id=$1', [tenantId]);
  console.log(`  ✅ ${tasks.rows[0].count} tasks\n`);

  // ── Activities ──
  console.log('📦 Seeding 300 activities...');
  for (let i = 0; i < 300; i++) {
    const cid = rand(cIds);
    await pool.query(
      `INSERT INTO public.activities(tenant_id,user_id,type,description,contact_id,entity_type,entity_id,action,created_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, userId, rand(['call','email','meeting','note','created']), rand(['Discussed pricing','Sent proposal','Followed up','Updated info','Scheduled demo','Closed deal']), cid, 'contact', cid, rand(['created','updated','called','emailed','met']), rd(30)]
    );
  }
  const activities = await pool.query('SELECT count(*) FROM public.activities WHERE tenant_id=$1', [tenantId]);
  console.log(`  ✅ ${activities.rows[0].count} activities\n`);

  // ── Summary ──
  console.log('═══════════════════════════════════════');
  console.log('  🎉 Seed Complete!');
  console.log('═══════════════════════════════════════');
  const stats = await pool.query(
    `SELECT 
      (SELECT count(*) FROM public.contacts WHERE tenant_id=$1) as contacts,
      (SELECT count(*) FROM public.leads WHERE tenant_id=$1) as leads,
      (SELECT count(*) FROM public.deals WHERE tenant_id=$1) as deals,
      (SELECT count(*) FROM public.companies WHERE tenant_id=$1) as companies,
      (SELECT count(*) FROM public.tasks WHERE tenant_id=$1) as tasks,
      (SELECT count(*) FROM public.activities WHERE tenant_id=$1) as activities`,
    [tenantId]
  );
  const s = stats.rows[0];
  console.log(`  Contacts:    ${s.contacts}`);
  console.log(`  Leads:       ${s.leads}`);
  console.log(`  Deals:       ${s.deals}`);
  console.log(`  Companies:   ${s.companies}`);
  console.log(`  Tasks:       ${s.tasks}`);
  console.log(`  Activities:  ${s.activities}`);
  console.log('═══════════════════════════════════════');

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
