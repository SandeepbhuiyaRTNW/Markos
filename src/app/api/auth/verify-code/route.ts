import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/auth/verify-code
 * Validates the OTP code, creates/fetches the user, returns userId.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body.email?.trim()?.toLowerCase();
    const code = body.code?.trim();

    if (!email || !code || code.length !== 6) {
      return NextResponse.json({ error: 'Email and 6-digit code required' }, { status: 400 });
    }

    // Find a valid, unused, unexpired code for this email
    const codeResult = await query(
      `SELECT id FROM email_codes
       WHERE email = $1 AND code = $2 AND used = false AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email, code]
    );

    if (codeResult.rows.length === 0) {
      return NextResponse.json({ error: 'Invalid or expired code. Please try again.' }, { status: 401 });
    }

    // Mark code as used
    await query(`UPDATE email_codes SET used = true WHERE id = $1`, [codeResult.rows[0].id]);

    // Create or fetch user
    const existingUser = await query(`SELECT id FROM users WHERE email = $1`, [email]);

    let userId: string;
    let isNewUser = false;

    if (existingUser.rows.length > 0) {
      userId = existingUser.rows[0].id;
    } else {
      const newUser = await query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [email, '']
      );
      userId = newUser.rows[0].id;
      isNewUser = true;
    }

    console.log(`[Auth] ✅ Verified ${email} → userId=${userId} (new=${isNewUser})`);
    return NextResponse.json({ userId, email, isNewUser });
  } catch (error) {
    console.error('[Auth] Verify code error:', error);
    return NextResponse.json({ error: 'Verification failed' }, { status: 500 });
  }
}

