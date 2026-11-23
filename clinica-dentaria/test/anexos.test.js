'use strict';
// Testes dos ficheiros do paciente (node --test). Usa uma base de dados temporária.
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
async function enviar(pid, bytes, qs = '', ck = cookie) {
  const r = await fetch(`${base}/api/pacientes/${pid}/anexos?${qs}`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: ck }, body: bytes });
  return { status: r.status, body: await r.json() };
}
// cria um utilizador da receção e devolve o cookie da sessão dele
async function sessaoRececao(login) {
  await ok('POST', 'users', { nome: login, login, perfil: 'rececao', password: 'provisoria-1' });
  let ck = '';
  for (const [url, corpo] of [['login', { login, password: 'provisoria-1' }], ['password', { atual: 'provisoria-1', nova: 'definitiva-1' }]]) {
    const r = await fetch(`${base}/api/${url}`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: ck }, body: JSON.stringify(corpo) });
    assert.equal(r.status, 200);
    ck = r.headers.get('set-cookie')?.split(';')[0] || ck;
  }
  return ck;
}
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('resto-do-png')]);

let pid;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  pid = (await ok('POST', 't/pacientes', { nome: 'Paciente Anexos' })).id;
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('carregar um PNG e descarregar os mesmos bytes com o Content-Type certo', async () => {
  const r = await enviar(pid, PNG, 'categoria=RX&descricao=Panor%C3%A2mica&dente=16&nome=rx.png');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.mime, 'image/png');
  assert.equal(r.body.nome_original, 'rx.png');
  assert.equal(r.body.tamanho, PNG.length);
  const f = await fetch(`${base}/api/anexos/${r.body.id}/ficheiro`, { headers: { Cookie: cookie } });
  assert.equal(f.status, 200);
  assert.equal(f.headers.get('content-type'), 'image/png');
  assert.match(f.headers.get('content-disposition'), /rx\.png/);
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), PNG);
});

test('um .png que é na verdade HTML é recusado', async () => {
  const r = await enviar(pid, Buffer.from('<script>alert(1)</script>'), 'categoria=RX&nome=foto.png');
  assert.equal(r.status, 415);
});

test('ficheiro com mais de 20 MB é recusado com 413', async () => {
  const grande = Buffer.alloc(20 * 1024 * 1024 + 1); PNG.copy(grande);
  assert.equal((await enviar(pid, grande, 'categoria=RX')).status, 413);
});

test('sem sessão não se carrega nem se descarrega', async () => {
  const a = (await enviar(pid, PNG, 'categoria=Outro')).body;
  assert.equal((await enviar(pid, PNG, 'categoria=Outro', '')).status, 401);
  assert.equal((await fetch(`${base}/api/anexos/${a.id}/ficheiro`)).status, 401);
});

test('categoria inválida dá 400; lista e filtro por categoria pelo CRUD', async () => {
  assert.equal((await enviar(pid, PNG, 'categoria=Inventada')).status, 400);
  const pdf = (await enviar(pid, Buffer.from('%PDF-1.4\n%fim'), 'categoria=Consentimento&nome=consentimento.pdf')).body;
  assert.equal(pdf.mime, 'application/pdf');
  const lista = await ok('GET', `t/anexos?paciente_id=${pid}&categoria=Consentimento`);
  assert.deepEqual(lista.map(a => a.id), [pdf.id]);
  assert.equal((await api('PUT', `t/anexos/${pdf.id}`, { categoria: 'Nada' })).status, 400);
  assert.equal((await ok('PUT', `t/anexos/${pdf.id}`, { descricao: 'Assinado' })).descricao, 'Assinado');
  assert.equal((await api('POST', 't/anexos', { categoria: 'RX' })).status, 405);
});

test('apagar remove o ficheiro do disco', async () => {
  const a = (await enviar(pid, PNG, 'categoria=Foto%20intraoral')).body;
  const f = path.join(dir, 'anexos', a.ficheiro);
  assert.ok(fs.existsSync(f));
  await ok('DELETE', `t/anexos/${a.id}`);
  assert.ok(!fs.existsSync(f));
  assert.equal((await fetch(`${base}/api/anexos/${a.id}/ficheiro`, { headers: { Cookie: cookie } })).status, 404);
});

test('nomes e ids não permitem sair de anexos/', async () => {
  const a = (await enviar(pid, PNG, 'categoria=RX&nome=' + encodeURIComponent('../../server.js'))).body;
  assert.match(a.ficheiro, /^\d+\/[0-9a-f]{32}\.png$/);
  assert.ok(!a.nome_original.includes('/'));
  assert.equal((await enviar('..%2F..', PNG, 'categoria=RX')).status, 404);
  assert.equal((await fetch(`${base}/api/anexos/..%2F..%2Fclinica.db/ficheiro`, { headers: { Cookie: cookie } })).status, 404);
  await ok('PUT', `t/anexos/${a.id}`, { ficheiro: '../../clinica.db' }); // o caminho não é editável
  const f = await fetch(`${base}/api/anexos/${a.id}/ficheiro`, { headers: { Cookie: cookie } });
  assert.deepEqual(Buffer.from(await f.arrayBuffer()), PNG);
});

test('a descrição é cortada a 500 caracteres também ao editar', async () => {
  const a = (await enviar(pid, PNG, 'categoria=RX')).body;
  assert.equal((await ok('PUT', `t/anexos/${a.id}`, { descricao: 'x'.repeat(900) })).descricao.length, 500);
});

test('o ficheiro descarregado pode ficar em cache privada (o conteúdo nunca muda)', async () => {
  const a = (await enviar(pid, PNG, 'categoria=RX')).body;
  const f = await fetch(`${base}/api/anexos/${a.id}/ficheiro`, { headers: { Cookie: cookie } });
  assert.equal(f.headers.get('cache-control'), 'private, max-age=31536000, immutable');
});

test('erro a ler o ficheiro do disco não derruba o servidor', async () => {
  const a = (await enviar(pid, PNG, 'categoria=RX')).body;
  const f = path.join(dir, 'anexos', a.ficheiro);
  fs.rmSync(f); fs.mkdirSync(f); // uma pasta no lugar do ficheiro: a leitura falha com EISDIR
  await fetch(`${base}/api/anexos/${a.id}/ficheiro`, { headers: { Cookie: cookie } }).then(r => r.arrayBuffer()).catch(() => {});
  assert.equal((await api('GET', `t/anexos/${a.id}`)).status, 200);
});

test('só o administrador elimina ficheiros; a receção pode editar os dados', async () => {
  const a = (await enviar(pid, PNG, 'categoria=RX')).body;
  const ck = await sessaoRececao('rececao-anexos');
  assert.equal((await api('PUT', `t/anexos/${a.id}`, { dente: '21' }, ck)).status, 200);
  assert.equal((await api('DELETE', `t/anexos/${a.id}`, null, ck)).status, 403);
  assert.ok(fs.existsSync(path.join(dir, 'anexos', a.ficheiro)));
  await ok('DELETE', `t/anexos/${a.id}`);
  assert.ok((await ok('GET', 'logs')).some(l => l.acao === 'eliminar anexos' && l.detalhe === `id=${a.id}`));
});

test('a lista de categorias vem do servidor', async () => {
  assert.deepEqual((await ok('GET', 'lookups')).anexo_categorias, ['RX', 'Foto intraoral', 'Consentimento', 'Relatório', 'Outro']);
});
