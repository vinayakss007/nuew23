#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { query } = require('../lib/db/client');
const { createHash, randomBytes } = require('crypto');

async function createAdmin() {
  const email = 'admin@abetworks.in';
  const password = 'Admin123!';
  const fullName = 'Admin User';
  
  // Generate password hash
  const salt = randomBytes(16).toString('hex');
  const hash = createHash('sha256').update(password + salt).digest('hex');
  const passwordHash = `${salt}:${hash}`;
  
  try {
    // Create admin user
    const { rows: [user] } = await query(
      `INSERT INTO public.users (email, password_hash, full_name, is_super_admin, email_verified)
       VALUES ($1, $2, $3, true, true)
       ON CONFLICT (email) DO UPDATE SET is_super_admin = true
       RETURNING id, email`,
      [email, passwordHash, fullName]
    );
    
    console.log('✅ Admin user created:', user.email);
    
    // Create tenant
    const { rows: [tenant] } = await query(
      `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status, trial_ends_at)
       VALUES ($1, $2, $3, 'free', 'active', now() + interval '14 days')
       ON CONFLICT (slug) DO UPDATE SET owner_id = $3
       RETURNING id, name, slug`,
      ['Abetworks Workspace', 'abetworks-workspace', user.id]
    );
    
    console.log('✅ Tenant created:', tenant.name);
    
    // Create tenant member
    await query(
      `INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status, joined_at)
       VALUES ($1, $2, 'admin', 'active', now())
       ON CONFLICT (tenant_id, user_id) DO UPDATE SET role_slug = 'admin', status = 'active'`,
      [tenant.id, user.id]
    );
    
    console.log('✅ Tenant membership created');
    
    // Update user's last_tenant_id
    await query('UPDATE public.users SET last_tenant_id = $1 WHERE id = $2', [tenant.id, user.id]);
    
    console.log('\n🎉 Setup complete!');
    console.log('\n📋 Login Credentials:');
    console.log('   Email:', email);
    console.log('   Password:', password);
    console.log('\n🌐 Access URLs:');
    console.log('   Login: http://localhost:3000/auth/login');
    console.log('   Dashboard: http://localhost:3000/tenant/dashboard');
    console.log('   Superadmin: http://localhost:3000/superadmin/dashboard');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
  
  process.exit(0);
}

createAdmin();
