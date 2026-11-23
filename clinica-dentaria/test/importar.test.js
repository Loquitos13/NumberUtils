'use strict';
// Testes da importação de pacientes por CSV (node --test). Usa uma base de dados temporária.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');
const { parseCsv } = require('../importar');

let base, cookie = '';
async function api(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && ck === cookie) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const importar = (csv, mapa, simular) => ok('POST', 'importar/pacientes', { csv, mapa, simular });

before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('simulação conta os pacientes e não cria nada', async () => {
  const r = await importar('Nome;Contribuinte\nAna Simulada;123456789\nRui Simulado;\n', ['nome', 'nif'], true);
  assert.deepEqual(r, { criados: 2, ignorados: 0, erros: [] });
  assert.equal((await ok('GET', 'pacientes?q=Simulad')).length, 0);
});

test('importação cria os pacientes, mantém o n.º do ficheiro, numera os restantes e converte datas', async () => {
  const csv = 'Processo;Nome;Data Nascimento\n;Rui Real;1990-12-31\n50;Ana Real;03/04/1980\n';
  assert.deepEqual(await importar(csv, ['numero', 'nome', 'data_nasc'], false), { criados: 2, ignorados: 0, erros: [] });
  const ps = (await ok('GET', 'pacientes?q=Real')).map(p => [p.nome, p.numero, p.data_nasc]);
  assert.deepEqual(ps, [['Ana Real', 50, '1980-04-03'], ['Rui Real', 51, '1990-12-31']]);
});

test('ignora os pacientes que já existem pelo n.º de processo ou pelo NIF', async () => {
  const csv = 'Processo;Nome;NIF\n50;Outra Ana;\n;Joana Dup;123456789\n;Joana Dup Repetida;123 456 789\n;Nova Dup;\n';
  assert.deepEqual(await importar(csv, ['numero', 'nome', 'nif'], false), { criados: 2, ignorados: 2, erros: [] });
  assert.deepEqual((await ok('GET', 'pacientes?q=Dup')).map(p => [p.nome, p.nif]), [['Joana Dup', '123456789'], ['Nova Dup', null]]);
  assert.equal((await ok('GET', 'pacientes?q=Outra Ana')).length, 0);
});

test('linhas com NIF inválido, data errada ou sem nome são erros da linha; as outras importam', async () => {
  const csv = 'Nome;NIF;Data Nascimento\nErro Nif;111111111;\nErro Data;;31/02/1990\nErro Bom;;01/02/2000\n;100000002;\n\n';
  assert.deepEqual(await importar(csv, ['nome', 'nif', 'data_nasc'], false), { criados: 1, ignorados: 0, erros: [
    { linha: 2, motivo: 'NIF inválido: dígito de controlo incorreto' },
    { linha: 3, motivo: 'Data de nascimento inválida: 31/02/1990' },
    { linha: 5, motivo: 'O nome é obrigatório' },
  ] });
  assert.deepEqual((await ok('GET', 'pacientes?q=Erro')).map(p => p.nome), ['Erro Bom']);
});

test('ficheiro em base64: Windows-1252 e UTF-8 com BOM são lidos corretamente', async () => {
  const latin1 = Buffer.from('Nome;Localidade\nJoão Latino;Évora\n', 'latin1').toString('base64');
  assert.deepEqual(await importar(latin1, ['nome', 'localidade'], false), { criados: 1, ignorados: 0, erros: [] });
  const utf8 = Buffer.from('﻿Nome,Localidade\nInês Unicode,Óbidos\n', 'utf8').toString('base64');
  assert.deepEqual(await importar(utf8, ['nome', 'localidade'], false), { criados: 1, ignorados: 0, erros: [] });
  assert.deepEqual((await ok('GET', 'pacientes?q=Latino')).map(p => [p.nome, p.localidade]), [['João Latino', 'Évora']]);
  assert.deepEqual((await ok('GET', 'pacientes?q=Unicode')).map(p => [p.nome, p.localidade]), [['Inês Unicode', 'Óbidos']]);
});

test('só o administrador importa; campos fora da tabela pacientes são recusados', async () => {
  await ok('POST', 'users', { nome: 'Receção', login: 'rec', password: 'provisoria1', perfil: 'rececao' });
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'rec', password: 'provisoria1' }) });
  const ck = r.headers.get('set-cookie').split(';')[0];
  await ok('POST', 'password', { atual: 'provisoria1', nova: 'uma-nova-boa' }, ck);
  const corpo = { csv: 'Nome\nIntruso\n', mapa: ['nome'], simular: false };
  assert.equal((await api('POST', 'importar/pacientes', corpo, ck)).status, 403);
  const mau = await api('POST', 'importar/pacientes', { csv: 'Nome;X\nA;1\n', mapa: ['nome', 'pass_hash'], simular: true });
  assert.deepEqual(mau, { status: 400, body: { erro: 'Campo desconhecido: pass_hash' } });
});

test('parser: deteta o separador ; e ,', () => {
  assert.deepEqual(parseCsv('Nome;NIF\nAna, Silva;123\n'), [['Nome', 'NIF'], ['Ana, Silva', '123']]);
  assert.deepEqual(parseCsv('Nome,NIF\r\nRui;Lopes,456'), [['Nome', 'NIF'], ['Rui;Lopes', '456']]);
});

test('parser: aspas, aspas duplicadas e quebras de linha dentro de aspas', () => {
  assert.deepEqual(parseCsv('Nome;Notas\n"Silva; Ana";"diz ""olá""\nsegunda linha"\nRui;'),
    [['Nome', 'Notas'], ['Silva; Ana', 'diz "olá"\nsegunda linha'], ['Rui', '']]);
});

test('parser: ignora o BOM', () => {
  assert.deepEqual(parseCsv('﻿Nome;NIF\nAna;1'), [['Nome', 'NIF'], ['Ana', '1']]);
});
