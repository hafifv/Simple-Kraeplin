const fs = require('node:fs');
const path = require('node:path');

// createStore()        -> hanya di memori (untuk tes)
// createStore(file)    -> tersimpan ke file JSON
function createStore(file) {
  let data = { attempts: {} };
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  let timer = null;

  function flush() {
    if (!file) return;
    clearTimeout(timer);
    timer = null;
    fs.writeFileSync(file + '.tmp', JSON.stringify(data));
    fs.renameSync(file + '.tmp', file);
  }

  return {
    get: (id) => data.attempts[id],
    all: () => Object.values(data.attempts),
    put(attempt) {
      data.attempts[attempt.id] = attempt;
      if (file && !timer) {
        timer = setTimeout(flush, 1000);
        timer.unref?.();
      }
    },
    flush,
  };
}

module.exports = { createStore };
