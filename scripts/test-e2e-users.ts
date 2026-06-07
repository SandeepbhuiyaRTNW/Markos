/**
 * E2E Test: Both invited user accounts
 * Tests: login → conversation opening → message/response → memory storage → isolation
 */

const BASE = 'http://localhost:3000';

const USERS = [
  { email: 'acjohnson2@stthomas.edu', password: 'Marcus2026ac', name: 'A.C. Johnson' },
  { email: 'okuhlke@mcad.edu', password: 'Marcus2026ok', name: 'Olaf Kuhlke' },
];

// Different messages per user to test memory isolation
const TEST_MESSAGES: Record<string, string[]> = {
  'acjohnson2@stthomas.edu': [
    "I've been thinking about my marriage lately. Things feel distant between us.",
    "She says I never open up. Maybe she's right. I don't know how.",
  ],
  'okuhlke@mcad.edu': [
    "I lost my job last month and I'm struggling to find purpose without it.",
    "My identity was so tied to my work. Now I don't know who I am.",
  ],
};

let passed = 0;
let failed = 0;

function assert(label: string, ok: boolean, detail?: string) {
  if (ok) { console.log(`  ✅ ${label}`); passed++; }
  else { console.log(`  ❌ ${label}${detail ? ` — ${detail}` : ''}`); failed++; }
}

async function api(path: string, body: object) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  return { status: res.status, data };
}

async function apiGet(path: string) {
  const res = await fetch(`${BASE}${path}`);
  const data = await res.json();
  return { status: res.status, data };
}

async function testUser(user: typeof USERS[0]) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`Testing: ${user.email}`);
  console.log('═'.repeat(50));

  // 1. Login
  console.log('\n── Login ──');
  const login = await api('/api/auth/login', { email: user.email, password: user.password });
  assert('Login succeeds', login.status === 200, `status=${login.status} ${JSON.stringify(login.data)}`);
  assert('Returns userId', !!login.data.userId, login.data.userId);
  assert('Returns correct email', login.data.email === user.email);
  const userId = login.data.userId;

  // 1b. Bad password
  const badLogin = await api('/api/auth/login', { email: user.email, password: 'wrong' });
  assert('Bad password rejected', badLogin.status === 401);

  // 2. Conversation opening
  console.log('\n── Conversation Opening ──');
  const opening = await apiGet(`/api/conversation/opening?userId=${userId}&skipTts=true&sessionType=fresh`);
  assert('Opening succeeds', opening.status === 200, `status=${opening.status}`);
  assert('Opening has marcusText', !!opening.data.marcusText, opening.data.marcusText?.substring(0, 80));
  assert('Opening has conversationId', !!opening.data.conversationId);
  const conversationId = opening.data.conversationId;
  console.log(`  📝 Marcus: "${opening.data.marcusText?.substring(0, 100)}..."`);

  // 3. Send messages through full pipeline
  console.log('\n── Message Pipeline ──');
  const messages = TEST_MESSAGES[user.email];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    console.log(`  → Sending: "${msg.substring(0, 60)}..."`);
    const resp = await api('/api/test-conversation', {
      userId, conversationId, message: msg, skipTts: true,
    });
    assert(`Message ${i + 1} succeeds`, resp.status === 200, `status=${resp.status} ${JSON.stringify(resp.data).substring(0, 200)}`);
    assert(`Message ${i + 1} has marcusText`, !!resp.data.marcusText);
    assert(`Message ${i + 1} has emotion`, !!resp.data.emotion);
    if (resp.data.agentTimings) {
      const timings = Object.entries(resp.data.agentTimings).map(([k, v]) => `${k}:${v}ms`).join(', ');
      console.log(`  ⏱️  Timings: ${timings}`);
    }
    if (resp.data.errors?.length > 0) {
      console.log(`  ⚠️  Errors: ${JSON.stringify(resp.data.errors)}`);
    }
    console.log(`  📝 Marcus: "${resp.data.marcusText?.substring(0, 100)}..."`);
  }

  // 4. Verify messages stored in DB
  console.log('\n── Memory & Storage ──');
  const convDetail = await apiGet(`/api/conversations/${conversationId}`);
  assert('Conversation exists in DB', convDetail.status === 200);
  const msgCount = convDetail.data.messages?.length || 0;
  // Opening + (2 user messages + 2 marcus responses) = 5
  assert('Messages stored (opening + turns)', msgCount >= 5, `count=${msgCount}`);

  return { userId, conversationId };
}

async function testMemoryIsolation(results: { userId: string; conversationId: string }[]) {
  console.log(`\n${'═'.repeat(50)}`);
  console.log('Testing: Memory Isolation');
  console.log('═'.repeat(50));

  // Fetch conversations for each user
  for (let i = 0; i < USERS.length; i++) {
    const { userId } = results[i];
    const convs = await apiGet(`/api/conversations?userId=${userId}`);
    assert(`${USERS[i].email} has conversations`, convs.status === 200 && (convs.data.length > 0 || convs.data.conversations?.length > 0));
  }

  // Verify user 1's conversation doesn't appear for user 2
  const u1Convs = await apiGet(`/api/conversations?userId=${results[0].userId}`);
  const u2Convs = await apiGet(`/api/conversations?userId=${results[1].userId}`);
  const u1Ids = (u1Convs.data.conversations || u1Convs.data || []).map((c: { id: string }) => c.id);
  const u2Ids = (u2Convs.data.conversations || u2Convs.data || []).map((c: { id: string }) => c.id);
  const overlap = u1Ids.filter((id: string) => u2Ids.includes(id));
  assert('No conversation overlap between users', overlap.length === 0, `overlap=${JSON.stringify(overlap)}`);
}

async function main() {
  console.log('🧪 E2E Test: Both User Accounts\n');

  const results = [];
  for (const user of USERS) {
    results.push(await testUser(user));
  }

  await testMemoryIsolation(results);

  console.log(`\n${'═'.repeat(50)}`);
  console.log(`\n${passed} passed, ${failed} failed out of ${passed + failed} tests`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
