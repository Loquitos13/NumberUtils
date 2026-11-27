'use strict';
/* Anamnese configurável: perguntas definidas em Configuração → Anamnese, respondidas na ficha */

// faixa de alertas clínicos (ficha e consulta) a partir do resumo do paciente
function alertasHtml(p) {
  const a = p.anamnese || {};
  const alertas = [a.alergias && `Alergias: ${a.alergias}`, a.anticoagulantes && 'Anticoagulantes', a.cardiaco && 'Doença cardíaca', a.diabetes && 'Diabetes',
    a.hipertensao && 'Hipertensão', a.gravidez && 'Gravidez', a.hepatite && 'Hepatite', ...p.alertas_extra].filter(Boolean);
  return alertas.length ? `<div class="alert danger" style="margin:10px 0 0">${alertas.map(esc).join(' · ')}</div>` : '';
}

// desenha as perguntas ativas em el e devolve a função que grava as respostas
async function anamneseExtra(el, pid) {
  const [ps, resp] = await Promise.all([GET('t/anamnese_perguntas?ativo=1'), GET(`pacientes/${pid}/anamnese-extra`)]);
  if (!ps.length) return async () => {};
  const campo = p => {
    const n = 'aq_' + p.id, v = resp[p.id];
    if (p.tipo === 'sn') return sel(n, optsArr([['', '—'], ['sim', 'Sim'], ['não', 'Não']], v));
    if (p.tipo === 'escolha') {
      const ops = String(p.opcoes || '').split(';').map(s => s.trim()).filter(Boolean); // como opcoes() em anamnese.js (servidor)
      // resposta guardada que já não está nas opções: mantém-se (e grava-se igual) em vez de se perder
      return sel(n, optsArr(['', ...ops, ...(v && !ops.includes(v) ? [[v, v + ' (antiga)']] : [])], v));
    }
    return inp(n, v);
  };
  el.innerHTML = `<h2 class="h-card">Outras perguntas</h2><div class="form-grid">${ps.map(p => fld(p.texto, campo(p), p.tipo === 'texto' ? 's2' : '')).join('')}</div>`;
  return () => PUT(`pacientes/${pid}/anamnese-extra`, Object.fromEntries(ps.map(p => [p.id, $(`[name="aq_${p.id}"]`, el).value])));
}
