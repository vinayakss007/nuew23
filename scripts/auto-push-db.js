/**
 * Auto Setup Database
 * Checks database status and automatically pushes schema if needed
 * Run: node scripts/auto-push-db.js
 */

require('dotenv').config({ path: '.env.local' });
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not found in .env.local');
  console.error('');
  console.error('Please configure your database:');
  console.error('1. Copy .env.local.example to .env.local');
  console.error('2. Set DATABASE_URL=postgresql://...');
  console.error('');
  process.exit(1);
}

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000
});

async function checkDatabaseStatus() {
  const client = await pool.connect();
  try {
    // Check if users table exists
    const result = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'users'
      ) as table_exists
    `);

    if (!result.rows[0].table_exists) {
      return { ready: false, reason: 'schema_missing' };
    }

    // Check if deleted_at column exists in users table
    const columnCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns
        WHERE table_schema = 'public' 
        AND table_name = 'users' 
        AND column_name = 'deleted_at'
      ) as column_exists
    `);

    if (!columnCheck.rows[0].column_exists) {
      return { ready: false, reason: 'missing_columns' };
    }

    // Count tables
    const tables = await client.query(`
      SELECT count(*) as count FROM information_schema.tables
      WHERE table_schema = 'public'
    `);

    // Count users
    const users = await client.query(`SELECT count(*) as count FROM public.users`);

    return {
      ready: true,
      tables: parseInt(tables.rows[0].count),
      users: parseInt(users.rows[0].count)
    };
  } catch (err) {
    return { ready: false, reason: 'connection_error', error: err.message };
  } finally {
    client.release();
  }
}

async function runSqlFile(filePath, client) {
  const sql = fs.readFileSync(filePath, 'utf-8');
  const fileName = path.basename(filePath);
  
  try {
    await client.query(sql);
    console.log(`  ✓ ${fileName}`);
    return true;
  } catch (err) {
    console.error(`  ✗ ${fileName}: ${err.message}`);
    throw err;
  }
}

async function pushSchema() {
  const scriptsDir = path.join(__dirname, '..', 'scripts');
  const files = fs.readdirSync(scriptsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  console.log('\n📦 Pushing database schema...\n');

  const client = await pool.connect();
  try {
    for (const file of files) {
      await runSqlFile(path.join(scriptsDir, file), client);
    }
    console.log('\n✅ Schema pushed successfully!');
    return true;
  } catch (err) {
    console.error('\n❌ Schema push failed:', err.message);
    return false;
  } finally {
    client.release();
  }
}

async function main() {
  console.log('🔍 Checking database status...\n');

  const status = await checkDatabaseStatus();

  if (status.ready) {
    console.log('✅ Database is ready!');
    console.log(`   • ${status.tables} tables`);
    console.log(`   • ${status.users} users`);
    console.log('');
    await pool.end();
    return;
  }

  console.log('⚠️  Database needs setup:\n');

  switch (status.reason) {
    case 'schema_missing':
      console.log('   • Database schema not found');
      break;
    case 'missing_columns':
      console.log('   • Missing required columns (deleted_at)');
      break;
    case 'connection_error':
      console.log(`   • Connection error: ${status.error}`);
      await pool.end();
      process.exit(1);
  }

  console.log('');
  console.log('Starting automatic setup...\n');

  const success = await pushSchema();

  if (success) {
    console.log('\n🎉 Database is ready to use!');
    console.log('\nNext steps:');
    console.log('1. Run: npm run dev');
    console.log('2. Open: http://localhost:3000');
    console.log('3. Create your first account at /setup');
    console.log('');
  } else {
    console.log('\n❌ Setup failed. Please check the errors above.');
    console.log('\nManual setup:');
    console.log('1. Check your DATABASE_URL in .env.local');
    console.log('2. Run: psql $DATABASE_URL -f scripts/001_schema.sql');
    console.log('');
    process.exit(1);
  }

  await pool.end();
}

main().catch(err => {
  console.error('💥 Unexpected error:', err.message);
  console.error(err.stack);
  process.exit(1);
});
