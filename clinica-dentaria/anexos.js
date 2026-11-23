'use strict';
// Ficheiros do paciente (RX, fotos, documentos): guardados em DATA_DIR/anexos/<paciente>/<aleatório>.<ext>
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const D = require('./db');

const DIR = path.join(D.DATA_DIR, 'anexos');
const LIMITE = 20 * 1024 * 1024;
const CATEGORIAS = ['RX', 'Foto intraoral', 'Consentimento', 'Relatório', 'Outro'];
// o tipo vem dos primeiros bytes, nunca da extensão
const TIPOS = [
  { mime: 'image/jpeg', ext: 'jpg', ok: b => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', ok: b => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', ok: b => b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', ok: b => b.toString('latin1', 0, 5) === '%PDF-' },
];
const erro = (status, msg) => Object.assign(new Error(msg), { status });

function validar(o) {
  if ('categoria' in o && !CATEGORIAS.includes(o.categoria)) throw erro(400, 'Categoria inválida');
  if (o.dente != null && !/^[1-8][1-8]$/.test(String(o.dente))) throw erro(400, 'Dente inválido (numeração FDI)');
  if (o.data != null && !/^\d{4}-\d{2}-\d{2}$/.test(String(o.data))) throw erro(400, 'Data inválida');
  if (o.descricao != null) o.descricao = String(o.descricao).slice(0, 500);
}

function lerBinario(req) {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length']) > LIMITE) return reject(erro(413, 'O ficheiro excede 20 MB'));
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > LIMITE) { reject(erro(413, 'O ficheiro excede 20 MB')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function carregar(req, pid, q, user) {
  if (!D.get('SELECT id FROM pacientes WHERE id=?', pid)) throw erro(404, 'Paciente não encontrado');
  const o = { categoria: q.get('categoria') || 'Outro', descricao: q.get('descricao') || null, dente: q.get('dente') || null, data: q.get('data') || null };
  validar(o);
  const buf = await lerBinario(req);
  if (!buf.length) throw erro(400, 'Ficheiro vazio');
  const tipo = TIPOS.find(t => t.ok(buf));
  if (!tipo) throw erro(415, 'Tipo de ficheiro não aceite (JPG, PNG, WebP ou PDF)');
  const ficheiro = `${pid}/${crypto.randomBytes(16).toString('hex')}.${tipo.ext}`;
  fs.mkdirSync(path.join(DIR, String(pid)), { recursive: true });
  const nome = String(q.get('nome') || `ficheiro.${tipo.ext}`).replace(/[\\/\0-\x1f]/g, '_').slice(0, 200);
  // ficheiro primeiro, registo depois: se o INSERT falhar, apaga-se o ficheiro e não fica nada órfão
  fs.writeFileSync(path.join(DIR, ficheiro), buf);
  let id;
  try {
    id = Number(D.run(`INSERT INTO anexos (paciente_id, nome_original, ficheiro, mime, tamanho, categoria, descricao, dente, data, criado_por)
      VALUES (?,?,?,?,?,?,?,?,?,?)`, pid, nome, ficheiro, tipo.mime, buf.length, o.categoria, o.descricao, o.dente, o.data, user.id).lastInsertRowid);
  } catch (e) { fs.rmSync(path.join(DIR, ficheiro), { force: true }); throw e; }
  D.log(user.id, 'carregar anexo', `id=${id} paciente=${pid}`);
  return D.get('SELECT * FROM anexos WHERE id=?', id);
}

// caminho absoluto, garantidamente dentro de anexos/
function caminho(a) {
  const f = path.resolve(DIR, a.ficheiro);
  if (!f.startsWith(DIR + path.sep)) throw erro(403, 'Caminho inválido');
  return f;
}

function servir(res, id) {
  const a = D.get('SELECT * FROM anexos WHERE id=?', id);
  if (!a) throw erro(404, 'Ficheiro não encontrado');
  const f = caminho(a);
  if (!fs.existsSync(f)) throw erro(404, 'Ficheiro em falta no disco');
  const ascii = a.nome_original.replace(/[^\x20-\x7e]|["\\]/g, '_');
  // o nome no disco é aleatório e nunca é reescrito: o conteúdo de um id não muda
  res.writeHead(200, { 'Content-Type': a.mime, 'Content-Length': fs.statSync(f).size, 'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'private, max-age=31536000, immutable',
    'Content-Disposition': `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(a.nome_original)}` });
  fs.createReadStream(f).on('error', () => res.destroy()).pipe(res);
}

// ligação ao CRUD genérico: não se cria por aí; o PUT é normalizado aqui; o DELETE (só administrador)
// é feito aqui e devolve a resposta: apaga o registo e só depois o ficheiro
function antesCrud(method, id, o, user) {
  if (method === 'POST') throw erro(405, 'Use o carregamento de ficheiros');
  if (method === 'PUT') validar(o);
  if (method === 'DELETE' && id) {
    if (user.perfil !== 'admin') throw erro(403, 'Apenas administradores podem eliminar ficheiros');
    const a = D.get('SELECT * FROM anexos WHERE id=?', id);
    if (!a) throw erro(404, 'Não encontrado');
    const f = caminho(a);
    D.run('DELETE FROM anexos WHERE id=?', id);
    D.log(user.id, 'eliminar anexos', `id=${id}`);
    fs.rmSync(f, { force: true });
    return { ok: true };
  }
}

module.exports = { carregar, servir, antesCrud, CATEGORIAS };
