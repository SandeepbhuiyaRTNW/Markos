import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const ses = new SESv2Client({
  region: process.env.SES_REGION || 'us-east-1',
  ...(process.env.SES_ACCESS_KEY_ID ? {
    credentials: {
      accessKeyId: process.env.SES_ACCESS_KEY_ID,
      secretAccessKey: process.env.SES_SECRET_ACCESS_KEY || '',
    },
  } : {}),
});

const SENDER_EMAIL = process.env.SES_SENDER_EMAIL || 'Sandeep.Bhuiya@ridethenextwave.com';

/**
 * POST /api/auth/send-code
 * Generates a 6-digit OTP code and sends it to the user's email via SES.
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const email = body.email?.trim()?.toLowerCase();

    if (!email || !email.includes('@')) {
      return NextResponse.json({ error: 'Valid email required' }, { status: 400 });
    }

    // Rate limit: max 3 codes per email in last 10 minutes
    const recentResult = await query(
      `SELECT COUNT(*) as cnt FROM email_codes WHERE email = $1 AND created_at > NOW() - INTERVAL '10 minutes'`,
      [email]
    );
    if (parseInt(recentResult.rows[0].cnt) >= 3) {
      return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes.' }, { status: 429 });
    }

    // Generate 6-digit code
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    // Store in DB
    await query(
      `INSERT INTO email_codes (email, code, expires_at) VALUES ($1, $2, $3)`,
      [email, code, expiresAt.toISOString()]
    );

    // Send via SES
    try {
      await ses.send(new SendEmailCommand({
        FromEmailAddress: SENDER_EMAIL,
        Destination: { ToAddresses: [email] },
        Content: {
          Simple: {
            Subject: { Data: `Your Marcus verification code: ${code}` },
            Body: {
              Html: {
                Data: `
                  <div style="font-family: system-ui, sans-serif; max-width: 480px; margin: 0 auto; padding: 40px 20px;">
                    <div style="text-align: center; margin-bottom: 32px;">
                      <div style="width: 56px; height: 56px; border-radius: 16px; background: linear-gradient(135deg, rgba(163,120,94,0.15), rgba(163,120,94,0.05)); border: 1px solid rgba(163,120,94,0.2); display: inline-flex; align-items: center; justify-content: center;">
                        <span style="font-size: 28px; color: #a3785e; font-weight: 300;">M</span>
                      </div>
                    </div>
                    <h2 style="text-align: center; font-size: 20px; color: #1a1a1a; margin-bottom: 8px;">Your Verification Code</h2>
                    <p style="text-align: center; color: #666; font-size: 14px; margin-bottom: 24px;">Enter this code to sign in to mrkos.ai</p>
                    <div style="text-align: center; background: #f5f5f0; border-radius: 12px; padding: 20px; margin-bottom: 24px;">
                      <span style="font-size: 36px; font-weight: 700; letter-spacing: 8px; color: #1a1a1a; font-family: monospace;">${code}</span>
                    </div>
                    <p style="text-align: center; color: #999; font-size: 12px;">This code expires in 10 minutes.</p>
                    <hr style="border: none; border-top: 1px solid #eee; margin: 32px 0;" />
                    <p style="text-align: center; color: #bbb; font-size: 11px; font-style: italic;">"Waste no more time arguing about what a good man should be. Be one." — Marcus Aurelius</p>
                  </div>
                `,
              },
              Text: { Data: `Your mrkos.ai verification code is: ${code}\n\nThis code expires in 10 minutes.` },
            },
          },
        },
      }));
    } catch (sesError) {
      console.error('[Auth] SES send error:', sesError);
      // In sandbox mode, SES may fail for unverified recipients — still return success
      // so the user can see the code in logs during development
      console.log(`[Auth] 🔑 OTP code for ${email}: ${code} (SES may have failed in sandbox mode)`);
    }

    console.log(`[Auth] ✉️ Code sent to ${email}`);
    return NextResponse.json({ success: true });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[Auth] Send code error:', errMsg, error);
    return NextResponse.json({ error: `Failed to send code: ${errMsg}` }, { status: 500 });
  }
}

