const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const K = require('../lib/kraepelin');
const { createStore } = require('../lib/store');
const { createApp } = require('../server');

async function boot() {
  let t = 1_000_000;
  const srv = createApp({ store: createStore(), now: () => t, newSeed: () => 42 });
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const call = async (p, body) => {
    const r = await fetch(base + p, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : undefined);
    return { status: r.status, data: await r.json() };
  };
  return { srv, call, tick: (ms) => (t += ms) };
}

test('soal deterministik dan jawaban benar', () => {
  assert.deepEqual(K.question(42, 7), K.question(42, 7));
  assert.equal(K.correctAnswer({ a: 3, b: 4 }), 'ganjil');
  assert.equal(K.correctAnswer({ a: 3, b: 5 }), 'genap');
  assert.equal(K.correctAnswer({ a: 0, b: 0 }), 'genap');
});

test('ranking: benar terbanyak, salah tersedikit, dijawab terbanyak', () => {
  const r = K.rank([
    { name: 'B', correct: 5, wrong: 3, answered: 8, startedAt: 1 },
    { name: 'A', correct: 5, wrong: 1, answered: 6, startedAt: 2 },
    { name: 'C', correct: 9, wrong: 9, answered: 18, startedAt: 3 },
  ]);
  assert.deepEqual(r.map((x) => x.name), ['C', 'A', 'B']);
});

test('alur tes: validasi, jawab, urutan, refresh, waktu habis, peringkat', async () => {
  const { srv, call, tick } = await boot();
  try {
    assert.equal((await call('/api/attempts', { name: '', minutes: 5 })).status, 400);
    assert.equal((await call('/api/attempts', { name: 'Ani', minutes: 7 })).status, 400);

    const { data: s } = await call('/api/attempts', { name: 'Ani', minutes: 1 });
    const { data } = await call(`/api/attempts/${s.id}/questions?count=3`);
    const qs = data.questions;
    assert.equal(qs[0].answer, undefined); // kunci jawaban tidak bocor

    const right = K.correctAnswer(qs[0]);
    const wrong = K.correctAnswer(qs[1]) === 'ganjil' ? 'genap' : 'ganjil';
    assert.equal((await call(`/api/attempts/${s.id}/answers`, { i: 0, answer: right })).data.correct, 1);
    assert.equal((await call(`/api/attempts/${s.id}/answers`, { i: 5, answer: right })).status, 409);
    assert.equal((await call(`/api/attempts/${s.id}/answers`, { i: 1, answer: wrong })).data.wrong, 1);

    tick(30_000); // "refresh": sisa waktu tetap dihitung dari server
    const mid = (await call(`/api/attempts/${s.id}`)).data;
    assert.equal(mid.remainingMs, 30_000);
    assert.equal(mid.finished, false);

    tick(40_000); // lewat durasi + toleransi
    assert.equal((await call(`/api/attempts/${s.id}`)).data.finished, true);
    assert.equal((await call(`/api/attempts/${s.id}/answers`, { i: 2, answer: right })).status, 410);

    const board = (await call('/api/leaderboard?minutes=1')).data;
    assert.equal(board.length, 1);
    assert.deepEqual(
      [board[0].rank, board[0].correct, board[0].wrong, board[0].answered],
      [1, 1, 1, 2]
    );
  } finally {
    srv.closeAllConnections();
    srv.close();
  }
});

test('percobaan tersimpan ke file', () => {
  const f = path.join(os.tmpdir(), `kraepelin-${Date.now()}.json`);
  const s = createStore(f);
  s.put({ id: 'x', answered: 0 });
  s.flush();
  assert.equal(createStore(f).get('x').id, 'x');
  fs.unlinkSync(f);
});
