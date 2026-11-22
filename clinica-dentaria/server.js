'use strict';
// Servidor HTTP da aplicação (sem dependências externas)
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const D = require('./db');
const { all, get, run, tx } = D;

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');

// ---------- utilitários ----------
class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const r2 = n => Math.round((Number(n) || 0) * 100) / 100;
const agora = () => { const d = new Date(); return `${today()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

function send(res, status, body, headers = {}) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', ...headers });
  res.end(data);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => { size += c.length; if (size > 5e6) { reject(new HttpError(413, 'Pedido demasiado grande')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new HttpError(400, 'JSON inválido')); }
    });
    req.on('error', reject);
  });
}

function parseCookies(req) {
  const o = {};
  (req.headers.cookie || '').split(';').forEach(p => { const i = p.indexOf('='); if (i > 0) o[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim()); });
  return o;
}

// ---------- autenticação ----------
function currentUser(req) {
  const t = parseCookies(req).sid;
  if (!t) return null;
  return get(`SELECT u.id, u.nome, u.login, u.perfil, u.medico_id FROM sessions s JOIN users u ON u.id = s.user_id
              WHERE s.token = ? AND u.ativo = 1`, t) || null;
}
const isAdmin = u => u && u.perfil === 'admin';
function requireAdmin(u) { if (!isAdmin(u)) throw new HttpError(403, 'Apenas administradores podem efetuar esta operação'); }

// ---------- CRUD genérico ----------
// writable: colunas editáveis; admin: escrita apenas para administradores
const TABLES = {
  especialidades: { cols: ['nome', 'abreviatura', 'ativo'], admin: true, order: 'nome' },
  medicos: { cols: ['nome', 'abreviatura', 'especialidade_id', 'cedula', 'nif', 'email', 'telefone', 'cor', 'comissao_pct', 'ativo'], admin: true, order: 'nome' },
  gabinetes: { cols: ['nome', 'ativo'], admin: true, order: 'nome' },
  estados: { cols: ['nome', 'cor', 'categoria', 'ordem', 'ativo'], admin: true, order: 'ordem, id' },
  razoes_visita: { cols: ['abreviatura', 'descricao', 'ativo'], admin: true, order: 'abreviatura' },
  feriados: { cols: ['nome', 'data', 'fixo', 'ativo'], admin: true, order: 'data' },
  entidades: { cols: ['nome', 'nif', 'desconto_pct', 'ativo'], admin: true, order: 'nome' },
  servicos: { cols: ['codigo', 'nome', 'especialidade_id', 'preco', 'iva', 'iva_id', 'duracao_min', 'por_dente', 'ativo'], admin: true, order: 'codigo, nome' },
  laboratorios: { cols: ['nome', 'contacto', 'telefone', 'email', 'ativo'], admin: false, order: 'nome' },
  armazens: { cols: ['nome', 'ativo'], admin: true, order: 'id' },
  produtos: { cols: ['codigo', 'nome', 'familia', 'unidade', 'stock_min', 'stock_ideal', 'preco_custo', 'fornecedor', 'ativo'], admin: false, order: 'nome' },
  sms_modelos: { cols: ['nome', 'texto', 'ativo'], admin: true, order: 'nome' },
  pacientes: { cols: ['numero', 'nome', 'data_nasc', 'genero', 'nif', 'sns', 'cc', 'telefone', 'telemovel', 'email', 'morada', 'cod_postal', 'localidade', 'profissao', 'razao_visita_id', 'medico_id', 'entidade_id', 'num_beneficiario', 'notas', 'rgpd_consent', 'rgpd_data', 'sms_ok', 'email_ok', 'ativo',
    'titulo', 'id_externo', 'nacionalidade', 'idioma', 'contacto_emergencia', 'telefone_emergencia', 'foto', 'agregado_id'], order: 'nome' },
  tratamentos: { cols: ['paciente_id', 'medico_id', 'servico_id', 'descricao', 'dente', 'faces', 'estado', 'data', 'preco', 'desconto_pct', 'iva', 'iva_id', 'notas', 'orcamento_id', 'marcacao_id'], order: 'data DESC, id DESC' },
  dentes_condicoes: { cols: ['paciente_id', 'dente', 'condicao', 'faces', 'notas', 'data'], order: 'dente' },
  notas_clinicas: { cols: ['paciente_id', 'medico_id', 'data', 'texto'], order: 'data DESC, id DESC' },
  proteses: { cols: ['paciente_id', 'medico_id', 'laboratorio_id', 'tipo', 'descricao', 'dentes', 'cor', 'referencia', 'data_emissao', 'data_prevista', 'data_envio', 'data_rececao', 'data_entrega', 'fase', 'custo', 'notas'], order: 'data_emissao DESC, id DESC' },
  ivas: { cols: ['taxa', 'descricao', 'regiao', 'codigo', 'isencao_cod', 'isencao_motivo', 'ativo'], admin: true, order: 'regiao, taxa' },
  bloqueios: { cols: ['medico_id', 'inicio', 'fim', 'tipo', 'motivo'], order: 'inicio DESC' },
  lista_espera: { cols: ['paciente_id', 'medico_id', 'servico_id', 'preferencia', 'notas', 'estado'], order: 'criado_em' },
  movimentos_stock: { cols: ['produto_id', 'armazem_id', 'tipo', 'qtd', 'lote', 'validade', 'data', 'motivo'], order: 'data DESC, id DESC' },
};

function pick(body, cols) {
  const o = {};
  for (const c of cols) if (Object.prototype.hasOwnProperty.call(body, c)) {
    let v = body[c];
    if (v === '' || v === undefined) v = null;
    if (typeof v === 'boolean') v = v ? 1 : 0;
    o[c] = v;
  }
  return o;
}

function insert(table, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) throw new HttpError(400, 'Sem dados');
  const r = run(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...keys.map(k => obj[k]));
  return Number(r.lastInsertRowid);
}
function update(table, id, obj) {
  const keys = Object.keys(obj);
  if (!keys.length) return;
  run(`UPDATE ${table} SET ${keys.map(k => `${k}=?`).join(',')} WHERE id=?`, ...keys.map(k => obj[k]), id);
}

function crud(method, table, id, query, body, user) {
  const def = TABLES[table];
  if (!def) throw new HttpError(404, 'Recurso desconhecido');
  if (method === 'GET') {
    if (id) { const row = get(`SELECT * FROM ${table} WHERE id=?`, id); if (!row) throw new HttpError(404, 'Não encontrado'); return row; }
    const where = []; const params = [];
    for (const c of [...def.cols, 'id']) if (query.has(c)) { where.push(`${c} = ?`); params.push(query.get(c)); }
    return all(`SELECT * FROM ${table} ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY ${def.order}`, ...params);
  }
  if (def.admin) requireAdmin(user);
  if (method === 'POST') {
    const o = pick(body, def.cols);
    if (table === 'pacientes') {
      if (!o.nome) throw new HttpError(400, 'O nome é obrigatório');
      if (!o.numero) o.numero = (get('SELECT MAX(numero) m FROM pacientes').m || 0) + 1;
      o.alterado_por = user.id; o.alterado_em = agora();
      validarNif(o.nif);
    }
    if (table === 'movimentos_stock') {
      if (!o.produto_id || !(Number(o.qtd) > 0)) throw new HttpError(400, 'Indique o produto e uma quantidade positiva');
      if (!o.data) o.data = today();
      o.user_id = user.id;
    }
    const newId = insert(table, o);
    D.log(user.id, `criar ${table}`, `id=${newId}`);
    return get(`SELECT * FROM ${table} WHERE id=?`, newId);
  }
  if (!id) throw new HttpError(400, 'Falta o id');
  if (method === 'PUT') {
    const o = pick(body, def.cols);
    if (table === 'pacientes') {
      if ('nif' in o) validarNif(o.nif);
      if (o.agregado_id && Number(o.agregado_id) === Number(id)) o.agregado_id = null;
      o.alterado_por = user.id; o.alterado_em = agora();
    }
    update(table, id, o);
    D.log(user.id, `editar ${table}`, `id=${id}`);
    return get(`SELECT * FROM ${table} WHERE id=?`, id);
  }
  if (method === 'DELETE') {
    try { run(`DELETE FROM ${table} WHERE id=?`, id); }
    catch (e) { throw new HttpError(409, 'Não é possível eliminar: o registo está a ser utilizado. Pode desativá-lo.'); }
    D.log(user.id, `eliminar ${table}`, `id=${id}`);
    return { ok: true };
  }
  throw new HttpError(405, 'Método não suportado');
}

function validarNif(nif) {
  if (!nif) return;
  const s = String(nif).replace(/\s/g, '');
  if (!/^\d{9}$/.test(s)) throw new HttpError(400, 'NIF inválido: deve ter 9 dígitos');
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(s[i]) * (9 - i);
  let ctrl = 11 - (soma % 11); if (ctrl >= 10) ctrl = 0;
  if (ctrl !== Number(s[8])) throw new HttpError(400, 'NIF inválido: dígito de controlo incorreto');
}

// ---------- feriados ----------
function pascoa(ano) {
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(ano, mes - 1, dia));
}
function feriadosAno(ano) {
  const cfg = D.getConfig(); const out = [];
  for (const f of all('SELECT * FROM feriados WHERE ativo=1')) {
    if (f.fixo) out.push({ data: `${ano}-${f.data}`, nome: f.nome });
    else if (f.data.startsWith(String(ano))) out.push({ data: f.data, nome: f.nome });
  }
  const p = pascoa(ano);
  const off = (n) => { const d = new Date(p); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  if (cfg.feriado_pascoa === '1') out.push({ data: off(0), nome: 'Páscoa' });
  if (cfg.feriado_sexta_santa === '1') out.push({ data: off(-2), nome: 'Sexta-feira Santa' });
  if (cfg.feriado_carnaval === '1') out.push({ data: off(-47), nome: 'Carnaval' });
  if (cfg.feriado_corpo_deus === '1') out.push({ data: off(60), nome: 'Corpo de Deus' });
  return out.sort((a, b) => a.data.localeCompare(b.data));
}

// ---------- agenda ----------
const AGENDA_SQL = `SELECT m.*, p.nome paciente_nome, p.telemovel paciente_telemovel, p.numero paciente_numero,
  md.nome medico_nome, md.cor medico_cor, g.nome gabinete_nome, s.nome servico_nome, e.nome estado_nome, e.cor estado_cor, e.categoria estado_categoria
  FROM marcacoes m LEFT JOIN pacientes p ON p.id=m.paciente_id LEFT JOIN medicos md ON md.id=m.medico_id
  LEFT JOIN gabinetes g ON g.id=m.gabinete_id LEFT JOIN servicos s ON s.id=m.servico_id LEFT JOIN estados e ON e.id=m.estado_id`;

function guardarMarcacao(id, body, user) {
  const o = pick(body, ['paciente_id', 'medico_id', 'gabinete_id', 'servico_id', 'inicio', 'fim', 'estado_id', 'notas', 'primeira']);
  const atual = id ? get('SELECT * FROM marcacoes WHERE id=?', id) : {};
  if (id && !atual) throw new HttpError(404, 'Marcação não encontrada');
  const m = { ...atual, ...o };
  if (!m.paciente_id) throw new HttpError(400, 'Escolha o paciente');
  if (!m.medico_id) throw new HttpError(400, 'Escolha o médico');
  if (!m.inicio || !m.fim || m.fim <= m.inicio) throw new HttpError(400, 'Horário inválido');
  if (!m.estado_id) o.estado_id = m.estado_id = get("SELECT id FROM estados WHERE ativo=1 ORDER BY ordem LIMIT 1").id;
  if (!body.forcar) {
    const inativas = "(SELECT id FROM estados WHERE categoria IN ('INATIVAS','FALTAS'))";
    const c1 = get(`SELECT m.id, p.nome FROM marcacoes m JOIN pacientes p ON p.id=m.paciente_id WHERE m.medico_id=? AND m.inicio < ? AND m.fim > ? AND m.id != ? AND m.estado_id NOT IN ${inativas}`,
      m.medico_id, m.fim, m.inicio, id || 0);
    if (c1) throw new HttpError(409, `O médico já tem uma marcação nesse horário (${c1.nome}).`);
    if (m.gabinete_id) {
      const c2 = get(`SELECT m.id FROM marcacoes m WHERE m.gabinete_id=? AND m.inicio < ? AND m.fim > ? AND m.id != ? AND m.estado_id NOT IN ${inativas}`,
        m.gabinete_id, m.fim, m.inicio, id || 0);
      if (c2) throw new HttpError(409, 'O gabinete já está ocupado nesse horário.');
    }
    const fer = feriadosAno(Number(m.inicio.slice(0, 4))).find(f => f.data === m.inicio.slice(0, 10));
    if (fer) throw new HttpError(409, `O dia escolhido é feriado (${fer.nome}).`);
    const bl = get('SELECT * FROM bloqueios WHERE (medico_id=? OR medico_id IS NULL) AND inicio < ? AND fim > ?', m.medico_id, m.fim, m.inicio);
    if (bl) throw new HttpError(409, `Agenda bloqueada nesse horário (${TIPOS_BLOQ[bl.tipo] || bl.tipo}${bl.motivo ? ': ' + bl.motivo : ''}).`);
  }
  if (id && o.inicio && o.inicio !== atual.inicio) o.remarcacoes = (atual.remarcacoes || 0) + 1;
  o.alterado_por = user.id; o.alterado_em = agora();
  if (id) { update('marcacoes', id, o); D.log(user.id, 'editar marcação', `id=${id}`); }
  else { o.criado_por = user.id; id = insert('marcacoes', o); D.log(user.id, 'criar marcação', `id=${id}`); }
  return get(`${AGENDA_SQL} WHERE m.id=?`, id);
}

const TIPOS_BLOQ = { ferias: 'Férias', congresso: 'Congresso/formação', ausencia: 'Ausência', fecho: 'Clínica fechada', outro: 'Bloqueio' };

// intervalos ocupados (marcações ativas + bloqueios) de um médico num dia
function ocupacaoDia(medicoId, dia) {
  const marc = all(`SELECT inicio, fim FROM marcacoes WHERE medico_id=? AND inicio LIKE ? AND estado_id NOT IN (SELECT id FROM estados WHERE categoria IN ('INATIVAS','FALTAS'))`, medicoId, dia + '%');
  const bl = all('SELECT inicio, fim FROM bloqueios WHERE (medico_id=? OR medico_id IS NULL) AND inicio <= ? AND fim >= ?', medicoId, dia + 'T23:59', dia + 'T00:00');
  return [...marc, ...bl];
}
const hhmm = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

// ---------- documentos (faturação) ----------
const TIPOS_DOC = { FT: 'Fatura', FR: 'Fatura-Recibo', RC: 'Recibo', NC: 'Nota de Crédito' };

function proximoNumero(tipo, data) {
  const ano = Number(String(data).slice(0, 4));
  let s = get('SELECT * FROM series WHERE tipo=? AND ano=?', tipo, ano);
  if (!s) { run('INSERT INTO series (tipo, ano, prefixo, ultimo) VALUES (?,?,?,0)', tipo, ano, `${tipo} ${ano}/`); s = get('SELECT * FROM series WHERE tipo=? AND ano=?', tipo, ano); }
  const n = s.ultimo + 1;
  run('UPDATE series SET ultimo=? WHERE id=?', n, s.id);
  return `${s.prefixo}${n}`;
}

function resolveIva(l) {
  let v = l.iva_id ? get('SELECT * FROM ivas WHERE id=?', l.iva_id) : null;
  if (!v) {
    const taxa = Number(l.iva) || 0;
    v = get("SELECT * FROM ivas WHERE ativo=1 AND taxa=? ORDER BY CASE regiao WHEN 'PT' THEN 0 ELSE 1 END, id LIMIT 1", taxa)
      || { id: null, taxa, isencao_cod: null, isencao_motivo: null };
  }
  return v;
}
function calcLinha(l) {
  const qtd = Number(l.qtd) || 1, preco = Number(l.preco) || 0, desc = Number(l.desconto_pct) || 0;
  const v = resolveIva(l); const iva = Number(v.taxa) || 0;
  const base = r2(qtd * preco * (1 - desc / 100));
  return { base, iva: r2(base * iva / 100), qtd, preco, desc, ivaPct: iva, ivaId: v.id,
    isCod: iva === 0 ? v.isencao_cod : null, isMot: iva === 0 ? v.isencao_motivo : null };
}

function criarDocumento(body, user) {
  const tipo = body.tipo;
  if (!['FT', 'FR', 'NC'].includes(tipo)) throw new HttpError(400, 'Tipo de documento inválido');
  if (!body.paciente_id) throw new HttpError(400, 'Escolha o paciente');
  const linhas = Array.isArray(body.linhas) ? body.linhas.filter(l => l.descricao) : [];
  if (!linhas.length) throw new HttpError(400, 'O documento não tem linhas');
  const data = body.data || today();
  return tx(() => {
    let tb = 0, ti = 0;
    const calc = linhas.map(l => { const c = calcLinha(l); tb += c.base; ti += c.iva; return { l, c }; });
    tb = r2(tb); ti = r2(ti); const total = r2(tb + ti);
    const numero = proximoNumero(tipo, data);
    const docId = insert('documentos', {
      tipo, numero, paciente_id: body.paciente_id, entidade_id: body.entidade_id || null, medico_id: body.medico_id || null,
      data, total_base: tb, total_iva: ti, total, notas: body.notas || null, user_id: user.id, ref_documento_id: body.ref_documento_id || null,
    });
    for (const { c } of calc) if (c.ivaPct === 0 && !c.isCod) throw new HttpError(400, 'Linha com IVA a 0% sem motivo de isenção. Configure-o na tabela de IVA.');
    for (const { l, c } of calc) {
      insert('documento_linhas', { documento_id: docId, iva_id: c.ivaId, isencao_cod: c.isCod, isencao_motivo: c.isMot, servico_id: l.servico_id || null, tratamento_id: l.tratamento_id || null,
        descricao: l.descricao, dente: l.dente || null, qtd: c.qtd, preco: c.preco, desconto_pct: c.desc, iva: c.ivaPct, total: r2(c.base + c.iva) });
      if (l.tratamento_id && tipo !== 'NC') run("UPDATE tratamentos SET documento_id=?, estado=CASE WHEN estado='planeado' THEN 'realizado' ELSE estado END, data=COALESCE(data, ?) WHERE id=?", docId, data, l.tratamento_id);
      if (l.tratamento_id && tipo === 'NC') run('UPDATE tratamentos SET documento_id=NULL WHERE id=?', l.tratamento_id);
    }
    if (tipo === 'FR') {
      insert('pagamentos', { paciente_id: body.paciente_id, documento_id: docId, recibo_id: docId, data, valor: total, metodo: body.metodo || 'Numerário' });
    }
    D.log(user.id, `emitir ${tipo}`, numero);
    return docComLinhas(docId);
  });
}

function criarRecibo(body, user) {
  const valor = r2(body.valor);
  if (!body.paciente_id) throw new HttpError(400, 'Escolha o paciente');
  if (!(valor > 0)) throw new HttpError(400, 'Valor inválido');
  const data = body.data || today();
  return tx(() => {
    const numero = proximoNumero('RC', data);
    const docId = insert('documentos', { tipo: 'RC', numero, paciente_id: body.paciente_id, data, total_base: valor, total_iva: 0, total: valor,
      notas: body.notas || null, user_id: user.id, ref_documento_id: body.documento_id || null });
    insert('documento_linhas', { documento_id: docId, descricao: body.documento_id ? `Pagamento ref. ${get('SELECT numero FROM documentos WHERE id=?', body.documento_id)?.numero || ''}` : 'Pagamento por conta',
      qtd: 1, preco: valor, total: valor });
    insert('pagamentos', { paciente_id: body.paciente_id, documento_id: body.documento_id || null, recibo_id: docId, data, valor, metodo: body.metodo || 'Numerário', notas: body.notas || null });
    D.log(user.id, 'emitir RC', numero);
    return docComLinhas(docId);
  });
}

function anularDocumento(id, user, motivo) {
  const d = get('SELECT * FROM documentos WHERE id=?', id);
  if (!d) throw new HttpError(404, 'Documento não encontrado');
  if (d.estado === 'anulado') throw new HttpError(400, 'Documento já anulado');
  tx(() => {
    run("UPDATE documentos SET estado='anulado', notas=COALESCE(notas,'') || ? WHERE id=?", `\nAnulado: ${motivo || ''}`, id);
    run("UPDATE pagamentos SET estado='anulado' WHERE recibo_id=?", id);
    if (d.tipo !== 'NC') run('UPDATE tratamentos SET documento_id=NULL WHERE documento_id=?', id);
  });
  D.log(user.id, 'anular documento', d.numero);
  return docComLinhas(id);
}

function docComLinhas(id) {
  const d = get(`SELECT d.*, p.nome paciente_nome, p.nif paciente_nif, p.morada paciente_morada, p.cod_postal paciente_cp, p.localidade paciente_localidade,
    p.numero paciente_numero, md.nome medico_nome, e.nome entidade_nome, u.nome user_nome
    FROM documentos d LEFT JOIN pacientes p ON p.id=d.paciente_id LEFT JOIN medicos md ON md.id=d.medico_id LEFT JOIN entidades e ON e.id=d.entidade_id
    LEFT JOIN users u ON u.id=d.user_id WHERE d.id=?`, id);
  if (!d) throw new HttpError(404, 'Documento não encontrado');
  d.linhas = all('SELECT * FROM documento_linhas WHERE documento_id=? ORDER BY id', id);
  d.pagamentos = all("SELECT * FROM pagamentos WHERE recibo_id=? OR documento_id=?", id, id);
  d.tipo_nome = TIPOS_DOC[d.tipo] || d.tipo;
  return d;
}

function saldoPaciente(pid) {
  const deb = get("SELECT COALESCE(SUM(total),0) s FROM documentos WHERE paciente_id=? AND estado='emitido' AND tipo IN ('FT','FR')", pid).s;
  const nc = get("SELECT COALESCE(SUM(total),0) s FROM documentos WHERE paciente_id=? AND estado='emitido' AND tipo='NC'", pid).s;
  const pag = get("SELECT COALESCE(SUM(valor),0) s FROM pagamentos WHERE paciente_id=? AND estado='ativo'", pid).s;
  return { faturado: r2(deb), creditos: r2(nc), pago: r2(pag), saldo: r2(deb - nc - pag) };
}

function contaCorrente(pid) {
  const mov = [];
  for (const d of all("SELECT * FROM documentos WHERE paciente_id=? ORDER BY data, id", pid)) {
    const ativo = d.estado === 'emitido';
    if (d.tipo === 'FT' || d.tipo === 'FR') mov.push({ data: d.data, documento_id: d.id, numero: d.numero, tipo: d.tipo, descricao: TIPOS_DOC[d.tipo], debito: d.total, credito: 0, anulado: !ativo });
    if (d.tipo === 'NC') mov.push({ data: d.data, documento_id: d.id, numero: d.numero, tipo: d.tipo, descricao: 'Nota de Crédito', debito: 0, credito: d.total, anulado: !ativo });
    if (d.tipo === 'FR' || d.tipo === 'RC') {
      const p = get('SELECT COALESCE(SUM(valor),0) v, MAX(metodo) metodo FROM pagamentos WHERE recibo_id=?', d.id);
      mov.push({ data: d.data, documento_id: d.id, numero: d.numero, tipo: d.tipo, descricao: `Pagamento (${p.metodo || '-'})`, debito: 0, credito: p.v, anulado: !ativo });
    }
  }
  let saldo = 0;
  for (const m of mov) { if (!m.anulado) saldo = r2(saldo + m.debito - m.credito); m.saldo = saldo; }
  return { movimentos: mov, ...saldoPaciente(pid) };
}

// ---------- orçamentos ----------
function guardarOrcamento(id, body, user) {
  const linhas = Array.isArray(body.linhas) ? body.linhas.filter(l => l.descricao) : [];
  if (!body.paciente_id) throw new HttpError(400, 'Escolha o paciente');
  return tx(() => {
    let total = 0;
    for (const l of linhas) { const c = calcLinha(l); total += c.base + c.iva; }
    const o = pick(body, ['paciente_id', 'medico_id', 'data', 'validade', 'estado', 'notas']);
    o.total = r2(total);
    if (!o.data) o.data = today();
    if (!o.validade) o.validade = D.addDays(o.data, Number(D.getConfig().validade_orcamento_dias) || 90);
    if (id) { update('orcamentos', id, o); run('DELETE FROM orcamento_linhas WHERE orcamento_id=?', id); }
    else { o.numero = proximoNumero('OR', o.data); id = insert('orcamentos', o); }
    for (const l of linhas) {
      const c = calcLinha(l);
      insert('orcamento_linhas', { orcamento_id: id, servico_id: l.servico_id || null, tratamento_id: l.tratamento_id || null, descricao: l.descricao, dente: l.dente || null,
        qtd: c.qtd, preco: c.preco, desconto_pct: c.desc, iva: c.ivaPct, iva_id: c.ivaId });
    }
    D.log(user.id, 'guardar orçamento', `id=${id}`);
    return orcamentoCompleto(id);
  });
}
function orcamentoCompleto(id) {
  const o = get(`SELECT o.*, p.nome paciente_nome, p.nif paciente_nif, p.numero paciente_numero, p.morada paciente_morada, p.cod_postal paciente_cp,
    p.localidade paciente_localidade, md.nome medico_nome FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id
    LEFT JOIN medicos md ON md.id=o.medico_id WHERE o.id=?`, id);
  if (!o) throw new HttpError(404, 'Orçamento não encontrado');
  o.linhas = all('SELECT * FROM orcamento_linhas WHERE orcamento_id=? ORDER BY id', id);
  return o;
}
function aceitarOrcamento(id, user) {
  const o = orcamentoCompleto(id);
  if (o.estado === 'aceite') throw new HttpError(400, 'Orçamento já aceite');
  tx(() => {
    run("UPDATE orcamentos SET estado='aceite' WHERE id=?", id);
    for (const l of o.linhas) {
      // linha criada a partir de um tratamento já planeado: liga-o ao orçamento em vez de duplicar
      const t = l.tratamento_id && get('SELECT id FROM tratamentos WHERE id=? AND paciente_id=? AND documento_id IS NULL', l.tratamento_id, o.paciente_id);
      if (t) { run('UPDATE tratamentos SET orcamento_id=?, preco=?, desconto_pct=?, iva=? WHERE id=?', id, l.preco, l.desconto_pct, l.iva, t.id); continue; }
      const n = Math.max(1, Math.round(l.qtd));
      for (let i = 0; i < n; i++) insert('tratamentos', { paciente_id: o.paciente_id, medico_id: o.medico_id, servico_id: l.servico_id, descricao: l.descricao,
        dente: l.dente, estado: 'planeado', preco: l.preco, desconto_pct: l.desconto_pct, iva: l.iva, orcamento_id: id });
    }
  });
  D.log(user.id, 'aceitar orçamento', o.numero);
  return orcamentoCompleto(id);
}

// ---------- stocks ----------
const SINAL = "CASE WHEN tipo IN ('entrada','ajuste+','transf_entrada') THEN qtd WHEN tipo IN ('saida','ajuste-','transf_saida') THEN -qtd ELSE qtd END";
function existencias(q) {
  const armFilter = q.get('armazem_id') ? 'AND m.armazem_id = ' + Number(q.get('armazem_id')) : '';
  const rows = all(`SELECT p.*, COALESCE((SELECT SUM(${SINAL}) FROM movimentos_stock m WHERE m.produto_id=p.id ${armFilter}),0) qtd,
    (SELECT MIN(validade) FROM (SELECT lote, validade, SUM(${SINAL}) s FROM movimentos_stock m WHERE m.produto_id=p.id AND validade IS NOT NULL ${armFilter} GROUP BY lote, validade HAVING s > 0)) prox_validade
    FROM produtos p WHERE p.ativo=1 ORDER BY p.nome`);
  const lim = D.addDays(today(), 60);
  for (const r of rows) {
    r.qtd = r2(r.qtd);
    r.alertas = [];
    if (r.qtd < 0) r.alertas.push('negativo');
    else if (r.qtd < r.stock_min) r.alertas.push('minimo');
    else if (r.qtd < r.stock_ideal) r.alertas.push('ideal');
    if (r.prox_validade && r.prox_validade <= lim) r.alertas.push('validade');
  }
  return rows;
}
function lotes(pid) {
  return all(`SELECT m.lote, m.validade, a.nome armazem, m.armazem_id, SUM(${SINAL}) qtd FROM movimentos_stock m LEFT JOIN armazens a ON a.id=m.armazem_id
    WHERE m.produto_id=? GROUP BY m.lote, m.validade, m.armazem_id HAVING qtd != 0 ORDER BY m.validade`, pid);
}

// ---------- estatísticas ----------
function estatisticas(q) {
  const de = q.get('de') || today().slice(0, 8) + '01';
  const ate = q.get('ate') || today();
  const ateFim = ate + 'T23:59';
  const porEstado = all(`SELECT e.nome, e.cor, COUNT(*) n FROM marcacoes m JOIN estados e ON e.id=m.estado_id WHERE m.inicio BETWEEN ? AND ? GROUP BY e.id ORDER BY e.ordem`, de, ateFim);
  const porMedico = all(`SELECT md.nome, md.cor, COUNT(*) n,
    SUM(CASE WHEN e.categoria='REALIZADAS' THEN 1 ELSE 0 END) realizadas, SUM(CASE WHEN e.categoria='FALTAS' THEN 1 ELSE 0 END) faltas
    FROM marcacoes m JOIN medicos md ON md.id=m.medico_id LEFT JOIN estados e ON e.id=m.estado_id WHERE m.inicio BETWEEN ? AND ? GROUP BY md.id ORDER BY n DESC`, de, ateFim);
  const fatMedico = all(`SELECT COALESCE(md.nome,'(sem médico)') nome, md.cor, md.comissao_pct, ROUND(SUM(CASE WHEN d.tipo='NC' THEN -l.total ELSE l.total END),2) total
    FROM documento_linhas l JOIN documentos d ON d.id=l.documento_id LEFT JOIN tratamentos t ON t.id=l.tratamento_id
    LEFT JOIN medicos md ON md.id=COALESCE(t.medico_id, d.medico_id)
    WHERE d.estado='emitido' AND d.tipo IN ('FT','FR','NC') AND d.data BETWEEN ? AND ? GROUP BY md.id ORDER BY total DESC`, de, ate);
  for (const f of fatMedico) f.comissao = r2(f.total * (f.comissao_pct || 0) / 100);
  const fatMes = all(`SELECT substr(data,1,7) mes, ROUND(SUM(CASE WHEN tipo='NC' THEN -total ELSE total END),2) total FROM documentos
    WHERE estado='emitido' AND tipo IN ('FT','FR','NC') AND data BETWEEN ? AND ? GROUP BY mes ORDER BY mes`, de, ate);
  const recebMetodo = all(`SELECT COALESCE(metodo,'-') metodo, ROUND(SUM(valor),2) total FROM pagamentos WHERE estado='ativo' AND data BETWEEN ? AND ? GROUP BY metodo ORDER BY total DESC`, de, ate);
  const topServicos = all(`SELECT COALESCE(s.nome, t.descricao) nome, COUNT(*) n, ROUND(SUM(t.preco*(1-COALESCE(t.desconto_pct,0)/100.0)),2) valor FROM tratamentos t LEFT JOIN servicos s ON s.id=t.servico_id
    WHERE t.estado='realizado' AND t.data BETWEEN ? AND ? GROUP BY COALESCE(s.nome, t.descricao) ORDER BY n DESC LIMIT 10`, de, ate);
  const novos = get(`SELECT COUNT(*) n FROM pacientes WHERE substr(criado_em,1,10) BETWEEN ? AND ?`, de, ate).n;
  const razoes = all(`SELECT r.descricao nome, COUNT(*) n FROM pacientes p JOIN razoes_visita r ON r.id=p.razao_visita_id WHERE substr(p.criado_em,1,10) BETWEEN ? AND ? GROUP BY r.id ORDER BY n DESC`, de, ate);
  const totalMarc = porEstado.reduce((a, b) => a + b.n, 0);
  const faltas = all(`SELECT COUNT(*) n FROM marcacoes m JOIN estados e ON e.id=m.estado_id WHERE e.categoria='FALTAS' AND m.inicio BETWEEN ? AND ?`, de, ateFim)[0].n;
  const faturado = r2(fatMes.reduce((a, b) => a + b.total, 0));
  const recebido = r2(recebMetodo.reduce((a, b) => a + b.total, 0));
  const emDivida = r2(all('SELECT id FROM pacientes').reduce((a, p) => { const s = saldoPaciente(p.id).saldo; return a + (s > 0 ? s : 0); }, 0));
  return { de, ate, porEstado, porMedico, fatMedico, fatMes, recebMetodo, topServicos, razoes,
    kpi: { marcacoes: totalMarc, faltas, taxaFaltas: totalMarc ? r2(faltas * 100 / totalMarc) : 0, novos, faturado, recebido, emDivida } };
}

// ---------- SMS ----------
function renderSms(texto, ctx) {
  return String(texto).replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? ctx[k] : m));
}
function prepararSms(body, user) {
  const modelo = get('SELECT * FROM sms_modelos WHERE id=?', body.modelo_id);
  if (!modelo) throw new HttpError(400, 'Escolha um modelo de SMS');
  const cfg = D.getConfig();
  const out = [];
  const add = (p, extra) => {
    const tel = p.telemovel || p.telefone;
    const ctx = { nome: p.nome, primeiro_nome: (p.nome || '').split(' ')[0], clinica: cfg.clinica_nome, telefone_clinica: cfg.clinica_telefone, ...extra };
    const texto = renderSms(modelo.texto, ctx);
    const estado = !tel ? 'sem número' : !p.sms_ok ? 'sem consentimento' : 'preparado';
    run('INSERT INTO sms_historico (paciente_id, telefone, texto, data, estado, user_id) VALUES (?,?,?,datetime(\'now\',\'localtime\'),?,?)', p.id, tel || '', texto, estado, user.id);
    out.push({ paciente_id: p.id, nome: p.nome, telefone: tel, texto, estado });
  };
  tx(() => {
    for (const mid of body.marcacao_ids || []) {
      const m = get(`${AGENDA_SQL} WHERE m.id=?`, mid); if (!m) continue;
      const p = get('SELECT * FROM pacientes WHERE id=?', m.paciente_id);
      const [d, h] = m.inicio.split('T');
      add(p, { data: d.split('-').reverse().join('/'), hora: h, medico: m.medico_nome, servico: m.servico_nome || '' });
    }
    for (const pid of body.paciente_ids || []) { const p = get('SELECT * FROM pacientes WHERE id=?', pid); if (p) add(p, {}); }
  });
  return out;
}

// ---------- backup ----------
function backup(res) {
  const tmp = path.join(os.tmpdir(), `clinica-backup-${Date.now()}.db`);
  D.db.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Content-Disposition': `attachment; filename="clinica-backup-${stamp}.db"` });
  const s = fs.createReadStream(tmp);
  s.pipe(res);
  s.on('close', () => fs.unlink(tmp, () => {}));
}

// ---------- listagens ----------
function listagem(tipo, q) {
  const de = q.get('de') || today().slice(0, 8) + '01', ate = q.get('ate') || today(), ateF = ate + 'T23:59';
  const f = k => q.get(k) || null;
  const M = 'money', D_ = 'date', DT = 'dt', N = 'num';
  const filtro = (where, params, col, key) => { if (f(key)) { where.push(`${col} = ?`); params.push(f(key)); } };
  const AG = `SELECT m.*, p.nome paciente_nome, p.numero paciente_numero, p.telemovel, md.nome medico_nome, s.nome servico_nome, e.nome estado_nome,
    e.categoria, en.nome entidade_nome, u.nome criado_por_nome, g.nome gabinete_nome FROM marcacoes m JOIN pacientes p ON p.id=m.paciente_id
    LEFT JOIN medicos md ON md.id=m.medico_id LEFT JOIN servicos s ON s.id=m.servico_id LEFT JOIN estados e ON e.id=m.estado_id
    LEFT JOIN entidades en ON en.id=p.entidade_id LEFT JOIN users u ON u.id=m.criado_por LEFT JOIN gabinetes g ON g.id=m.gabinete_id`;
  const agCols = [{ k: 'inicio', h: 'Data/hora', t: DT }, { k: 'paciente_nome', h: 'Paciente' }, { k: 'telemovel', h: 'Telemóvel' },
    { k: 'medico_nome', h: 'Médico' }, { k: 'servico_nome', h: 'Serviço' }, { k: 'gabinete_nome', h: 'Gabinete' }, { k: 'estado_nome', h: 'Estado' }];
  switch (tipo) {
    case 'agenda': {
      const por = f('por') || 'medico';
      const where = ['m.inicio BETWEEN ? AND ?']; const params = [de, ateF];
      filtro(where, params, 'm.medico_id', 'medico_id'); filtro(where, params, 'p.entidade_id', 'entidade_id');
      filtro(where, params, 'm.criado_por', 'user_id'); filtro(where, params, 'm.paciente_id', 'paciente_id');
      const grupo = { medico: 'medico_nome', entidade: 'entidade_nome', utilizador: 'criado_por_nome', paciente: 'paciente_nome' }[por] || 'medico_nome';
      const rows = all(`${AG} WHERE ${where.join(' AND ')} ORDER BY ${grupo === 'paciente_nome' ? 'p.nome' : grupo}, m.inicio`, ...params);
      for (const r of rows) { r.entidade_nome ||= 'Particular'; r.criado_por_nome ||= '—'; }
      return { titulo: 'Marcações por ' + { medico: 'médico', entidade: 'entidade', utilizador: 'utilizador', paciente: 'paciente' }[por], grupo,
        cols: [...agCols, { k: 'entidade_nome', h: 'Entidade' }, { k: 'criado_por_nome', h: 'Marcado por' }], rows };
    }
    case 'confirmar': {
      const rows = all(`${AG} WHERE m.inicio BETWEEN ? AND ? AND e.nome IN ('Marcada','A Confirmar') ORDER BY m.inicio`, de, ateF);
      return { titulo: 'Consultas por confirmar', cols: agCols, rows };
    }
    case 'remarcacoes': {
      const rows = all(`${AG} WHERE m.inicio BETWEEN ? AND ? AND (m.remarcacoes > 0 OR e.categoria='INATIVAS') ORDER BY m.inicio`, de, ateF);
      return { titulo: 'Remarcações e desmarcações', cols: [...agCols, { k: 'remarcacoes', h: 'N.º remarcações', t: N }, { k: 'notas', h: 'Notas' }], rows };
    }
    case 'faltas': {
      const rows = all(`${AG} WHERE m.inicio BETWEEN ? AND ? AND e.categoria='FALTAS' ORDER BY m.inicio`, de, ateF);
      return { titulo: 'Faltas', cols: agCols, rows };
    }
    case 'ocupacao': {
      const cfg = D.getConfig(); const toM = h => { const [a, b] = h.split(':').map(Number); return a * 60 + b; };
      const aberto = toM(cfg.agenda_fim || '20:00') - toM(cfg.agenda_inicio || '08:00');
      const dias = (cfg.agenda_dias || '1,2,3,4,5').split(',').map(Number);
      const meds = all('SELECT id, nome FROM medicos WHERE ativo=1 ORDER BY nome').filter(m => !f('medico_id') || String(m.id) === f('medico_id'));
      const rows = [];
      for (const md of meds) {
        let minDisp = 0, minOcup = 0, n = 0;
        for (let d = new Date(de + 'T12:00:00'); d <= new Date(ate + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
          const dia = d.toISOString().slice(0, 10);
          if (!dias.includes(d.getDay()) || feriadosAno(d.getFullYear()).some(x => x.data === dia)) continue;
          const bl = all('SELECT inicio, fim FROM bloqueios WHERE (medico_id=? OR medico_id IS NULL) AND inicio <= ? AND fim >= ?', md.id, dia + 'T23:59', dia + 'T00:00');
          const abre = `${dia}T${cfg.agenda_inicio || '08:00'}`, fecha = `${dia}T${cfg.agenda_fim || '20:00'}`;
          const blMin = bl.reduce((a, b) => { const s0 = b.inicio > abre ? b.inicio : abre, e0 = b.fim < fecha ? b.fim : fecha; return a + Math.max(0, (new Date(e0) - new Date(s0)) / 60000); }, 0);
          minDisp += Math.max(0, aberto - blMin);
          const mm = all(`SELECT inicio, fim FROM marcacoes WHERE medico_id=? AND inicio LIKE ? AND estado_id NOT IN (SELECT id FROM estados WHERE categoria IN ('INATIVAS','FALTAS'))`, md.id, dia + '%');
          n += mm.length; minOcup += mm.reduce((a, m) => a + (new Date(m.fim) - new Date(m.inicio)) / 60000, 0);
        }
        rows.push({ medico_nome: md.nome, marcacoes: n, horas_disp: r2(minDisp / 60), horas_ocup: r2(minOcup / 60), taxa: minDisp ? r2(minOcup * 100 / minDisp) : 0 });
      }
      return { titulo: 'Taxa de ocupação da agenda', cols: [{ k: 'medico_nome', h: 'Médico' }, { k: 'marcacoes', h: 'Marcações', t: N },
        { k: 'horas_disp', h: 'Horas disponíveis', t: N }, { k: 'horas_ocup', h: 'Horas marcadas', t: N }, { k: 'taxa', h: 'Ocupação %', t: N }], rows };
    }
    case 'ausencias': {
      const rows = all(`SELECT b.*, COALESCE(md.nome,'Todos (clínica)') medico_nome FROM bloqueios b LEFT JOIN medicos md ON md.id=b.medico_id
        WHERE b.inicio <= ? AND b.fim >= ? ORDER BY b.inicio`, ateF, de + 'T00:00').map(b => ({ ...b, tipo_nome: TIPOS_BLOQ[b.tipo] || b.tipo }));
      return { titulo: 'Férias e ausências dos médicos', cols: [{ k: 'medico_nome', h: 'Médico' }, { k: 'tipo_nome', h: 'Tipo' }, { k: 'inicio', h: 'Início', t: DT }, { k: 'fim', h: 'Fim', t: DT }, { k: 'motivo', h: 'Motivo' }], rows };
    }
    case 'espera': {
      const rows = all(`SELECT le.*, p.nome paciente_nome, p.telemovel, md.nome medico_nome, s.nome servico_nome FROM lista_espera le
        JOIN pacientes p ON p.id=le.paciente_id LEFT JOIN medicos md ON md.id=le.medico_id LEFT JOIN servicos s ON s.id=le.servico_id WHERE le.estado='aguarda' ORDER BY le.criado_em`);
      return { titulo: 'Lista de espera', cols: [{ k: 'criado_em', h: 'Desde', t: D_ }, { k: 'paciente_nome', h: 'Paciente' }, { k: 'telemovel', h: 'Telemóvel' },
        { k: 'medico_nome', h: 'Médico' }, { k: 'servico_nome', h: 'Serviço' }, { k: 'preferencia', h: 'Preferência' }, { k: 'notas', h: 'Notas' }], rows };
    }
    case 'caixa': {
      const where = ["pg.estado='ativo'", 'pg.data BETWEEN ? AND ?']; const params = [de, ate];
      filtro(where, params, 'd.user_id', 'user_id'); filtro(where, params, 'd.medico_id', 'medico_id');
      const rows = all(`SELECT pg.data, pg.valor, pg.metodo, d.numero, p.nome paciente_nome, u.nome user_nome, md.nome medico_nome FROM pagamentos pg
        LEFT JOIN documentos d ON d.id=pg.recibo_id LEFT JOIN pacientes p ON p.id=pg.paciente_id LEFT JOIN users u ON u.id=d.user_id
        LEFT JOIN medicos md ON md.id=d.medico_id WHERE ${where.join(' AND ')} ORDER BY pg.metodo, pg.data, pg.id`, ...params);
      return { titulo: 'Mapa de caixa', grupo: 'metodo', cols: [{ k: 'data', h: 'Data', t: D_ }, { k: 'numero', h: 'Documento' }, { k: 'paciente_nome', h: 'Paciente' },
        { k: 'medico_nome', h: 'Médico' }, { k: 'user_nome', h: 'Utilizador' }, { k: 'metodo', h: 'Meio de pagamento' }, { k: 'valor', h: 'Valor', t: M }], rows };
    }
    case 'comissoes': {
      const where = ["d.estado='emitido'", "d.tipo IN ('FT','FR','NC')", 'd.data BETWEEN ? AND ?']; const params = [de, ate];
      if (f('medico_id')) { where.push('COALESCE(t.medico_id, d.medico_id) = ?'); params.push(f('medico_id')); }
      const rows = all(`SELECT d.data, d.numero, p.nome paciente_nome, l.descricao, COALESCE(md.nome,'(sem médico)') medico_nome, COALESCE(md.comissao_pct,0) pct,
        ROUND(CASE WHEN d.tipo='NC' THEN -l.total ELSE l.total END, 2) valor FROM documento_linhas l JOIN documentos d ON d.id=l.documento_id
        LEFT JOIN pacientes p ON p.id=d.paciente_id LEFT JOIN tratamentos t ON t.id=l.tratamento_id LEFT JOIN medicos md ON md.id=COALESCE(t.medico_id, d.medico_id)
        WHERE ${where.join(' AND ')} ORDER BY medico_nome, d.data`, ...params).map(r => ({ ...r, comissao: r2(r.valor * r.pct / 100) }));
      return { titulo: 'Comissões dos médicos', grupo: 'medico_nome', cols: [{ k: 'data', h: 'Data', t: D_ }, { k: 'numero', h: 'Documento' }, { k: 'paciente_nome', h: 'Paciente' },
        { k: 'descricao', h: 'Descrição' }, { k: 'valor', h: 'Faturado', t: M }, { k: 'pct', h: '%', t: N }, { k: 'comissao', h: 'Comissão', t: M }], rows };
    }
    case 'pendentes': {
      const rows = all('SELECT id, numero, nome, telemovel FROM pacientes ORDER BY nome').map(p => ({ ...p, ...saldoPaciente(p.id) })).filter(p => p.saldo > 0.004);
      return { titulo: 'Pacientes com valores pendentes', cols: [{ k: 'numero', h: 'N.º' }, { k: 'nome', h: 'Paciente' }, { k: 'telemovel', h: 'Telemóvel' },
        { k: 'faturado', h: 'Faturado', t: M }, { k: 'pago', h: 'Pago', t: M }, { k: 'saldo', h: 'Em dívida', t: M }], rows };
    }
    case 'producao': {
      const where = ["t.estado='realizado'", 't.data BETWEEN ? AND ?']; const params = [de, ate];
      filtro(where, params, 't.medico_id', 'medico_id');
      const rows = all(`SELECT t.data, p.nome paciente_nome, t.descricao, t.dente, COALESCE(md.nome,'(sem médico)') medico_nome,
        ROUND(t.preco*(1-COALESCE(t.desconto_pct,0)/100.0)*(1+COALESCE(t.iva,0)/100.0),2) valor, d.numero documento FROM tratamentos t
        JOIN pacientes p ON p.id=t.paciente_id LEFT JOIN medicos md ON md.id=t.medico_id LEFT JOIN documentos d ON d.id=t.documento_id
        WHERE ${where.join(' AND ')} ORDER BY medico_nome, t.data`, ...params).map(r => ({ ...r, documento: r.documento || 'por faturar' }));
      return { titulo: 'Produção (tratamentos realizados)', grupo: 'medico_nome', cols: [{ k: 'data', h: 'Data', t: D_ }, { k: 'paciente_nome', h: 'Paciente' },
        { k: 'descricao', h: 'Tratamento' }, { k: 'dente', h: 'Dente' }, { k: 'documento', h: 'Faturado em' }, { k: 'valor', h: 'Valor', t: M }], rows };
    }
    case 'orcamentos': {
      const where = ['o.data BETWEEN ? AND ?']; const params = [de, ate];
      if (f('estado') === 'expirado') where.push(`o.estado='aberto' AND o.validade < '${today()}'`);
      else filtro(where, params, 'o.estado', 'estado');
      filtro(where, params, 'o.medico_id', 'medico_id');
      const rows = all(`SELECT o.numero, o.data, o.validade, o.estado, o.total, p.nome paciente_nome, md.nome medico_nome FROM orcamentos o
        JOIN pacientes p ON p.id=o.paciente_id LEFT JOIN medicos md ON md.id=o.medico_id WHERE ${where.join(' AND ')} ORDER BY o.data`, ...params);
      return { titulo: 'Orçamentos', cols: [{ k: 'numero', h: 'Número' }, { k: 'data', h: 'Data', t: D_ }, { k: 'paciente_nome', h: 'Paciente' }, { k: 'medico_nome', h: 'Médico' },
        { k: 'validade', h: 'Validade', t: D_ }, { k: 'estado', h: 'Estado' }, { k: 'total', h: 'Total', t: M }], rows };
    }
    case 'movimentos': {
      const where = ['d.data BETWEEN ? AND ?']; const params = [de, ate];
      filtro(where, params, 'd.medico_id', 'medico_id'); filtro(where, params, 'd.user_id', 'user_id'); filtro(where, params, 'd.paciente_id', 'paciente_id');
      const docs = all(`SELECT d.*, p.nome paciente_nome, md.nome medico_nome, u.nome user_nome FROM documentos d LEFT JOIN pacientes p ON p.id=d.paciente_id
        LEFT JOIN medicos md ON md.id=d.medico_id LEFT JOIN users u ON u.id=d.user_id WHERE ${where.join(' AND ')} ORDER BY d.data DESC, d.id DESC`, ...params);
      const rows = [];
      for (const d of docs) {
        const base = { data: d.data, numero: d.numero, paciente_nome: d.paciente_nome, medico_nome: d.medico_nome, user_nome: d.user_nome, estado: d.estado };
        if (d.tipo === 'FR' || d.tipo === 'RC') {
          const pg = get('SELECT COALESCE(SUM(valor),0) v, MAX(metodo) mp FROM pagamentos WHERE recibo_id=?', d.id);
          rows.push({ ...base, dc: 'C', descricao: 'Pagamento', mp: pg.mp, credito: pg.v, debito: 0 });
        }
        if (d.tipo === 'FT' || d.tipo === 'FR') rows.push({ ...base, dc: 'D', descricao: TIPOS_DOC[d.tipo], mp: '', debito: d.total, credito: 0 });
        if (d.tipo === 'NC') rows.push({ ...base, dc: 'C', descricao: 'Nota de crédito', mp: '', debito: 0, credito: d.total });
      }
      return { titulo: 'Movimentos de conta corrente (global)', cols: [{ k: 'data', h: 'Data', t: D_ }, { k: 'numero', h: 'Documento' }, { k: 'dc', h: 'D/C' },
        { k: 'descricao', h: 'Descrição' }, { k: 'mp', h: 'MP' }, { k: 'paciente_nome', h: 'Paciente' }, { k: 'medico_nome', h: 'Médico' },
        { k: 'user_nome', h: 'Utilizador' }, { k: 'estado', h: 'Estado' }, { k: 'debito', h: 'Débito', t: M }, { k: 'credito', h: 'Crédito', t: M }], rows };
    }
  }
  throw new HttpError(404, 'Listagem desconhecida');
}

// ---------- router da API ----------
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // remove 'api'
  const q = url.searchParams;
  const m = req.method;
  const body = ['POST', 'PUT'].includes(m) ? await readBody(req) : {};

  if (parts[0] === 'login' && m === 'POST') {
    const u = get('SELECT * FROM users WHERE login=? AND ativo=1', String(body.login || '').trim());
    if (!u || !D.checkPassword(String(body.password || ''), u.pass_hash)) { D.log(null, 'login falhado', String(body.login || '')); throw new HttpError(401, 'Utilizador ou palavra-passe incorretos'); }
    const token = crypto.randomBytes(24).toString('hex');
    run("INSERT INTO sessions VALUES (?,?,datetime('now','localtime'))", token, u.id);
    D.log(u.id, 'login', '');
    return send(res, 200, { id: u.id, nome: u.nome, perfil: u.perfil, medico_id: u.medico_id },
      { 'Set-Cookie': `sid=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${60 * 60 * 12}` });
  }

  const user = currentUser(req);
  if (!user) throw new HttpError(401, 'Sessão expirada. Inicie sessão novamente.');

  const [r0, r1, r2_, r3] = parts;
  const id = r1 && /^\d+$/.test(r1) ? Number(r1) : null;

  switch (r0) {
    case 'logout': run('DELETE FROM sessions WHERE token=?', parseCookies(req).sid); return { ok: true };
    case 'me': return user;
    case 'password': {
      const u = get('SELECT * FROM users WHERE id=?', user.id);
      if (!D.checkPassword(String(body.atual || ''), u.pass_hash)) throw new HttpError(400, 'Palavra-passe atual incorreta');
      if (String(body.nova || '').length < 4) throw new HttpError(400, 'A nova palavra-passe deve ter pelo menos 4 caracteres');
      run('UPDATE users SET pass_hash=? WHERE id=?', D.hashPassword(body.nova), user.id);
      return { ok: true };
    }
    case 'config':
      if (m === 'GET') return D.getConfig();
      requireAdmin(user);
      for (const [k, v] of Object.entries(body)) run('INSERT INTO config VALUES (?,?) ON CONFLICT(chave) DO UPDATE SET valor=excluded.valor', k, v == null ? '' : String(v));
      D.log(user.id, 'alterar configuração', Object.keys(body).join(','));
      return D.getConfig();
    case 'lookups': // dados de referência para a interface
      return {
        medicos: all('SELECT * FROM medicos ORDER BY nome'), gabinetes: all('SELECT * FROM gabinetes ORDER BY nome'),
        estados: all('SELECT * FROM estados ORDER BY ordem, id'), servicos: all('SELECT * FROM servicos ORDER BY codigo, nome'),
        especialidades: all('SELECT * FROM especialidades ORDER BY nome'), razoes: all('SELECT * FROM razoes_visita ORDER BY abreviatura'),
        entidades: all('SELECT * FROM entidades ORDER BY nome'), laboratorios: all('SELECT * FROM laboratorios ORDER BY nome'),
        armazens: all('SELECT * FROM armazens ORDER BY id'), sms_modelos: all('SELECT * FROM sms_modelos ORDER BY nome'),
        ivas: all('SELECT * FROM ivas ORDER BY regiao, taxa'), isencoes: D.ISENCOES,
        tipos_bloqueio: TIPOS_BLOQ, utilizadores: all('SELECT id, nome FROM users ORDER BY nome'),
        config: D.getConfig(),
      };
    case 'users': {
      requireAdmin(user);
      if (m === 'GET') return all('SELECT id, nome, login, perfil, medico_id, ativo FROM users ORDER BY nome');
      const o = pick(body, ['nome', 'login', 'perfil', 'medico_id', 'ativo']);
      if (body.password) o.pass_hash = D.hashPassword(String(body.password));
      if (m === 'POST') {
        if (!o.nome || !o.login || !o.pass_hash) throw new HttpError(400, 'Nome, login e palavra-passe são obrigatórios');
        try { return { id: insert('users', o) }; } catch { throw new HttpError(409, 'Esse login já existe'); }
      }
      if (m === 'PUT' && id) {
        if (id === user.id && o.ativo === 0) throw new HttpError(400, 'Não pode desativar o seu próprio utilizador');
        try { update('users', id, o); } catch { throw new HttpError(409, 'Esse login já existe'); }
        if (o.ativo === 0 || o.pass_hash) run('DELETE FROM sessions WHERE user_id=?', id);
        return { ok: true };
      }
      if (m === 'DELETE' && id) {
        if (id === user.id) throw new HttpError(400, 'Não pode eliminar o seu próprio utilizador');
        run('UPDATE users SET ativo=0 WHERE id=?', id); run('DELETE FROM sessions WHERE user_id=?', id); return { ok: true };
      }
      break;
    }
    case 't': return crud(m, r1, r2_ && /^\d+$/.test(r2_) ? Number(r2_) : null, q, body, user);

    case 'pacientes': {
      if (m === 'GET' && !id) {
        const s = (q.get('q') || '').trim();
        const where = []; const params = [];
        if (s) {
          const like = `%${s}%`;
          where.push('(p.nome LIKE ? OR p.nif LIKE ? OR p.telemovel LIKE ? OR p.telefone LIKE ? OR p.email LIKE ? OR CAST(p.numero AS TEXT) = ?)');
          params.push(like, like, like, like, like, s);
        }
        if (q.get('ativos') !== '0') where.push('p.ativo=1');
        return all(`SELECT p.id, p.numero, p.nome, p.nif, p.telemovel, p.telefone, p.email, p.data_nasc, p.localidade, p.ativo, md.nome medico_nome, e.nome entidade_nome
          FROM pacientes p LEFT JOIN medicos md ON md.id=p.medico_id LEFT JOIN entidades e ON e.id=p.entidade_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY p.nome LIMIT ${Number(q.get('limit')) || 200}`, ...params);
      }
      if (m === 'GET' && id && r2_ === 'resumo') {
        const p = get(`SELECT p.*, md.nome medico_nome, e.nome entidade_nome, r.descricao razao_nome FROM pacientes p LEFT JOIN medicos md ON md.id=p.medico_id
          LEFT JOIN entidades e ON e.id=p.entidade_id LEFT JOIN razoes_visita r ON r.id=p.razao_visita_id WHERE p.id=?`, id);
        if (!p) throw new HttpError(404, 'Paciente não encontrado');
        p.anamnese = get('SELECT * FROM anamnese WHERE paciente_id=?', id) || {};
        p.saldo = saldoPaciente(id);
        p.stats = get(`SELECT COUNT(*) total, SUM(CASE WHEN e.categoria='REALIZADAS' THEN 1 ELSE 0 END) realizadas,
          SUM(CASE WHEN e.categoria='FALTAS' THEN 1 ELSE 0 END) faltas, SUM(CASE WHEN e.categoria='INATIVAS' THEN 1 ELSE 0 END) inativas,
          SUM(CASE WHEN m.inicio >= ? AND e.categoria NOT IN ('INATIVAS','FALTAS') THEN 1 ELSE 0 END) futuras
          FROM marcacoes m LEFT JOIN estados e ON e.id=m.estado_id WHERE m.paciente_id=?`, today(), id);
        p.por_realizar = r2(get("SELECT COALESCE(SUM(preco*(1-COALESCE(desconto_pct,0)/100.0)*(1+COALESCE(iva,0)/100.0)),0) v FROM tratamentos WHERE paciente_id=? AND estado='planeado'", id).v);
        p.alterado_por_nome = p.alterado_por ? get('SELECT nome FROM users WHERE id=?', p.alterado_por)?.nome : null;
        const tit = p.agregado_id || id;
        p.agregado = all('SELECT id, nome, numero, data_nasc, agregado_id FROM pacientes WHERE (id=? OR agregado_id=?) AND id != ? ORDER BY nome', tit, tit, id);
        p.titular_nome = p.agregado_id ? get('SELECT nome FROM pacientes WHERE id=?', p.agregado_id)?.nome : null;
        p.proxima = get(`${AGENDA_SQL} WHERE m.paciente_id=? AND m.inicio >= ? ORDER BY m.inicio LIMIT 1`, id, today());
        p.ultima = get(`${AGENDA_SQL} WHERE m.paciente_id=? AND m.inicio < ? ORDER BY m.inicio DESC LIMIT 1`, id, today());
        return p;
      }
      if (id && r2_ === 'marcacoes') return all(`${AGENDA_SQL} WHERE m.paciente_id=? ORDER BY m.inicio DESC`, id);
      if (id && r2_ === 'tratamentos') return all(`SELECT t.*, md.nome medico_nome, s.codigo servico_codigo, d.numero documento_numero FROM tratamentos t
        LEFT JOIN medicos md ON md.id=t.medico_id LEFT JOIN servicos s ON s.id=t.servico_id LEFT JOIN documentos d ON d.id=t.documento_id
        WHERE t.paciente_id=? ORDER BY CASE t.estado WHEN 'planeado' THEN 0 ELSE 1 END, t.data DESC, t.id DESC`, id);
      if (id && r2_ === 'notas') return all(`SELECT n.*, md.nome medico_nome, u.nome user_nome FROM notas_clinicas n LEFT JOIN medicos md ON md.id=n.medico_id
        LEFT JOIN users u ON u.id=n.user_id WHERE n.paciente_id=? ORDER BY n.data DESC, n.id DESC`, id);
      if (id && r2_ === 'contacorrente') return contaCorrente(id);
      if (id && r2_ === 'documentos') return all('SELECT * FROM documentos WHERE paciente_id=? ORDER BY data DESC, id DESC', id);
      break;
    }
    case 'anamnese': {
      if (m === 'GET') return get('SELECT * FROM anamnese WHERE paciente_id=?', id) || {};
      const o = pick(body, ['alergias', 'doencas', 'medicacao', 'fumador', 'gravidez', 'hipertensao', 'diabetes', 'cardiaco', 'anticoagulantes', 'hepatite', 'observacoes']);
      o.atualizado_em = new Date().toISOString().slice(0, 16).replace('T', ' ');
      const keys = Object.keys(o);
      run(`INSERT INTO anamnese (paciente_id, ${keys.join(',')}) VALUES (?, ${keys.map(() => '?').join(',')})
        ON CONFLICT(paciente_id) DO UPDATE SET ${keys.map(k => `${k}=excluded.${k}`).join(',')}`, id, ...keys.map(k => o[k]));
      D.log(user.id, 'editar anamnese', `paciente=${id}`);
      return get('SELECT * FROM anamnese WHERE paciente_id=?', id);
    }
    case 'notas': {
      if (m === 'POST') {
        if (!body.texto) throw new HttpError(400, 'Escreva a nota');
        const nid = insert('notas_clinicas', { paciente_id: body.paciente_id, medico_id: body.medico_id || user.medico_id || null, user_id: user.id,
          data: body.data || new Date().toISOString().slice(0, 16).replace('T', ' '), texto: body.texto });
        return { id: nid };
      }
      if (m === 'DELETE' && id) { run('DELETE FROM notas_clinicas WHERE id=?', id); return { ok: true }; }
      break;
    }
    case 'agenda': {
      const de = q.get('de') || today(); const ate = q.get('ate') || de;
      const where = ['m.inicio >= ?', 'm.inicio <= ?']; const params = [de, ate + 'T23:59'];
      if (q.get('medico_id')) { where.push('m.medico_id = ?'); params.push(q.get('medico_id')); }
      if (q.get('gabinete_id')) { where.push('m.gabinete_id = ?'); params.push(q.get('gabinete_id')); }
      return all(`${AGENDA_SQL} WHERE ${where.join(' AND ')} ORDER BY m.inicio`, ...params);
    }
    case 'marcacoes': {
      if (m === 'GET' && id) { const r = get(`${AGENDA_SQL} WHERE m.id=?`, id); if (!r) throw new HttpError(404, 'Não encontrada'); return r; }
      if (m === 'POST') return guardarMarcacao(null, body, user);
      if (m === 'PUT' && id) return guardarMarcacao(id, body, user);
      if (m === 'DELETE' && id) { run('DELETE FROM marcacoes WHERE id=?', id); D.log(user.id, 'eliminar marcação', `id=${id}`); return { ok: true }; }
      break;
    }
    case 'pesquisa-vagas': { // procura horários livres para um ou dois médicos em simultâneo
      const medicos = [q.get('medico_id'), q.get('medico2_id')].filter(Boolean).map(Number);
      if (!medicos.length) throw new HttpError(400, 'Escolha o médico');
      const dur = Number(q.get('duracao')) || 30;
      const cfg = D.getConfig();
      const dias = (q.get('dias') || cfg.agenda_dias || '1,2,3,4,5').split(',').filter(Boolean).map(Number);
      const toM = h => { const [a, b] = String(h).split(':').map(Number); return a * 60 + (b || 0); };
      const hMin = Math.max(toM(cfg.agenda_inicio || '08:00'), toM(q.get('hora_min') || '00:00'));
      const hMax = Math.min(toM(cfg.agenda_fim || '20:00'), toM(q.get('hora_max') || '23:59'));
      const periodos = { manha: q.get('manha') !== '0', tarde: q.get('tarde') !== '0', noite: q.get('noite') === '1' };
      const okPeriodo = t => (t < 780 && periodos.manha) || (t >= 780 && t < 1200 && periodos.tarde) || (t >= 1200 && periodos.noite);
      const incluirFeriados = q.get('feriados') === '1';
      const limite = Math.min(Number(q.get('limite')) || 20, 100);
      const step = Number(cfg.agenda_intervalo) || 15;
      const out = []; const d = new Date((q.get('de') || today()) + 'T12:00:00'); const now = new Date();
      for (let i = 0; i < 120 && out.length < limite; i++, d.setDate(d.getDate() + 1)) {
        const dia = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        if (!dias.includes(d.getDay())) continue;
        if (!incluirFeriados && feriadosAno(d.getFullYear()).some(f => f.data === dia)) continue;
        const ocup = medicos.flatMap(mid => ocupacaoDia(mid, dia));
        let porDia = 0;
        for (let t = hMin; t + dur <= hMax && out.length < limite && porDia < 4; t += step) {
          if (!okPeriodo(t) || !okPeriodo(t + dur - 1)) continue;
          const ini = `${dia}T${hhmm(t)}`, fim = `${dia}T${hhmm(t + dur)}`;
          if (new Date(ini) < now) continue;
          if (!ocup.some(o => o.inicio < fim && o.fim > ini)) { out.push({ inicio: ini, fim, medicos }); porDia++; t += Math.max(0, 60 - step); }
        }
      }
      return out;
    }
    case 'bloqueios': {
      const de = q.get('de') || today(); const ate = q.get('ate') || de;
      return all(`SELECT b.*, md.nome medico_nome FROM bloqueios b LEFT JOIN medicos md ON md.id=b.medico_id
        WHERE b.inicio <= ? AND b.fim >= ? ORDER BY b.inicio`, ate + 'T23:59', de + 'T00:00').map(b => ({ ...b, tipo_nome: TIPOS_BLOQ[b.tipo] || b.tipo }));
    }
    case 'espera':
      return all(`SELECT le.*, p.nome paciente_nome, p.telemovel, md.nome medico_nome, s.nome servico_nome FROM lista_espera le
        JOIN pacientes p ON p.id=le.paciente_id LEFT JOIN medicos md ON md.id=le.medico_id LEFT JOIN servicos s ON s.id=le.servico_id
        WHERE le.estado = ? ORDER BY le.criado_em`, q.get('estado') || 'aguarda');
    case 'listagens': return listagem(r1, q);
    case 'feriados': return feriadosAno(Number(q.get('ano')) || new Date().getFullYear());

    case 'orcamentos': {
      if (m === 'GET' && !id) {
        const where = []; const params = [];
        if (q.get('paciente_id')) { where.push('o.paciente_id=?'); params.push(q.get('paciente_id')); }
        if (q.get('estado')) { where.push('o.estado=?'); params.push(q.get('estado')); }
        return all(`SELECT o.*, p.nome paciente_nome, md.nome medico_nome FROM orcamentos o LEFT JOIN pacientes p ON p.id=o.paciente_id
          LEFT JOIN medicos md ON md.id=o.medico_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY o.data DESC, o.id DESC LIMIT 500`, ...params);
      }
      if (m === 'GET' && id) return orcamentoCompleto(id);
      if (m === 'POST' && id && r2_ === 'aceitar') return aceitarOrcamento(id, user);
      if (m === 'POST' && id && r2_ === 'recusar') { run("UPDATE orcamentos SET estado='recusado' WHERE id=?", id); return orcamentoCompleto(id); }
      if (m === 'POST') return guardarOrcamento(null, body, user);
      if (m === 'PUT' && id) return guardarOrcamento(id, body, user);
      if (m === 'DELETE' && id) { run('DELETE FROM orcamentos WHERE id=?', id); return { ok: true }; }
      break;
    }
    case 'documentos': {
      if (m === 'GET' && !id) {
        const where = []; const params = [];
        if (q.get('paciente_id')) { where.push('d.paciente_id=?'); params.push(q.get('paciente_id')); }
        if (q.get('tipo')) { where.push('d.tipo=?'); params.push(q.get('tipo')); }
        if (q.get('de')) { where.push('d.data>=?'); params.push(q.get('de')); }
        if (q.get('ate')) { where.push('d.data<=?'); params.push(q.get('ate')); }
        return all(`SELECT d.*, p.nome paciente_nome, p.nif paciente_nif FROM documentos d LEFT JOIN pacientes p ON p.id=d.paciente_id
          ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY d.data DESC, d.id DESC LIMIT 1000`, ...params);
      }
      if (m === 'GET' && id) return docComLinhas(id);
      if (m === 'POST' && id && r2_ === 'anular') return anularDocumento(id, user, body.motivo);
      if (m === 'POST') return criarDocumento(body, user);
      break;
    }
    case 'recibos': if (m === 'POST') return criarRecibo(body, user); break;
    case 'devedores':
      return all('SELECT id, numero, nome, telemovel FROM pacientes ORDER BY nome').map(p => ({ ...p, ...saldoPaciente(p.id) })).filter(p => Math.abs(p.saldo) > 0.004);

    case 'stocks': {
      if (r1 === 'existencias') return existencias(q);
      if (r1 === 'lotes') return lotes(Number(q.get('produto_id')));
      if (r1 === 'movimentos') return all(`SELECT m.*, p.nome produto_nome, p.unidade, a.nome armazem_nome FROM movimentos_stock m
        JOIN produtos p ON p.id=m.produto_id LEFT JOIN armazens a ON a.id=m.armazem_id ORDER BY m.data DESC, m.id DESC LIMIT 500`);
      if (r1 === 'transferir' && m === 'POST') {
        const qtd = Number(body.qtd);
        if (!(qtd > 0) || !body.produto_id || !body.de || !body.para || body.de === body.para) throw new HttpError(400, 'Dados de transferência inválidos');
        tx(() => {
          const base = { produto_id: body.produto_id, qtd, lote: body.lote || null, validade: body.validade || null, data: today(), motivo: 'Transferência', user_id: user.id };
          insert('movimentos_stock', { ...base, armazem_id: body.de, tipo: 'transf_saida' });
          insert('movimentos_stock', { ...base, armazem_id: body.para, tipo: 'transf_entrada' });
        });
        return { ok: true };
      }
      break;
    }
    case 'proteses': {
      const where = []; const params = [];
      const f = q.get('filtro');
      if (f === 'atraso') { where.push("pr.fase IN ('pedido','enviado','em_prova') AND pr.data_prevista < ?"); params.push(today()); }
      if (f === 'pendentes') where.push("pr.fase IN ('pedido','enviado','em_prova')");
      if (f === 'para_enviar') where.push("pr.fase='pedido'");
      if (f === 'na_clinica') where.push("pr.fase='recebido'");
      if (f === 'entregues') where.push("pr.fase='entregue'");
      if (f === 'canceladas') where.push("pr.fase='cancelado'");
      for (const c of ['laboratorio_id', 'medico_id', 'paciente_id']) if (q.get(c)) { where.push(`pr.${c}=?`); params.push(q.get(c)); }
      return all(`SELECT pr.*, p.nome paciente_nome, md.nome medico_nome, l.nome laboratorio_nome FROM proteses pr LEFT JOIN pacientes p ON p.id=pr.paciente_id
        LEFT JOIN medicos md ON md.id=pr.medico_id LEFT JOIN laboratorios l ON l.id=pr.laboratorio_id
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY pr.data_prevista, pr.id DESC`, ...params);
    }
    case 'estatisticas': return estatisticas(q);
    case 'aniversarios': {
      const de = q.get('de') || today(); const ate = q.get('ate') || de;
      const md = s => s.slice(5);
      const rows = all("SELECT id, numero, nome, data_nasc, telemovel, email, sms_ok FROM pacientes WHERE ativo=1 AND data_nasc IS NOT NULL ORDER BY substr(data_nasc,6)");
      return rows.filter(r => md(de) <= md(ate) ? (md(r.data_nasc) >= md(de) && md(r.data_nasc) <= md(ate)) : (md(r.data_nasc) >= md(de) || md(r.data_nasc) <= md(ate)));
    }
    case 'sms': {
      if (r1 === 'preparar' && m === 'POST') return prepararSms(body, user);
      if (r1 === 'historico') return all(`SELECT h.*, p.nome paciente_nome FROM sms_historico h LEFT JOIN pacientes p ON p.id=h.paciente_id ORDER BY h.id DESC LIMIT 500`);
      if (r1 === 'marcar-enviado' && m === 'POST') { for (const hid of body.ids || []) run("UPDATE sms_historico SET estado='enviado' WHERE id=?", hid); return { ok: true }; }
      break;
    }
    case 'dashboard': {
      const d = today();
      const marc = all(`${AGENDA_SQL} WHERE m.inicio LIKE ? ORDER BY m.inicio`, d + '%');
      return {
        hoje: marc,
        proteses_atraso: get("SELECT COUNT(*) n FROM proteses WHERE fase IN ('pedido','enviado','em_prova') AND data_prevista < ?", d).n,
        proteses_clinica: get("SELECT COUNT(*) n FROM proteses WHERE fase='recebido'").n,
        stock_alertas: existencias(new URLSearchParams()).filter(p => p.alertas.some(a => a !== 'ideal')).length,
        aniversarios: all("SELECT id, nome, data_nasc FROM pacientes WHERE ativo=1 AND substr(data_nasc,6)=?", d.slice(5)),
        faturado_hoje: r2(get("SELECT COALESCE(SUM(CASE WHEN tipo='NC' THEN -total ELSE total END),0) s FROM documentos WHERE estado='emitido' AND tipo IN ('FT','FR','NC') AND data=?", d).s),
        recebido_hoje: r2(get("SELECT COALESCE(SUM(valor),0) s FROM pagamentos WHERE estado='ativo' AND data=?", d).s),
        orcamentos_abertos: get("SELECT COUNT(*) n FROM orcamentos WHERE estado='aberto'").n,
        feriado: feriadosAno(new Date().getFullYear()).find(f => f.data === d) || null,
      };
    }
    case 'logs': requireAdmin(user);
      return all('SELECT l.*, u.nome user_nome FROM logs l LEFT JOIN users u ON u.id=l.user_id ORDER BY l.id DESC LIMIT 1000');
    case 'backup': requireAdmin(user); backup(res); D.log(user.id, 'backup', ''); return undefined;
  }
  throw new HttpError(404, 'Rota não encontrada');
}

// ---------- ficheiros estáticos ----------
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const file = path.normalize(path.join(PUBLIC, p));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }); return res.end('Não encontrado'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': path.extname(file) === '.woff2' ? 'max-age=604800' : 'no-cache' });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(req, res, url);
  try {
    const out = await api(req, res, url);
    if (out !== undefined && !res.headersSent) send(res, 200, out);
  } catch (e) {
    const status = e.status || 500;
    if (status === 500) console.error(e);
    if (!res.headersSent) send(res, status, { erro: status === 500 ? 'Erro interno: ' + e.message : e.message });
  }
});

if (require.main === module) {
  server.listen(PORT, '0.0.0.0', () => {
    const ips = Object.values(os.networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
    console.log(`\n  Clínica Dentária — servidor ativo`);
    console.log(`  Neste computador:   http://localhost:${PORT}`);
    for (const ip of ips) console.log(`  Noutros postos:     http://${ip}:${PORT}`);
    console.log(`  Base de dados:      ${D.DB_FILE}\n`);
  });
}

module.exports = { server, feriadosAno, pascoa, validarNif };
