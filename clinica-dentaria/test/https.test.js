'use strict';
// HTTPS opcional: com HTTPS_CERT/HTTPS_KEY o servidor fala TLS, o cookie leva Secure e há HSTS.
// O certificado é gerado na hora com o openssl (autoassinado, só para o teste); sem openssl o teste é ignorado.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
let temOpenssl = true;
try {
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '1',
    '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1,DNS:localhost',
    '-keyout', path.join(dir, 'chave.pem'), '-out', path.join(dir, 'certificado.pem')], { stdio: 'ignore' });
} catch { temOpenssl = false; }

let server, port;
const ca = () => fs.readFileSync(path.join(dir, 'certificado.pem'));
function pedido(metodo, caminho, { corpo, ck, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const h = { ...headers }; if (ck) h.Cookie = ck; if (corpo !== undefined) h['Content-Type'] = 'application/json';
    const r = https.request({ host: '127.0.0.1', port, path: caminho, method: metodo, headers: h, ca: ca() }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(ch).toString('utf8') }));
    });
    r.setTimeout(5000, () => r.destroy(new Error('sem resposta'))); r.on('error', reject);
    r.end(corpo === undefined ? undefined : JSON.stringify(corpo));
  });
}

before(async () => {
  if (!temOpenssl) return;
  process.env.DATA_DIR = dir;
  process.env.ADMIN_PASSWORD = 'segredo-de-teste';
  process.env.HTTPS_CERT = path.join(dir, 'certificado.pem');
  process.env.HTTPS_KEY = path.join(dir, 'chave.pem');
  ({ server } = require('../server'));
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
});
after(() => { server?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('HTTPS: login dá cookie com Secure, HSTS presente e a API responde com a sessão', { skip: !temOpenssl && 'openssl não disponível' }, async () => {
  const r = await pedido('POST', '/api/login', { corpo: { login: 'admin', password: 'segredo-de-teste' } });
  assert.equal(r.status, 200);
  const cookie = r.headers['set-cookie'][0];
  assert.match(cookie, /; Secure/);
  assert.match(cookie, /HttpOnly/);
  assert.equal(r.headers['strict-transport-security'], 'max-age=31536000');

  const me = await pedido('GET', '/api/me', { ck: cookie.split(';')[0] });
  assert.equal(me.status, 200);
  assert.equal(JSON.parse(me.texto).login, 'admin');
  assert.equal(me.headers['strict-transport-security'], 'max-age=31536000');

  // páginas estáticas também levam HSTS
  assert.equal((await pedido('GET', '/')).headers['strict-transport-security'], 'max-age=31536000');
});

test('HTTPS: a verificação de origem aceita a própria origem https e recusa outra', { skip: !temOpenssl && 'openssl não disponível' }, async () => {
  const login = { login: 'admin', password: 'segredo-de-teste' };
  assert.equal((await pedido('POST', '/api/login', { corpo: login, headers: { Origin: `https://127.0.0.1:${port}` } })).status, 200);
  assert.equal((await pedido('POST', '/api/login', { corpo: login, headers: { Origin: 'https://malicioso.example' } })).status, 403);
});
