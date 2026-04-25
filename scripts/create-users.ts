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
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.password, 12);
    const result = await pool.query(
      `UPDATE users SET password_hash = $1, onboarding_complete = true WHERE email = $2
       RETURNING id, email, name, onboarding_complete`,
      [hash, u.email]
    );
    if (result.rows.length > 0) {
      console.log('✅ Updated:', result.rows[0]);
    } else {
      console.log('❌ Not found:', u.email);
    }
  }

  // Verify
  const verify = await pool.query(
    `SELECT id, email, name, onboarding_complete, password_hash IS NOT NULL as has_password
     FROM users WHERE email = ANY($1)`,
    [['acjohnson2@stthomas.edu', 'okuhlke@mcad.edu']]
  );
  console.log('\n── Final state ──');
  for (const row of verify.rows) {
    console.log(`  ${row.email} → onboarded: ${row.onboarding_complete}, has_password: ${row.has_password}`);
  }

  await pool.end();
}

main().catch(e => { console.error(e); process.exit(1); });
