// ── Seed Test Data ──────────────────────────────────────
fastify.post('/api/seed', async (request, reply) => {
  // SECURITY: Only allow seeding in development/test environments
  if (process.env.NODE_ENV === 'production') {
    return reply.code(403).send({ 
      error: 'Seed endpoint disabled in production',
      message: 'Use database migrations and admin tools in production' 
    });
  }

  // Require authentication
  const tenant_id = request.authenticatedTenantId;
  
  const { tenant_name, user_email } = request.body || {};
  const tName = tenant_name || 'Test Company';
  const uEmail = user_email || `test+${Date.now()}@example.com`;
  const cCount = Math.min(request.body?.contact_count || 20, 100); // Cap at 100

  // SECURITY: Generate unique password per seed, return only once
  const generatedPassword = `Test_${Date.now()}_!${Math.random().toString(36).slice(2, 8)}`;

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const bcrypt = require('bcryptjs');
    const { randomUUID } = require('crypto');
    const userId = randomUUID();
    // Use bcrypt with proper cost factor
    const hashedPassword = await bcrypt.hash(generatedPassword, 12);

    const userRes = await client.query(
      `INSERT INTO public.users (id, full_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (email) DO UPDATE SET full_name = $2
       RETURNING id`,
      [userId, 'Test User', uEmail, hashedPassword]
    );
    const actualUserId = userRes.rows[0].id;

    // Create tenant
    const slug = tName.toLowerCase().replace(/\s+/g, '-') + '-' + Date.now();
    const tenantRes = await client.query(
      `INSERT INTO public.tenants (name, slug, owner_id, plan_id, status)
       VALUES ($1, $2, $3, (SELECT id FROM public.plans LIMIT 1), 'active')
       RETURNING id`,
      [tName, slug, actualUserId]
    );
    const tenantId = tenantRes.rows[0].id;

    // Add user to tenant
    await client.query(
      `INSERT INTO public.tenant_members (tenant_id, user_id, role_slug, status)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT DO NOTHING`,
      [tenantId, actualUserId, 'admin', 'active']
    );

    // Create contacts (capped at 100)
    const firstNames = ['John','Jane','Bob','Alice','Charlie','Diana','Eve','Frank','Grace','Henry','Ivy','Jack','Karen','Leo','Mia','Noah','Olivia','Paul','Quinn','Rachel'];
    const lastNames = ['Doe','Smith','Johnson','Williams','Brown','Davis','Miller','Wilson','Moore','Taylor','Anderson','Thomas','Jackson','White','Harris','Martin','Garcia','Martinez','Robinson','Clark'];
    const statuses = ['new','contacted','qualified','converted','unqualified'];
    const sources = ['website','referral','cold_outreach','social_media','event'];
    const lifecycleStages = ['lead','marketing_qualified_lead','sales_qualified_lead','opportunity','customer'];

    let createdContacts = 0;
    for (let i = 0; i < cCount; i++) {
      const firstName = firstNames[i % firstNames.length];
      const lastName = lastNames[i % lastNames.length];
      const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;

      try {
        await client.query(
          `INSERT INTO public.contacts (
            tenant_id, first_name, last_name, email, phone, title,
            lead_status, lead_source, lifecycle_stage, assigned_to, created_by
          ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            tenantId, firstName, lastName, email,
            `+1-555-${String(1000 + i)}`,
            `${firstName === 'John' ? 'CEO' : firstName === 'Jane' ? 'CTO' : 'Manager'}`,
            statuses[i % statuses.length],
            sources[i % sources.length],
            lifecycleStages[i % lifecycleStages.length],
            actualUserId,
            actualUserId,
          ]
        );
        createdContacts++;
      } catch (err) {
        fastify.log.error(`Contact ${i} failed: ${err.message}`);
      }
    }

    await client.query('COMMIT');

    return {
      success: true,
      tenant_id: tenantId,
      user_id: actualUserId,
      user_email: uEmail,
      password: generatedPassword,
      contacts_created: createdContacts,
      login_url: `http://localhost:3000/login?tenant=${slug}`,
      security_note: 'Password is unique per seed and shown only once',
    };
  } catch (err) {
    await client.query('ROLLBACK');
    fastify.log.error(err);
    return reply.code(500).send({ error: 'Seeding failed', message: err.message });
  } finally {
    client.release();
  }
});
