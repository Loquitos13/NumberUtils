'use strict';
// Ataques ao login e às sessões: força bruta, contornar o bloqueio, enumeração de utilizadores, cookies, CSRF.
// Cada teste usa endereços de origem próprios (127.0.0.x) para o bloqueio por IP de um não afetar os outros.
const { test, before, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');
const D = require('../db');

let port;
function pedido(metodo, caminho, { corpo, ck, ip = '127.0.0.1', tipo = 'application/json', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers }; if (ck) h.Cookie = ck; if (corpo !== undefined) h['Content-Type'] = tipo;
    const r = http.request({ host: '127.0.0.1', port, path: caminho, method: metodo, headers: h, localAddress: ip }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(ch).toString('utf8') }));
    });
    r.setTimeout(5000, () => r.destroy(new Error('sem resposta'))); r.on('error', reject);
    r.end(corpo === undefined ? undefined : typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  });
}
const entrar = (login, password, opt = {}) => pedido('POST', '/api/login', { corpo: { login, password }, ...opt });
const sid = r => (r.headers['set-cookie'] || [''])[0].split(';')[0];
let ipN = 10; const novoIp = () => `127.0.${Math.floor(ipN / 250)}.${(ipN++ % 250) + 2}`;

let ckAdmin;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  ckAdmin = sid(await entrar('admin', 'segredo-de-teste'));
  const novo = async (login, perfil) => {
    assert.equal((await pedido('POST', '/api/users', { ck: ckAdmin, corpo: { nome: login, login, password: 'provisoria1', perfil } })).status, 200);
    const c = sid(await entrar(login, 'provisoria1'));
    assert.equal((await pedido('POST', '/api/password', { ck: c, corpo: { atual: 'provisoria1', nova: 'palavra-boa-1' } })).status, 200);
  };
  await novo('maria', 'rececao'); await novo('joao', 'medico'); await novo('inativo', 'assistente');
  for (const l of ['rita', 'alvo', 'alvo2', 'alvo3', ...Array.from({ length: 9 }, (_, i) => 't' + i)]) await novo(l, 'rececao');
  await pedido('DELETE', `/api/users/${D.get("SELECT id FROM users WHERE login='inativo'").id}`, { ck: ckAdmin });
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('força bruta: 5 falhas no mesmo IP → 429, mesmo com a palavra-passe certa', async () => {
  const ip = novoIp();
  for (let i = 0; i < 5; i++) assert.equal((await entrar('nao-existe-fb' + i, 'errada' + i, { ip })).status, 401); // logins diferentes: só conta o IP
  assert.equal((await entrar('maria', 'palavra-boa-1', { ip })).status, 429);
  assert.equal((await entrar('maria', 'palavra-boa-1', { ip: novoIp() })).status, 200); // outro posto não fica bloqueado
});

test('o bloqueio não se contorna com X-Forwarded-For, outros logins, maiúsculas, espaços ou unicode', async () => {
  const ip = novoIp();
  for (let i = 0; i < 5; i++) await entrar('nao-existe-xff' + i, 'errada', { ip });
  for (const h of [{ 'X-Forwarded-For': '10.9.9.9' }, { 'X-Real-IP': '10.9.9.8' }, { Forwarded: 'for=10.9.9.7' }])
    assert.equal((await entrar('maria', 'palavra-boa-1', { ip, headers: h })).status, 429);
  for (const l of ['joao', 'MARIA', ' maria ', 'mаria' /* а cirílico */, 'ｍａｒｉａ', 'maria​'])
    assert.equal((await entrar(l, 'palavra-boa-1', { ip })).status, 429, l);
});

test('variantes do login não autenticam nem contam como outra conta', async () => {
  const ip = novoIp();
  assert.equal((await entrar('  rita\t', 'palavra-boa-1', { ip })).status, 200); // espaços nas pontas são ignorados (trim)
  for (const l of ['RITA', 'Rita', 'rіta' /* і cirílico */, 'ｒｉｔａ', 'rita​']) assert.equal((await entrar(l, 'palavra-boa-1', { ip: novoIp() })).status, 401, l);
  assert.equal((await entrar({ $ne: null }, 'x', { ip })).status, 401, 'objeto'); // tipos estranhos não passam
  assert.equal((await entrar('joao', { $gt: '' }, { ip })).status, 401, 'objeto na palavra-passe');
});

test('ataque distribuído: muitas falhas na mesma conta a partir de IPs diferentes bloqueiam a conta', async () => {
  for (let i = 0; i < 40; i++) await entrar('alvo', 'tentativa' + i, { ip: novoIp() });
  assert.equal((await entrar('alvo', 'tentativa-41', { ip: novoIp() })).status, 429);
});

test('por conta: atraso progressivo depois de 3 falhas (maiúsculas/unicode contam como a mesma conta); o sucesso limpa', async t => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.after(() => mock.timers.reset());
  for (const l of ['alvo2', 'ALVO2', ' ａｌｖｏ２ ']) assert.equal((await entrar(l, 'errada', { ip: novoIp() })).status, 401, l);
  assert.equal((await entrar('alvo2', 'palavra-boa-1', { ip: novoIp() })).status, 429); // 3 falhas → aguardar 1 s
  mock.timers.tick(1100);
  assert.equal((await entrar('alvo2', 'palavra-boa-1', { ip: novoIp() })).status, 200);
  for (let i = 0; i < 3; i++) assert.equal((await entrar('alvo2', 'errada', { ip: novoIp() })).status, 401, 'contador recomeça');
});

test('por conta: 10 falhas espaçadas → conta bloqueada 15 min, mesmo com a palavra-passe certa e noutro IP', async t => {
  mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.after(() => mock.timers.reset());
  for (let i = 0; i < 10; i++) { assert.equal((await entrar('alvo3', 'errada', { ip: novoIp() })).status, 401, String(i)); mock.timers.tick(31e3); }
  assert.equal((await entrar('alvo3', 'palavra-boa-1', { ip: novoIp() })).status, 429);
  mock.timers.tick(10 * 60e3);
  assert.equal((await entrar('alvo3', 'palavra-boa-1', { ip: novoIp() })).status, 429);
  mock.timers.tick(5 * 60e3);
  assert.equal((await entrar('alvo3', 'palavra-boa-1', { ip: novoIp() })).status, 200);
});

test('mensagens de erro idênticas: utilizador inexistente, palavra-passe errada e utilizador inativo', async () => {
  const a = await entrar('nao-existe', 'x', { ip: novoIp() }), b = await entrar('maria', 'x', { ip: novoIp() }), c = await entrar('inativo', 'palavra-boa-1', { ip: novoIp() });
  assert.deepEqual([a.status, b.status, c.status], [401, 401, 401]);
  assert.equal(a.texto, b.texto); assert.equal(b.texto, c.texto);
});

test('enumeração por tempo de resposta: utilizador inexistente demora o mesmo que palavra-passe errada', async () => {
    const t = async login => { const ip = novoIp(), s = process.hrtime.bigint(); await entrar(login, 'errada', { ip }); return Number(process.hrtime.bigint() - s) / 1e6; };
    const med = a => a.sort((x, y) => x - y)[a.length >> 1];
    const inex = [], errada = [];
    for (let i = 0; i < 9; i++) { inex.push(await t('nao-existe-' + i)); errada.push(await t('t' + i)); } // uma conta por amostra: sem atraso por conta
    const r = med(errada) / med(inex);
    assert.ok(r < 2 && r > 0.5, `inexistente ${med(inex).toFixed(1)} ms vs errada ${med(errada).toFixed(1)} ms`);
  });

test('falhas de login não enchem a base de dados (login gigante registado no log)', async () => {
    assert.equal((await entrar('x'.repeat(1e6), 'y', { ip: novoIp() })).status, 413); // corpo do login limitado a 64 KB
    assert.equal((await entrar('z'.repeat(5e4), 'y', { ip: novoIp() })).status, 401);
    const l = D.get("SELECT length(detalhe) n FROM logs WHERE acao='login falhado' ORDER BY id DESC LIMIT 1").n;
    assert.ok(l <= 200, `detalhe com ${l} caracteres`);
  });

test('cookie de sessão: HttpOnly, SameSite=Strict, Path=/, 12 h, token aleatório', async () => {
  const r = await entrar('maria', 'palavra-boa-1', { ip: novoIp() });
  const c = r.headers['set-cookie'][0];
  for (const f of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=43200']) assert.ok(c.includes(f), f);
  assert.match(sid(r), /^sid=[0-9a-f]{48}$/);
  assert.equal(r.headers['set-cookie'].length, 1);
});

test('fixação de sessão: um sid escolhido pelo atacante não é aceite nem reaproveitado', async () => {
  const r = await entrar('maria', 'palavra-boa-1', { ip: novoIp(), ck: 'sid=fixado-pelo-atacante' });
  assert.notEqual(sid(r), 'sid=fixado-pelo-atacante');
  assert.equal((await pedido('GET', '/api/me', { ck: 'sid=fixado-pelo-atacante' })).status, 401);
  assert.equal((await pedido('GET', '/api/me', { ck: sid(r) })).status, 200);
});

test('logout invalida a sessão no servidor', async () => {
  const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
  assert.equal((await pedido('POST', '/api/logout', { ck: c, corpo: {} })).status, 200);
  assert.equal((await pedido('GET', '/api/me', { ck: c })).status, 401);
  assert.equal(D.get('SELECT COUNT(*) n FROM sessions WHERE token=?', c.slice(4)).n, 0);
});

test('a sessão expira ao fim de 12 h (no servidor, não só no cookie)', async () => {
  const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
  D.run("UPDATE sessions SET criado_em=datetime('now','localtime','-12 hours','-1 minute') WHERE token=?", c.slice(4));
  assert.equal((await pedido('GET', '/api/me', { ck: c })).status, 401);
});

test('mudar a palavra-passe termina as outras sessões e mantém a atual', async () => {
  const c1 = sid(await entrar('joao', 'palavra-boa-1', { ip: novoIp() })), c2 = sid(await entrar('joao', 'palavra-boa-1', { ip: novoIp() }));
  assert.equal((await pedido('POST', '/api/password', { ck: c1, corpo: { atual: 'palavra-boa-1', nova: 'palavra-boa-2' } })).status, 200);
  assert.equal((await pedido('GET', '/api/me', { ck: c1 })).status, 200);
  assert.equal((await pedido('GET', '/api/me', { ck: c2 })).status, 401);
  assert.equal((await pedido('POST', '/api/password', { ck: c1, corpo: { atual: 'palavra-boa-2', nova: 'palavra-boa-1' } })).status, 200);
});

test('o admin repor a palavra-passe termina as sessões do utilizador e obriga a trocá-la', async () => {
  const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
  const id = D.get("SELECT id FROM users WHERE login='maria'").id;
  assert.equal((await pedido('PUT', `/api/users/${id}`, { ck: ckAdmin, corpo: { password: 'reposta-123' } })).status, 200);
  assert.equal((await pedido('GET', '/api/me', { ck: c })).status, 401);
  const n = sid(await entrar('maria', 'reposta-123', { ip: novoIp() }));
  assert.equal((await pedido('GET', '/api/pacientes', { ck: n })).status, 403);
  assert.equal((await pedido('POST', '/api/password', { ck: n, corpo: { atual: 'reposta-123', nova: 'palavra-boa-1' } })).status, 200);
});

test('utilizador inativo não entra e as sessões abertas morrem', async () => {
  const c = sid(await entrar('joao', 'palavra-boa-1', { ip: novoIp() }));
  D.run("UPDATE users SET ativo=0 WHERE login='joao'"); // mesmo sem passar pela API
  assert.equal((await pedido('GET', '/api/me', { ck: c })).status, 401);
  assert.equal((await entrar('joao', 'palavra-boa-1', { ip: novoIp() })).status, 401);
  D.run("UPDATE users SET ativo=1 WHERE login='joao'");
});

test('CSRF: cookie SameSite=Strict e corpo form-encoded rejeitado', async () => {
  const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
  const r = await pedido('POST', '/api/notas', { ck: c, tipo: 'application/x-www-form-urlencoded', corpo: 'paciente_id=1&texto=csrf' });
  assert.equal(r.status, 415);
});

test('CSRF: text/plain com JSON (mesma origem) → 415; Origin alheia → 403; Origin própria passa', async () => {
  const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
  assert.equal((await pedido('POST', '/api/notas', { ck: c, tipo: 'text/plain', corpo: '{}' })).status, 415);
  assert.equal((await pedido('POST', '/api/logout', { ck: c, headers: { Origin: 'http://atacante.example' } })).status, 403);
  assert.equal((await pedido('POST', '/api/login', { corpo: { login: 'maria', password: 'palavra-boa-1' }, headers: { Origin: 'null' } })).status, 403);
  assert.equal((await pedido('GET', '/api/me', { ck: c, headers: { Origin: 'http://atacante.example' } })).status, 200); // leituras não são afetadas
  assert.equal((await pedido('POST', '/api/logout', { ck: c, headers: { Origin: `http://127.0.0.1:${port}` } })).status, 200);
});

test('CSRF: pedido "simples" text/plain com JSON e Origin alheia é recusado', async () => {
    const c = sid(await entrar('maria', 'palavra-boa-1', { ip: novoIp() }));
    const pid = JSON.parse((await pedido('POST', '/api/t/pacientes', { ck: ckAdmin, corpo: { nome: 'Alvo CSRF' } })).texto).id;
    const r = await pedido('POST', '/api/notas', { ck: c, tipo: 'text/plain', headers: { Origin: 'http://atacante.example' }, corpo: JSON.stringify({ paciente_id: pid, texto: 'csrf' }) });
    assert.ok([403, 415].includes(r.status), `${r.status} ${r.texto}`);
  });
