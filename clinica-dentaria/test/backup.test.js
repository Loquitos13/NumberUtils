'use strict';
// Cópia de segurança em ZIP: base de dados + anexos (node --test, base de dados temporária).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');
const { DatabaseSync } = require('node:sqlite');

let base, cookie = '';
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const r = await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'admin', password: 'segredo-de-teste' }) });
  cookie = r.headers.get('set-cookie').split(';')[0];
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// leitor mínimo: diretório central -> { nome: bytes } (só método 0; verifica o CRC)
function lerZip(buf) {
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(eocd >= 0, 'sem EOCD');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let i = 0; i < n; i++) {
    assert.equal(buf.readUInt32LE(p), 0x02014b50);
    const metodo = buf.readUInt16LE(p + 10), crc = buf.readUInt32LE(p + 16), tam = buf.readUInt32LE(p + 20);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nome = buf.toString('utf8', p + 46, p + 46 + ln);
    assert.equal(buf.readUInt32LE(off), 0x04034b50);
    assert.equal(metodo, 0);
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const dados = buf.subarray(ini, ini + tam);
    assert.equal(zlib.crc32(dados), crc, `CRC de ${nome}`);
    out[nome] = dados;
    p += 46 + ln + le + lc;
  }
  return out;
}

test('a cópia de segurança é um ZIP com clinica.db e os anexos', async () => {
  const pid = (await (await fetch(base + '/api/t/pacientes', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ nome: 'Paciente Backup' }) })).json()).id;
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('bytes-do-rx')]);
  const a = await (await fetch(`${base}/api/pacientes/${pid}/anexos?categoria=RX&nome=rx.png`, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', Cookie: cookie }, body: PNG })).json();

  const r = await fetch(base + '/api/backup', { headers: { Cookie: cookie } });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('content-type'), 'application/zip');
  assert.match(r.headers.get('content-disposition'), /clinica-backup-.*\.zip/);
  const zip = Buffer.from(await r.arrayBuffer());
  const e = lerZip(zip);

  assert.deepEqual(e[`anexos/${a.ficheiro}`], PNG);
  assert.ok(e['clinica.db'], 'falta clinica.db');
  const f = path.join(dir, 'restaurado.db');
  fs.writeFileSync(f, e['clinica.db']);
  const db = new DatabaseSync(f);
  assert.equal(db.prepare('SELECT nome FROM pacientes WHERE id=?').get(pid).nome, 'Paciente Backup');
  db.close();
  // a cópia temporária da base de dados não fica para trás
  assert.deepEqual(fs.readdirSync(dir).filter(n => n.includes('backup')), []);

  // verificação independente com o unzip do sistema, se existir
  let unzip = true; try { execFileSync('unzip', ['-v'], { stdio: 'ignore' }); } catch { unzip = false; }
  if (unzip) {
    const z = path.join(dir, 'copia.zip'); fs.writeFileSync(z, zip);
    assert.match(execFileSync('unzip', ['-t', z]).toString(), /No errors detected/);
  }
});

test('um anexo apagado durante a cópia é ignorado e o ZIP continua válido', async () => {
  const ZIP = require('../zip');
  const { PassThrough } = require('node:stream');
  const a = path.join(dir, 'fica.txt'), b = path.join(dir, 'some.txt');
  fs.writeFileSync(a, 'conteúdo'); fs.writeFileSync(b, 'vai desaparecer');
  const entradas = [{ nome: 'some.txt', ficheiro: b }, { nome: 'fica.txt', ficheiro: a }];
  ZIP.verificar(entradas);
  fs.rmSync(b); // apagado entre a listagem e a escrita
  const out = new PassThrough(), partes = []; out.on('data', c => partes.push(c));
  const ouvintes = () => out.listenerCount('error') + out.listenerCount('close');
  const antes = ouvintes();
  const r = await ZIP.escrever(out, entradas);
  assert.equal(r, 1);
  const e = lerZip(Buffer.concat(partes));
  assert.deepEqual(Object.keys(e), ['fica.txt']);
  assert.equal(e['fica.txt'].toString(), 'conteúdo');
  assert.ok(ouvintes() - antes <= 1, 'sem listeners acumulados por ficheiro');
});
