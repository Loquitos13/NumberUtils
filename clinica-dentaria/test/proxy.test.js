'use strict';
// Atrás de um proxy (TRUST_PROXY=1) todos os postos chegam do mesmo IP: o bloqueio de login usa o X-Forwarded-For.
// Sem TRUST_PROXY o cabeçalho é ignorado (ver login.test.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
process.env.TRUST_PROXY = '1';
const { server } = require('../server');

let base;
const entrar = (login, password, xff) => fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': xff },
  body: JSON.stringify({ login, password }) }).then(r => r.status);

before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('TRUST_PROXY=1: 5 falhas de um posto bloqueiam esse posto e não os outros atrás do mesmo proxy', async () => {
  for (let i = 0; i < 5; i++) assert.equal(await entrar('nao-existe-' + i, 'errada', '10.0.0.1'), 401);
  assert.equal(await entrar('admin', 'segredo-de-teste', '10.0.0.1'), 429);
  // conta o endereço que o proxy acrescentou (o último), não o que o cliente inventou antes
  assert.equal(await entrar('admin', 'segredo-de-teste', '1.2.3.4, 10.0.0.1'), 429);
  assert.equal(await entrar('admin', 'segredo-de-teste', '10.0.0.2'), 200);
});

test('TRUST_PROXY=1 com X-Forwarded-Proto: https → cookie com Secure; sem o cabeçalho, sem Secure', async () => {
  const ck = async proto => (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.' + (proto ? 1 : 2), ...(proto ? { 'X-Forwarded-Proto': proto } : {}) },
    body: JSON.stringify({ login: 'admin', password: 'segredo-de-teste' }) })).headers.get('set-cookie');
  assert.match(await ck('https'), /; Secure/);
  assert.doesNotMatch(await ck(null), /Secure/);
});
