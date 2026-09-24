// Combine accounts (POST /api/account/merge): the pure rules must match the shared SDK golden
// (Collective-Shared packages/userdata/test/merge.golden.json, copied to fixtures/), and the I/O flow is
// exercised end to end against in-memory Auth + Firestore fakes — no network.
const { test } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const m = require('../../src/server/account-merge');

const golden = require(path.join(__dirname, 'fixtures/merge.golden.json'));

test('pickSurvivor matches the shared golden', () => {
  for (const c of golden.survivor) assert.strictEqual(m.pickSurvivor(c.a, c.b).survivor.uid, c.expected, c.name);
});

test('mergeUserData matches the shared golden', () => {
  assert.deepStrictEqual(m.mergeUserData(golden.merge.survivor, golden.merge.loser), golden.merge.expected);
});

// --- fakes ----------------------------------------------------------------------------------

function fakeDb(seed = {}) {
  const store = new Map(); // "users/uid/coll/doc" -> data
  for (const [uid, colls] of Object.entries(seed)) {
    for (const [c, docs] of Object.entries(colls)) for (const [id, d] of Object.entries(docs)) store.set(`users/${uid}/${c}/${id}`, d);
  }
  const docRef = (p) => ({ _p: p, collection: (c) => collRef(`${p}/${c}`), listCollections: async () => {
    const names = new Set();
    for (const k of store.keys()) if (k.startsWith(`${p}/`)) names.add(k.slice(p.length + 1).split('/')[0]);
    return [...names].map((n) => ({ id: n }));
  } });
  const collRef = (p) => ({
    doc: (id) => docRef(`${p}/${id}`),
    get: async () => {
      const docs = [...store.entries()].filter(([k]) => k.startsWith(`${p}/`) && k.slice(p.length + 1).split('/').length === 1)
        .map(([k, v]) => ({ id: k.split('/').pop(), data: () => v }));
      return { empty: docs.length === 0, forEach: (f) => docs.forEach(f) };
    },
  });
  return {
    store,
    collection: (c) => collRef(c),
    batch: () => {
      const ops = [];
      return { set: (ref, d) => ops.push([ref._p, d]), commit: async () => ops.forEach(([p, d]) => store.set(p, d)) };
    },
    recursiveDelete: async (ref) => { for (const k of [...store.keys()]) if (k.startsWith(`${ref._p}/`)) store.delete(k); },
  };
}

const NOW = 1790000000000;
function fakeAuth(users) {
  const calls = [];
  return {
    calls,
    users,
    verifyIdToken: async (t) => {
      const [uid, age] = t.split(':');
      if (!users[uid]) throw new Error('bad token');
      return { uid, auth_time: Math.floor((NOW - Number(age) * 1000) / 1000) };
    },
    getUser: async (uid) => users[uid],
    deleteUser: async (uid) => { calls.push(['delete', uid]); delete users[uid]; },
    updateUser: async (uid, p) => {
      calls.push(['update', uid, p]);
      if (p.providerToLink) users[uid].providerData.push({ ...p.providerToLink });
      if (p.displayName) users[uid].displayName = p.displayName;
    },
    createCustomToken: async (uid) => `custom:${uid}`,
  };
}

const appleRelay = () => ({
  uid: 'A', email: 'x7@privaterelay.appleid.com', emailVerified: true, displayName: 'Bryan',
  metadata: { creationTime: 'Mon, 08 Dec 2025 17:23:00 GMT' },
  providerData: [{ providerId: 'apple.com', uid: 'apple-sub', email: 'x7@privaterelay.appleid.com' }],
});
const google = () => ({
  uid: 'G', email: 'bryan@noblecitychurch.org', emailVerified: true, displayName: null,
  metadata: { creationTime: 'Sun, 20 Sep 2026 20:53:00 GMT' },
  providerData: [{ providerId: 'google.com', uid: 'google-sub', email: 'bryan@noblecitychurch.org' }],
});

// --- flow ---------------------------------------------------------------------------------------

test("Bryan's case: signed in with an empty Apple account, connects Google → Google account survives with both logins", async () => {
  const auth = fakeAuth({ A: appleRelay(), G: google() });
  const db = fakeDb({ G: { annotations: { hl1: { kind: 'highlight', updatedAt: 5 } } } });
  const logs = [];
  const r = await m.mergeAccounts({ currentIdToken: 'A:86400', otherIdToken: 'G:10' }, { auth, db, now: () => NOW, log: (x) => logs.push(x) });

  assert.strictEqual(r.survivorUid, 'G');
  assert.strictEqual(r.survivorIsCurrent, false);
  assert.strictEqual(r.customToken, 'custom:G');
  assert.deepStrictEqual(r.moved, ['apple.com']);
  assert.ok(!auth.users.A, 'loser deleted');
  assert.deepStrictEqual(auth.users.G.providerData.map((p) => p.providerId).sort(), ['apple.com', 'google.com']);
  assert.strictEqual(auth.users.G.displayName, 'Bryan', 'name carried over when the survivor has none');
  assert.ok(db.store.has('users/G/annotations/hl1'));
  assert.strictEqual(logs.length, 1);
  // order: delete the loser BEFORE linking its identity to the survivor
  const iDel = auth.calls.findIndex((c) => c[0] === 'delete');
  const iLink = auth.calls.findIndex((c) => c[0] === 'update' && c[2].providerToLink);
  assert.ok(iDel >= 0 && iDel < iLink);
});

test('data moves from the loser into the survivor, and the loser is emptied', async () => {
  const auth = fakeAuth({ A: appleRelay(), G: google() });
  const db = fakeDb({
    A: { annotations: { hl2: { kind: 'highlight', updatedAt: 9 } }, answers: { q1: { text: 'from apple', updatedAt: 9 } } },
    G: { answers: { q1: { text: 'older', updatedAt: 1 } } },
  });
  // A has data and is the current (loser) session → needs a recent sign-in
  await assert.rejects(
    m.mergeAccounts({ currentIdToken: 'A:86400', otherIdToken: 'G:10' }, { auth, db, now: () => NOW }),
    (e) => e.code === 'reauth-required' && e.status === 401,
  );
  const r = await m.mergeAccounts({ currentIdToken: 'A:60', otherIdToken: 'G:10' }, { auth, db, now: () => NOW });
  assert.strictEqual(r.survivorUid, 'G');
  assert.strictEqual(db.store.get('users/G/answers/q1').text, 'from apple');
  assert.ok(db.store.has('users/G/annotations/hl2'));
  assert.ok(![...db.store.keys()].some((k) => k.startsWith('users/A/')));
});

test('survivor is the current account → no custom token needed', async () => {
  const auth = fakeAuth({ G: google(), A: appleRelay() });
  const db = fakeDb({});
  const r = await m.mergeAccounts({ currentIdToken: 'G:86400', otherIdToken: 'A:10' }, { auth, db, now: () => NOW });
  assert.strictEqual(r.survivorUid, 'G');
  assert.strictEqual(r.customToken, null);
});

test('refusals: stale other sign-in, same account, bad token, legacy data, other-product data', async () => {
  const mk = () => ({ auth: fakeAuth({ A: appleRelay(), G: google() }), db: fakeDb({}), now: () => NOW });
  const code = async (args, deps) => { try { await m.mergeAccounts(args, deps); return 'ok'; } catch (e) { return e.code; } };

  assert.strictEqual(await code({ currentIdToken: 'A:1', otherIdToken: 'G:600' }, mk()), 'stale-sign-in');
  assert.strictEqual(await code({ currentIdToken: 'A:1', otherIdToken: 'A:1' }, mk()), 'same-account');
  assert.strictEqual(await code({ currentIdToken: 'Z:1', otherIdToken: 'G:1' }, mk()), 'invalid-token');
  assert.strictEqual(await code({ currentIdToken: 'A:1' }, mk()), 'missing-token');

  const legacyDb = fakeDb({ A: { highlights: { h: { x: 1 } } } });
  assert.strictEqual(await code({ currentIdToken: 'A:1', otherIdToken: 'G:1' }, { ...mk(), legacyDb }), 'legacy-data');
  assert.strictEqual(
    await code({ currentIdToken: 'A:1', otherIdToken: 'G:1' }, { ...mk(), hasOtherProductData: async (uid) => (uid === 'A' ? 'institute' : null) }),
    'institute-data',
  );
});

test('dry run reports the plan and changes nothing', async () => {
  const auth = fakeAuth({ A: appleRelay(), G: google() });
  const db = fakeDb({ A: { activity: { u: { viewedAt: 3 } } } });
  const r = await m.mergeAccounts({ currentIdToken: 'A:10', otherIdToken: 'G:10', dryRun: true }, { auth, db, now: () => NOW });
  assert.strictEqual(r.dryRun, true);
  assert.strictEqual(r.writes, 1);
  assert.ok(auth.users.A);
  assert.strictEqual(auth.calls.length, 0);
});

test('a provider the survivor already has is reported, not moved', async () => {
  const a = appleRelay();
  a.providerData.push({ providerId: 'google.com', uid: 'other-google' });
  const auth = fakeAuth({ A: a, G: google() });
  const r = await m.mergeAccounts({ currentIdToken: 'A:10', otherIdToken: 'G:10' }, { auth, db: fakeDb({}), now: () => NOW });
  assert.deepStrictEqual(r.moved, ['apple.com']);
  assert.deepStrictEqual(r.skipped, ['google.com']);
});

// --- Institute check (fails closed) ------------------------------------------------------------
const { hasInstituteData } = require('../../src/server/institute-data');
function fakeInstituteDb(rows, { throws = false } = {}) {
  return {
    collection: (c) => ({
      where: (field, _op, value) => ({
        limit: () => ({
          get: async () => {
            if (throws) throw new Error('PERMISSION_DENIED');
            const hit = (rows[c] || []).some((r) => r[field] === value);
            return { empty: !hit };
          },
        }),
      }),
    }),
  };
}

test('Institute check: none → null; any record → institute; cannot read → institute (fail closed)', async () => {
  assert.strictEqual(await hasInstituteData('A', fakeInstituteDb({ progress: [{ uid: 'B' }] })), null);
  assert.strictEqual(await hasInstituteData('A', fakeInstituteDb({ progress: [{ uid: 'A' }] })), 'institute');
  assert.strictEqual(await hasInstituteData('A', fakeInstituteDb({ cohorts: [{ facilitatorUid: 'A' }] })), 'institute');
  assert.strictEqual(await hasInstituteData('A', fakeInstituteDb({}, { throws: true })), 'institute');
});
