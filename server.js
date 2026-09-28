const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const K = require('./lib/kraepelin');
const { createStore } = require('./lib/store');

const GRACE_MS = 2000; // toleransi latensi untuk jawaban terakhir

// Semua dependensi (store, jam, seed) bisa diganti saat tes.
function createApp({ store, now = Date.now, newSeed = () => crypto.randomInt(2 ** 31) }) {
  const endsAt = (a) => a.startedAt + a.durationMs;
  const closed = (a) => now() > endsAt(a) + GRACE_MS;
  const view = (a) => {
    const remainingMs = Math.max(0, endsAt(a) - now());
    return {
      id: a.id,
      name: a.name,
      minutes: a.minutes,
      remainingMs,
      finished: remainingMs === 0,
      ...K.score(a),
    };
  };
  const NF = [404, { error: 'Percobaan tidak ditemukan' }];
  const routes = [];
  const route = (method, re, fn) => routes.push({ method, re, fn });

  route('POST', /^\/api\/attempts$/, ({ body }) => {
    const name = String(body.name ?? '').trim().slice(0, 40);
    const minutes = Number(body.minutes);
    if (!name || !K.MINUTES.includes(minutes)) {
      return [400, { error: 'Nama dan durasi wajib diisi dengan benar' }];
    }
    const a = {
      id: crypto.randomUUID(),
      name,
      minutes,
      durationMs: minutes * 60000,
      seed: newSeed(),
      startedAt: now(),
      answered: 0,
      correct: 0,
      log: [], // { i, answer, ok, t } untuk setiap jawaban
    };
    store.put(a);
    return [201, view(a)];
  });

  route('GET', /^\/api\/attempts$/, ({ query }) => {
    const name = (query.get('name') || '').trim().toLowerCase();
    return [
      200,
      store
        .all()
        .filter((a) => !name || a.name.toLowerCase() === name)
        .sort((x, y) => y.startedAt - x.startedAt)
        .map(view),
    ];
  });

  route('GET', /^\/api\/attempts\/([\w-]+)$/, ({ params }) => {
    const a = store.get(params[0]);
    return a ? [200, view(a)] : NF;
  });

  route('GET', /^\/api\/attempts\/([\w-]+)\/questions$/, ({ params, query }) => {
    const a = store.get(params[0]);
    if (!a) return NF;
    if (closed(a)) return [200, { questions: [] }];
    const n = Math.min(Number(query.get('count')) || 50, 100);
    const from = Math.max(a.answered, Number(query.get('from')) || 0);
    return [200, { questions: Array.from({ length: n }, (_, k) => K.question(a.seed, from + k)) }];
  });

  route('POST', /^\/api\/attempts\/([\w-]+)\/answers$/, ({ params, body }) => {
    const a = store.get(params[0]);
    if (!a) return NF;
    if (closed(a)) return [410, { error: 'Waktu habis', ...view(a) }];
    if (!['ganjil', 'genap'].includes(body.answer)) {
      return [400, { error: 'Jawaban harus ganjil atau genap' }];
    }
    if (body.i !== a.answered) return [409, { error: 'Urutan soal tidak sesuai', ...view(a) }];
    const ok = K.correctAnswer(K.question(a.seed, a.answered)) === body.answer;
    a.log.push({ i: a.answered, answer: body.answer, ok, t: now() - a.startedAt });
    a.answered += 1;
    if (ok) a.correct += 1;
    store.put(a);
    return [200, view(a)];
  });

  // Hanya percobaan yang sudah ditutup (waktu habis + toleransi), per durasi.
  route('GET', /^\/api\/leaderboard$/, ({ query }) => {
    const minutes = Number(query.get('minutes'));
    const list = store
      .all()
      .filter((a) => closed(a) && (!minutes || a.minutes === minutes))
      .map((a) => ({ id: a.id, name: a.name, minutes: a.minutes, startedAt: a.startedAt, ...K.score(a) }));
    return [200, K.rank(list).slice(0, 50)];
  });

  return http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const send = (status, obj) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(obj));
    };
    try {
      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html')));
      }
      for (const r of routes) {
        const m = r.method === req.method && url.pathname.match(r.re);
        if (!m) continue;
        let body = {};
        if (req.method === 'POST') {
          let raw = '';
          for await (const chunk of req) {
            raw += chunk;
            if (raw.length > 10000) throw new Error('terlalu besar');
          }
          body = raw ? JSON.parse(raw) : {};
        }
        const [status, obj] = await r.fn({ params: m.slice(1), query: url.searchParams, body });
        return send(status, obj);
      }
      send(404, { error: 'Tidak ditemukan' });
    } catch {
      send(400, { error: 'Request tidak valid' });
    }
  });
}

module.exports = { createApp };

if (require.main === module) {
  const store = createStore(process.env.DATA_FILE || path.join(__dirname, 'data', 'attempts.json'));
  const port = process.env.PORT || 3000;
  createApp({ store }).listen(port, () => console.log(`Kraepelin jalan di http://localhost:${port}`));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
      store.flush();
      process.exit(0);
    });
  }
}
