'use strict';
/* Periodontograma: 6 locais por dente (MV, V, DV, ML, L, DL), índices calculados no servidor */
const PERIO_ARCOS = [['Maxilar', [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28]],
  ['Mandíbula', [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38]]];
const PERIO_SITIOS = ['MV', 'V', 'DV', 'ML', 'L', 'DL'];
// índices no array de 6 locais, pela ordem em que aparecem no ecrã (da esquerda para a direita)
const perioLocais = (d, face) => {
  const dir = [1, 4].includes(Math.floor(d / 10)); // lado direito do paciente: distal à esquerda
  const l = face === 'V' ? [0, 1, 2] : [3, 4, 5];
  return dir ? l.reverse() : l;
};
const perioVazio = () => ({ ps: Array(6).fill(null), rec: Array(6).fill(null), hem: Array(6).fill(0), pla: Array(6).fill(0), mob: 0, furca: 0, ausente: 0 });
const perioCor = ps => ps >= 6 ? 'p6' : ps >= 4 ? 'p4' : '';
const perioValido = v => /^-?\d*$/.test(v.trim()); // vazio ou inteiro; os limites são verificados no servidor

// grelha de um arco; soLeitura = para impressão
function perioArco(nome, dentes, dados, anterior, soLeitura) {
  const dente = d => dados[d] || perioVazio();
  const off = d => dente(d).ausente ? 'disabled' : '';
  const cel = (d, html) => `<td class="${dente(d).ausente ? 'aus' : ''}">${html}</td>`;
  const medida = (d, k, i) => {
    const v = dente(d)[k][i];
    if (soLeitura) return `<span class="${k === 'ps' ? perioCor(v) : ''}">${v ?? ''}</span>`;
    return `<input class="perio-num ${k === 'ps' ? perioCor(v) : ''}" data-d="${d}" data-k="${k}" data-i="${i}" value="${v ?? ''}" inputmode="numeric" maxlength="3" aria-label="${d} ${k} ${PERIO_SITIOS[i]}" ${off(d)}>`;
  };
  const marca = (d, k, i) => soLeitura ? (dente(d)[k][i] ? '●' : '')
    : `<input type="checkbox" class="perio-chk ${k}" data-d="${d}" data-k="${k}" data-i="${i}" ${dente(d)[k][i] ? 'checked' : ''} aria-label="${d} ${k === 'hem' ? 'hemorragia' : 'placa'} ${PERIO_SITIOS[i]}" ${off(d)}>`;
  const linha = (rot, f, cls = '') => `<tr class="${cls}"><th>${rot}</th>${dentes.map(d => cel(d, f(d))).join('')}</tr>`;
  const sitios = (lado, f) => d => `<div class="perio-locais">${perioLocais(d, lado).map(i => f(d, i)).join('')}</div>`;
  const nivelInsercao = (d, i) => { const x = dente(d); return x.ps[i] != null && x.rec[i] != null ? x.ps[i] + x.rec[i] : ''; };
  const face = (rot, f) => [
    linha(`PS ${rot}`, sitios(f, (d, i) => medida(d, 'ps', i))),
    anterior ? linha('PS anterior', sitios(f, (d, i) => `<span class="${perioCor(anterior[d]?.ps?.[i])}">${anterior[d]?.ps?.[i] ?? ''}</span>`), 'ant') : '',
    linha(`Recessão ${rot}`, sitios(f, (d, i) => medida(d, 'rec', i))),
    linha(`NI ${rot}`, sitios(f, (d, i) => `<span data-ni="${d}-${i}">${nivelInsercao(d, i)}</span>`), 'ni'),
    linha('Hemorragia', sitios(f, (d, i) => marca(d, 'hem', i))),
    linha('Placa', sitios(f, (d, i) => marca(d, 'pla', i))),
  ].join('');
  // mobilidade e furca: grau 0 a 3 por dente
  const grau = k => d => soLeitura ? (dente(d)[k] || '')
    : `<input class="perio-num" data-d="${d}" data-k="${k}" value="${dente(d)[k] || ''}" inputmode="numeric" maxlength="1" aria-label="${d} ${k}" ${off(d)}>`;
  const lingual = nome === 'Maxilar' ? 'P' : 'L';
  const corpo = [
    linha('Ausente', d => soLeitura ? (dente(d).ausente ? '×' : '') : `<input type="checkbox" class="perio-aus" data-d="${d}" ${dente(d).ausente ? 'checked' : ''} aria-label="${d} ausente">`),
    linha('Mobilidade', grau('mob')), linha('Furca', grau('furca')),
  ];
  const v = face('V', 'V'), l = face(lingual, 'L');
  return `<h3>${nome}</h3><div class="tbl-wrap"><table class="perio">
    <thead><tr><th></th>${dentes.map(d => `<th>${d}</th>`).join('')}</tr></thead>
    <tbody>${nome === 'Maxilar' ? corpo.join('') + v + l : l + v + corpo.join('')}</tbody></table></div>`;
}

function perioLer(el) {
  const dados = {};
  for (const [, dentes] of PERIO_ARCOS) for (const d of dentes) dados[d] = perioVazio();
  for (const i of $$('[data-d]', el)) {
    const t = dados[i.dataset.d];
    if (i.classList.contains('perio-aus')) t.ausente = i.checked ? 1 : 0;
    else if (i.type === 'checkbox') t[i.dataset.k][i.dataset.i] = i.checked ? 1 : 0;
    else if (i.dataset.i == null) t[i.dataset.k] = i.value.trim() === '' ? 0 : Number(i.value);
    else t[i.dataset.k][i.dataset.i] = i.value.trim() === '' ? null : Number(i.value);
  }
  return dados;
}

function perioFactos(ix, ant) {
  const f = (l, k, suf, d) => {
    const dif = ant ? ix[k] - ant[k] : 0;
    return `<div class="fact"><div class="l">${l}</div><div class="v">${num(ix[k], d)}${suf}</div>${ant ? `<div class="small">${dif > 0 ? '+' : ''}${num(dif, d)} vs. anterior</div>` : ''}</div>`;
  };
  return `<div class="facts">${f('Índice de placa', 'placa_pct', '%', 1)}${f('Índice de hemorragia', 'hemorragia_pct', '%', 1)}${f('Profundidade média', 'ps_media', ' mm', 2)}${f('Locais ≥ 4 mm', 'locais_4mm', '', 0)}</div>`;
}

async function tabPerio(el, p, st = {}) {
  const exames = await GET(`pacientes/${p.id}/perio`);
  const cur = st.id === 'novo' ? null : byId(exames, st.id) || exames[0] || null;
  const outros = exames.filter(e => e !== cur);
  const comp = st.comp === '' ? null : byId(outros, st.comp) || (cur ? outros.find(e => e.data <= cur.data) : outros[0]) || null;
  // exame novo: parte dos dentes ausentes do último exame
  const dados = cur ? cur.dados : Object.fromEntries(Object.entries(exames[0]?.dados || {}).filter(([, d]) => d.ausente).map(([k]) => [k, { ...perioVazio(), ausente: 1 }]));
  const rotulo = e => `${fmtDate(e.data)}${e.medico_nome ? ' · ' + e.medico_nome : ''}`;
  el.innerHTML = `<div class="card"><div class="row end">
      ${fld('Exame', sel('pe-sel', `<option value="novo" ${cur ? '' : 'selected'}>Novo exame</option>${opts(exames, cur?.id, { label: rotulo })}`, 'id="pe-sel"'))}
      ${fld('Comparar com', sel('pe-comp', opts(outros, comp?.id, { label: rotulo, empty: '— sem comparação —' }), 'id="pe-comp"'))}
      ${fld('Data', inp('pe-data', cur ? cur.data : isoDate(), 'type="date" id="pe-data"'))}
      ${fld('Médico', sel('pe-med', opts(ativos(L().medicos), cur ? cur.medico_id : App.user.medico_id || p.medico_id, { empty: '—' }), 'id="pe-med"'))}
      <div class="spacer"></div>
      ${cur ? `${App.user.perfil === 'admin' ? '<button id="pe-del" class="icon" title="Eliminar exame" aria-label="Eliminar exame"><i data-ic="trash"></i></button>' : ''}<button id="pe-print" class="icon" title="Imprimir exame" aria-label="Imprimir exame"><i data-ic="printer"></i></button>` : ''}
      <button class="primary" id="pe-save">${cur ? 'Guardar alterações' : 'Guardar exame'}</button>
    </div></div>
    ${cur ? perioFactos(cur.indices, comp && comp.indices) : ''}
    <div class="card" id="pe-grid">${PERIO_ARCOS.map(([n, ds]) => perioArco(n, ds, dados, comp && comp.dados)).join('')}
      <div class="muted small" style="margin-top:6px">PS: profundidade de sondagem · NI: nível de inserção (PS + recessão) · <span class="p4">≥ 4 mm</span> <span class="p6">≥ 6 mm</span> · Enter avança para o local seguinte</div></div>
    <div class="card">${fld('Notas', txt('pe-notas', cur ? cur.notas : '', 'id="pe-notas"'))}</div>`;
  const grid = $('#pe-grid', el);
  const redo = s => tabPerio(el, p, s);
  $('#pe-sel', el).onchange = e => redo({ id: e.target.value });
  $('#pe-comp', el).onchange = e => redo({ id: cur ? cur.id : 'novo', comp: e.target.value });
  grid.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !e.target.matches('input')) return;
    e.preventDefault();
    const todos = $$('input:not(:disabled)', grid); const n = todos[todos.indexOf(e.target) + 1];
    if (n) { n.focus(); if (n.select) n.select(); }
  });
  grid.addEventListener('input', e => {
    const i = e.target; if (!i.classList.contains('perio-num')) return;
    const valido = perioValido(i.value);
    i.classList.toggle('invalido', !valido);
    if (valido) i.removeAttribute('aria-invalid'); else i.setAttribute('aria-invalid', 'true');
    if (i.dataset.k === 'ps') { i.classList.remove('p4', 'p6'); if (perioCor(Number(i.value))) i.classList.add(perioCor(Number(i.value))); }
    if (i.dataset.i != null) {
      const v = k => $(`input[data-d="${i.dataset.d}"][data-k="${k}"][data-i="${i.dataset.i}"]`, grid).value;
      const ni = $(`[data-ni="${i.dataset.d}-${i.dataset.i}"]`, grid);
      const ps = Number(v('ps')), rec = Number(v('rec'));
      if (ni) ni.textContent = v('ps') !== '' && v('rec') !== '' && Number.isInteger(ps + rec) ? ps + rec : '';
    }
  });
  grid.addEventListener('change', e => {
    if (!e.target.classList.contains('perio-aus')) return;
    const d = e.target.dataset.d;
    $$(`[data-d="${d}"]:not(.perio-aus)`, grid).forEach(x => { x.disabled = e.target.checked; x.closest('td').classList.toggle('aus', e.target.checked); });
    e.target.closest('td').classList.toggle('aus', e.target.checked);
  });
  $('#pe-save', el).onclick = async () => {
    const mau = $$('.perio-num:not(:disabled)', grid).find(i => !perioValido(i.value));
    if (mau) { mau.focus(); return toast(`Valor inválido em ${mau.getAttribute('aria-label')}: use só números`, true); }
    const body = { data: $('#pe-data', el).value, medico_id: Number($('#pe-med', el).value) || null, notas: $('#pe-notas', el).value, dados: perioLer(grid) };
    const e = await act(() => cur ? PUT(`perio/${cur.id}`, body) : POST(`pacientes/${p.id}/perio`, body), 'Exame guardado').catch(() => null);
    if (e) { App.dirty = false; redo({ id: e.id, comp: $('#pe-comp', el).value }); }
  };
  if (!cur) return;
  if ($('#pe-del', el)) $('#pe-del', el).onclick = async () => {
    if (!await confirmDlg(`Eliminar o exame de ${fmtDate(cur.data)}?`, 'Eliminar', true)) return;
    await act(() => DEL(`perio/${cur.id}`), 'Exame eliminado'); redo({});
  };
  $('#pe-print', el).onclick = () => printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Periodontograma</h2>${esc(p.nome)} · processo n.º ${esc(p.numero)}<br>${esc(rotulo(cur))}</div></div>
    ${perioFactos(cur.indices, comp && comp.indices)}${PERIO_ARCOS.map(([n, ds]) => perioArco(n, ds, cur.dados, null, true)).join('')}
    ${cur.notas ? `<p>${esc(cur.notas).replace(/\n/g, '<br>')}</p>` : ''}</div>`);
}
