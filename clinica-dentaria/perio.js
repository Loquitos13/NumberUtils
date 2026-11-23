'use strict';
// Periodontograma: exames por paciente (6 locais por dente) e índices calculados no servidor
const D = require('./db');
const { all, get, run } = D;

const erro = (status, msg) => Object.assign(new Error(msg), { status });

const arred = (n, c) => Math.round(n * 10 ** c) / 10 ** c;

function indices(dados) {
  let locais = 0, placa = 0, hem = 0, somaPs = 0, nPs = 0, fundos = 0;
  for (const d of Object.values(dados)) {
    if (d.ausente) continue;
    locais += 6;
    placa += (d.pla || []).filter(Boolean).length;
    hem += (d.hem || []).filter(Boolean).length;
    for (const ps of d.ps || []) if (ps != null) { somaPs += ps; nPs++; if (ps >= 4) fundos++; }
  }
  return { placa_pct: locais ? arred(placa / locais * 100, 1) : 0, hemorragia_pct: locais ? arred(hem / locais * 100, 1) : 0,
    ps_media: nPs ? arred(somaPs / nPs, 2) : 0, locais_4mm: fundos };
}

function exame(id) {
  const e = get('SELECT e.*, md.nome medico_nome FROM perio_exames e LEFT JOIN medicos md ON md.id=e.medico_id WHERE e.id=?', id);
  if (!e) throw erro(404, 'Exame não encontrado');
  e.dados = JSON.parse(e.dados);
  e.indices = indices(e.dados);
  return e;
}

const DENTES = [1, 2, 3, 4].flatMap(q => [1, 2, 3, 4, 5, 6, 7, 8].map(n => String(q * 10 + n)));

// valida e normaliza: só ficam os campos conhecidos; null = local por registar
function validarDados(dados) {
  if (!dados || typeof dados !== 'object' || Array.isArray(dados)) throw erro(400, 'Dados do exame inválidos');
  const out = {};
  const inteiro = (v, min, max, nome, dente) => {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw erro(400, `Dente ${dente}: ${nome} deve estar entre ${min} e ${max}`);
    return n;
  };
  const seis = (a, nome, dente) => {
    if (a == null) return [null, null, null, null, null, null];
    if (!Array.isArray(a) || a.length !== 6) throw erro(400, `Dente ${dente}: ${nome} precisa de 6 locais`);
    return a;
  };
  for (const [k, d] of Object.entries(dados)) {
    if (!DENTES.includes(k) || !d || typeof d !== 'object') throw erro(400, `Dente inválido: ${k}`);
    out[k] = {
      ps: seis(d.ps, 'a profundidade de sondagem', k).map(v => inteiro(v, 0, 15, 'a profundidade de sondagem', k)),
      rec: seis(d.rec, 'a recessão', k).map(v => inteiro(v, -5, 15, 'a recessão', k)),
      hem: seis(d.hem, 'a hemorragia', k).map(v => v ? 1 : 0),
      pla: seis(d.pla, 'a placa', k).map(v => v ? 1 : 0),
      mob: inteiro(d.mob, 0, 3, 'a mobilidade', k) || 0,
      furca: inteiro(d.furca, 0, 3, 'a furca', k) || 0,
      ausente: d.ausente ? 1 : 0,
    };
  }
  return out;
}

function guardar(pid, id, body, user) {
  const data = String(body.data || '');
  // o Date normaliza 2026-02-30 para 03-02: só é real se voltar igual
  const t = new Date(data + 'T00:00:00Z');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(data) || isNaN(t) || t.toISOString().slice(0, 10) !== data) throw erro(400, 'Data do exame inválida');
  const medico_id = Number(body.medico_id) || null;
  if (medico_id && !get('SELECT 1 FROM medicos WHERE id=?', medico_id)) throw erro(400, 'Médico inexistente');
  const o = { data, medico_id,dados: JSON.stringify(validarDados(body.dados)), notas: body.notas == null ? null : String(body.notas) };
  if (id) {
    run('UPDATE perio_exames SET data=?, medico_id=?, dados=?, notas=? WHERE id=?', o.data, o.medico_id, o.dados, o.notas, id);
    D.log(user.id, 'editar periodontograma', `id=${id}`);
  } else {
    id = Number(run('INSERT INTO perio_exames (paciente_id, data, medico_id, dados, notas) VALUES (?,?,?,?,?)', pid, o.data, o.medico_id, o.dados, o.notas).lastInsertRowid);
    D.log(user.id, 'criar periodontograma', `id=${id} paciente=${pid}`);
  }
  return exame(id);
}

// /api/pacientes/:id/perio
function doPaciente(m, pid, body, user) {
  if (m === 'GET') return all('SELECT id FROM perio_exames WHERE paciente_id=? ORDER BY data DESC, id DESC', pid).map(r => exame(r.id));
  if (m === 'POST') return guardar(pid, null, body, user);
  throw erro(405, 'Método não suportado');
}

// /api/perio/:id
function doExame(m, id, body, user) {
  const e = exame(id);
  if (m === 'GET') return e;
  if (m === 'PUT') return guardar(e.paciente_id, id, { ...e, ...body }, user);
  if (m === 'DELETE') {
    if (user.perfil !== 'admin') throw erro(403, 'Apenas administradores podem eliminar exames');
    run('DELETE FROM perio_exames WHERE id=?', id); D.log(user.id, 'eliminar periodontograma', `id=${id}`); return { ok: true };
  }
  throw erro(405, 'Método não suportado');
}

module.exports = { doPaciente, doExame };
