'use strict';
// Testes de robustez: URLs inválidos, limites das notas de crédito, anulações, permissões e arranque da BD.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

process.env.TZ = 'Pacific/Kiritimati'; // UTC+14: a hora local nunca coincide com a hora UTC
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = path.relative(process.cwd(), dir); // caminho relativo de propósito
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');
const COM = require('../comunicacao');

let base, cookie = '', ckRec = '';
async function api(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && ck === cookie) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const pedidoBruto = caminho => new Promise((resolve, reject) => {
  const r = http.request({ host: '127.0.0.1', port: server.address().port, path: caminho }, res => { res.resume(); resolve(res.statusCode); });
  r.setTimeout(2000, () => r.destroy(new Error('sem resposta'))); r.on('error', reject); r.end();
});
const fatura = (pid, preco, tipo = 'FT') => ok('POST', 'documentos', { tipo, paciente_id: pid, linhas: [{ descricao: 'Consulta', preco, iva: 0 }] });

let pA, pB;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  pA = (await ok('POST', 't/pacientes', { nome: 'Ana Robusta' })).id;
  pB = (await ok('POST', 't/pacientes', { nome: 'Bruno Robusto' })).id;
  await ok('POST', 'users', { nome: 'Receção', login: 'rec', password: 'provisoria1', perfil: 'rececao' });
  ckRec = (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rec', password: 'provisoria1' }) }))
    .headers.get('set-cookie').split(';')[0];
  await ok('POST', 'password', { atual: 'provisoria1', nova: 'uma-nova-boa' }, ckRec);
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('URL inválido não derruba o servidor', async () => {
  assert.equal(await pedidoBruto('/%E0%A4%A'), 400);
  assert.equal(await pedidoBruto('//'), 400);
  assert.equal((await api('GET', 'me')).status, 200);
});

test('nota de crédito só para o mesmo paciente e até ao valor por creditar', async () => {
  const ft = await fatura(pA, 50);
  const nc = (paciente_id, preco) => api('POST', 'documentos', { tipo: 'NC', paciente_id, ref_documento_id: ft.id, linhas: [{ descricao: 'Crédito', preco, iva: 0 }] });
  assert.equal((await nc(pB, 10)).status, 400);
  assert.equal((await nc(pA, 1000)).status, 400);
  assert.equal((await nc(pA, 30)).status, 200);
  assert.equal((await nc(pA, 30)).status, 400); // só restam 20 €
  assert.equal((await nc(pA, 20)).status, 200);
});

test('não se anula uma fatura com nota de crédito ou recibo ativos', async () => {
  const ft = await fatura(pA, 40);
  const nc = await ok('POST', 'documentos', { tipo: 'NC', paciente_id: pA, ref_documento_id: ft.id, linhas: [{ descricao: 'Crédito', preco: 5, iva: 0 }] });
  assert.equal((await api('POST', `documentos/${ft.id}/anular`, { motivo: 't' })).status, 409);
  await ok('POST', `documentos/${nc.id}/anular`, { motivo: 't' });
  const rc = await ok('POST', 'recibos', { paciente_id: pA, valor: 10, documento_ids: [ft.id] });
  assert.equal((await api('POST', `documentos/${ft.id}/anular`, { motivo: 't' })).status, 409);
  await ok('POST', `documentos/${rc.id}/anular`, { motivo: 't' });
  await ok('POST', `documentos/${ft.id}/anular`, { motivo: 't' });
});

test('notas clínicas: só o administrador apaga, e fica registado', async () => {
  const { id } = await ok('POST', 'notas', { paciente_id: pA, texto: 'Nota de teste' }, ckRec);
  assert.equal((await api('DELETE', `notas/${id}`, null, ckRec)).status, 403);
  await ok('DELETE', `notas/${id}`);
  const acoes = (await ok('GET', 'logs')).map(l => l.acao);
  assert.ok(acoes.includes('criar nota clínica'), acoes.join());
  assert.ok(acoes.includes('apagar nota clínica'), acoes.join());
});

test('nota e anamnese guardam a hora local', async () => {
  const d = new Date(); const hora = `${hoje()} ${String(d.getHours()).padStart(2, '0')}`;
  await ok('POST', 'notas', { paciente_id: pA, texto: 'Hora' });
  const n = (await ok('GET', `pacientes/${pA}/notas`)).find(x => x.texto === 'Hora');
  assert.equal(n.data.slice(0, 13), hora);
  const a = await ok('PUT', `anamnese/${pA}`, { alergias: 'Penicilina' });
  assert.equal(a.atualizado_em.slice(0, 13), hora);
});

test('anamnese sem paciente e orçamento com data inválida dão 400', async () => {
  assert.equal((await api('PUT', 'anamnese', { alergias: 'x' })).status, 400);
  assert.equal((await api('POST', 'orcamentos', { paciente_id: pA, data: 'ontem', linhas: [{ descricao: 'x', preco: 10 }] })).status, 400);
});

test('devedores e pendentes batem certo com o saldo de cada paciente', async () => {
  const pC = (await ok('POST', 't/pacientes', { nome: 'Carla Credora' })).id;
  await ok('POST', 'recibos', { paciente_id: pC, valor: 15 }); // crédito por conta
  await fatura(pB, 70);
  const ft = await fatura(pA, 60);
  await ok('POST', 'recibos', { paciente_id: pA, valor: 15, documento_ids: [ft.id] });
  const saldos = {};
  for (const p of [pA, pB, pC]) saldos[p] = (await ok('GET', `pacientes/${p}/contacorrente`)).saldo;
  assert.deepEqual(saldos, { [pA]: 45, [pB]: 70, [pC]: -15 });
  const dev = await ok('GET', 'devedores');
  assert.deepEqual(dev.map(d => [d.id, d.saldo]), [[pA, 45], [pB, 70], [pC, -15]]);
  assert.deepEqual(dev.find(d => d.id === pA), { id: pA, numero: 1, nome: 'Ana Robusta', telemovel: null, faturado: 110, creditos: 50, pago: 15, saldo: 45 });
  assert.deepEqual((await ok('GET', 'listagens/pendentes')).rows.map(r => [r.id, r.saldo]), [[pA, 45], [pB, 70]]);
  assert.equal((await ok('GET', 'estatisticas')).kpi.emDivida, 115);
});

test('DATA_DIR relativo: anexos descarregam-se', async () => {
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);
  const r = await fetch(`${base}/api/pacientes/${pA}/anexos?categoria=RX&nome=rx.png`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie }, body: PNG });
  const a = await r.json(); assert.equal(r.status, 200, JSON.stringify(a));
  assert.equal((await fetch(`${base}/api/anexos/${a.id}/ficheiro`, { headers: { Cookie: cookie } })).status, 200);
});

test('perguntas da anamnese apagadas não voltam ao reiniciar', async () => {
  for (const p of await ok('GET', 't/anamnese_perguntas')) await ok('DELETE', `t/anamnese_perguntas/${p.id}`);
  delete require.cache[require.resolve('../db')];
  const D2 = require('../db');
  assert.deepEqual(D2.all('SELECT * FROM anamnese_perguntas'), []);
  D2.db.close();
});

test('SMS por API HTTP: texto com aspas e mudança de linha fica JSON válido', async () => {
  let recebido;
  const srv = http.createServer((req, res) => {
    let b = ''; req.on('data', c => { b += c; });
    req.on('end', () => { recebido = { tipo: req.headers['content-type'], corpo: b }; res.end('ok'); });
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  try {
    const texto = 'Olá "Ana"\nAté amanhã \\ 10h';
    await COM.enviarSMS({ sms_fornecedor: 'http', sms_url: `http://127.0.0.1:${srv.address().port}/sms`, sms_corpo: '{"to":"{para}","msg":"{texto}"}' }, { para: '912345678', texto });
    assert.equal(recebido.tipo, 'application/json');
    assert.deepEqual(JSON.parse(recebido.corpo), { to: '+351912345678', msg: texto });
  } finally { srv.close(); }
});
