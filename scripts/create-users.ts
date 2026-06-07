import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function main() {
  const users = [
    { email: 'acjohnson2@stthomas.edu', name: 'A.C. Johnson', password: 'Marcus2026ac' },
    { email: 'okuhlke@mcad.edu', name: 'Olaf Kuhlke', password: 'Marcus2026ok' },
    { email: 'sandeep.bhuiya@ridethenextwave.com', name: 'Sandeep Bhuiya', password: 'Marcus2026sb' },
    { email: 'cihan.behlivan@ridethenextwave.com', name: 'Cihan Behlivan', password: 'Marcus2026cb' },
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 12);
    // Try UPDATE first (existing user)
    const update = await pool.query(
      `UPDATE users SET password_hash = $1, onboarding_complete = true WHERE email = $2
       RETURNING id, email, name, onboarding_complete`,
      [hash, u.email]
    );
    if (update.rows.length > 0) {
      console.log('✅ Updated:', update.rows[0]);
    } else {
      // INSERT new user if not found
      const insert = await pool.query(
        `INSERT INTO users (email, name, password_hash, onboarding_complete)
         VALUES ($1, $2, $3, true)
         RETURNING id, email, name, onboarding_complete`,
        [u.email, u.name, hash]
      );
      console.log('✅ Created:', insert.rows[0]);
    }
  }

  // Verify
  const verify = await pool.query(
    `SELECT id, email, name, onboarding_complete, password_hash IS NOT NULL as has_password
     FROM users WHERE email = ANY($1)`,
    [['acjohnson2@stthomas.edu', 'okuhlke@mcad.edu', 'sandeep.bhuiya@ridethenextwave.com', 'cihan.behlivan@ridethenextwave.com']]
  );
  console.log('\n── Final state ──');
  for (const row of verify.rows) {
    console.log(`  ${row.email} → onboarded: ${row.onboarding_complete}, has_password: ${row.has_password}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
