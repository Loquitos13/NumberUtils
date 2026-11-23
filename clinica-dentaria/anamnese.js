'use strict';
// Anamnese configurável: perguntas definidas pelo administrador e respostas por paciente.
const D = require('./db');

const erro = msg => Object.assign(new Error(msg), { status: 400 });
const TIPOS = ['sn', 'texto', 'escolha'];
const SN = ['sim', 'não'];
const opcoes = p => String(p.opcoes || '').split(';').map(s => s.trim()).filter(Boolean);

// valida uma pergunta nova (atual vazio) ou alterada (o = campos enviados, atual = registo guardado)
function validarPergunta(o, atual = {}) {
  const p = { ...atual, ...o };
  if (!String(p.texto || '').trim()) throw erro('Escreva o texto da pergunta');
  if (p.tipo !== undefined && !TIPOS.includes(p.tipo)) throw erro('Tipo inválido (sim/não, texto ou escolha)');
  if (p.tipo === 'escolha' && !opcoes(p).length) throw erro('Indique as opções, separadas por ";"');
}

// todas as respostas guardadas, incluindo as de perguntas desativadas: { pergunta_id: valor }
function respostas(pid) {
  return Object.fromEntries(D.all('SELECT pergunta_id, valor FROM anamnese_respostas WHERE paciente_id=?', pid).map(r => [r.pergunta_id, r.valor]));
}

// body: { pergunta_id: valor }; valor vazio apaga a resposta
function guardar(pid, body, user) {
  const ps = new Map(D.all('SELECT * FROM anamnese_perguntas').map(p => [p.id, p]));
  const antes = respostas(pid);
  const linhas = Object.entries(body || {}).map(([k, v]) => {
    const p = ps.get(Number(k));
    if (!p) throw erro(`Pergunta desconhecida (${k})`);
    const valor = v === null || v === undefined ? '' : String(v).trim();
    if (valor && p.tipo === 'sn' && !SN.includes(valor)) throw erro(`"${p.texto}": responda sim ou não`);
    // uma resposta já guardada vale mesmo que a opção tenha sido retirada da pergunta
    if (valor && p.tipo === 'escolha' && !opcoes(p).includes(valor) && valor !== antes[p.id]) throw erro(`"${p.texto}": opção inválida`);
    if (valor.length > 2000) throw erro(`"${p.texto}": resposta demasiado longa`);
    return [p.id, valor];
  });
  D.tx(() => {
    for (const [qid, valor] of linhas) {
      if (!valor) D.run('DELETE FROM anamnese_respostas WHERE paciente_id=? AND pergunta_id=?', pid, qid);
      else D.run(`INSERT INTO anamnese_respostas (paciente_id, pergunta_id, valor) VALUES (?,?,?)
        ON CONFLICT(paciente_id, pergunta_id) DO UPDATE SET valor=excluded.valor`, pid, qid, valor);
    }
  });
  D.log(user.id, 'editar anamnese (perguntas)', `paciente=${pid}`);
  return respostas(pid);
}

// texto das perguntas de alerta ativas respondidas "sim"; uma pergunta desativada guarda a resposta mas deixa de alertar
function alertas(pid) {
  return D.all(`SELECT p.texto FROM anamnese_respostas r JOIN anamnese_perguntas p ON p.id=r.pergunta_id
    WHERE r.paciente_id=? AND p.ativo=1 AND p.alerta=1 AND r.valor='sim' ORDER BY p.ordem, p.id`, pid).map(r => r.texto);
}

module.exports = { validarPergunta, respostas, guardar, alertas };
