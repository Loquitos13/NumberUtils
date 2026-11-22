'use strict';
/* Listagens / relatórios: agenda, conta corrente, orçamentos */
const LISTAGENS = [
  ['Agenda', [
    ['agenda-medico', 'Marcações por médico', { tipo: 'agenda', por: 'medico', f: ['medico'] }],
    ['agenda-entidade', 'Marcações por entidade', { tipo: 'agenda', por: 'entidade', f: ['entidade'] }],
    ['agenda-utilizador', 'Marcações por utilizador', { tipo: 'agenda', por: 'utilizador', f: ['utilizador'] }],
    ['agenda-paciente', 'Marcações de um paciente', { tipo: 'agenda', por: 'paciente', f: ['paciente'] }],
    ['confirmar', 'Consultas por confirmar', { tipo: 'confirmar', futuro: true }],
    ['remarcacoes', 'Remarcações e desmarcações', { tipo: 'remarcacoes' }],
    ['faltas', 'Faltas', { tipo: 'faltas' }],
    ['ocupacao', 'Ocupação da agenda', { tipo: 'ocupacao', f: ['medico'] }],
    ['ausencias', 'Férias e ausências', { tipo: 'ausencias', futuro: true }],
    ['espera', 'Lista de espera', { tipo: 'espera', semDatas: true }],
  ]],
  ['Conta corrente', [
    ['caixa', 'Mapa de caixa', { tipo: 'caixa', f: ['utilizador', 'medico'], hoje: true }],
    ['movimentos', 'Movimentos (global)', { tipo: 'movimentos', f: ['medico', 'utilizador', 'paciente'] }],
    ['comissoes', 'Comissões', { tipo: 'comissoes', f: ['medico'] }],
    ['producao', 'Produção', { tipo: 'producao', f: ['medico'] }],
    ['pendentes', 'Pendentes (dívidas)', { tipo: 'pendentes', semDatas: true }],
  ]],
  ['Orçamentos', [
    ['orc-aberto', 'Pendentes', { tipo: 'orcamentos', estado: 'aberto', f: ['medico'] }],
    ['orc-aceite', 'Aprovados', { tipo: 'orcamentos', estado: 'aceite', f: ['medico'] }],
    ['orc-recusado', 'Recusados', { tipo: 'orcamentos', estado: 'recusado', f: ['medico'] }],
    ['orc-expirado', 'Sem efeito (expirados)', { tipo: 'orcamentos', estado: 'expirado', f: ['medico'] }],
    ['orc-todos', 'Todos', { tipo: 'orcamentos', f: ['medico'] }],
  ]],
];
const LST_STATE = {};

function fmtCell(c, v) {
  if (c.t === 'money') return eur(v);
  if (c.t === 'date') return fmtDate(v);
  if (c.t === 'dt') return fmtDT(v);
  if (c.t === 'num') return num(v);
  return esc(v ?? '');
}

route('listagens', async (view, [key = 'agenda-medico']) => {
  const all = LISTAGENS.flatMap(([, l]) => l);
  const [, titulo, def] = all.find(x => x[0] === key) || all[0];
  const st = LST_STATE[key] ||= {
    de: def.hoje ? isoDate() : def.futuro ? isoDate() : isoDate().slice(0, 8) + '01',
    ate: def.futuro ? addDays(isoDate(), 14) : isoDate(),
  };
  const lk = L(); const fs = def.f || [];
  view.innerHTML = `<div class="page-head"><h1>Listagens</h1></div>
    <div class="grid" style="grid-template-columns:220px minmax(0,1fr)">
      <div class="card" style="padding:10px">${LISTAGENS.map(([g, l]) => `<div class="muted small bold" style="margin:8px 6px 4px">${esc(g)}</div>
        ${l.map(([k, t]) => `<a href="#/listagens/${k}" class="btn ghost" style="display:flex;width:100%;${k === key ? 'background:var(--brand-soft);color:var(--brand-2);font-weight:600' : ''}">${esc(t)}</a>`).join('')}`).join('')}</div>
      <div><div class="card"><h2>${esc(titulo)}</h2><form class="row" id="ls-f" onsubmit="return false">
        ${def.semDatas ? '' : fld('De', inp('de', st.de, 'type="date"')) + fld('Até', inp('ate', st.ate, 'type="date"'))}
        ${fs.includes('medico') ? fld('Médico', sel('medico_id', opts(lk.medicos, st.medico_id, { empty: 'Todos' }))) : ''}
        ${fs.includes('entidade') ? fld('Entidade', sel('entidade_id', opts(lk.entidades, st.entidade_id, { empty: 'Todas' }))) : ''}
        ${fs.includes('utilizador') ? fld('Utilizador', sel('user_id', opts(lk.utilizadores, st.user_id, { empty: 'Todos' }))) : ''}
        ${fs.includes('paciente') ? `<div style="min-width:260px">${pacField('paciente_id', st.paciente_id, st.paciente_nome)}</div>` : ''}
        <div class="field"><label class="f">&nbsp;</label><button class="primary" id="ls-go">Gerar listagem</button></div>
        <div class="spacer"></div>
        <div class="field"><label class="f">&nbsp;</label><span class="row"><button id="ls-csv" disabled>⇩ Excel (CSV)</button><button id="ls-print" disabled>🖨 Imprimir</button></span></div>
      </form></div><div class="card" id="ls-res"><div class="empty">Defina os filtros e clique em "Gerar listagem".</div></div></div></div>`;
  const form = $('#ls-f');
  if (fs.includes('paciente')) bindPacField(form, 'paciente_id', p => { st.paciente_nome = p.nome; });
  const gerar = async () => {
    Object.assign(st, readForm(form));
    if (fs.includes('paciente') && def.por === 'paciente' && !st.paciente_id) return toast('Escolha o paciente', true);
    const qs = new URLSearchParams(Object.entries({ de: st.de, ate: st.ate, por: def.por, estado: def.estado, medico_id: st.medico_id, entidade_id: st.entidade_id, user_id: st.user_id, paciente_id: st.paciente_id })
      .filter(([, v]) => v !== undefined && v !== null && v !== ''));
    const r = await act(() => GET(`listagens/${def.tipo}?${qs}`));
    $('#ls-res').innerHTML = listagemHTML(r);
    const periodo = def.semDatas ? fmtDate(isoDate()) : `${fmtDate(st.de)} a ${fmtDate(st.ate)}`;
    const csvCols = r.cols.map(c => ({ h: c.h, f: row => c.t === 'money' || c.t === 'num' ? String(row[c.k] ?? '').replace('.', ',') : fmtCell(c, row[c.k]) }));
    $('#ls-csv').disabled = $('#ls-print').disabled = false;
    $('#ls-csv').onclick = () => downloadCSV(`${key}-${st.de || isoDate()}`, r.rows, csvCols);
    $('#ls-print').onclick = () => printHTML(`<div class="doc" style="max-width:none"><div class="dh">${cabecalhoClinica()}<div class="right"><h2 style="margin:0">${esc(titulo)}</h2>${periodo}</div></div>${listagemHTML(r, true)}</div>`);
  };
  $('#ls-go').onclick = gerar;
  if (def.semDatas || st.gerado) gerar();
  st.gerado = true;
});

function listagemHTML(r, print = false) {
  if (!r.rows.length) return '<div class="empty">Sem resultados para os filtros escolhidos.</div>';
  const money = r.cols.filter(c => c.t === 'money');
  const head = `<tr>${r.cols.map(c => `<th class="${c.t === 'money' || c.t === 'num' ? 'right' : ''}">${esc(c.h)}</th>`).join('')}</tr>`;
  const row = x => `<tr>${r.cols.map(c => `<td class="${c.t === 'money' || c.t === 'num' ? 'right' : ''}">${fmtCell(c, x[c.k])}</td>`).join('')}</tr>`;
  const totRow = (rows, label) => money.length ? `<tr class="bold">${r.cols.map((c, i) => `<td class="right">${c.t === 'money' ? eur(rows.reduce((a, x) => a + (Number(x[c.k]) || 0), 0)) : i === 0 ? esc(label) : ''}</td>`).join('')}</tr>` : '';
  let body = '';
  if (r.grupo) {
    const groups = new Map();
    for (const x of r.rows) { const g = x[r.grupo] ?? '—'; if (!groups.has(g)) groups.set(g, []); groups.get(g).push(x); }
    for (const [g, rows] of groups) {
      body += `<tr><td colspan="${r.cols.length}" style="background:var(--brand-soft);font-weight:700;padding-top:10px">${esc(g)} <span class="muted small">(${rows.length})</span></td></tr>`;
      body += rows.map(row).join('') + totRow(rows, 'Subtotal');
    }
  } else body = r.rows.map(row).join('');
  const total = money.length ? `<tfoot>${totRow(r.rows, 'Total')}</tfoot>` : '';
  const tbl = `<table class="t">${print ? head : `<thead>${head}</thead>`}<tbody>${body}</tbody>${total}</table>`;
  return `${print ? '' : `<div class="muted small" style="margin-bottom:8px">${r.rows.length} registo(s)</div>`}${print ? tbl : `<div class="tbl-wrap">${tbl}</div>`}`;
}
