'use strict';
// Testes estruturais: lêem o código-fonte e a base de dados para apanhar referências partidas
// (scripts, tabelas, colunas, rotas, ícones, separadores) antes de chegarem ao utilizador.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const D = require('../db');
after(() => { try { D.db.close(); } catch { /* já fechada */ } fs.rmSync(dir, { recursive: true, force: true }); });

const RAIZ = path.join(__dirname, '..');
const PUB = path.join(RAIZ, 'public');
const ler = f => fs.readFileSync(path.join(RAIZ, f), 'utf8');
const JS_CLIENTE = fs.readdirSync(path.join(PUB, 'js')).filter(f => f.endsWith('.js')).sort();
const SERVIDOR = fs.readdirSync(RAIZ).filter(f => f.endsWith('.js')).sort();
const html = ler('public/index.html');
const scripts = [...html.matchAll(/<script[^>]*\ssrc="([^"]+)"/g)].map(m => m[1]);
const cliente = Object.fromEntries(JS_CLIENTE.map(f => [f, ler('public/js/' + f)]));
const todoCliente = Object.values(cliente).join('\n');
const server = ler('server.js');
const bloco = (src, inicio, fim = '\n};') => { const i = src.indexOf(inicio); assert.ok(i >= 0, inicio); return src.slice(i, src.indexOf(fim, i) + fim.length); };
const colunas = t => D.all(`PRAGMA table_info(${t})`).map(c => c.name);
const tabelasBD = new Set(D.all("SELECT name FROM sqlite_master WHERE type='table'").map(r => r.name));

// ---------- index.html e ficheiros do cliente ----------
test('cada <script src> do index.html existe e cada ficheiro de public/js é carregado', () => {
  assert.ok(scripts.length > 0);
  for (const s of scripts) assert.ok(fs.existsSync(path.join(PUB, s)), `falta ${s}`);
  assert.deepEqual(JS_CLIENTE.filter(f => !scripts.includes('js/' + f)), []);
  assert.equal(new Set(scripts).size, scripts.length, 'script repetido');
  for (const [, href] of html.matchAll(/<link[^>]*\shref="([^"]+)"/g)) if (!/^(https?|data):/.test(href)) assert.ok(fs.existsSync(path.join(PUB, href)), `falta ${href}`);
});

test('cada ficheiro do cliente compila, e todos juntos não repetem declarações globais', () => {
  for (const [f, src] of Object.entries(cliente)) assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
  // no browser os scripts clássicos partilham o âmbito global: um const/let repetido entre ficheiros rebenta
  assert.doesNotThrow(() => new vm.Script(scripts.map(s => fs.readFileSync(path.join(PUB, s), 'utf8')).join('\n;\n'), { filename: 'index.html' }));
});

test('cada módulo do servidor compila e só usa módulos do Node ou ficheiros locais', () => {
  for (const f of SERVIDOR) {
    const src = ler(f);
    assert.doesNotThrow(() => new vm.Script(`(function (exports, require, module, __filename, __dirname) {${src}\n})`, { filename: f }), f);
    for (const [, mod] of src.matchAll(/require\('([^']+)'\)/g)) {
      assert.ok(mod.startsWith('node:') || mod.startsWith('./'), `${f} requer ${mod}`);
      if (mod.startsWith('./')) assert.ok(fs.existsSync(path.join(RAIZ, mod + (mod.endsWith('.js') ? '' : '.js'))), `${f}: ${mod}`);
    }
  }
});

test('package.json sem dependências', () => {
  const pkg = JSON.parse(ler('package.json'));
  for (const k of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'bundledDependencies']) assert.equal(pkg[k], undefined, k);
  assert.equal(pkg.scripts.test, 'node --test');
  assert.ok(!fs.existsSync(path.join(RAIZ, 'node_modules')) || fs.readdirSync(path.join(RAIZ, 'node_modules')).length === 0);
});

test('não há console.log esquecidos no cliente', () => {
  const restos = Object.entries(cliente).flatMap(([f, src]) => src.split('\n').map((l, i) => [f, i + 1, l]).filter(([, , l]) => /console\.log\(/.test(l)).map(([f, n]) => `${f}:${n}`));
  assert.deepEqual(restos, []);
});

// ---------- base de dados ----------
test('cada coluna do CRUD genérico (TABLES) existe na tabela real', () => {
  const TABLES = new Function(`${bloco(server, 'const TABLES = {')}; return TABLES;`)();
  assert.ok(Object.keys(TABLES).length > 20);
  for (const [t, def] of Object.entries(TABLES)) {
    assert.ok(tabelasBD.has(t), `tabela ${t}`);
    const cols = colunas(t);
    for (const c of [...def.cols, ...(def.filtros || [])]) assert.ok(cols.includes(c), `${t}.${c}`);
    for (const o of def.order.split(',').map(s => s.trim().split(' ')[0])) assert.ok(cols.includes(o), `${t} order ${o}`);
  }
});

test('cada tabela referida no SQL dos módulos do servidor existe', () => {
  const faltam = [];
  for (const f of SERVIDOR) {
    for (const [, t] of ler(f).matchAll(/\b(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_]+)\b/g)) if (!tabelasBD.has(t) && t !== 'sqlite_master') faltam.push(`${f}: ${t}`);
  }
  assert.deepEqual([...new Set(faltam)], []);
});

test('migrações são idempotentes: abrir a BD outra vez não falha nem duplica dados', () => {
  const migr = [...ler('db.js').matchAll(/'ALTER TABLE (\w+) ADD COLUMN (\w+)/g)].map(m => [m[1], m[2]]);
  assert.ok(migr.length > 20);
  for (const [t, c] of migr) assert.ok(colunas(t).includes(c), `${t}.${c}`);
  const conta = d => Object.fromEntries(['users', 'ivas', 'sms_modelos', 'estados', 'feriados', 'servicos', 'config', 'anamnese_perguntas']
    .map(t => [t, d.get(`SELECT COUNT(*) n FROM ${t}`).n]));
  const esquema = d => d.all("SELECT name, sql FROM sqlite_master ORDER BY name");
  const antes = [conta(D), esquema(D)];
  for (let i = 0; i < 2; i++) {
    delete require.cache[require.resolve('../db')];
    const D2 = require('../db');
    assert.deepEqual([conta(D2), esquema(D2)], antes);
    D2.db.close();
  }
});

// ---------- interface ----------
const rotas = new Set([...todoCliente.matchAll(/\broute\('([a-z-]+)'/g)].map(m => m[1]));

test('cada link #/x, go(#/x) e entrada do menu tem rota', () => {
  const alvos = new Set([...(todoCliente + html).matchAll(/#\/([a-z-]+)/g)].map(m => m[1]));
  const NAV = new Function(`${bloco(cliente['main.js'], 'const NAV = [', '\n];')}; return NAV;`)();
  for (const n of NAV) if (n !== 'sep') alvos.add(n[0]);
  assert.ok(alvos.size > 5);
  assert.deepEqual([...alvos].filter(a => !rotas.has(a)), []);
  assert.ok(rotas.has('inicio'), 'rota por omissão');
});

test('cada ícone usado (data-ic, ic(), menu) existe em ICONS', () => {
  const ICONS = new Function(`${bloco(cliente['core.js'], 'const ICONS = {')}; return ICONS;`)();
  const usados = new Set([...(todoCliente + html).matchAll(/data-ic="([a-z-]+)"/g), ...todoCliente.matchAll(/\bic\('([a-z-]+)'\)/g)].map(m => m[1]));
  const NAV = new Function(`${bloco(cliente['main.js'], 'const NAV = [', '\n];')}; return NAV;`)();
  for (const n of NAV) if (n !== 'sep') usados.add(n[1]);
  assert.ok(usados.size > 5);
  assert.deepEqual([...usados].filter(i => !ICONS[i]), []);
});

test('cada separador da ficha (FICHA_TABS) tem função e cada secção da configuração tem tratamento', () => {
  const pac = cliente['pacientes.js'];
  const tabs = [...bloco(pac, 'const FICHA_TABS = [', '];').matchAll(/\['(\w+)', '/g)].map(m => m[1]);
  const fns = Object.fromEntries([...bloco(pac, 'const fns = {', '};').matchAll(/(\w+): (\w+)/g)].map(m => [m[1], m[2]]));
  assert.ok(tabs.length >= 10);
  for (const t of tabs) {
    assert.ok(fns[t], `separador ${t} sem função`);
    assert.match(todoCliente, new RegExp(`function ${fns[t]}\\(`), `${fns[t]} não definida`);
  }
  const cfg = cliente['config.js'];
  const secs = [...bloco(cfg, 'const CFG_SECTIONS = [', '];').matchAll(/\['(\w+)', '/g)].map(m => m[1]);
  const crud = new Set([...bloco(cfg, 'const CRUD_DEFS = {').matchAll(/\n {2}(\w+): \{ table:/g)].map(m => m[1]));
  assert.ok(secs.length >= 15);
  assert.deepEqual(secs.filter(s => !crud.has(s) && !cfg.includes(`sec === '${s}'`)), []);
});

test('formulários genéricos da configuração só usam tabelas e colunas que o servidor aceita', () => {
  const TABLES = new Function(`${bloco(server, 'const TABLES = {')}; return TABLES;`)();
  const defs = bloco(cliente['config.js'], 'const CRUD_DEFS = {').split(/\n {2}(?=\w+: \{ table:)/).slice(1);
  assert.ok(defs.length >= 10);
  for (const d of defs) {
    const table = d.match(/table: '(\w+)'/)[1];
    assert.ok(TABLES[table], `tabela ${table}`);
    for (const [, k] of d.matchAll(/\{ k: '(\w+)'/g)) assert.ok(TABLES[table].cols.includes(k), `${table}.${k}`);
  }
  for (const [, t] of todoCliente.matchAll(/['`]t\/([a-z_]+)/g)) assert.ok(TABLES[t], `t/${t}`);
});

test('cada pedido do cliente à API vai para uma rota que o servidor conhece', () => {
  const casos = new Set([...bloco(server, 'async function api(req, res, url)', '\n}\n').matchAll(/case '([a-z-]+)'/g)].map(m => m[1]));
  if (server.includes("parts[0] === 'login'")) casos.add('login'); // tratado antes da sessão
  const usados = new Set([...todoCliente.matchAll(/\b(?:GET|POST|PUT|DEL|api)\(\s*(?:'[A-Z]+',\s*)?['`]([a-z-]+)/g)].map(m => m[1]));
  assert.ok(usados.size > 20);
  assert.deepEqual([...usados].filter(u => !casos.has(u)), []);
  // listagens: cada tipo do menu de relatórios existe no servidor
  const tipos = new Set([...cliente['listagens.js'].matchAll(/tipo: '([a-z]+)'/g)].map(m => m[1]));
  const lst = bloco(server, 'function listagem(tipo, q)', "throw new HttpError(404, 'Listagem desconhecida')");
  assert.deepEqual([...tipos].filter(t => !lst.includes(`case '${t}'`)), []);
});
