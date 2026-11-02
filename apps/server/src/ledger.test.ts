import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';
import { authHeaders, registerAccount, startTestApp, type TestApp } from './test-helpers.js';
import { seedCredits, seedStack } from './test-fixtures.js';
import { verifyChain } from './ledger.js';

let current: TestApp;

afterEach(async () => {
  await current?.close();
});

describe('账本哈希链', () => {
  it('追加记录后链完整，序号连续', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '账本员');
    seedCredits(current.app, account.playerId, 500, 'seed-a');
    seedStack(current.app, account.playerId, 'ore-test', 10);

    const chain = verifyChain(current.app.db);
    assert.equal(chain.chainOk, true);
    assert.equal(chain.checked, 2);

    const rows = current.app.db
      .prepare('SELECT seq, prev_hash, hash FROM ledger_entries ORDER BY seq ASC')
      .all() as Array<{ seq: number; prev_hash: string; hash: string }>;
    assert.deepEqual(rows.map((row) => row.seq), [1, 2]);
    assert.equal(rows[0].prev_hash, '0'.repeat(64));
    assert.equal(rows[1].prev_hash, rows[0].hash);
  });

  it('篡改任何一条记录的金额都会被校验发现', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '篡改侦查');
    seedCredits(current.app, account.playerId, 100, 'seed-b');
    seedCredits(current.app, account.playerId, 100, 'seed-c');

    current.app.db.prepare('UPDATE ledger_entries SET credits_delta = 999 WHERE seq = 1').run();
    const broken = verifyChain(current.app.db);
    assert.equal(broken.chainOk, false);
    assert.equal(broken.brokenAt, 1);
  });

  it('客户端只能看到自己的流水，且带哈希可自校验', async () => {
    current = await startTestApp();
    const mine = await registerAccount(current.baseUrl, '我');
    const other = await registerAccount(current.baseUrl, '他');
    seedCredits(current.app, mine.playerId, 300, 'seed-mine');
    seedCredits(current.app, other.playerId, 700, 'seed-other');

    const res = await fetch(`${current.baseUrl}/api/ledger/entries`, { headers: authHeaders(mine.token) });
    const payload = (await res.json()) as { entries: Array<{ seq: number; creditsDelta: number; hash: string }> };
    assert.equal(payload.entries.length, 1);
    assert.equal(payload.entries[0].creditsDelta, 300);
    assert.match(payload.entries[0].hash, /^[0-9a-f]{64}$/);

    const verify = await fetch(`${current.baseUrl}/api/ledger/verify`, { headers: authHeaders(mine.token) });
    const chain = (await verify.json()) as { chainOk: boolean; checked: number };
    assert.equal(chain.chainOk, true);
    assert.equal(chain.checked, 2);
  });

  it('钱包拒绝透支与负冻结', async () => {
    current = await startTestApp();
    const account = await registerAccount(current.baseUrl, '透支者');
    seedCredits(current.app, account.playerId, 10, 'seed-small');

    const { appendEntry, tx } = await import('./ledger.js');
    assert.throws(() => {
      tx(current.app.db, () => {
        appendEntry(current.app.db, {
          accountId: account.playerId,
          entryType: 'test_overdraft',
          refType: 'test',
          refId: 'overdraft',
          creditsDelta: -50,
        });
      });
    }, /信用点余额不足/);
  });
});
