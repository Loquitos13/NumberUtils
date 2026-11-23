'use strict';
// Testes do periodontograma (node --test). Usa uma base de dados temporária.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');

let base, cookie = '';
async function api(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && ck === cookie) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };

// locais: MV, V, DV, ML, L, DL
const dente = (ps, extra = {}) => ({ ps, rec: [0, 0, 0, 0, 0, 0], hem: [0, 0, 0, 0, 0, 0], pla: [0, 0, 0, 0, 0, 0], mob: 0, furca: 0, ausente: 0, ...extra });

let pid;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  pid = (await ok('POST', 't/pacientes', { nome: 'Paciente Perio' })).id;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('criar e ler um exame periodontal', async () => {
  const dados = { 16: dente([3, 2, 3, 3, 2, 3], { mob: 1, furca: 2 }) };
  const e = await ok('POST', `pacientes/${pid}/perio`, { data: '2026-01-10', dados, notas: 'inicial' });
  const lido = await ok('GET', `perio/${e.id}`);
  assert.equal(lido.paciente_id, pid);
  assert.equal(lido.data, '2026-01-10');
  assert.equal(lido.notas, 'inicial');
  assert.deepEqual(lido.dados['16'].ps, [3, 2, 3, 3, 2, 3]);
  assert.equal(lido.dados['16'].furca, 2);
});

test('índices calculados sem contar os dentes ausentes', async () => {
  const dados = {
    16: dente([3, 4, 5, 2, 6, 3], { pla: [1, 0, 1, 0, 0, 0], hem: [1, 1, 0, 0, 0, 0] }),
    11: dente([2, 2, 2, 2, 2, 2], { pla: [0, 0, 0, 0, 0, 1] }),
    26: dente([9, 9, 9, 9, 9, 9], { ausente: 1, pla: [1, 1, 1, 1, 1, 1], hem: [1, 1, 1, 1, 1, 1] }),
  };
  const e = await ok('POST', `pacientes/${pid}/perio`, { data: '2026-03-01', dados });
  // 12 locais presentes: placa 3/12, hemorragia 2/12, PS (23+12)/12, locais ≥4 mm: 4, 5, 6
  assert.deepEqual(e.indices, { placa_pct: 25, hemorragia_pct: 16.7, ps_media: 2.92, locais_4mm: 3 });
});

test('valores fora dos limites dão 400', async () => {
  const post = dados => api('POST', `pacientes/${pid}/perio`, { data: '2026-03-02', dados });
  assert.equal((await post({ 16: dente([16, 0, 0, 0, 0, 0]) })).status, 400); // PS > 15
  assert.equal((await post({ 16: dente([-1, 0, 0, 0, 0, 0]) })).status, 400); // PS < 0
  assert.equal((await post({ 16: dente([3, 3, 3, 3, 3, 3], { rec: [-6, 0, 0, 0, 0, 0] }) })).status, 400);
  assert.equal((await post({ 16: dente([3, 3, 3, 3, 3, 3], { rec: [16, 0, 0, 0, 0, 0] }) })).status, 400);
  assert.equal((await post({ 16: dente([3, 3, 3, 3, 3, 3], { mob: 4 }) })).status, 400);
  assert.equal((await post({ 16: dente([3, 3, 3, 3, 3, 3], { furca: -1 }) })).status, 400);
  assert.equal((await post({ 16: dente([3, 3, 3]) })).status, 400); // faltam locais
  assert.equal((await post({ 19: dente([3, 3, 3, 3, 3, 3]) })).status, 400); // dente FDI inexistente
  assert.equal((await api('POST', `pacientes/${pid}/perio`, { data: 'ontem', dados: {} })).status, 400);
  // limites aceites e locais por registar
  await ok('POST', `pacientes/${pid}/perio`, { data: '2026-03-02', dados: { 48: dente([15, 0, null, 0, 0, 0], { rec: [-5, 15, null, 0, 0, 0], mob: 3, furca: 3 }) } });
});

test('alterar e eliminar um exame, com registo', async () => {
  const e = await ok('POST', `pacientes/${pid}/perio`, { data: '2026-04-01', dados: { 21: dente([2, 2, 2, 2, 2, 2]) } });
  const u = await ok('PUT', `perio/${e.id}`, { notas: 'revisto', dados: { 21: dente([5, 2, 2, 2, 2, 2]) } });
  assert.equal(u.notas, 'revisto');
  assert.equal(u.data, '2026-04-01'); // campos não enviados mantêm-se
  assert.equal(u.indices.locais_4mm, 1);
  assert.equal((await api('PUT', `perio/${e.id}`, { dados: { 21: dente([20, 2, 2, 2, 2, 2]) } })).status, 400);
  await ok('DELETE', `perio/${e.id}`);
  assert.equal((await api('GET', `perio/${e.id}`)).status, 404);
  const acoes = (await ok('GET', 'logs')).map(l => l.acao);
  for (const a of ['criar periodontograma', 'editar periodontograma', 'eliminar periodontograma']) assert.ok(acoes.includes(a), a);
});

test('lista do paciente para comparar: mais recente primeiro, com índices', async () => {
  const p2 = (await ok('POST', 't/pacientes', { nome: 'Paciente Comparação' })).id;
  await ok('POST', `pacientes/${p2}/perio`, { data: '2026-01-15', dados: { 36: dente([6, 5, 4, 3, 3, 3]) } });
  await ok('POST', `pacientes/${p2}/perio`, { data: '2026-06-15', dados: { 36: dente([3, 3, 3, 3, 3, 3]) } });
  const l = await ok('GET', `pacientes/${p2}/perio`);
  assert.deepEqual(l.map(e => e.data), ['2026-06-15', '2026-01-15']);
  assert.deepEqual(l.map(e => e.indices.locais_4mm), [0, 3]);
  assert.deepEqual(l[1].dados['36'].ps, [6, 5, 4, 3, 3, 3]);
  assert.equal((await api('GET', 'pacientes/999999/perio')).status, 404);
});

test('a data tem de existir no calendário e o médico tem de existir', async () => {
  const post = extra => api('POST', `pacientes/${pid}/perio`, { data: '2026-05-01', dados: {}, ...extra });
  assert.equal((await post({ data: '2024-13-45' })).status, 400);
  assert.equal((await post({ data: '2026-02-30' })).status, 400);
  assert.equal((await post({ medico_id: 999999 })).status, 400);
  const e = await ok('POST', `pacientes/${pid}/perio`, { data: '2024-02-29', dados: {}, medico_id: null });
  assert.equal((await api('PUT', `perio/${e.id}`, { medico_id: 999999 })).status, 400);
});

test('só o administrador elimina um exame', async () => {
  const e = await ok('POST', `pacientes/${pid}/perio`, { data: '2026-07-01', dados: {} });
  await ok('POST', 'users', { nome: 'Receção Perio', login: 'rececao-perio', perfil: 'rececao', password: 'provisoria-1' });
  let ck = '';
  for (const [url, corpo] of [['login', { login: 'rececao-perio', password: 'provisoria-1' }], ['password', { atual: 'provisoria-1', nova: 'definitiva-1' }]]) {
    const r = await fetch(`${base}/api/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify(corpo) });
    assert.equal(r.status, 200);
    ck = r.headers.get('set-cookie')?.split(';')[0] || ck;
  }
  assert.equal((await api('PUT', `perio/${e.id}`, { notas: 'pela receção' }, ck)).status, 200);
  assert.equal((await api('DELETE', `perio/${e.id}`, null, ck)).status, 403);
  await ok('DELETE', `perio/${e.id}`);
});
