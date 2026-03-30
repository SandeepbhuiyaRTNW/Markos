import { NextRequest, NextResponse } from 'next/server';
import { query } from '@/lib/db';

/**
 * POST /api/onboarding
 * Save onboarding answers and mark user as onboarded
 */
export async function POST(req: NextRequest) {
  try {
    const { userId, name, age, whatBroughtYou, answers } = await req.json();

    if (!userId || !answers) {
      return NextResponse.json({ error: 'Missing userId or answers' }, { status: 400 });
    }

    // Build full profile data (profile info + deep question answers)
    const profileData = {
      name: name || '',
      age: age || '',
      what_brought_you: whatBroughtYou || '',
      ...answers,
    };

    // Save profile data, name, and mark onboarding complete
    await query(
      `UPDATE users
       SET name = $1, profile_data = $2, onboarding_complete = true, updated_at = NOW()
       WHERE id = $3`,
      [name || null, JSON.stringify(profileData), userId]
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Onboarding error:', error);
    return NextResponse.json({ error: 'Failed to save onboarding' }, { status: 500 });
  }
}

/**
 * GET /api/onboarding?userId=X
 * Check if user has completed onboarding
 */
export async function GET(req: NextRequest) {
  const userId = req.nextUrl.searchParams.get('userId');
  if (!userId) {
    return NextResponse.json({ error: 'Missing userId' }, { status: 400 });
  }

  try {
    const result = await query(
      `SELECT onboarding_complete, profile_data FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: 'User not found' }, { status: 404 });
    }

    return NextResponse.json({
      onboardingComplete: result.rows[0].onboarding_complete,
      profileData: result.rows[0].profile_data,
    });
  } catch (error) {
    console.error('Onboarding check error:', error);
    return NextResponse.json({ error: 'Failed to check onboarding' }, { status: 500 });
  }
}

