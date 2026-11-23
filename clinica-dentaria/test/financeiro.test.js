'use strict';
// Testes da faturação, recibos e saldos (node --test). Usa uma base de dados temporária.
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
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const saldo = async pid => (await ok('GET', `pacientes/${pid}/contacorrente`)).saldo;

let pid, t1, t2;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  pid = (await ok('POST', 't/pacientes', { nome: 'Paciente Teste' })).id;
  const trat = preco => ok('POST', 't/tratamentos', { paciente_id: pid, descricao: 'Tratamento ' + preco, preco, iva: 0, estado: 'realizado', data: hoje() });
  t1 = (await trat(50)).id; t2 = (await trat(80)).id;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('fatura-recibo paga no ato: saldo zero e motivo de isenção', async () => {
  const d = await ok('POST', 'documentos', { tipo: 'FR', paciente_id: pid, linhas: [{ tratamento_id: t1, descricao: 'Tratamento 50', preco: 50, iva: 0 }] });
  assert.equal(d.total, 50);
  assert.equal(d.linhas[0].isencao_cod, 'M07');
  assert.equal(await saldo(pid), 0);
});

test('o mesmo tratamento não pode ser faturado duas vezes', async () => {
  const r = await api('POST', 'documentos', { tipo: 'FR', paciente_id: pid, linhas: [{ tratamento_id: t1, descricao: 'Tratamento 50', preco: 50 }] });
  assert.equal(r.status, 409);
});

test('fatura + recibo parcial + recibo com excedente por conta', async () => {
  const ft = await ok('POST', 'documentos', { tipo: 'FT', paciente_id: pid, linhas: [{ tratamento_id: t2, descricao: 'Tratamento 80', preco: 80 }] });
  assert.equal(await saldo(pid), 80);
  await ok('POST', 'recibos', { paciente_id: pid, valor: 30, documento_ids: [ft.id] });
  assert.equal(await saldo(pid), 50);
  assert.equal((await ok('GET', `pacientes/${pid}/em-aberto`))[0].em_divida, 50);
  const rc = await ok('POST', 'recibos', { paciente_id: pid, valor: 60, documento_ids: [ft.id] });
  assert.equal(await saldo(pid), -10); // 10 € ficam por conta
  assert.equal((await ok('GET', `pacientes/${pid}/em-aberto`)).length, 0);
  await ok('POST', `documentos/${rc.id}/anular`, { motivo: 'teste' });
  assert.equal(await saldo(pid), 50);
});

test('nota de crédito parcial não liberta o tratamento para nova faturação', async () => {
  const fr = (await ok('GET', `documentos?paciente_id=${pid}&tipo=FR`))[0];
  await ok('POST', 'documentos', { tipo: 'NC', paciente_id: pid, ref_documento_id: fr.id, linhas: [{ tratamento_id: t1, descricao: 'Desconto', preco: 20 }] });
  const t = (await ok('GET', `pacientes/${pid}/tratamentos`)).find(x => x.id === t1);
  assert.equal(t.documento_id, fr.id);
  assert.equal((await api('POST', 'documentos', { tipo: 'FR', paciente_id: pid, linhas: [{ tratamento_id: t1, descricao: 'x', preco: 50 }] })).status, 409);
  assert.equal((await api('POST', 'documentos', { tipo: 'NC', paciente_id: pid, linhas: [{ descricao: 'x', preco: 5 }] })).status, 400); // NC sem origem
});

test('datas dos documentos seguem a ordem da série', async () => {
  const amanha = new Date(Date.now() + 864e5); const fut = `${amanha.getFullYear()}-${String(amanha.getMonth() + 1).padStart(2, '0')}-${String(amanha.getDate()).padStart(2, '0')}`;
  assert.equal((await api('POST', 'documentos', { tipo: 'FR', paciente_id: pid, data: fut, linhas: [{ descricao: 'x', preco: 10 }] })).status, 400);
  const ontem = new Date(Date.now() - 864e5); const ant = `${ontem.getFullYear()}-${String(ontem.getMonth() + 1).padStart(2, '0')}-${String(ontem.getDate()).padStart(2, '0')}`;
  if (ant.slice(0, 4) === hoje().slice(0, 4)) assert.equal((await api('POST', 'documentos', { tipo: 'FR', paciente_id: pid, data: ant, linhas: [{ descricao: 'x', preco: 10 }] })).status, 400);
});

test('fatura simplificada limitada a 100 €', async () => {
  assert.equal((await api('POST', 'documentos', { tipo: 'FS', paciente_id: pid, linhas: [{ descricao: 'x', preco: 150 }] })).status, 400);
  await ok('POST', 'documentos', { tipo: 'FS', paciente_id: pid, linhas: [{ descricao: 'x', preco: 40 }] });
});

test('histórico protegido: não se apaga paciente nem se altera tratamento faturado', async () => {
  assert.equal((await api('DELETE', `t/pacientes/${pid}`)).status, 409);
  assert.equal((await api('PUT', `t/tratamentos/${t1}`, { preco: 1 })).status, 409);
  assert.equal((await api('DELETE', `t/tratamentos/${t1}`)).status, 409);
  await ok('PUT', `t/tratamentos/${t1}`, { notas: 'ok' });
});

test('utilizador novo tem de mudar a palavra-passe antes de usar a app', async () => {
  await ok('POST', 'users', { nome: 'Receção', login: 'rec', password: 'provisoria1', perfil: 'rececao' });
  let ck = '';
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rec', password: 'provisoria1' }) });
  ck = r.headers.get('set-cookie').split(';')[0];
  assert.equal((await r.json()).trocar_pw, 1);
  assert.equal((await api('GET', 'pacientes', null, ck)).status, 403);
  assert.equal((await api('POST', 'password', { atual: 'provisoria1', nova: 'curta' }, ck)).status, 400);
  assert.equal((await api('POST', 'password', { atual: 'provisoria1', nova: 'uma-nova-boa' }, ck)).status, 200);
  assert.equal((await api('GET', 'pacientes', null, ck)).status, 200);
});
