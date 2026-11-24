'use strict';
// Limites dos parâmetros numéricos (DoS), permissões de estado dos tratamentos e verificação de origem atrás de proxy.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');

let port;
function pedido(metodo, caminho, { corpo, ck, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers }; if (ck) h.Cookie = ck; if (corpo !== undefined) h['Content-Type'] = 'application/json';
    const r = http.request({ host: '127.0.0.1', port, path: '/api/' + caminho, method: metodo, headers: h }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => { const texto = Buffer.concat(ch).toString('utf8'); let json; try { json = JSON.parse(texto); } catch {} resolve({ status: res.statusCode, texto, json }); });
    });
    r.setTimeout(5000, () => r.destroy(new Error('sem resposta'))); r.on('error', reject);
    r.end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });
}
const sid = r => (r.headers['set-cookie'] || [''])[0].split(';')[0];
async function login(l, p) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: '/api/login', method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(sid(res))); });
    r.on('error', reject); r.end(JSON.stringify({ login: l, password: p }));
  });
}
const ck = {};
let md, pid;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  ck.admin = await login('admin', 'segredo-de-teste');
  assert.equal((await pedido('POST', 'users', { ck: ck.admin, corpo: { nome: 'Receção', login: 'rec', password: 'provisoria1', perfil: 'rececao' } })).status, 200);
  ck.rececao = await login('rec', 'provisoria1');
  assert.equal((await pedido('POST', 'password', { ck: ck.rececao, corpo: { atual: 'provisoria1', nova: 'palavra-boa-1' } })).status, 200);
  md = (await pedido('POST', 't/medicos', { ck: ck.admin, corpo: { nome: 'Dr. Limites', ativo: 1 } })).json.id;
  pid = (await pedido('POST', 't/pacientes', { ck: ck.admin, corpo: { nome: 'Paciente Limites' } })).json.id;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('pesquisa de vagas: duração negativa ou absurda → 400 rápido; normal funciona', async () => {
  for (const dur of ['-1e12', '-1', '0', '1e12', '100000']) {
    const r = await pedido('GET', `pesquisa-vagas?medico_id=${md}&duracao=${dur}&manha=0&tarde=0`, { ck: ck.rececao });
    assert.equal(r.status, 400, dur); // validado antes do ciclo: o tempo não se mede aqui (o stress mede)
  }
  for (const qs of ['limite=-5', 'limite=1e9', 'dias=1e12']) assert.equal((await pedido('GET', `pesquisa-vagas?medico_id=${md}&${qs}`, { ck: ck.rececao })).status, 400, qs);
  const r = await pedido('GET', `pesquisa-vagas?medico_id=${md}&duracao=30&de=2030-04-01&limite=3`, { ck: ck.rececao });
  assert.equal(r.status, 200, r.texto);
  assert.equal(r.json.length, 3);
});

test('orçamentos: quantidade 0, negativa ou enorme → 400; aceitar com mais de 32 unidades → 400; 2 cria 2', async () => {
  for (const qtd of [0, -1, 1e9]) assert.equal((await pedido('POST', 'orcamentos', { ck: ck.rececao, corpo: { paciente_id: pid, linhas: [{ descricao: 'X', preco: 10, qtd }] } })).status, 400, String(qtd));
  const grande = (await pedido('POST', 'orcamentos', { ck: ck.rececao, corpo: { paciente_id: pid, linhas: [{ descricao: 'Selante', preco: 10, qtd: 33 }] } })).json.id;
  assert.equal((await pedido('POST', `orcamentos/${grande}/aceitar`, { ck: ck.rececao, corpo: {} })).status, 400);
  const o = (await pedido('POST', 'orcamentos', { ck: ck.rececao, corpo: { paciente_id: pid, linhas: [{ descricao: 'Coroa-2', preco: 10, qtd: 2 }] } })).json.id;
  assert.equal((await pedido('POST', `orcamentos/${o}/aceitar`, { ck: ck.rececao, corpo: {} })).status, 200);
  const trat = (await pedido('GET', `pacientes/${pid}/tratamentos`, { ck: ck.rececao })).json.filter(t => t.descricao === 'Coroa-2');
  assert.equal(trat.length, 2);
});

test('tratamento realizado: a receção não o volta a planear (para depois apagar); o admin pode; outros campos sim', async () => {
  const t = (await pedido('POST', 't/tratamentos', { ck: ck.admin, corpo: { paciente_id: pid, descricao: 'Restauração', estado: 'realizado' } })).json.id;
  assert.equal((await pedido('PUT', `t/tratamentos/${t}`, { ck: ck.rececao, corpo: { estado: 'planeado' } })).status, 403);
  assert.equal((await pedido('PUT', `t/tratamentos/${t}`, { ck: ck.rececao, corpo: { estado: 'realizado', notas: 'ok' } })).status, 200);
  assert.equal((await pedido('PUT', `t/tratamentos/${t}`, { ck: ck.rececao, corpo: { notas: 'só notas' } })).status, 200);
  assert.equal((await pedido('PUT', `t/tratamentos/${t}`, { ck: ck.admin, corpo: { estado: 'planeado' } })).status, 200);
});

test('origem: atrás de um proxy aceita Origin igual a X-Forwarded-Host; outra origem continua 403', async () => {
  const h = o => ({ Origin: o, 'X-Forwarded-Host': 'clinica.exemplo' });
  assert.equal((await pedido('POST', 'notas', { ck: ck.rececao, corpo: { texto: 'a' }, headers: h('https://clinica.exemplo') })).status !== 403, true);
  assert.equal((await pedido('POST', 'notas', { ck: ck.rececao, corpo: { texto: 'a' }, headers: h('https://mau.exemplo') })).status, 403);
  assert.equal((await pedido('POST', 'notas', { ck: ck.rececao, corpo: { texto: 'a' }, headers: { Origin: 'https://mau.exemplo' } })).status, 403);
});
