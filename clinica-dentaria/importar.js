'use strict';
// Importação de pacientes a partir de CSV (migração do NoviGest / Excel).

const D = require('./db');
const { parseCsv } = require('./public/js/csv');

// texto tal como vem do cliente, ou base64 dos bytes do ficheiro (UTF-8 válido, senão Windows-1252)
function lerCsv(csv) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(csv) || csv.length % 4) return csv;
  const buf = Buffer.from(csv, 'base64');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
const erro400 = msg => Object.assign(new Error(msg), { status: 400 });
const SIMULACAO = {};

const NOMES_DATA = { data_nasc: 'Data de nascimento', rgpd_data: 'Data do consentimento RGPD' };
// colunas com id de outra tabela: o valor tem de existir (senão a FOREIGN KEY abortava a importação toda)
const FKS = { entidade_id: ['entidades', 'Entidade'], medico_id: ['medicos', 'Médico'], razao_visita_id: ['razoes_visita', 'Razão da visita'], agregado_id: ['pacientes', 'Agregado'] };
const FLAGS = ['ativo', 'sms_ok', 'email_ok', 'rgpd_consent'];
const SIM = ['1', 'sim', 's', 'x', 'true'], NAO = ['0', 'não', 'nao', 'n', 'false'];
const NAO_MAPEAVEIS = ['id', 'criado_em', 'alterado_por', 'alterado_em', 'foto'];
// colunas com o nome (o export do NoviGest traz nomes, não ids): campo → [coluna id, erro, nomes aceites]
const POR_NOME = { entidade: ['entidade_id', 'Entidade desconhecida', 'SELECT id, nome FROM entidades ORDER BY ativo DESC, id'],
  medico: ['medico_id', 'Médico desconhecido', 'SELECT id, nome, abreviatura FROM medicos ORDER BY ativo DESC, id'] };
const norm = s => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
// nome normalizado → id; os nomes ganham às abreviaturas; nos repetidos ganha o ativo (e depois o mais antigo)
function nomesPara(sql) {
  const m = new Map(), rows = D.all(sql);
  for (const k of ['nome', 'abreviatura']) for (const r of rows) if (r[k] && !m.has(norm(r[k]))) m.set(norm(r[k]), r.id);
  return m;
}

// valida e normaliza uma linha; devolve o motivo do erro ou null
function validarLinha(o, nomes) {
  if (!o.nome) return 'O nome é obrigatório';
  for (const [k, [col, erro]] of Object.entries(POR_NOME)) if (o[k]) {
    const id = nomes[k].get(norm(o[k]));
    if (id === undefined) return `${erro}: ${o[k]}`;
    o[col] = id; delete o[k];
  }
  for (const k of Object.keys(NOMES_DATA)) if (o[k]) {
    const v = o[k].replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
    const d = new Date(v + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) return `${NOMES_DATA[k]} inválida: ${o[k]}`;
    o[k] = v;
  }
  if (o.numero && !/^\d+$/.test(o.numero)) return `N.º de processo inválido: ${o.numero}`;
  if (o.nif) {
    o.nif = o.nif.replace(/\s/g, '');
    try { D.validarNif(o.nif); } catch (e) { return e.message; }
  }
  for (const [k, [tabela, nome]] of Object.entries(FKS)) if (o[k]) {
    if (!/^\d+$/.test(o[k]) || !D.get(`SELECT 1 FROM ${tabela} WHERE id=?`, Number(o[k]))) return `${nome} inexistente: ${o[k]}`;
    o[k] = Number(o[k]);
  }
  for (const k of FLAGS) if (o[k]) {
    const v = o[k].toLowerCase();
    if (SIM.includes(v)) o[k] = 1; else if (NAO.includes(v)) o[k] = 0; else return `Valor inválido (sim/não): ${o[k]}`;
  }
  return null;
}

// POST /api/importar/pacientes {csv, mapa: [campo por coluna], simular} → {criados, ignorados, erros:[{linha, motivo}]}
function importarPacientes(body, user) {
  if (typeof body.csv !== 'string' || !body.csv) throw erro400('Falta o ficheiro CSV');
  const mapa = Array.isArray(body.mapa) ? body.mapa : [];
  const cols = D.all('PRAGMA table_info(pacientes)').map(c => c.name).filter(c => !NAO_MAPEAVEIS.includes(c)).concat(Object.keys(POR_NOME));
  const fora = mapa.filter(c => c && !cols.includes(c));
  if (fora.length) throw erro400('Campo desconhecido: ' + fora.join(', '));
  if (!mapa.includes('nome')) throw erro400('Associe uma coluna ao nome');
  let dados;
  try { [, ...dados] = parseCsv(lerCsv(body.csv)); } catch (e) { throw erro400(e.message); }
  const iNum = mapa.indexOf('numero');
  const nomes = Object.fromEntries(Object.entries(POR_NOME).map(([k, [, , sql]]) => [k, nomesPara(sql)]));
  const alterado_em = D.get("SELECT strftime('%Y-%m-%d %H:%M','now','localtime') t").t;
  const out = { criados: 0, ignorados: 0, erros: [] };
  try {
    D.tx(() => {
      // o n.º seguinte fica acima dos da base de dados e de todos os do ficheiro, para não colidir com nenhum
      let proximo = dados.reduce((m, c) => Math.max(m, parseInt(c[iNum]) || 0), D.get('SELECT MAX(numero) m FROM pacientes').m || 0) + 1;
      dados.forEach((campos, n) => {
        const o = {};
        mapa.forEach((c, i) => { const v = (campos[i] || '').trim(); if (c && v) o[c] = v; });
        if (!Object.keys(o).length) return; // linha vazia
        const motivo = validarLinha(o, nomes);
        if (motivo) return out.erros.push({ linha: n + 2, motivo }); // n.º da linha como no Excel (1 = cabeçalho)
        // as linhas já inseridas contam (estamos dentro da transação): repetidos no próprio ficheiro também são ignorados
        // shortcut: sem n.º, NIF nem data de nascimento não há como reconhecer o paciente e a linha é criada de novo; limpar à mão se reimportar
        if ((o.numero && D.get('SELECT 1 FROM pacientes WHERE numero=?', Number(o.numero))) || (o.nif && D.get('SELECT 1 FROM pacientes WHERE nif=?', o.nif))
          || (!o.numero && !o.nif && o.data_nasc && D.get('SELECT 1 FROM pacientes WHERE nome=? AND data_nasc=?', o.nome, o.data_nasc))) return out.ignorados++;
        o.numero = o.numero ? Number(o.numero) : proximo++;
        Object.assign(o, { alterado_por: user.id, alterado_em });
        D.run(`INSERT INTO pacientes (${Object.keys(o).join(',')}) VALUES (${Object.keys(o).map(() => '?').join(',')})`, ...Object.values(o));
        out.criados++;
      });
      if (body.simular) throw SIMULACAO; // desfaz tudo: a simulação conta exatamente o que a importação faria
    });
  } catch (e) { if (e !== SIMULACAO) throw e; }
  if (!body.simular) D.log(user.id, 'importar pacientes', `criados=${out.criados} ignorados=${out.ignorados} erros=${out.erros.length}`);
  return out;
}

module.exports = { importarPacientes };
