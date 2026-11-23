'use strict';
// Testes da anamnese configurável (node --test). Usa uma base de dados temporária.
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

let pid;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  pid = (await ok('POST', 't/pacientes', { nome: 'Paciente Anamnese' })).id;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('perguntas iniciais: 4 alertas sim/não', async () => {
  const ps = await ok('GET', 't/anamnese_perguntas');
  assert.deepEqual(ps.map(p => p.texto), ['Bifosfonatos', 'Problemas de coagulação', 'Próteses articulares', 'Epilepsia']);
  assert.ok(ps.every(p => p.tipo === 'sn' && p.alerta === 1 && p.ativo === 1));
});

let escolha;
test('só o administrador cria perguntas; tipo e opções validados', async () => {
  await ok('POST', 'users', { nome: 'Médico', login: 'medico1', perfil: 'medico', password: 'inicial-123' });
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'medico1', password: 'inicial-123' }) });
  const ck = r.headers.get('set-cookie').split(';')[0];
  await ok('POST', 'password', { atual: 'inicial-123', nova: 'nova-pass-456' }, ck);
  assert.equal((await api('POST', 't/anamnese_perguntas', { texto: 'X', tipo: 'sn' }, ck)).status, 403);
  assert.equal((await api('GET', 't/anamnese_perguntas', null, ck)).status, 200);
  assert.equal((await api('POST', 't/anamnese_perguntas', { texto: 'X', tipo: 'outro' })).status, 400);
  assert.equal((await api('POST', 't/anamnese_perguntas', { texto: 'X', tipo: 'escolha' })).status, 400); // escolha sem opções
  assert.equal((await api('POST', 't/anamnese_perguntas', { texto: '', tipo: 'sn' })).status, 400);
  escolha = await ok('POST', 't/anamnese_perguntas', { texto: 'Grupo sanguíneo', tipo: 'escolha', opcoes: 'A; B; AB; O', ordem: 50 });
  assert.equal(escolha.alerta, 0);
  assert.equal((await api('PUT', 't/anamnese_perguntas/' + escolha.id, { tipo: 'nada' })).status, 400);
  assert.equal((await api('PUT', 't/anamnese_perguntas/' + escolha.id, { tipo: '' })).status, 400);
  assert.equal((await api('PUT', 't/anamnese_perguntas/' + escolha.id, { tipo: null })).status, 400);
});

test('grava e lê as respostas; valores inválidos dão 400', async () => {
  const [bif] = await ok('GET', 't/anamnese_perguntas');
  assert.deepEqual(await ok('GET', `pacientes/${pid}/anamnese-extra`), {});
  await ok('PUT', `pacientes/${pid}/anamnese-extra`, { [bif.id]: 'não', [escolha.id]: 'AB' });
  assert.deepEqual(await ok('GET', `pacientes/${pid}/anamnese-extra`), { [bif.id]: 'não', [escolha.id]: 'AB' });
  assert.equal((await api('PUT', `pacientes/${pid}/anamnese-extra`, { [escolha.id]: 'Z' })).status, 400);
  assert.equal((await api('PUT', `pacientes/${pid}/anamnese-extra`, { [bif.id]: 'talvez' })).status, 400);
  assert.equal((await api('PUT', `pacientes/${pid}/anamnese-extra`, { 99999: 'sim' })).status, 400);
  await ok('PUT', `pacientes/${pid}/anamnese-extra`, { [escolha.id]: '' }); // vazio apaga
  assert.deepEqual(await ok('GET', `pacientes/${pid}/anamnese-extra`), { [bif.id]: 'não' });
});

test('"sim" a uma pergunta de alerta aparece em alertas_extra do resumo', async () => {
  const [bif, coag, prot] = await ok('GET', 't/anamnese_perguntas');
  const fumo = await ok('POST', 't/anamnese_perguntas', { texto: 'Pratica desporto', tipo: 'sn', alerta: 0 });
  await ok('PUT', `pacientes/${pid}/anamnese-extra`, { [bif.id]: 'não', [coag.id]: 'sim', [prot.id]: 'sim', [fumo.id]: 'sim' });
  assert.deepEqual((await ok('GET', `pacientes/${pid}/resumo`)).alertas_extra, ['Problemas de coagulação', 'Próteses articulares']);
});

test('desativar uma pergunta guarda a resposta mas tira-a dos alertas', async () => {
  const coag = (await ok('GET', 't/anamnese_perguntas')).find(p => p.texto === 'Problemas de coagulação');
  await ok('PUT', 't/anamnese_perguntas/' + coag.id, { ativo: 0 });
  assert.deepEqual((await ok('GET', `pacientes/${pid}/resumo`)).alertas_extra, ['Próteses articulares']);
  assert.equal((await ok('GET', `pacientes/${pid}/anamnese-extra`))[coag.id], 'sim');
  assert.equal((await api('DELETE', 't/anamnese_perguntas/' + coag.id)).status, 409); // com respostas não se apaga
});

test('resposta de escolha que deixou de ser opção mantém-se ao gravar de novo; nova inválida continua recusada', async () => {
  const q = await ok('POST', 't/anamnese_perguntas', { texto: 'Escova', tipo: 'escolha', opcoes: 'manual; elétrica' });
  await ok('PUT', `pacientes/${pid}/anamnese-extra`, { [q.id]: 'manual' });
  await ok('PUT', 't/anamnese_perguntas/' + q.id, { opcoes: 'elétrica; sónica' });
  await ok('PUT', `pacientes/${pid}/anamnese-extra`, { [q.id]: 'manual' });
  assert.equal((await ok('GET', `pacientes/${pid}/anamnese-extra`))[q.id], 'manual');
  assert.equal((await api('PUT', `pacientes/${pid}/anamnese-extra`, { [q.id]: 'outra' })).status, 400);
});
