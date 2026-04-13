#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { query } = require('../lib/db/client');

async function cleanup() {
  try {
    // Delete test admin and related data
    await query('DELETE FROM public.sessions WHERE user_id IN (SELECT id FROM public.users WHERE email = $1)', ['admin@abetworks.in']);
    await query('DELETE FROM public.tenant_members WHERE user_id IN (SELECT id FROM public.users WHERE email = $1)', ['admin@abetworks.in']);
    await query('DELETE FROM public.users WHERE email = $1', ['admin@abetworks.in']);
    
    console.log('✅ Test admin deleted - Setup page is now ready!');
    console.log('\n🌐 Visit: http://localhost:3000/setup');
    console.log('   Create your super admin account there.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  process.exit(0);
}

cleanup();
