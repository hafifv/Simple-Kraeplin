const MINUTES = [1, 5, 10, 15, 30, 45, 60];

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Soal ke-i selalu sama untuk seed yang sama: tak terhingga dan mudah dites.
function question(seed, i) {
  const r = mulberry32((seed + Math.imul(i + 1, 0x9e3779b1)) | 0);
  return { i, a: Math.floor(r() * 10), b: Math.floor(r() * 10) };
}

const correctAnswer = (q) => ((q.a + q.b) % 2 === 0 ? 'genap' : 'ganjil');

const score = (a) => ({
  answered: a.answered,
  correct: a.correct,
  wrong: a.answered - a.correct,
});

// Urutan: benar terbanyak, salah tersedikit, dijawab terbanyak, lalu yang lebih dulu mulai.
function rank(list) {
  return [...list]
    .sort(
      (x, y) =>
        y.correct - x.correct ||
        x.wrong - y.wrong ||
        y.answered - x.answered ||
        x.startedAt - y.startedAt
    )
    .map((s, i) => ({ rank: i + 1, ...s }));
}

module.exports = { MINUTES, question, correctAnswer, score, rank };
