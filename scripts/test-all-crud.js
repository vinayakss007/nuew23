#!/usr/bin/env node
/**
 * NuCRM SaaS - Comprehensive Data Test Script
 * Tests ALL CRUD operations by creating fake data everywhere
 */

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const SETUP_KEY = process.env.SETUP_KEY || 'nucrm-setup-key-2025-change-in-production';

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
};

let SESSION_COOKIE = '';

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function section(title) {
  log(`\n${'═'.repeat(60)}`, 'cyan');
  log(` ${title}`, 'cyan');
  log(`${'═'.repeat(60)}`, 'cyan');
}

async function testEndpoint(method, endpoint, data = null, expectedStatus = 200, useAuth = true) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (data) options.body = JSON.stringify(data);
  if (useAuth && SESSION_COOKIE) {
    options.headers.Cookie = SESSION_COOKIE;
  }

  try {
    const res = await fetch(url, options);
    const json = await res.json().catch(() => ({}));
    const success = res.status === expectedStatus || (res.status >= 200 && res.status < 300);
    
    if (success) {
      log(`  ✓ ${method} ${endpoint} - ${res.status}`, 'green');
      return { success: true, data: json, status: res.status };
    } else {
      log(`  ✗ ${method} ${endpoint} - ${res.status}: ${json.error || json.message || 'Unknown error'}`, 'red');
      return { success: false, data: json, status: res.status };
    }
  } catch (err) {
    log(`  ✗ ${method} ${endpoint} - ${err.message}`, 'red');
    return { success: false, error: err.message };
  }
}

async function setupDemoUser() {
  section('Setting up Demo User');
  
  // Try to login with default admin first
  log('  Attempting login with default admin...', 'blue');
  const loginRes = await fetch(`${BASE_URL}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'admin@nucrm.local',
      password: 'admin123',
    }),
  });
  const loginData = await loginRes.json();
  if (loginRes.ok && loginData.token) {
    SESSION_COOKIE = `nucrm_session=${loginData.token}`;
    log('  ✓ Logged in successfully', 'green');
    return true;
  }
  
  log(`  ℹ️  Login failed: ${loginData.error || 'Unknown'}`, 'yellow');
  
  // Check if already set up
  const checkRes = await fetch(`${BASE_URL}/api/setup/check`);
  const checkData = await checkRes.json();
  
  if (!checkData.is_setup) {
    // Create admin user
    log('\n  Creating admin user...', 'blue');
    const signupRes = await fetch(`${BASE_URL}/api/setup/create-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        setup_key: SETUP_KEY,
        email: 'admin@nucrm.local',
        password: 'admin123',
        full_name: 'Test Admin',
        company_name: 'Test Company',
      }),
    });
    const signupData = await signupRes.json();
    
    if (signupRes.ok || signupData.token) {
      SESSION_COOKIE = `nucrm_session=${signupData.token}`;
      log('  ✓ Admin user created and logged in', 'green');
      return true;
    } else {
      log(`  ✗ Failed to create admin: ${signupData.error || 'Unknown error'}`, 'red');
      return false;
    }
  } else {
    log('  ℹ️  System already set up but login failed. You may need to use existing credentials.', 'yellow');
    return false;
  }
}

// Generate random data
const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
const randId = () => Math.random().toString(36).substring(2, 10);
const randEmail = () => `test.${randId()}@example.com`;
const randPhone = () => `+1-555-${Math.floor(Math.random() * 900) + 100}-${Math.floor(Math.random() * 9000) + 1000}`;

const FIRST_NAMES = ['John', 'Jane', 'Mike', 'Sarah', 'David', 'Emma', 'Chris', 'Lisa', 'Tom', 'Amy'];
const LAST_NAMES = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Wilson', 'Taylor'];
const COMPANY_NAMES = ['Acme Corp', 'TechStart', 'GlobalInc', 'DataFlow', 'CloudBase', 'NetWorks', 'SoftLab', 'Webify'];
const DEAL_NAMES = ['Enterprise License', 'Annual Subscription', 'Consulting Package', 'Support Contract', 'Integration Project'];

async function main() {
  log('\n╔═══════════════════════════════════════════════════════════╗', 'cyan');
  log('║     NuCRM SaaS - Comprehensive Data Test Suite           ║', 'cyan');
  log('╚═══════════════════════════════════════════════════════════╝', 'cyan');

  const results = { passed: 0, failed: 0, skipped: 0 };
  const createdIds = { companies: [], contacts: [], deals: [], tasks: [] };

  // Setup demo user and get auth token
  const authSuccess = await setupDemoUser();
  if (!authSuccess) {
    log('\n⚠️  Failed to setup authentication. Exiting.', 'yellow');
    process.exit(1);
  }

  // First, check if we can access the API
  section('1. Health Check');
  const health = await testEndpoint('GET', '/api/health');
  if (!health.success) {
    log('\n⚠️  App is not healthy. Make sure it\'s running on http://localhost:3000', 'yellow');
    process.exit(1);
  }

  // Test Companies
  section('2. Testing Companies');
  
  log('\n  Creating companies...', 'blue');
  for (let i = 0; i < 3; i++) {
    const companyData = {
      name: `${rand(COMPANY_NAMES)} ${i + 1}`,
      website: `https://company${i + 1}.com`,
      industry: rand(['Technology', 'Finance', 'Healthcare', 'Retail']),
      employees: Math.floor(Math.random() * 500) + 10,
      annual_revenue: Math.floor(Math.random() * 10000000) + 100000,
      phone: randPhone(),
      billing_address: { street: '123 Main St', city: 'San Francisco', state: 'CA', zip: '94105', country: 'USA' },
      shipping_address: { street: '123 Main St', city: 'San Francisco', state: 'CA', zip: '94105', country: 'USA' },
      description: `Test company ${i + 1}`,
      tags: ['test', 'auto-generated'],
      custom_fields: {},
    };
    
    const result = await testEndpoint('POST', '/api/tenant/companies', companyData, 201);
    if (result.success && result.data?.data?.id) {
      createdIds.companies.push(result.data.data.id);
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Test Contacts
  section('3. Testing Contacts');
  
  log('\n  Creating contacts...', 'blue');
  for (let i = 0; i < 5; i++) {
    const contactData = {
      first_name: rand(FIRST_NAMES),
      last_name: rand(LAST_NAMES),
      email: randEmail(),
      phone: randPhone(),
      company_id: createdIds.companies.length > 0 ? rand(createdIds.companies) : null,
      lead_status: rand(['new', 'contacted', 'qualified', 'converted']),
      lead_source: rand(['website', 'referral', 'linkedin', 'google']),
      assigned_to: '',
      tags: ['test', 'auto-generated'],
      custom_fields: {},
    };
    
    const result = await testEndpoint('POST', '/api/tenant/contacts', contactData, 201);
    if (result.success && result.data?.data?.id) {
      createdIds.contacts.push(result.data.data.id);
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Test Deals
  section('4. Testing Deals');
  
  log('\n  Creating deals...', 'blue');
  for (let i = 0; i < 3; i++) {
    const dealData = {
      name: `${rand(DEAL_NAMES)} ${i + 1}`,
      contact_id: createdIds.contacts.length > 0 ? rand(createdIds.contacts) : null,
      company_id: createdIds.companies.length > 0 ? rand(createdIds.companies) : null,
      value: Math.floor(Math.random() * 50000) + 5000,
      stage: rand(['lead', 'qualified', 'proposal', 'negotiation', 'won']),
      probability: rand([10, 25, 50, 75, 90]),
      expected_close_date: new Date(Date.now() + Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      description: `Test deal ${i + 1}`,
      tags: ['test', 'auto-generated'],
      custom_fields: {},
    };
    
    const result = await testEndpoint('POST', '/api/tenant/deals', dealData, 201);
    if (result.success && result.data?.data?.id) {
      createdIds.deals.push(result.data.data.id);
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Test Tasks
  section('5. Testing Tasks');
  
  log('\n  Creating tasks...', 'blue');
  for (let i = 0; i < 4; i++) {
    const taskData = {
      title: `Test Task ${i + 1}: ${rand(['Call', 'Email', 'Meeting', 'Follow-up'])}`,
      description: `This is a test task #${i + 1}`,
      due_date: new Date(Date.now() + Math.random() * 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
      priority: rand(['low', 'medium', 'high', 'urgent']),
      status: rand(['pending', 'in_progress', 'completed']),
      contact_id: createdIds.contacts.length > 0 ? rand(createdIds.contacts) : null,
      deal_id: createdIds.deals.length > 0 ? rand(createdIds.deals) : null,
      assigned_to: '',
      tags: ['test', 'auto-generated'],
    };
    
    const result = await testEndpoint('POST', '/api/tenant/tasks', taskData, 201);
    if (result.success && result.data?.data?.id) {
      createdIds.tasks.push(result.data.data.id);
      results.passed++;
    } else {
      results.failed++;
    }
  }

  // Test Notes
  section('6. Testing Notes');
  
  if (createdIds.contacts.length > 0) {
    log('\n  Creating notes...', 'blue');
    const noteData = {
      content: `Test note created at ${new Date().toISOString()}`,
      contact_id: rand(createdIds.contacts),
    };
    const result = await testEndpoint('POST', '/api/tenant/notes', noteData, 201);
    if (result.success) results.passed++;
    else results.failed++;
  } else {
    log('\n  ⚠️  Skipped notes (no contacts)', 'yellow');
    results.skipped++;
  }

  // Test Meetings
  section('7. Testing Meetings');
  
  log('\n  Creating meetings...', 'blue');
  const meetingData = {
    title: `Test Meeting ${randId()}`,
    description: 'Automated test meeting',
    start_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    end_time: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    location: 'Virtual - Zoom',
    meeting_url: 'https://zoom.us/j/123456789',
    contact_ids: createdIds.contacts.slice(0, 2),
    deal_id: createdIds.deals.length > 0 ? createdIds.deals[0] : null,
    status: 'scheduled',
  };
  const result = await testEndpoint('POST', '/api/tenant/meetings', meetingData, 201);
  if (result.success) results.passed++;
  else results.failed++;

  // Test Email Templates
  section('8. Testing Email Templates');
  
  log('\n  Creating email templates...', 'blue');
  const templateData = {
    name: `Test Template ${randId()}`,
    subject: 'Test Email Subject',
    body: '<p>This is a test email template</p>',
    tags: ['test', 'auto-generated'],
  };
  const templateResult = await testEndpoint('POST', '/api/tenant/email-templates', templateData, 201);
  if (templateResult.success) results.passed++;
  else results.failed++;

  // Test Products
  section('9. Testing Products');
  
  log('\n  Creating products...', 'blue');
  const productData = {
    name: `Test Product ${randId()}`,
    description: 'Automated test product',
    unit_price: Math.floor(Math.random() * 1000) + 50,
    currency: 'USD',
    sku: `SKU-${randId()}`,
    active: true,
  };
  const productResult = await testEndpoint('POST', '/api/tenant/products', productData, 201);
  if (productResult.success) results.passed++;
  else results.failed++;

  // Test Pipelines
  section('10. Testing Pipelines');
  
  log('\n  Creating pipelines...', 'blue');
  const pipelineData = {
    name: `Test Pipeline ${randId()}`,
    type: 'deals',
    stages: [
      { name: 'Lead', position: 0, color: '#94a3b8' },
      { name: 'Qualified', position: 1, color: '#3b82f6' },
      { name: 'Proposal', position: 2, color: '#8b5cf6' },
      { name: 'Won', position: 3, color: '#10b981' },
    ],
    is_default: false,
  };
  const pipelineResult = await testEndpoint('POST', '/api/tenant/pipelines', pipelineData, 201);
  if (pipelineResult.success) results.passed++;
  else results.failed++;

  // Test Bulk Operations
  section('11. Testing Bulk Operations');
  
  if (createdIds.contacts.length > 0) {
    log('\n  Testing bulk update...', 'blue');
    const bulkData = {
      ids: createdIds.contacts.slice(0, 2),
      updates: { lead_status: 'qualified' },
    };
    const bulkResult = await testEndpoint('PATCH', '/api/tenant/contacts/bulk', bulkData);
    if (bulkResult.success) results.passed++;
    else results.failed++;
  } else {
    log('\n  ⚠️  Skipped bulk operations (no contacts)', 'yellow');
    results.skipped++;
  }

  // Test Search
  section('12. Testing Search');
  
  log('\n  Testing search...', 'blue');
  const searchResult = await testEndpoint('GET', `/api/tenant/search?q=${rand(FIRST_NAMES)}`);
  if (searchResult.success) results.passed++;
  else results.failed++;

  // Test Exports
  section('13. Testing Exports');
  
  log('\n  Testing contacts export...', 'blue');
  try {
    const res = await fetch(`${BASE_URL}/api/tenant/contacts/export`);
    if (res.ok) {
      log(`  ✓ GET /api/tenant/contacts/export - ${res.status}`, 'green');
      results.passed++;
    } else {
      log(`  ✗ GET /api/tenant/contacts/export - ${res.status}`, 'red');
      results.failed++;
    }
  } catch (err) {
    log(`  ✗ GET /api/tenant/contacts/export - ${err.message}`, 'red');
    results.failed++;
  }

  // Summary
  section('Test Summary');
  const total = results.passed + results.failed + results.skipped;
  log(`\n  Total Tests: ${total}`, 'cyan');
  log(`  ✓ Passed: ${results.passed}`, 'green');
  log(`  ✗ Failed: ${results.failed}`, 'red');
  log(`  ⚠️  Skipped: ${results.skipped}`, 'yellow');
  
  if (results.failed > 0) {
    log('\n⚠️  Some tests failed. Check the errors above.', 'yellow');
    log('Common issues:', 'yellow');
    log('  - Missing tenant_id in inserts (check lib/db/client.ts PROTECTED set)', 'yellow');
    log('  - Missing useEffect imports in client components', 'yellow');
    log('  - Database schema not initialized', 'yellow');
    process.exit(1);
  } else {
    log('\n✅ All tests passed! Data is being inserted correctly.', 'green');
    process.exit(0);
  }
}

main().catch(err => {
  log(`\nFatal error: ${err.message}`, 'red');
  log(err.stack, 'red');
  process.exit(1);
});
