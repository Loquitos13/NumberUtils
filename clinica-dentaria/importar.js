'use strict';
// Importação de pacientes a partir de CSV (migração do NoviGest / Excel).

// Lê CSV para uma lista de linhas (listas de campos). Separador ';' ou ',' pela 1.ª linha.
function parseCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const prim = texto.slice(0, texto.indexOf('\n') + 1 || texto.length);
  const sep = (prim.match(/;/g) || []).length >= (prim.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let linha = [], campo = '', aspas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c !== '"') campo += c;
      else if (texto[i + 1] === '"') { campo += '"'; i++; }
      else aspas = false;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = '';
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

const D = require('./db');

// texto tal como vem do cliente, ou base64 dos bytes do ficheiro (UTF-8 válido, senão Windows-1252)
function lerCsv(csv) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(csv) || csv.length % 4) return csv;
  const buf = Buffer.from(csv, 'base64');
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { return new TextDecoder('windows-1252').decode(buf); }
}
const erro400 = msg => Object.assign(new Error(msg), { status: 400 });
const SIMULACAO = {};

const NOMES_DATA = { data_nasc: 'Data de nascimento', rgpd_data: 'Data do consentimento RGPD' };

// valida e normaliza uma linha; devolve o motivo do erro ou null
function validarLinha(o) {
  if (!o.nome) return 'O nome é obrigatório';
  for (const k of Object.keys(NOMES_DATA)) if (o[k]) {
    const v = o[k].replace(/^(\d{2})\/(\d{2})\/(\d{4})$/, '$3-$2-$1');
    const d = new Date(v + 'T00:00:00Z');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v) || isNaN(d) || d.toISOString().slice(0, 10) !== v) return `${NOMES_DATA[k]} inválida: ${o[k]}`;
    o[k] = v;
  }
  if (o.numero && !/^\d+$/.test(o.numero)) return `N.º de processo inválido: ${o.numero}`;
  if (o.nif) {
    o.nif = o.nif.replace(/\s/g, '');
    try { require('./server').validarNif(o.nif); } catch (e) { return e.message; } // require tardio: server.js também carrega este ficheiro
  }
  return null;
}

// POST /api/importar/pacientes {csv, mapa: [campo por coluna], simular} → {criados, ignorados, erros:[{linha, motivo}]}
function importarPacientes(body, user) {
  if (typeof body.csv !== 'string' || !body.csv) throw erro400('Falta o ficheiro CSV');
  const mapa = Array.isArray(body.mapa) ? body.mapa : [];
  const cols = D.all('PRAGMA table_info(pacientes)').map(c => c.name).filter(c => !['id', 'criado_em', 'alterado_por', 'alterado_em'].includes(c));
  const fora = mapa.filter(c => c && !cols.includes(c));
  if (fora.length) throw erro400('Campo desconhecido: ' + fora.join(', '));
  if (!mapa.includes('nome')) throw erro400('Associe uma coluna ao nome');
  const [, ...dados] = parseCsv(lerCsv(body.csv));
  const iNum = mapa.indexOf('numero');
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
        const motivo = validarLinha(o);
        if (motivo) return out.erros.push({ linha: n + 2, motivo }); // n.º da linha como no Excel (1 = cabeçalho)
        // as linhas já inseridas contam (estamos dentro da transação): repetidos no próprio ficheiro também são ignorados
        if ((o.numero && D.get('SELECT 1 FROM pacientes WHERE numero=?', Number(o.numero))) || (o.nif && D.get('SELECT 1 FROM pacientes WHERE nif=?', o.nif))) return out.ignorados++;
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

module.exports = { parseCsv, importarPacientes };
