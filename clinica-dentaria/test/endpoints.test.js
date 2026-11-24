'use strict';
// Matriz de autorização: todos os endpoints × {sem sessão, sessão expirada, trocar_pw, assistente, receção, médico, admin}.
// Também: ficheiros estáticos (path traversal), JSON inválido, corpo demasiado grande, rotas e métodos desconhecidos.
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
const D = require('../db');

let port;
// pedido em bruto (sem normalização do caminho pelo cliente); status 0 = sem resposta em 3 s
function pedido(metodo, caminho, { corpo, ck, tipo = 'application/json', headers = {} } = {}) {
  return new Promise(resolve => {
    const h = { ...headers }; if (ck) h.Cookie = ck; if (corpo !== undefined) h['Content-Type'] = tipo;
    const r = http.request({ host: '127.0.0.1', port, path: caminho, method: metodo, headers: h }, res => {
      const ch = []; res.on('data', c => ch.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, texto: Buffer.concat(ch).toString('utf8') }));
      res.on('error', () => resolve({ status: 0 }));
    });
    r.setTimeout(3000, () => { r.destroy(); resolve({ status: 0, timeout: true }); });
    r.on('error', e => resolve({ status: 0, erro: e.code }));
    r.end(corpo === undefined ? undefined : Buffer.isBuffer(corpo) ? corpo : typeof corpo === 'string' ? corpo : JSON.stringify(corpo));
  });
}
const sid = r => (r.headers['set-cookie'] || [''])[0].split(';')[0];
const login = async (l, p) => { const r = await pedido('POST', '/api/login', { corpo: { login: l, password: p } }); assert.equal(r.status, 200, r.texto); return sid(r); };

const ck = {};
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  port = server.address().port;
  ck.admin = await login('admin', 'segredo-de-teste');
  for (const perfil of ['assistente', 'rececao', 'medico', 'trocar']) {
    const r = await pedido('POST', '/api/users', { ck: ck.admin, corpo: { nome: perfil, login: 'u_' + perfil, password: 'provisoria1', perfil: perfil === 'trocar' ? 'rececao' : perfil } });
    assert.equal(r.status, 200, r.texto);
    ck[perfil] = await login('u_' + perfil, 'provisoria1');
    if (perfil !== 'trocar') assert.equal((await pedido('POST', '/api/password', { ck: ck[perfil], corpo: { atual: 'provisoria1', nova: 'nova-pw-' + perfil } })).status, 200);
  }
  ck.expirada = 'sid=sessao-expirada-teste';
  D.run("INSERT INTO sessions VALUES ('sessao-expirada-teste', 1, datetime('now','localtime','-13 hours'))");
  ck.nenhuma = undefined;
  D.run("INSERT INTO pacientes (id, numero, nome) VALUES (1, 1, 'Paciente da matriz')"); // as leituras pacientes/1/... têm de encontrar a ficha
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------- inventário de endpoints (router api() em server.js) ----------
// acesso: 'todos' = qualquer utilizador autenticado; 'admin' = só administrador; 'sempre' = também com trocar_pw
const N = 999999; // ids inexistentes: os pedidos não alteram dados
const E = [];
const ep = (acesso, metodo, url, corpo, extra = {}) => E.push({ acesso, metodo, url, corpo, ...extra });
ep('sempre', 'GET', 'me'); ep('sempre', 'POST', 'password', {});
ep('todos', 'GET', 'config'); ep('admin', 'PUT', 'config', {});
ep('todos', 'GET', 'servicos-frequentes'); ep('todos', 'GET', 'lookups');
ep('admin', 'GET', 'users'); ep('admin', 'POST', 'users', {}); ep('admin', 'PUT', `users/${N}`, {}); ep('admin', 'DELETE', `users/${N}`);
ep('admin', 'POST', 'importar/pacientes', {});
const TABELAS = { especialidades: 1, medicos: 1, gabinetes: 1, estados: 1, razoes_visita: 1, feriados: 1, entidades: 1, servicos: 1, laboratorios: 0, armazens: 1,
  produtos: 0, sms_modelos: 1, pacientes: 0, tratamentos: 0, dentes_condicoes: 0, notas_clinicas: 0, proteses: 0, ivas: 1, bloqueios: 0, lista_espera: 0,
  anamnese_perguntas: 1, anexos: 0, movimentos_stock: 0 };
// README "Permissões": próteses e tratamentos realizados só o admin apaga (ver o teste dos registos clínicos abaixo)
for (const [t, adm] of Object.entries(TABELAS)) {
  ep('todos', 'GET', `t/${t}`); ep('todos', 'GET', `t/${t}/${N}`);
  ep(adm ? 'admin' : 'todos', 'POST', `t/${t}`, {});
  ep(adm ? 'admin' : 'todos', 'PUT', `t/${t}/${N}`, {}, { soNegado: true }); // autorizados: ver o teste "PUT t/<tabela>/<id inexistente>"
  ep(adm || ['proteses', 'anexos'].includes(t) ? 'admin' : 'todos', 'DELETE', `t/${t}/${N}`);
}
for (const s of ['resumo', 'perio', 'marcacoes', 'em-aberto', 'tratamentos', 'notas', 'anamnese-extra', 'contacorrente']) ep('todos', 'GET', `pacientes/1/${s}`);
ep('todos', 'GET', 'pacientes'); ep('todos', 'GET', 'pacientes?q=a'); ep('todos', 'PUT', `pacientes/${N}/anamnese-extra`, {});
ep('todos', 'POST', `pacientes/${N}/anexos`, undefined, { binario: true });
ep('todos', 'PUT', `anamnese/${N}`, {}); ep('todos', 'GET', `perio/${N}`);
ep('todos', 'POST', 'notas', {}); ep('admin', 'DELETE', `notas/${N}`);
ep('todos', 'GET', 'agenda'); ep('todos', 'GET', `marcacoes/${N}`); ep('todos', 'POST', 'marcacoes', {}); ep('todos', 'PUT', `marcacoes/${N}`, {});
ep('todos', 'DELETE', `marcacoes/${N}`); ep('todos', 'GET', 'pesquisa-vagas?medico_id=1'); ep('todos', 'GET', 'bloqueios'); ep('todos', 'GET', 'espera');
ep('todos', 'GET', 'listagens/agenda'); ep('todos', 'GET', 'feriados');
ep('todos', 'GET', 'orcamentos'); ep('todos', 'GET', `orcamentos/${N}`); ep('todos', 'POST', 'orcamentos', {}); ep('todos', 'PUT', `orcamentos/${N}`, {});
ep('todos', 'POST', `orcamentos/${N}/aceitar`, {}); ep('todos', 'POST', `orcamentos/${N}/recusar`, {}); ep('todos', 'DELETE', `orcamentos/${N}`);
ep('todos', 'GET', 'documentos'); ep('todos', 'GET', `documentos/${N}`); ep('todos', 'POST', 'documentos', {}); ep('todos', 'POST', `documentos/${N}/anular`, {});
ep('todos', 'POST', `documentos/${N}/email`, {}); ep('todos', 'POST', 'recibos', {}); ep('todos', 'GET', 'devedores');
ep('todos', 'GET', 'stocks/existencias'); ep('todos', 'GET', 'stocks/lotes?produto_id=1'); ep('todos', 'GET', 'stocks/movimentos'); ep('todos', 'POST', 'stocks/transferir', {});
ep('todos', 'GET', 'proteses'); ep('todos', 'GET', 'estatisticas'); ep('todos', 'GET', 'aniversarios'); ep('todos', 'GET', 'revisoes');
ep('todos', 'POST', 'sms/preparar', {}); ep('todos', 'GET', 'sms/historico'); ep('todos', 'GET', 'sms/estado'); ep('todos', 'POST', 'sms/marcar-enviado', {});
ep('admin', 'POST', 'sms/teste', { canal: 'email', para: 'x@exemplo.pt' });
ep('todos', 'GET', 'dashboard'); ep('todos', 'GET', `anexos/${N}/ficheiro`);
ep('admin', 'GET', 'logs'); ep('admin', 'GET', 'backup');

const PERFIS = ['nenhuma', 'expirada', 'trocar', 'assistente', 'rececao', 'medico', 'admin'];
function esperado(acesso, perfil) {
  if (perfil === 'nenhuma' || perfil === 'expirada') return 401;
  if (perfil === 'trocar') return acesso === 'sempre' ? 'ok' : 403;
  if (acesso === 'admin' && perfil !== 'admin') return 403;
  return 'ok'; // autorizado: tudo menos 401/403, sem erro 5xx e com resposta
}

test(`inventário: ${E.length} endpoints × ${PERFIS.length} perfis`, () => assert.ok(E.length > 120));

for (const e of E) {
  test(`${e.metodo} /api/${e.url} [${e.acesso}]`, e.todo ? { todo: e.todo } : {}, async () => {
    const falhas = [];
    for (const perfil of PERFIS) {
      if (e.soNegado && esperado(e.acesso, perfil) === 'ok') continue;
      const opt = { ck: ck[perfil] };
      if (e.binario) { opt.corpo = Buffer.from('%PDF-1.4 teste'); opt.tipo = 'application/octet-stream'; } else if (e.corpo !== undefined) opt.corpo = e.corpo;
      const r = await pedido(e.metodo, '/api/' + e.url, opt);
      const exp = esperado(e.acesso, perfil);
      // 404 só é resposta válida quando o pedido usa um id inexistente (senão a rota pode ter desaparecido)
      const bom = exp === 'ok' ? r.status && ![401, 403].includes(r.status) && r.status < 500 && (r.status !== 404 || e.url.includes(String(N))) : r.status === exp;
      if (!bom) falhas.push(`${perfil}: esperado ${exp}, obtido ${r.status}${r.timeout ? ' (sem resposta)' : ''} ${(r.texto || '').slice(0, 80)}`);
    }
    assert.deepEqual(falhas, []);
  });
}

test('PUT t/<tabela>/<id inexistente> responde 404', async () => {
  for (const t of ['pacientes', 'especialidades']) assert.equal((await pedido('PUT', `/api/t/${t}/${N}`, { ck: ck.admin, corpo: { nome: 'x' } })).status, 404, t);
});

test('login público, rotas desconhecidas → 401 sem sessão e 404 com sessão', async () => {
  assert.equal((await pedido('POST', '/api/login', { corpo: {} })).status, 401);
  assert.equal((await pedido('GET', '/api/nao-existe')).status, 401);
  assert.equal((await pedido('GET', '/api/nao-existe', { ck: ck.admin })).status, 404);
  assert.equal((await pedido('GET', '/api/t/users', { ck: ck.admin })).status, 404); // users/sessions/config não estão no CRUD genérico
  assert.equal((await pedido('GET', '/api/t/sessions', { ck: ck.admin })).status, 404);
  assert.equal((await pedido('GET', '/api/t/config', { ck: ck.admin })).status, 404);
  assert.equal((await pedido('PATCH', '/api/pacientes', { ck: ck.admin })).status, 404);
  assert.equal((await pedido('GET', '/api/pacientes/1/desconhecido', { ck: ck.admin })).status, 404);
  assert.equal((await pedido('GET', '/api/pacientes/1/documentos', { ck: ck.admin })).status, 404); // removidas: o cliente não as usa
  assert.equal((await pedido('GET', '/api/anamnese/1', { ck: ck.admin })).status, 404);
});

test('métodos não suportados em rotas só de leitura', async () => {
  for (const [m, u] of [['DELETE', 'lookups'], ['POST', 'agenda'], ['DELETE', 'dashboard'], ['PUT', 'devedores'], ['POST', 'revisoes'], ['DELETE', 'me'], ['GET', 'logout'], ['GET', 'login']])
    assert.ok([404, 405].includes((await pedido(m, '/api/' + u, { ck: ck.admin, corpo: m === 'DELETE' || m === 'GET' ? undefined : {} })).status), `${m} ${u}`);
  assert.equal((await pedido('GET', '/api/me', { ck: ck.admin })).status, 200, 'GET /api/logout não termina a sessão');
});

test('apagar registos clínicos: realizados e próteses só o admin; plano e odontograma qualquer perfil (com registo no log)', async () => {
  const novo = async (t, corpo) => JSON.parse((await pedido('POST', '/api/t/' + t, { ck: ck.admin, corpo })).texto).id;
  const pid = await novo('pacientes', { nome: 'Paciente Apagar' });
  const realizado = await novo('tratamentos', { paciente_id: pid, descricao: 'Restauração', estado: 'realizado' });
  const planeado = await novo('tratamentos', { paciente_id: pid, descricao: 'Destartarização', estado: 'planeado' });
  const condicao = await novo('dentes_condicoes', { paciente_id: pid, dente: 11, condicao: 'carie' });
  const protese = await novo('proteses', { paciente_id: pid, descricao: 'Coroa' });
  for (const [u, id] of [['tratamentos', realizado], ['proteses', protese]])
    assert.equal((await pedido('DELETE', `/api/t/${u}/${id}`, { ck: ck.rececao })).status, 403, u);
  for (const [u, id] of [['tratamentos', planeado], ['dentes_condicoes', condicao]]) {
    assert.equal((await pedido('DELETE', `/api/t/${u}/${id}`, { ck: ck.medico })).status, 200, u);
    assert.ok(D.get('SELECT 1 FROM logs WHERE acao=? AND detalhe=?', `eliminar ${u}`, `id=${id}`), `log ${u}`);
  }
  for (const [u, id] of [['tratamentos', realizado], ['proteses', protese]])
    assert.equal((await pedido('DELETE', `/api/t/${u}/${id}`, { ck: ck.admin })).status, 200, u);
});

test('JSON inválido → 400 com sessão; sem sessão → 401 sem ler o corpo', async () => {
  for (const c of ['{', '{"a":', 'nao json', '\u0000', '[1,]']) {
    assert.equal((await pedido('POST', '/api/notas', { ck: ck.admin, corpo: c })).status, 400, c);
    assert.equal((await pedido('POST', '/api/notas', { corpo: c })).status, 401, c);
  }
});

test('JSON profundamente aninhado não derruba o servidor', async () => {
  const r = await pedido('POST', '/api/notas', { ck: ck.admin, corpo: '['.repeat(1e6) + ']'.repeat(1e6) });
  assert.ok(r.status === 400 || r.status === 413, String(r.status));
  assert.equal((await pedido('GET', '/api/me', { ck: ck.admin })).status, 200);
});

test('corpo acima de 5 MB → resposta 413', async () => {
  const r = await pedido('POST', '/api/notas', { ck: ck.admin, corpo: JSON.stringify({ texto: 'x'.repeat(6e6) }) });
  assert.equal(r.status, 413, JSON.stringify(r));
});

test('o servidor continua a responder depois de um corpo gigante', async () => {
  await pedido('POST', '/api/notas', { ck: ck.admin, corpo: JSON.stringify({ texto: 'x'.repeat(6e6) }) });
  assert.equal((await pedido('GET', '/api/me', { ck: ck.admin })).status, 200);
});

test('parâmetros numéricos inválidos não dão erro 500 (nem expõem SQL)', async () => {
  for (const u of ['servicos-frequentes?medico_id=abc', 'servicos-frequentes?medico_id=1%20OR%201', 'pacientes?limit=Infinity', 'pacientes?limit=1e999', 'pacientes?limit=-1', 'pacientes?limit=abc']) {
    const r = await pedido('GET', '/api/' + u, { ck: ck.admin });
    assert.ok(r.status < 500, `${u}: ${r.status} ${r.texto.slice(0, 100)}`);
    assert.doesNotMatch(r.texto, /SQL|no such|column/i, u);
  }
});

test('stocks/existencias?armazem_id inválido → 400; válido filtra pelo armazém', async () => {
  for (const a of ['x', '1 OR 1', '1.5']) assert.equal((await pedido('GET', `/api/stocks/existencias?armazem_id=${encodeURIComponent(a)}`, { ck: ck.admin })).status, 400, a);
  const prod = JSON.parse((await pedido('POST', '/api/t/produtos', { ck: ck.admin, corpo: { nome: 'Luvas Armazém', ativo: 1 } })).texto).id;
  assert.equal((await pedido('POST', '/api/t/movimentos_stock', { ck: ck.admin, corpo: { produto_id: prod, armazem_id: 1, tipo: 'entrada', qtd: 7 } })).status, 200);
  const qtd = async a => JSON.parse((await pedido('GET', `/api/stocks/existencias${a}`, { ck: ck.admin })).texto).find(p => p.id === prod).qtd;
  assert.deepEqual([await qtd('?armazem_id=1'), await qtd('?armazem_id=2'), await qtd('')], [7, 0, 7]);
});

test('pacientes?limit fica entre 1 e 1000', async () => {
  D.tx(() => { for (let i = 0; i < 1001; i++) D.run('INSERT INTO pacientes (numero, nome, ativo) VALUES (?,?,1)', 500000 + i, 'Limite ' + i); });
  const n = async l => JSON.parse((await pedido('GET', '/api/pacientes?limit=' + l, { ck: ck.admin })).texto).length;
  assert.equal(await n(-1), 1);
  assert.equal(await n(2), 2);
  assert.equal(await n('abc'), 200); // por omissão
  assert.equal(await n(100000), 1000);
  assert.equal(await n('Infinity'), 1000);
});

test('t/pacientes (lista) devolve no máximo 1000 fichas e sem fotografias; a ficha por id traz a foto', async () => {
  const foto = 'data:image/jpeg;base64,' + 'A'.repeat(1000);
  const id = JSON.parse((await pedido('POST', '/api/t/pacientes', { ck: ck.admin, corpo: { nome: 'Com Foto', foto } })).texto).id;
  const lista = JSON.parse((await pedido('GET', '/api/t/pacientes', { ck: ck.admin })).texto);
  assert.equal(lista.length, 1000);
  assert.ok(lista.every(p => !('foto' in p) && p.nome));
  assert.deepEqual(JSON.parse((await pedido('GET', `/api/t/pacientes?id=${id}`, { ck: ck.admin })).texto).map(p => p.nome), ['Com Foto']);
  assert.equal(JSON.parse((await pedido('GET', `/api/t/pacientes/${id}`, { ck: ck.admin })).texto).foto, foto);
});

test('erro 500 não expõe detalhes internos (só no console)', async () => {
  const orig = D.getConfig, err = console.error; const vistos = [];
  D.getConfig = () => { throw new Error('detalhe-secreto /caminho/clinica.db'); };
  console.error = (...a) => vistos.push(a.map(String).join(' '));
  try {
    const r = await pedido('GET', '/api/config', { ck: ck.admin });
    assert.equal(r.status, 500);
    assert.equal(JSON.parse(r.texto).erro, 'Erro interno');
  } finally { D.getConfig = orig; console.error = err; }
  assert.ok(vistos.some(v => v.includes('detalhe-secreto')));
});

// ---------- listagem de ocupação ----------
test('listagens/ocupacao e agenda/confirmar recusam intervalos acima de 1 ano (400)', async () => {
  for (const t of ['ocupacao', 'agenda', 'confirmar']) {
    for (const [de, ate] of [['2024-01-01', '2025-12-31'], ['1900-01-01', '2100-12-31'], ['abc', '2025-01-01']]) {
      const r = await pedido('GET', `/api/listagens/${t}?de=${de}&ate=${ate}`, { ck: ck.medico });
      assert.equal(r.status, 400, `${t} ${de}..${ate}: ${r.status}`);
    }
    assert.equal((await pedido('GET', `/api/listagens/${t}?de=2025-01-01&ate=2025-12-31`, { ck: ck.medico })).status, 200, t);
  }
});

test('listagens/ocupacao de um mês: valores calculados à mão', async () => {
  const cfgAntes = JSON.parse((await pedido('GET', '/api/config', { ck: ck.admin })).texto);
  const cfg = { agenda_inicio: '08:00', agenda_fim: '20:00', agenda_dias: '1,2,3,4,5', feriado_pascoa: '1', feriado_sexta_santa: '1', feriado_carnaval: '0', feriado_corpo_deus: '0' };
  assert.equal((await pedido('PUT', '/api/config', { ck: ck.admin, corpo: cfg })).status, 200);
  try {
    const md = JSON.parse((await pedido('POST', '/api/t/medicos', { ck: ck.admin, corpo: { nome: 'Dra. Ocupação', ativo: 1 } })).texto).id;
    D.run("INSERT INTO feriados (nome, data, fixo) VALUES ('Dia da Liberdade', '04-25', 1)");
    const est = n => D.get('SELECT id FROM estados WHERE nome=?', n)?.id ?? D.run('INSERT INTO estados (nome, categoria) VALUES (?,?)', n, { Faltou: 'FALTAS', Desmarcada: 'INATIVAS' }[n] || 'OUTRAS').lastInsertRowid;
    const pac = JSON.parse((await pedido('POST', '/api/t/pacientes', { ck: ck.admin, corpo: { nome: 'Paciente Ocupação' } })).texto).id;
    const marc = (i, f, e) => D.run('INSERT INTO marcacoes (paciente_id, medico_id, inicio, fim, estado_id) VALUES (?,?,?,?,?)', pac, md, i, f, est(e));
    marc('2030-04-02T09:00', '2030-04-02T10:00', 'Marcada');     // 60
    marc('2030-04-02T10:00', '2030-04-02T10:30', 'Faltou');      // faltas não contam
    marc('2030-04-03T14:00', '2030-04-03T14:45', 'Confirmada');  // 45
    marc('2030-04-03T15:00', '2030-04-03T15:30', 'Desmarcada');  // inativas não contam
    marc('2030-04-06T09:00', '2030-04-06T09:30', 'Marcada');     // sábado (fora dos dias de agenda)
    marc('2030-04-25T09:00', '2030-04-25T10:00', 'Marcada');     // feriado fixo
    marc('2030-04-19T09:00', '2030-04-19T10:00', 'Marcada');     // Sexta-feira Santa 2030
    marc('2030-04-30T19:30', '2030-04-30T20:00', 'Marcada');     // 30, último dia
    marc('2030-03-29T09:00', '2030-03-29T10:00', 'Marcada');     // fora do intervalo
    marc('2030-05-01T09:00', '2030-05-01T10:00', 'Marcada');     // fora do intervalo
    const bl = (i, f) => D.run("INSERT INTO bloqueios (medico_id, inicio, fim, tipo) VALUES (?,?,?,'ausencia')", md, i, f);
    bl('2030-04-03T08:00', '2030-04-03T12:00'); // 240
    bl('2030-04-10T18:00', '2030-04-10T22:00'); // 120 (corta às 20:00)
    bl('2030-04-15T00:00', '2030-04-16T23:59'); // 2 × 720
    const r = await pedido('GET', `/api/listagens/ocupacao?de=2030-04-01&ate=2030-04-30&medico_id=${md}`, { ck: ck.rececao });
    assert.equal(r.status, 200, r.texto);
    // abril 2030: 22 dias úteis − 19/4 (Sexta Santa) − 25/4 = 20 dias × 12 h = 240 h; bloqueado 1800 min = 30 h
    assert.deepEqual(JSON.parse(r.texto).rows, [{ medico_nome: 'Dra. Ocupação', marcacoes: 3, horas_disp: 210, horas_ocup: 2.25, taxa: 1.07 }]);
  } finally {
    await pedido('PUT', '/api/config', { ck: ck.admin, corpo: Object.fromEntries(Object.keys(cfg).map(k => [k, cfgAntes[k]])) });
  }
});

// ---------- ficheiros estáticos ----------
const SEGREDO = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8').slice(0, 60);
test('ficheiros estáticos: index e 404', async () => {
  assert.equal((await pedido('GET', '/')).status, 200);
  assert.equal((await pedido('GET', '/nao-existe.js')).status, 404);
});
const TRAVESSIAS = ['/../server.js', '/..%2fserver.js', '/%2e%2e/server.js', '/%2e%2e%2fserver.js', '/%2E%2E%2Fserver.js', '/..\\server.js', '/..%5cserver.js',
  '/%5c..%5cserver.js', '/....//server.js', '/%252e%252e%252fserver.js', '/public/../server.js', '/..%2f..%2f..%2fetc%2fpasswd', '/%2e%2e%2f%2e%2e%2fetc/passwd',
  '/..%c0%afserver.js', '/index.html/..%2f..%2fserver.js', '/./../db.js', '/..%2fdata%2fclinica.db', `/..%2f${path.basename(dir)}`];
for (const p of TRAVESSIAS) test(`path traversal não expõe ficheiros: ${p}`, async () => {
  const r = await pedido('GET', p);
  assert.ok(r.status !== 200 || !r.texto.includes(SEGREDO), `${p} → ${r.status}`);
  assert.ok(!/root:x:0/.test(r.texto || ''));
  assert.ok(r.status > 0 && r.status < 500, `${p} → ${r.status}`);
});
test('path traversal com byte nulo → 4xx, nunca 500', async () => {
  for (const p of ['/%00', '/index.html%00.js', '/..%00/server.js']) {
    const r = await pedido('GET', p);
    assert.ok(r.status >= 400 && r.status < 500, `${p} → ${r.status} ${r.texto}`);
  }
});
