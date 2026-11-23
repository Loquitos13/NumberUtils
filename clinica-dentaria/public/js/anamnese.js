'use strict';
/* Anamnese configurável: perguntas definidas em Configuração → Anamnese, respondidas na ficha */

// desenha as perguntas ativas em el e devolve a função que grava as respostas
async function anamneseExtra(el, pid) {
  const [ps, resp] = await Promise.all([GET('t/anamnese_perguntas?ativo=1'), GET(`pacientes/${pid}/anamnese-extra`)]);
  if (!ps.length) return async () => {};
  const campo = p => {
    const n = 'aq_' + p.id, v = resp[p.id];
    if (p.tipo === 'sn') return sel(n, optsArr([['', '—'], ['sim', 'Sim'], ['não', 'Não']], v));
    if (p.tipo === 'escolha') return sel(n, optsArr(['', ...String(p.opcoes || '').split(';').map(s => s.trim()).filter(Boolean)], v));
    return inp(n, v);
  };
  el.innerHTML = `<h3>Outras perguntas</h3><div class="form-grid">${ps.map(p => fld(p.texto, campo(p), p.tipo === 'texto' ? 's2' : '')).join('')}</div>`;
  return () => PUT(`pacientes/${pid}/anamnese-extra`, Object.fromEntries(ps.map(p => [p.id, $(`[name="aq_${p.id}"]`, el).value])));
}
