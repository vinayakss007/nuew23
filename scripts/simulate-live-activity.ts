/**
 * NuCRM Real-Time Activity Simulator
 *
 * Continuously injects realistic CRM activity to simulate live user behavior.
 * Creates contacts, leads, deals, tasks, activities, notifications, deal stage
 * movements, and more — at configurable rates.
 *
 * Usage:
 *   npx tsx scripts/simulate-live-activity.ts
 *   TENANT_ID=xxx USER_ID=xxx RATE=fast npx tsx scripts/simulate-live-activity.ts
 *
 * Options:
 *   TENANT_ID  — Target tenant (default: first found)
 *   USER_ID    — Acting user (default: first found)
 *   RATE       — Speed: slow (30s), normal (10s), fast (3s), extreme (1s)
 *   DURATION   — Run duration in seconds (default: 0 = forever)
 */

import { Pool } from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('ERROR: DATABASE_URL environment variable is required');
  process.exit(1);
}

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: false,
});

const TENANT_ID = process.env['TENANT_ID'] || null;
const USER_ID = process.env['USER_ID'] || null;
const RATE = (process.env['RATE'] || 'normal').toLowerCase();
const DURATION = parseInt(process.env['DURATION'] || '0', 10);

const INTERVAL_MS: Record<string, number> = { slow: 30000, normal: 10000, fast: 3000, extreme: 1000 };
const intervalMs = INTERVAL_MS[RATE] || 10000;

let tenantId: string;
let userId: string;
let running = true;

// ── Data Generators ───────────────────────────────────────────
const FIRST_NAMES = ['James','Mary','John','Patricia','Robert','Jennifer','Michael','Linda','David','Elizabeth','William','Barbara','Richard','Susan','Joseph','Jessica','Thomas','Sarah','Charles','Karen','Christopher','Lisa','Daniel','Nancy','Matthew','Betty','Anthony','Margaret','Mark','Sandra','Donald','Ashley','Steven','Dorothy','Paul','Kimberly','Andrew','Emily','Joshua','Donna','Kenneth','Michelle','Kevin','Carol','Brian','Amanda','George','Melissa','Timothy','Deborah','Ronald','Stephanie','Edward','Rebecca','Jason','Sharon','Jeffrey','Laura','Ryan','Cynthia','Jacob','Kathleen','Gary','Nicholas','Eric','Jonathan','Stephen','Larry','Justin','Scott','Brandon','Benjamin','Samuel','Raymond','Gregory','Alexander','Patrick','Frank','Jack','Dennis','Jerry','Tyler','Aaron','Jose','Adam','Nathan','Henry','Douglas','Peter','Zachary','Kyle','Noah','Ethan','Jeremy','Christian','Keith','Roger','Terry','Austin','Sean','Gerald','Carl','Dylan','Harold','Jordan','Jesse','Bryan','Billy','Bruce','Gabriel','Joe','Logan','Alan','Juan','Albert','Willie','Elijah','Wayne','Randy','Mason','Vincent','Liam','Evan','Roy','Louis','Bobby','Ralph','Austin','Nicholas','Jesse','Jordan','Bryan','Harry','Steve','Connor','Chase','Cody','Cameron','Blake','Isaac','Wyatt','Caleb','Luke','Connor','Hunter','Parker','Owen','Tristan','Adrian','Colton','Ian','Dominic','Nolan','Cooper','Gavin','Brayden','Xavier','Jaxon','Landon','Lincoln','Asher','Leo','Hudson','Axel','Easton','Josiah','Carson','Nathaniel','Santiago','Ezra','Miles','Jace','Roman','Jameson','Jayden','Bentley','Ryder','Declan','Weston','Micah','Beckett','Kai','Rowan','Damian','Tobias','Max','Emmett','George','Luis','Diego','Alejandro','Carlos','Eduardo','Rafael','Matias','Fernando','Sergio','Andres','Javier','Miguel','Arturo','Francisco','Manuel','Pedro','Angel','Raul','Hector','Oscar','Ricardo','Julio','Mario','Edgar','Victor','Martin','Roberto','Armando','Alfredo','Gerardo','Rodrigo','Enrique','Felipe','Guillermo','Jaime','Pablo','Ruben','Salvador','Saul','Tomas','Agustin','Bernardo','Calvin','Cesar','Clayton','Corey','Courtney','Craig','Dakota','Dallas','Darryl','Darrell','Darren','Darryl','Darry','Dewayne','Dewey','Don','Donald','Donnell','Donnie','Donovan','Doug','Douglas','Duane','Duncan','Dustin','Dwayne','Dwight','Earl','Easton','Ed','Eddie','Eddy','Edgar','Edmund','Edwin','Elbert','Elden','Eli','Elias','Elijah','Elisha','Elliot','Elliott','Elmer','Elton','Elvis','Emanuel','Emilio','Emmanuel','Emmett','Emmitt','Enoch','Enrique','Ephraim','Ernest','Ernesto','Ervin','Erwin','Esteban','Ethan','Eugene','Evan','Everett','Ezekiel','Ezra','Fabian','Felix','Ferdinand','Fidel','Floyd','Forrest','Foster','Frances','Francis','Francisco','Frank','Frankie','Franklin','Fred','Freddie','Frederick','Gabriel','Gage','Galen','Garfield','Garrett','Garry','Gary','Gavin','Gayle','Geoffrey','George','Gerald','Gerard','Gerry','Gilbert','Gilberto','Glen','Glenn','Gordon','Grady','Graham','Grant','Greg','Gregg','Gregory','Grover','Guido','Guillermo','Gunnar','Gunner','Gustavo','Guy','Hal','Hank','Harlan','Harland','Harley','Harold','Harrison','Harry','Harvey','Hayden','Heath','Hector','Henry','Herbert','Herman','Herschel','Hiram','Homer','Horace','Howard','Hubert','Hugo','Humberto','Hunter','Hyrum','Ian','Ignacio','Ike','Immanuel','Irvin','Irving','Irwin','Isaac','Isaiah','Isaias','Isiah','Ismael','Israel','Issac','Ivan','Izaiah','Jace','Jack','Jackie','Jackson','Jacob','Jacoby','Jaden','Jadon','Jaeden','Jaiden','Jaison','Jake','Jakob','Jalen','Jamar','Jamal','Jamarion','Jame','Jamell','James','Jameson','Jamey','Jamie','Jamison','Jan','Jared','Jaren','Jarod','Jaron','Jarred','Jarrett','Jarrod','Jarvis','Jason','Jasper','Javier','Javon','Javonte','Jay','Jayce','Jayden','Jaylan','Jaylen','Jaylon','Jayson','Jaziel','Jean','Jed','Jedediah','Jedidiah','Jeff','Jefferey','Jefferson','Jeffery','Jeffrey','Jeffry','Jensen','Jerald','Jeremiah','Jeremy','Jermaine','Jerome','Jerry','Jesse','Jessie','Jesus','Jett','Jevon','Jimmie','Jimmy','Joan','Joaquin','Joe','Joel','Joey','Johan','John','Johnathan','Johnathon','Johnnie','Johnny','Jon','Jonah','Jonas','Jonathan','Jonathon','Jordain','Jordan','Jorden','Jordon','Jordy','Jordyn','Jorge','Jose','Joseph','Josh','Joshua','Josiah','Josue','Jovan','Jovani','Jovanni','Jovanny','Jovany','Juan','Judah','Jude','Julian','Julio','Julius','Junior','Justice','Justin','Kade','Kaden','Kadyn','Kael','Kaiden','Kale','Kaleb','Kameron','Kamren','Kane','Karson','Kayden','Kayson','Keagan','Keaton','Keegan','Keegan','Keenan','Keith','Kellen','Kelton','Kelvin','Ken','Kendall','Kendrick','Kennedy','Kenneth','Kenny','Kent','Kenton','Kenyon','Keon','Keshawn','Keven','Kevin','Keyon','Khalil','Kian','Kieran','Killian','King','Kobe','Kody','Kolby','Kole','Kolten','Kolton','Konnor','Korbin','Korey','Kory','Kris','Kristian','Kristofer','Kristoffer','Kristopher','Kurt','Kurtis','Kyler','Kyson','Lance','Landen','Landon','Landyn','Lane','Lanny','Larry','Lauren','Lawrence','Lawson','Layton','Lee','Leif','Leland','Lemuel','Len','Leo','Leon','Leonard','Leonardo','Leroy','Leslie','Lester','Levi','Liam','Lincoln','Lionel','Lloyd','Logan','Lonnie','Lorenzo','Louis','Loyal','Luca','Lucas','Lucian','Luciano','Luis','Luka','Lukas','Luke','Lyndon','Lynn','Mac','Mack','Mackenzie','Madison','Magnus','Malachi','Malcolm','Malik','Manuel','Marc','Marcel','Marcelino','Marcellus','Marco','Marcos','Marcus','Mario','Marion','Mark','Marshall','Martin','Marty','Marvin','Mason','Mateo','Mathew','Matt','Matteo','Matthew','Maurice','Mauricio','Max','Maximilian','Maximiliano','Maximus','Maxwell','Mayson','Mekhi','Melvin','Melvyn','Micah','Michael','Micheal','Miguel','Mike','Mikel','Milan','Miles','Milo','Milton','Mitchell','Moises','Montana','Monte','Montgomery','Morgan','Morris','Moses','Moshe','Myles','Nasir','Nathan','Nathanael','Nathanial','Nathaniel','Nehemiah','Neil','Nelson','Nestor','Nevan','Nicholas','Nick','Nickolas','Nicolas','Nikolas','Nikolaus','Noah','Noel','Nolan','Norman','Nathaniel','Oakley','Obadiah','Obed','Octavio','Odin','Oliver','Omar','Omari','Orion','Orlando','Osvaldo','Oswaldo','Owen','Pablo','Palmer','Paris','Parker','Patrick','Paul','Paxton','Payton','Pedro','Perry','Pete','Peter','Peyton','Philip','Phillip','Phoenix','Porter','Preston','Price','Quentin','Quincy','Quinn','Quinten','Quinton','Rafael','Raheem','Rahul','Raiden','Ramon','Randy','Raphael','Rashad','Raul','Ray','Raymond','Raymundo','Reece','Reed','Reese','Reginald','Reid','Reilly','Remington','Rene','Reuben','Rey','Reynaldo','Rhett','Ricardo','Richard','Ricky','Rico','Riley','River','RJ','Rob','Robbie','Robby','Robert','Roberto','Robin','Rocco','Rocky','Rodger','Rodney','Rodolfo','Rodrick','Rodrigo','Roger','Rogelio','Roman','Romeo','Ron','Ronald','Ronaldo','Ronan','Ronnie','Ronny','Roosevelt','Rory','Roscoe','Ross','Rowan','Roy','Royal','Royce','Ruben','Russell','Rusty','Ryan','Ryder','Ryker','Rylan','Salvador','Salvatore','Sam','Samir','Sammie','Sammy','Samson','Samuel','Santino','Santos','Saul','Sawyer','Scott','Scottie','Scotty','Sean','Sebastian','Sergio','Seth','Seymour','Shamar','Shane','Shannon','Shaun','Shawn','Shelby','Sheldon','Shelton','Sherman','Sidney','Silas','Simon','Skyler','Solomon','Sonny','Spencer','Spike','Stanford','Stanley','Stefan','Stephan','Stephen','Steve','Steven','Stone','Stuart','Sullivan','Sylas','Sylvester','Talon','Tate','Taylor','Ted','Teddy','Terence','Terrance','Terrell','Terrence','Terry','Thaddeus','Theodore','Thiago','Thomas','Tim','Timmothy','Timothy','Tobias','Toby','Todd','Tom','Tomas','Tommy','Tony','Torin','Trace','Tracy','Travis','Trent','Trenton','Trevor','Trey','Tristan','Tristen','Triston','Troy','Truman','Tucker','Turner','Ty','Tyree','Tyreek','Tyrel','Tyrell','Tyrese','Tyron','Tyrone','Tyson','Ulysses','Uriah','Uriel','Valentin','Van','Vance','Vaughn','Vernon','Victor','Vince','Vincent','Vincenzo','Virgil','Vishal','Vance','Wade','Waldo','Walker','Walter','Warren','Watson','Waylon','Wayne','Weldon','Wesley','Weston','Wilbert','Wilbur','Wildan','Wilfred','Wilfredo','Will','Willard','William','Williams','Wilson','Wilton','Winchester','Winston','Wyatt','Xander','Xavier','Xzavier','Yahir','Yandel','Yosef','Younger','Zachariah','Zachary','Zack','Zackary','Zackery','Zander','Zane','Zayden','Zechariah','Zion','Zyaire'];
const LAST_NAMES = ['Smith','Johnson','Williams','Brown','Jones','Garcia','Miller','Davis','Rodriguez','Martinez','Hernandez','Lopez','Gonzalez','Wilson','Anderson','Thomas','Taylor','Moore','Jackson','Martin','Lee','Perez','Thompson','White','Harris','Sanchez','Clark','Ramirez','Lewis','Robinson','Walker','Young','Allen','King','Wright','Scott','Torres','Nguyen','Hill','Flores','Green','Adams','Nelson','Baker','Hall','Rivera','Campbell','Mitchell','Carter','Roberts','Phillips','Evans','Turner','Torres','Parker','Collins','Edwards','Stewart','Flores','Morris','Nguyen','Murphy','Rivera','Cook','Rogers','Morgan','Peterson','Cooper','Reed','Bailey','Bell','Gomez','Kelly','Howard','Ward','Cox','Diaz','Richardson','Wood','Watson','Brooks','Bennett','Gray','James','Reyes','Cruz','Hughes','Price','Myers','Long','Ross','Foster','Sanders','Payne','Pierce','Butler','Barnes','Fisher','Henderson','Coleman','Jenkins','Perry','Powell','Long','Patterson','Hughes','Flores','Washington','Butler','Simmons','Foster','Gonzales','Bryant','Alexander','Russell','Griffin','Diaz','Hayes','Myers','Ford','Hamilton','Graham','Sullivan','Wallace','Woods','Cole','West','Jordan','Owens','Reynolds','Fisher','Ellis','Harrison','Gibson','Mcdonald','Cruz','Marshall','Ortiz','Gomez','Murray','Freeman','Wells','Webb','Simpson','Stevens','Tucker','Porter','Hunter','Hicks','Crawford','Henry','Boyd','Mason','Morales','Kennedy','Warren','Dixon','Ramos','Reyes','Burns','Gordon','Shaw','Holmes','Rice','Robertson','Hunt','Black','Daniels','Palmer','Mills','Nichols','Grant','Knight','Ferguson','Rose','Stone','Hawkins','Dunn','Perkins','Hudson','Spencer','Gardner','Stephens','Payne','Pierce','Berry','Matthews','Arnold','Wagner','Willis','Ray','Watkins','Olson','Carroll','Duncan','Snyder','Hart','Cunningham','Bradley','Lane','Andrews','Ruiz','Harper','Fox','Riley','Armstrong','Carpenter','Weaver','Greene','Lawrence','Elliott','Chavez','Sims','Austin','Peters','Kelley','Franklin','Lawson'];
const COMPANIES = ['Acme Corp','TechFlow','DataSync','CloudNine','PixelForge','NexaBase','QuantumLeap','SwiftEdge','BlueHarbor','IronClad','NovaStar','ApexPoint','CrystalWave','EchoValley','FlexiCore','GridLine','Hyperion','InnoVista','JadePeak','Kinetic','Luminar','MetroGrid','Nimbus','OptiCore','PulseTech','Quasar','RapidAxis','SolarPeak','TitanEdge','UltraSync','Vertex','Windward','Xenon','YieldMax','Zenith','AlphaWave','BravoNet','CipherSoft','DeltaCore','EchoTech','FusionHub','GammaLine','HorizonX','Infinity','JetStream','Krypton','LogicWave','MatrixCore','NeonPeak','OmegaGrid','PrismTech','QuantumSoft','RadiantX','SigmaNet','TerraCore','UnityWave','VortexTech','WaveSync','XenoGrid','YellowPeak','ZephyrCore','Arcadia','BrightStar','Cascade','Dynamic','Emerald','Frontier','Genesis','Harmony','Insight','Jupiter','Kestrel','Liberty','Momentum','Nexus','Orion','Pacific','Quest','Radiant','Summit','Trident','Unity','Velocity','Wisdom','Zenith','Apex','Beacon','Catalyst','Dynamo','Elevate','Forge','Galaxy','Horizon','Impact','Journey','KeyStone','Legacy','Momentum','Noble','Origin','Pioneer','Quanta','Resolve','Summit','Transform','Unite','Vision','Wave'];
const TITLES = ['CEO','CTO','CFO','VP Engineering','VP Sales','Director','Manager','Senior Developer','Product Manager','Sales Manager','Marketing Director','Account Executive','Operations Manager','HR Director','Data Scientist','Software Engineer','Business Analyst','Project Manager','Design Lead','Marketing Manager','Sales Rep','Customer Success','Finance Director','Engineering Manager','Head of Product','Chief Architect','DevOps Lead','QA Manager','Technical Lead','Program Manager'];
const STAGES = ['new','contacted','qualified','unqualified','converted','lost'];
const DEAL_STAGES = ['lead','qualified','proposal','negotiation','won','lost'];
const SOURCES = ['website','referral','linkedin','google_ads','cold_call','conference','twitter','facebook','partner','inbound_email','event','webinar','demo_request'];
const ACTIVITY_TYPES = ['note','call','email','meeting','task','deal_update'];
const PRIORITY = ['low','medium','high'];

function rand<T>(arr: T[]): T { return arr[Math.floor(Math.random() * arr.length)]!; }
function randInt(min: number, max: number) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function slug(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 30); }
function uid() { return crypto.randomUUID(); }
let emailCounter = 0;
function genEmail(first: string, last: string) { return `${slug(first)}.${slug(last)}${emailCounter++}@${rand(['gmail.com','company.io','tech.co','startup.com','corp.net','biz.org']).toLowerCase()}`; }

let contactIds: string[] = [];
let dealIds: string[] = [];
let companyIds: string[] = [];
let activityCount = 0;
let stats = { contacts: 0, leads: 0, deals: 0, companies: 0, tasks: 0, activities: 0, notifications: 0, dealMoves: 0, dealWins: 0 };

async function loadExisting() {
  const c = await pool.query('SELECT id FROM public.contacts WHERE tenant_id=$1 LIMIT 5000', [tenantId]);
  contactIds = c.rows.map((r: any) => r.id);
  const d = await pool.query('SELECT id FROM public.deals WHERE tenant_id=$1 LIMIT 2000', [tenantId]);
  dealIds = d.rows.map((r: any) => r.id);
  const co = await pool.query('SELECT id FROM public.companies WHERE tenant_id=$1 LIMIT 500', [tenantId]);
  companyIds = co.rows.map((r: any) => r.id);
  console.log(`  Loaded: ${contactIds.length} contacts, ${dealIds.length} deals, ${companyIds.length} companies`);
}

// ── Activity Generators ──────────────────────────────────────────────

async function createContact() {
  const first = rand(FIRST_NAMES);
  const last = rand(LAST_NAMES);
  const email = genEmail(first, last);
  const companyId = companyIds.length ? rand(companyIds) : null;
  const { rows: [contact] } = await pool.query(
    `INSERT INTO public.contacts (tenant_id,created_by,assigned_to,first_name,last_name,email,phone,company_id,lead_status,lead_source,score,tags,city,country,linkedin_url,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now()) RETURNING id`,
    [tenantId, userId, userId, first, last, email, `+1${randInt(200,999)}${randInt(1000000,9999999)}`,
     companyId, rand(['new','contacted','qualified']), rand(SOURCES), randInt(0, 100),
     JSON.stringify(rand([[], ['vip'], ['enterprise'], ['hot_lead'], ['startup']])),
     rand(['New York','San Francisco','Chicago','Austin','Seattle','Denver','Boston','Miami']),
     'US', `https://linkedin.com/in/${slug(first)}-${slug(last)}`]
  );
  contactIds.push(contact.id);
  stats.contacts++;

  // Create activity
  await pool.query(
    `INSERT INTO public.activities (tenant_id,contact_id,user_id,type,description,created_at) VALUES ($1,$2,$3,$4,$5,now())`,
    [tenantId, contact.id, userId, 'note', `New contact created: ${first} ${last} from ${companyId ? rand(COMPANIES) : 'N/A'}`]
  );
  stats.activities++;

  // Create notification
  if (Math.random() < 0.3) {
    await pool.query(
      `INSERT INTO public.notifications (tenant_id,user_id,type,title,body,link,is_read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [tenantId, userId, 'contact_assigned', `New contact: ${first} ${last}`, `Added to your pipeline`, `/tenant/contacts/${contact.id}`, false]
    );
    stats.notifications++;
  }
}

async function createLead() {
  const first = rand(FIRST_NAMES);
  const last = rand(LAST_NAMES);
  const email = genEmail(first, last);
  const company = rand(COMPANIES);
  await pool.query(
    `INSERT INTO public.leads (tenant_id,created_by,first_name,last_name,email,phone,company_name,lead_status,lead_source,score,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now())`,
    [tenantId, userId, first, last, email, `+1${randInt(200,999)}${randInt(1000000,9999999)}`,
     `${company} ${randInt(1,999)}`, rand(STAGES.slice(0, 4)), rand(SOURCES), randInt(0, 100)]
  );
  stats.leads++;
}

async function createDeal() {
  const title = `${rand(['New','Enterprise','Partnership','Renewal','Expansion','Pilot','Custom','Annual'])} ${rand(['Deal','Contract','Agreement','License','Package','Solution'])} #${randInt(1000, 9999)}`;
  const value = randInt(1000, 500000);
  const stage = rand(DEAL_STAGES.slice(0, 4));
  const contactId = contactIds.length ? rand(contactIds) : null;
  const companyId = companyIds.length ? rand(companyIds) : null;
  const { rows: [deal] } = await pool.query(
    `INSERT INTO public.deals (tenant_id,created_by,title,value,stage,probability,close_date,contact_id,company_id,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING id`,
    [tenantId, userId, title, value, stage, [10, 25, 50, 75][DEAL_STAGES.indexOf(stage)] || 10,
     new Date(Date.now() + randInt(7, 180) * 86400000).toISOString().split('T')[0],
     contactId, companyId]
  );
  dealIds.push(deal.id);
  stats.deals++;
}

async function moveDeal() {
  if (dealIds.length < 2) return;
  const dealId = rand(dealIds);
  const stages = DEAL_STAGES;
  const currentIdx = randInt(0, stages.length - 2);
  const newStage = stages[currentIdx + 1];

  const { rows } = await pool.query(
    `UPDATE public.deals SET stage=$1, updated_at=now() WHERE id=$2 AND tenant_id=$3 AND deleted_at IS NULL RETURNING id`,
    [newStage, dealId, tenantId]
  );
  if (rows.length === 0) return;

  stats.dealMoves++;
  if (newStage === 'won') stats.dealWins++;

  // Activity
  await pool.query(
    `INSERT INTO public.activities (tenant_id,deal_id,user_id,type,description,created_at) VALUES ($1,$2,$3,$4,$5,now())`,
    [tenantId, dealId, userId, 'deal_update', `Deal stage moved to ${newStage}`]
  );
  stats.activities++;

  // Notification
  if (Math.random() < 0.4) {
    const type = newStage === 'won' ? 'deal_won' : 'deal_stage';
    await pool.query(
      `INSERT INTO public.notifications (tenant_id,user_id,type,title,body,link,is_read,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())`,
      [tenantId, userId, type,
       newStage === 'won' ? 'Deal Won! 🎉' : `Deal moved to ${newStage}`,
       `A deal has been updated`, `/tenant/deals/${dealId}`, false]
    );
    stats.notifications++;
  }
}

async function createTask() {
  const titles = ['Follow up with client','Send proposal','Schedule demo','Review contract','Update CRM','Prepare presentation','Quarterly review','Call to check interest','Send pricing info','Contract renewal'];
  const contactId = contactIds.length ? rand(contactIds) : null;
  const dealId = dealIds.length ? rand(dealIds) : null;
  await pool.query(
    `INSERT INTO public.tasks (tenant_id,created_by,title,due_date,priority,completed,contact_id,deal_id,created_at)
     VALUES ($1,$2,$3,$4,$5,false,$6,$7,now())`,
    [tenantId, userId, `${rand(titles)} #${randInt(1, 999)}`,
     new Date(Date.now() + randInt(1, 30) * 86400000).toISOString().split('T')[0],
     rand(PRIORITY), contactId, dealId]
  );
  stats.tasks++;
}

async function completeTask() {
  await pool.query(
    `UPDATE public.tasks SET completed=true, completed_at=now() WHERE tenant_id=$1 AND completed=false ORDER BY random() LIMIT 1`,
    [tenantId]
  );
}

async function createCompany() {
  const name = rand(COMPANIES) + ' ' + randInt(1, 999);
  const { rows: [company] } = await pool.query(
    `INSERT INTO public.companies (tenant_id,created_by,name,industry,company_size,website,annual_revenue,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,now()) RETURNING id`,
    [tenantId, userId, name, rand(['Technology','Healthcare','Finance','Manufacturing','Retail','Education','Consulting']),
     rand(['1-10','11-50','51-200','201-500','501-1000']),
     `https://${slug(name)}.com`, randInt(100000, 50000000)]
  );
  companyIds.push(company.id);
  stats.companies++;
}

async function createActivity() {
  const contactId = contactIds.length ? rand(contactIds) : null;
  const dealId = dealIds.length ? rand(dealIds) : null;
  const notes = [
    'Discussed pricing for enterprise plan.',
    'Follow-up call scheduled for next week.',
    'Sent product demo recording.',
    'Meeting with CTO about integration.',
    'Updated deal value based on new scope.',
    'Received positive feedback on proposal.',
    'Negotiating contract terms.',
    'Competitor mentioned: evaluating options.',
    'Decision timeline: end of quarter.',
    'Champion identified: VP of Engineering.',
    'Technical requirements shared.',
    'Budget approval received.',
    'Security review initiated.',
    'Pilot program proposed.',
    'Contract signed, onboarding starts Monday.',
  ];
  await pool.query(
    `INSERT INTO public.activities (tenant_id,contact_id,deal_id,user_id,type,description,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,now())`,
    [tenantId, contactId, dealId, userId, rand(ACTIVITY_TYPES), rand(notes)]
  );
  stats.activities++;
}

async function updateContactScore() {
  if (contactIds.length < 5) return;
  const id = rand(contactIds);
  const score = randInt(0, 100);
  await pool.query(`UPDATE public.contacts SET score=$1, updated_at=now() WHERE id=$2`, [score, id]);
}

// ── Main Loop ────────────────────────────────────────────────────────────

async function runCycle() {
  // Random mix of activities each cycle
  const actions: (() => Promise<void>)[] = [];

  // Always create some contacts
  for (let i = 0; i < randInt(1, 3); i++) actions.push(createContact);
  // Some leads
  for (let i = 0; i < randInt(0, 2); i++) actions.push(createLead);
  // Some deals
  if (Math.random() < 0.3) actions.push(createDeal);
  // Move existing deals
  if (Math.random() < 0.5) actions.push(moveDeal);
  // Create tasks
  if (Math.random() < 0.4) actions.push(createTask);
  // Complete tasks
  if (Math.random() < 0.2) actions.push(completeTask);
  // New companies
  if (Math.random() < 0.15) actions.push(createCompany);
  // Activities
  for (let i = 0; i < randInt(1, 4); i++) actions.push(createActivity);
  // Update scores
  if (Math.random() < 0.3) actions.push(updateContactScore);

  // Execute in parallel where possible
  await Promise.all(actions.map(fn => fn().catch(() => {})));
}

async function printStats() {
  console.log(`\n📊 Live Activity Stats (rate: ${RATE}, every ${intervalMs/1000}s):`);
  console.log(`  👥 Contacts created: ${stats.contacts}`);
  console.log(`  🎯 Leads created:    ${stats.leads}`);
  console.log(`  💰 Deals created:    ${stats.deals}`);
  console.log(`  🏢 Companies:        ${stats.companies}`);
  console.log(`  📋 Tasks created:    ${stats.tasks}`);
  console.log(`  📝 Activities:       ${stats.activities}`);
  console.log(`  🔔 Notifications:    ${stats.notifications}`);
  console.log(`  🔄 Deal moves:       ${stats.dealMoves}`);
  console.log(`  🏆 Deals won:        ${stats.dealWins}`);
  console.log(`  📈 Pool: ${contactIds.length} contacts, ${dealIds.length} deals, ${companyIds.length} companies`);
  console.log('  ' + '─'.repeat(50));
}

async function main() {
  console.log('========================================');
  console.log('  NuCRM Real-Time Activity Simulator');
  console.log('========================================');
  console.log(`  Tenant: ${tenantId || '(auto)'}`);
  console.log(`  User:   ${userId || '(auto)'}`);
  console.log(`  Rate:   ${RATE} (${intervalMs}ms)`);
  console.log(`  Duration: ${DURATION > 0 ? DURATION + 's' : '∞ forever'}`);
  console.log('');

  // Resolve tenant/user
  if (!tenantId) {
    const { rows } = await pool.query('SELECT id FROM public.tenants ORDER BY created_at DESC LIMIT 1');
    tenantId = rows[0]?.id;
  }
  if (!userId) {
    const { rows } = await pool.query('SELECT id FROM public.users ORDER BY created_at DESC LIMIT 1');
    userId = rows[0]?.id;
  }
  if (!tenantId || !userId) { console.error('No tenant or user found'); process.exit(1); }

  console.log(`  Using: tenant=${tenantId.slice(0, 8)}... user=${userId.slice(0, 8)}...\n`);
  await loadExisting();
  console.log('');

  // Ctrl+C handler
  process.on('SIGINT', () => { running = false; });
  process.on('SIGTERM', () => { running = false; });

  const startTime = Date.now();
  let cycleCount = 0;

  while (running) {
    if (DURATION > 0 && (Date.now() - startTime) > DURATION * 1000) {
      console.log('\n⏱️  Duration reached, stopping...');
      break;
    }

    await runCycle();
    cycleCount++;

    if (cycleCount % 6 === 0) {
      await printStats();
    }

    await new Promise(r => setTimeout(r, intervalMs));
  }

  await printStats();
  console.log(`\n✅ Simulator stopped after ${cycleCount} cycles (${((Date.now() - startTime) / 1000).toFixed(0)}s)`);
  await pool.end();
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
