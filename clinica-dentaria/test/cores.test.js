'use strict';
// Cores dos estados: regra vermelho/azul/cinzento; só se mudam as cores que ninguém alterou.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');

test('estados antigos com a cor de origem passam às novas; cores personalizadas ficam', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-cores-'));
  process.env.DATA_DIR = dir; process.env.ADMIN_PASSWORD = 'x-teste-cores';
  const D = require('../db');
  D.run("UPDATE estados SET cor='#16a34a' WHERE nome='Presente'");
  D.run("UPDATE estados SET cor='#123456' WHERE nome='Urgente'");
  delete require.cache[require.resolve('../db')];
  const D2 = require('../db');
  const cor = n => D2.get('SELECT cor FROM estados WHERE nome=?', n).cor;
  assert.equal(cor('Presente'), '#0e7490');
  assert.equal(cor('Urgente'), '#123456');
  assert.equal(cor('Faltou'), '#dc2626');
  fs.rmSync(dir, { recursive: true, force: true });
});
