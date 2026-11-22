'use strict';
/* Pacientes: lista, ficha, anamnese, odontograma, tratamentos, notas */

route('pacientes', async (view) => {
  view.innerHTML = `<div class="page-head"><h1>Pacientes</h1><div class="spacer"></div>
    <label class="check"><input type="checkbox" id="pl-inat"> Incluir inativos</label>
    <button id="pl-csv">⇩ Exportar</button><button class="primary" id="pl-new">＋ Novo paciente</button></div>
    <div class="card"><input id="pl-q" placeholder="Pesquisar por nome, NIF, telemóvel, e-mail ou n.º de processo…" style="margin-bottom:12px"><div id="pl-res"></div></div>`;
  let rows = [];
  const cols = [
    { h: 'N.º', f: p => esc(p.numero) }, { h: 'Nome', f: p => `<b>${esc(p.nome)}</b>` }, { h: 'Idade', f: p => esc(idade(p.data_nasc)) },
    { h: 'NIF', f: p => esc(p.nif) }, { h: 'Telemóvel', f: p => esc(p.telemovel || p.telefone) }, { h: 'E-mail', f: p => esc(p.email) },
    { h: 'Médico', f: p => esc(p.medico_nome) }, { h: 'Entidade', f: p => esc(p.entidade_nome) },
  ];
  const load = async () => {
    rows = await GET(`pacientes?limit=500&ativos=${$('#pl-inat').checked ? 0 : 1}&q=${encodeURIComponent($('#pl-q').value)}`);
    $('#pl-res').innerHTML = `<div class="tbl-wrap">${table(rows, cols, { onClick: p => go('#/paciente/' + p.id), rowCls: p => p.ativo ? '' : 'off' })}</div>
      <div class="muted small" style="margin-top:6px">${rows.length} paciente(s)${rows.length >= 500 ? ' (mostrando os primeiros 500)' : ''}</div>`;
  };
  $('#pl-q').oninput = debounce(load); $('#pl-inat').onchange = load;
  $('#pl-new').onclick = () => editPaciente(null, p => go('#/paciente/' + p.id));
  $('#pl-csv').onclick = () => downloadCSV('pacientes', rows, cols);
  $('#pl-q').focus();
  await load();
});

// ---------- criar/editar paciente ----------
async function editPaciente(id, onSaved) {
  const lk = L();
  const p = id ? await GET('t/pacientes/' + id) : { sms_ok: 1, email_ok: 1, ativo: 1 };
  const body = `<form class="form-grid" onsubmit="return false">
    ${fld('Nome completo *', inp('nome', p.nome, 'required'), 's3')}${fld('N.º processo', inp('numero', p.numero, 'type="number" placeholder="automático"'))}
    ${fld('Data de nascimento', inp('data_nasc', p.data_nasc, 'type="date"'))}${fld('Género', sel('genero', optsArr([['', '—'], ['F', 'Feminino'], ['M', 'Masculino'], ['O', 'Outro']], p.genero)))}
    ${fld('NIF', inp('nif', p.nif, 'maxlength="9" inputmode="numeric"'))}${fld('N.º Utente SNS', inp('sns', p.sns))}
    ${fld('Telemóvel', inp('telemovel', p.telemovel, 'type="tel"'))}${fld('Telefone', inp('telefone', p.telefone, 'type="tel"'))}${fld('E-mail', inp('email', p.email, 'type="email"'), 's2')}
    ${fld('Morada', inp('morada', p.morada), 's2')}${fld('Código postal', inp('cod_postal', p.cod_postal, 'placeholder="0000-000"'))}${fld('Localidade', inp('localidade', p.localidade))}
    ${fld('Cartão de Cidadão', inp('cc', p.cc))}${fld('Profissão', inp('profissao', p.profissao))}
    ${fld('Entidade / seguro', sel('entidade_id', opts(lk.entidades, p.entidade_id, { empty: '—', only: x => x.ativo })))}${fld('N.º beneficiário', inp('num_beneficiario', p.num_beneficiario))}
    ${fld('Médico assistente', sel('medico_id', opts(lk.medicos, p.medico_id, { empty: '—', only: x => x.ativo })), 's2')}
    ${fld('Razão da 1.ª visita', sel('razao_visita_id', opts(lk.razoes, p.razao_visita_id, { empty: '—', label: 'descricao', only: x => x.ativo })), 's2')}
    ${fld('Observações', txt('notas', p.notas), 's4')}
    <div class="s4">${chk('rgpd_consent', p.rgpd_consent, 'Consentimento RGPD assinado')} ${chk('sms_ok', p.sms_ok, 'Aceita SMS')} ${chk('email_ok', p.email_ok, 'Aceita e-mail')} ${id ? chk('ativo', p.ativo, 'Ativo') : ''}</div>
  </form>`;
  modal({ title: id ? 'Editar paciente' : 'Novo paciente', size: 'lg', body, buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.nome.trim()) throw new Error('O nome é obrigatório');
    if (f.rgpd_consent && !p.rgpd_consent) f.rgpd_data = isoDate();
    for (const k of ['entidade_id', 'medico_id', 'razao_visita_id']) f[k] = f[k] ? Number(f[k]) : null;
    const r = id ? await PUT('t/pacientes/' + id, f) : await POST('t/pacientes', f);
    toast('Paciente guardado'); onSaved && onSaved(r);
  } }] });
}

// ---------- ficha do paciente ----------
const FICHA_TABS = [['resumo', 'Resumo'], ['odontograma', 'Odontograma'], ['tratamentos', 'Tratamentos'], ['anamnese', 'Anamnese'],
  ['notas', 'Notas clínicas'], ['marcacoes', 'Marcações'], ['orcamentos', 'Orçamentos'], ['cc', 'Conta corrente'], ['proteses', 'Próteses']];

route('paciente', async (view, [id, tab = 'resumo']) => {
  const p = await GET(`pacientes/${id}/resumo`);
  const a = p.anamnese || {};
  const alertas = [a.alergias && `Alergias: ${a.alergias}`, a.anticoagulantes && 'Anticoagulantes', a.cardiaco && 'Doença cardíaca', a.diabetes && 'Diabetes',
    a.hipertensao && 'Hipertensão', a.gravidez && 'Gravidez', a.hepatite && 'Hepatite'].filter(Boolean);
  view.innerHTML = `<div class="card" style="padding:14px 16px">
    <div class="row">
      <div style="font-size:2rem">${p.genero === 'M' ? '👨' : p.genero === 'F' ? '👩' : '🧑'}</div>
      <div><h1 style="margin:0">${esc(p.nome)} ${p.ativo ? '' : '<span class="badge">Inativo</span>'}</h1>
        <div class="muted small">Processo n.º ${esc(p.numero)} · ${p.data_nasc ? `${fmtDate(p.data_nasc)} (${idade(p.data_nasc)} anos)` : 'sem data de nascimento'}
        ${p.nif ? ' · NIF ' + esc(p.nif) : ''}${p.telemovel ? ' · 📱 ' + esc(p.telemovel) : ''}${p.entidade_nome ? ' · ' + esc(p.entidade_nome) : ''}</div></div>
      <div class="spacer"></div>
      <div class="right"><div class="muted small">Saldo</div><div class="bold ${p.saldo.saldo > 0 ? 'danger' : 'ok'}" style="font-size:1.2rem">${eur(p.saldo.saldo)}</div></div>
      <button id="pf-marc" class="primary">＋ Marcação</button><button id="pf-edit">✎ Editar</button><button id="pf-print">🖨</button>
    </div>
    ${alertas.length ? `<div class="alert danger" style="margin:10px 0 0">⚠ ${alertas.map(esc).join(' · ')}</div>` : ''}
    ${!p.rgpd_consent ? '<div class="alert" style="margin:10px 0 0">Sem consentimento RGPD registado.</div>' : ''}
  </div>
  <div class="tabs">${FICHA_TABS.map(([k, l]) => `<button class="${k === tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div id="pf-body"></div>`;
  $$('.tabs button', view).forEach(b => b.onclick = () => go(`#/paciente/${id}/${b.dataset.t}`));
  $('#pf-edit').onclick = () => editPaciente(p.id, () => render());
  $('#pf-marc').onclick = () => openMarcacao({ paciente: { id: p.id, nome: p.nome }, medico_id: p.medico_id });
  $('#pf-print').onclick = () => imprimirFicha(p);
  const body = $('#pf-body');
  const fns = { resumo: tabResumo, odontograma: tabOdonto, tratamentos: tabTratamentos, anamnese: tabAnamnese, notas: tabNotas,
    marcacoes: tabMarcacoes, orcamentos: tabOrcamentosPac, cc: tabContaCorrente, proteses: tabProtesesPac };
  await (fns[tab] || tabResumo)(body, p);
});

async function tabResumo(el, p) {
  const [trat, notas] = await Promise.all([GET(`pacientes/${p.id}/tratamentos`), GET(`pacientes/${p.id}/notas`)]);
  const plan = trat.filter(t => t.estado === 'planeado');
  el.innerHTML = `<div class="grid g3">
    <div class="card"><h3>Contactos</h3>
      <div>${esc(p.morada)}<br>${esc(p.cod_postal)} ${esc(p.localidade)}</div>
      <div style="margin-top:8px">📱 ${esc(p.telemovel || '—')} ${p.telefone ? '· ☎ ' + esc(p.telefone) : ''}<br>✉ ${esc(p.email || '—')}</div>
      <div class="muted small" style="margin-top:8px">SNS: ${esc(p.sns || '—')} · CC: ${esc(p.cc || '—')}<br>Profissão: ${esc(p.profissao || '—')}</div>
      <div class="muted small" style="margin-top:8px">Médico: ${esc(p.medico_nome || '—')}<br>1.ª visita: ${esc(p.razao_nome || '—')}<br>Criado em ${fmtDate(p.criado_em)}</div>
      ${p.notas ? `<div class="alert info" style="margin-top:10px">${esc(p.notas)}</div>` : ''}</div>
    <div class="card"><h3>Consultas</h3>
      <div><span class="muted">Próxima:</span> ${p.proxima ? `<b>${fmtDT(p.proxima.inicio)}</b> · ${esc(p.proxima.medico_nome)}<br><span class="small">${esc(p.proxima.servico_nome || '')} · ${esc(p.proxima.estado_nome)}</span>` : '—'}</div>
      <div style="margin-top:10px"><span class="muted">Última:</span> ${p.ultima ? `${fmtDT(p.ultima.inicio)} · ${esc(p.ultima.medico_nome)} · ${esc(p.ultima.estado_nome)}` : '—'}</div>
      <h3 style="margin-top:16px">Financeiro</h3>
      <div class="grid g3 small"><div><div class="muted">Faturado</div><b>${eur(p.saldo.faturado)}</b></div><div><div class="muted">Pago</div><b>${eur(p.saldo.pago)}</b></div>
      <div><div class="muted">Em dívida</div><b class="${p.saldo.saldo > 0 ? 'danger' : ''}">${eur(p.saldo.saldo)}</b></div></div></div>
    <div class="card"><h3>Plano de tratamento (${plan.length})</h3>
      ${plan.length ? plan.slice(0, 8).map(t => `<div class="row between small" style="padding:3px 0;border-bottom:1px solid var(--line2)"><span>${t.dente ? `<b>${esc(t.dente)}</b> ` : ''}${esc(t.descricao)}</span><span>${eur(t.preco * (1 - (t.desconto_pct || 0) / 100))}</span></div>`).join('')
        + `<div class="row between" style="margin-top:6px"><b>Total</b><b>${eur(plan.reduce((s, t) => s + t.preco * (1 - (t.desconto_pct || 0) / 100), 0))}</b></div>` : '<div class="muted">Sem tratamentos planeados</div>'}
    </div></div>
    <div class="card"><h3>Últimas notas clínicas</h3>${notas.slice(0, 5).map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--line2)"><div class="muted small">${fmtDT(n.data.replace(' ', 'T'))} · ${esc(n.medico_nome || n.user_nome || '')}</div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="muted">Sem notas</div>'}</div>`;
}

// ---------- anamnese ----------
async function tabAnamnese(el, p) {
  const a = p.anamnese || {};
  el.innerHTML = `<div class="card"><form class="form-grid" onsubmit="return false">
    ${fld('Alergias', txt('alergias', a.alergias, 'placeholder="Ex.: penicilina, látex, anestésicos…"'), 's2')}
    ${fld('Doenças / antecedentes', txt('doencas', a.doencas), 's2')}
    ${fld('Medicação habitual', txt('medicacao', a.medicacao), 's2')}
    ${fld('Observações', txt('observacoes', a.observacoes), 's2')}
    ${fld('Fumador', sel('fumador', optsArr(['', 'Não', 'Sim', 'Ex-fumador'], a.fumador)))}
    <div class="s3" style="padding-top:20px">${chk('hipertensao', a.hipertensao, 'Hipertensão')}${chk('diabetes', a.diabetes, 'Diabetes')}${chk('cardiaco', a.cardiaco, 'Doença cardíaca')}
      ${chk('anticoagulantes', a.anticoagulantes, 'Anticoagulantes')}${chk('hepatite', a.hepatite, 'Hepatite')}${chk('gravidez', a.gravidez, 'Gravidez')}</div>
    <div class="s4 row between"><span class="muted small">${a.atualizado_em ? 'Atualizado em ' + esc(a.atualizado_em) : ''}</span><button class="primary" id="an-save">Guardar anamnese</button></div>
  </form></div>`;
  $('#an-save').onclick = async () => { await act(() => PUT('anamnese/' + p.id, readForm($('form', el))), 'Anamnese guardada'); render(); };
}

// ---------- notas clínicas ----------
async function tabNotas(el, p) {
  const notas = await GET(`pacientes/${p.id}/notas`);
  el.innerHTML = `<div class="card"><h3>Nova nota</h3><textarea id="nt-txt" placeholder="Descrição clínica, observações, procedimentos efetuados…" style="min-height:90px"></textarea>
    <div class="row end" style="margin-top:8px">${fld('Médico', sel('nt-med', opts(ativos(L().medicos), App.user.medico_id || p.medico_id, { empty: '—' }), 'id="nt-med"'))}<button class="primary" id="nt-add">Adicionar nota</button></div></div>
    <div class="card">${notas.map(n => `<div style="padding:10px 0;border-bottom:1px solid var(--line2)"><div class="row between"><span class="muted small">${esc(n.data)} · ${esc(n.medico_nome || '')} ${n.user_nome ? '(registado por ' + esc(n.user_nome) + ')' : ''}</span>
      <button class="ghost sm" data-del="${n.id}">🗑</button></div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="empty">Sem notas clínicas</div>'}</div>`;
  $('#nt-add').onclick = async () => {
    const texto = $('#nt-txt').value.trim(); if (!texto) return toast('Escreva a nota', true);
    await act(() => POST('notas', { paciente_id: p.id, texto, medico_id: Number($('#nt-med').value) || null }), 'Nota adicionada'); render();
  };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar esta nota?', 'Eliminar', true)) { await DEL('notas/' + b.dataset.del); render(); } });
}

// ---------- marcações do paciente ----------
async function tabMarcacoes(el, p) {
  const ms = await GET(`pacientes/${p.id}/marcacoes`);
  const faltas = ms.filter(m => m.estado_categoria === 'FALTAS').length;
  el.innerHTML = `<div class="card"><div class="row between" style="margin-bottom:10px"><span class="muted">${ms.length} marcações · ${faltas} falta(s)</span>
    <button class="primary" id="pm-new">＋ Nova marcação</button></div>${table(ms, [
    { h: 'Data', f: m => `<b>${fmtDT(m.inicio)}</b>` }, { h: 'Médico', f: m => esc(m.medico_nome) }, { h: 'Serviço', f: m => esc(m.servico_nome) },
    { h: 'Gabinete', f: m => esc(m.gabinete_nome) }, { h: 'Estado', f: m => `<span class="dot" style="background:${esc(m.estado_cor)}"></span>${esc(m.estado_nome)}` }, { h: 'Notas', f: m => esc(m.notas) },
  ], { onClick: m => openMarcacao({ id: m.id }) })}</div>`;
  $('#pm-new').onclick = () => openMarcacao({ paciente: p, medico_id: p.medico_id });
}

// ---------- odontograma ----------
const Q_UP = [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28]];
const Q_LO = [[48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]];
const D_UP = [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65]];
const D_LO = [[85, 84, 83, 82, 81], [71, 72, 73, 74, 75]];
const CONDICOES = [['carie', 'Cárie', '#ef4444'], ['restauracao', 'Restauração', '#3b82f6'], ['ausente', 'Ausente', '#9ca3af'], ['extrair', 'Extração indicada', '#dc2626'],
  ['endodontia', 'Endodontia', '#a855f7'], ['coroa', 'Coroa', '#eab308'], ['implante', 'Implante', '#16a34a'], ['fratura', 'Fratura', '#f97316'],
  ['selante', 'Selante', '#14b8a6'], ['mobilidade', 'Mobilidade', '#78716c']];
const COND = Object.fromEntries(CONDICOES.map(([k, l, c]) => [k, { l, c }]));
const FACES = { O: 'Oclusal/Incisal', V: 'Vestibular', L: 'Lingual/Palatina', M: 'Mesial', D: 'Distal' };

// posição visual das faces: superior, inferior, esquerda, direita
function facePos(n) {
  const q = Math.floor(n / 10) % 5 || 5; const qq = q > 4 ? q - 4 : q; // decíduos 5-8 -> 1-4
  const up = qq === 1 || qq === 2;
  const mesialRight = qq === 1 || qq === 4;
  return { top: up ? 'V' : 'L', bottom: up ? 'L' : 'V', left: mesialRight ? 'D' : 'M', right: mesialRight ? 'M' : 'D' };
}
function toothSVG(n, st) {
  const fp = facePos(n);
  const fill = f => st.faces[f] || '#fff';
  let extra = '';
  if (st.whole.ausente) extra += '<line x1="4" y1="4" x2="36" y2="36" stroke="#6b7280" stroke-width="3"/><line x1="36" y1="4" x2="4" y2="36" stroke="#6b7280" stroke-width="3"/>';
  if (st.whole.extrair) extra += '<line x1="4" y1="4" x2="36" y2="36" stroke="#dc2626" stroke-width="3"/><line x1="36" y1="4" x2="4" y2="36" stroke="#dc2626" stroke-width="3"/>';
  if (st.whole.coroa) extra += '<circle cx="20" cy="20" r="18" fill="none" stroke="#eab308" stroke-width="3" style="fill:none;stroke:#eab308"/>';
  if (st.whole.implante) extra += '<rect x="16" y="2" width="8" height="36" rx="2" style="fill:#16a34a;stroke:#166534;opacity:.85"/>';
  if (st.whole.endodontia) extra += '<line x1="20" y1="3" x2="20" y2="37" style="stroke:#a855f7" stroke-width="4"/>';
  if (st.whole.fratura) extra += '<polyline points="8,6 18,18 12,22 30,34" fill="none" style="fill:none;stroke:#f97316" stroke-width="2.5"/>';
  if (st.whole.mobilidade) extra += '<text x="20" y="25" text-anchor="middle" font-size="14" font-weight="700" fill="#78716c">M</text>';
  if (st.planned) extra += '<circle cx="34" cy="6" r="4.5" style="fill:#f59e0b;stroke:#fff"/>';
  return `<svg viewBox="0 0 40 40">
    <path data-f="${fp.top}" d="M2 2 L38 2 L28 12 L12 12 Z" style="fill:${fill(fp.top)}"/>
    <path data-f="${fp.bottom}" d="M2 38 L38 38 L28 28 L12 28 Z" style="fill:${fill(fp.bottom)}"/>
    <path data-f="${fp.left}" d="M2 2 L12 12 L12 28 L2 38 Z" style="fill:${fill(fp.left)}"/>
    <path data-f="${fp.right}" d="M38 2 L28 12 L28 28 L38 38 Z" style="fill:${fill(fp.right)}"/>
    <rect data-f="O" x="12" y="12" width="16" height="16" style="fill:${fill('O')}"/>${extra}</svg>`;
}

async function tabOdonto(el, p) {
  const [conds, trat] = await Promise.all([GET('t/dentes_condicoes?paciente_id=' + p.id), GET(`pacientes/${p.id}/tratamentos`)]);
  const state = {};
  const S = n => (state[n] ||= { faces: {}, whole: {}, planned: false, items: [] });
  for (const c of conds) {
    const s = S(c.dente); s.items.push({ kind: 'c', ...c });
    const faces = (c.faces || '').split('').filter(f => FACES[f]);
    if (faces.length && ['carie', 'restauracao', 'selante'].includes(c.condicao)) faces.forEach(f => s.faces[f] = COND[c.condicao].c);
    else s.whole[c.condicao] = true;
  }
  for (const t of trat) {
    if (!t.dente) continue;
    for (const d of String(t.dente).split(/[,\s]+/).filter(Boolean)) {
      const s = S(d); s.items.push({ kind: 't', ...t });
      if (t.estado === 'planeado') s.planned = true;
      if (t.estado === 'realizado' && t.faces) t.faces.split('').forEach(f => { if (FACES[f]) s.faces[f] = '#3b82f6'; });
    }
  }
  const showDec = el.dataset.dec === '1';
  const arc = rows => `<div class="arc">${rows.map((q, i) => q.map(n => `<div class="tooth ${String(n) === el.dataset.sel ? 'sel' : ''}" data-n="${n}">${rows === Q_LO || rows === D_LO ? '' : `<span class="n">${n}</span>`}${toothSVG(n, S(String(n)))}${rows === Q_LO || rows === D_LO ? `<span class="n">${n}</span>` : ''}</div>`).join('') + (i === 0 ? '<div class="gap"></div>' : '')).join('')}</div>`;
  el.innerHTML = `<div class="grid" style="grid-template-columns:minmax(0,1.6fr) minmax(0,1fr)">
    <div class="card"><div class="row between"><h3>Odontograma</h3><label class="check"><input type="checkbox" id="od-dec" ${showDec ? 'checked' : ''}> Dentição decídua</label></div>
      <div class="odonto">${arc(Q_UP)}${showDec ? arc(D_UP) + '<div style="height:10px"></div>' + arc(D_LO) : '<div style="height:14px;border-top:1px dashed var(--line);width:90%"></div>'}${arc(Q_LO)}</div>
      <div class="odonto-legend">${CONDICOES.map(([, l, c]) => `<span style="--c:${c}">${l}</span>`).join('')}<span style="--c:#f59e0b">Tratamento planeado</span></div>
      <p class="muted small center">Clique num dente (ou numa face) para ver o histórico e registar condições ou tratamentos.</p></div>
    <div class="card" id="od-panel"><div class="empty">Selecione um dente</div></div></div>`;
  $('#od-dec').onchange = e => { el.dataset.dec = e.target.checked ? '1' : '0'; tabOdonto(el, p); };
  const openPanel = (n, face) => {
    el.dataset.sel = n;
    $$('.tooth', el).forEach(t => t.classList.toggle('sel', t.dataset.n === n));
    const s = S(n);
    const panel = $('#od-panel');
    const lk = L();
    panel.innerHTML = `<h3>Dente ${esc(n)}</h3>
      ${s.items.length ? s.items.map(i => i.kind === 'c'
        ? `<div class="row between small" style="padding:4px 0;border-bottom:1px solid var(--line2)"><span><span class="dot" style="background:${COND[i.condicao]?.c}"></span>${esc(COND[i.condicao]?.l || i.condicao)}${i.faces ? ' (' + esc(i.faces) + ')' : ''} <span class="muted">${fmtDate(i.data)}</span></span><button class="ghost sm" data-dc="${i.id}">🗑</button></div>`
        : `<div class="small" style="padding:4px 0;border-bottom:1px solid var(--line2)"><span class="badge ${i.estado === 'realizado' ? 'info' : 'warn'}">${esc(i.estado)}</span> ${esc(i.descricao)}${i.faces ? ' (' + esc(i.faces) + ')' : ''} <span class="muted">${fmtDate(i.data)}</span></div>`).join('') : '<p class="muted small">Sem registos neste dente.</p>'}
      <h3 style="margin-top:14px">Faces</h3>
      <div>${Object.entries(FACES).map(([k, l]) => `<label class="check"><input type="checkbox" name="face" value="${k}" ${face === k ? 'checked' : ''}> ${k} <span class="muted small">${l}</span></label>`).join('<br>')}</div>
      <h3 style="margin-top:14px">Registar condição</h3>
      <div class="row">${sel('cond', optsArr(CONDICOES.map(([k, l]) => [k, l])), 'id="od-cond" style="flex:1"')}<button id="od-addc">Registar</button></div>
      <h3 style="margin-top:14px">Adicionar tratamento</h3>
      ${sel('serv', opts(ativos(lk.servicos), null, { empty: 'Escolha o tratamento…', label: x => `${x.codigo || ''} ${x.nome} — ${eur(x.preco)}` }), 'id="od-serv"')}
      <div class="row" style="margin-top:8px">${sel('med', opts(ativos(lk.medicos), App.user.medico_id || p.medico_id), 'id="od-med" style="flex:1"')}
        ${sel('est', optsArr([['planeado', 'Planeado'], ['realizado', 'Realizado']]), 'id="od-est" style="width:130px"')}</div>
      <div class="row end" style="margin-top:8px"><button class="primary" id="od-addt">Adicionar</button></div>`;
    const faces = () => $$('input[name=face]:checked', panel).map(i => i.value).join('');
    $('#od-addc').onclick = async () => {
      await act(() => POST('t/dentes_condicoes', { paciente_id: p.id, dente: n, condicao: $('#od-cond').value, faces: faces(), data: isoDate() }), 'Condição registada');
      tabOdonto(el, p);
    };
    $('#od-addt').onclick = async () => {
      const sv = byId(lk.servicos, $('#od-serv').value); if (!sv) return toast('Escolha o tratamento', true);
      const ent = byId(lk.entidades, p.entidade_id);
      await act(() => POST('t/tratamentos', { paciente_id: p.id, medico_id: Number($('#od-med').value), servico_id: sv.id, descricao: sv.nome, dente: n, faces: faces(),
        estado: $('#od-est').value, data: isoDate(), preco: sv.preco, iva: sv.iva, desconto_pct: ent?.desconto_pct || 0 }), 'Tratamento adicionado');
      tabOdonto(el, p);
    };
    $$('[data-dc]', panel).forEach(b => b.onclick = async () => { await DEL('t/dentes_condicoes/' + b.dataset.dc); tabOdonto(el, p); });
  };
  $$('.tooth', el).forEach(t => t.onclick = e => openPanel(t.dataset.n, e.target.closest('[data-f]')?.dataset.f));
  if (el.dataset.sel) openPanel(el.dataset.sel);
}

// ---------- tratamentos ----------
async function tabTratamentos(el, p) {
  const trat = await GET(`pacientes/${p.id}/tratamentos`);
  const liq = t => t.preco * (1 - (t.desconto_pct || 0) / 100) * (1 + (t.iva || 0) / 100);
  const porFaturar = trat.filter(t => t.estado === 'realizado' && !t.documento_id);
  el.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px">
      <button class="primary" id="tr-new">＋ Tratamento</button>
      <button id="tr-fat" ${porFaturar.length ? '' : 'disabled'}>🧾 Faturar realizados (${porFaturar.length})</button>
      <button id="tr-orc">📄 Orçamento do plano</button>
      <div class="spacer"></div><span class="muted small">Selecione linhas para ações em lote:</span>
      <button class="sm" id="tr-done">✔ Marcar realizado</button><button class="sm" id="tr-fsel">🧾 Faturar seleção</button></div>
    ${table(trat, [
      { h: '', f: t => `<input type="checkbox" data-sel="${t.id}">` },
      { h: 'Data', f: t => fmtDate(t.data) }, { h: 'Dente', f: t => `<b>${esc(t.dente)}</b>${t.faces ? ' <span class="muted small">' + esc(t.faces) + '</span>' : ''}` },
      { h: 'Tratamento', f: t => esc(t.descricao) }, { h: 'Médico', f: t => esc(t.medico_nome) },
      { h: 'Estado', f: t => `<span class="badge ${t.estado === 'realizado' ? 'info' : 'warn'}">${esc(t.estado)}</span>` },
      { h: 'Valor', cls: 'right', f: t => eur(liq(t)) + (t.desconto_pct ? ` <span class="muted small">-${num(t.desconto_pct)}%</span>` : '') },
      { h: 'Documento', f: t => t.documento_numero ? `<a href="#" data-doc="${t.documento_id}">${esc(t.documento_numero)}</a>` : (t.estado === 'realizado' ? '<span class="warn small">por faturar</span>' : '') },
      { h: '', cls: 'right', f: t => `<button class="ghost sm" data-ed="${t.id}">✎</button>${t.documento_id ? '' : `<button class="ghost sm" data-del="${t.id}">🗑</button>`}` },
    ], { empty: 'Sem tratamentos registados' })}
    <div class="row end" style="margin-top:10px;gap:24px"><span>Planeado: <b>${eur(trat.filter(t => t.estado === 'planeado').reduce((s, t) => s + liq(t), 0))}</b></span>
      <span>Realizado: <b>${eur(trat.filter(t => t.estado === 'realizado').reduce((s, t) => s + liq(t), 0))}</b></span></div></div>`;
  const selIds = () => $$('[data-sel]:checked', el).map(c => Number(c.dataset.sel));
  $('#tr-new').onclick = () => editTratamento(null, p, () => tabTratamentos(el, p));
  $$('[data-ed]', el).forEach(b => b.onclick = () => editTratamento(byId(trat, b.dataset.ed), p, () => tabTratamentos(el, p)));
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar este tratamento?', 'Eliminar', true)) { await DEL('t/tratamentos/' + b.dataset.del); tabTratamentos(el, p); } });
  $$('[data-doc]', el).forEach(a => a.onclick = e => { e.preventDefault(); verDocumento(Number(a.dataset.doc)); });
  $('#tr-done').onclick = async () => {
    const ids = selIds(); if (!ids.length) return toast('Selecione tratamentos', true);
    for (const id of ids) await PUT('t/tratamentos/' + id, { estado: 'realizado', data: isoDate() });
    toast('Tratamentos marcados como realizados'); tabTratamentos(el, p);
  };
  const faturar = list => emitirDocumento({ paciente: p, tratamentos: list, onDone: () => tabTratamentos(el, p) });
  $('#tr-fat').onclick = () => faturar(porFaturar);
  $('#tr-fsel').onclick = () => { const l = trat.filter(t => selIds().includes(t.id) && !t.documento_id); if (!l.length) return toast('Selecione tratamentos por faturar', true); faturar(l); };
  $('#tr-orc').onclick = () => {
    const plan = trat.filter(t => t.estado === 'planeado' && !t.orcamento_id);
    editOrcamento(null, { paciente: p, linhas: plan.map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco, desconto_pct: t.desconto_pct, iva: t.iva })) });
  };
}

function editTratamento(t, p, onSaved) {
  const lk = L(); t = t || { estado: 'planeado', data: isoDate(), medico_id: App.user.medico_id || p.medico_id };
  const ent = byId(lk.entidades, p.entidade_id);
  modal({ title: t.id ? 'Editar tratamento' : 'Novo tratamento', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Tratamento', sel('servico_id', opts(lk.servicos, t.servico_id, { empty: '—', only: x => x.ativo, label: x => `${x.codigo || ''} ${x.nome}` })), 's4')}
    ${fld('Descrição', inp('descricao', t.descricao), 's4')}
    ${fld('Dente(s)', inp('dente', t.dente, 'placeholder="ex.: 16 ou 11,21"'))}${fld('Faces', inp('faces', t.faces, 'placeholder="O M D V L"'))}
    ${fld('Estado', sel('estado', optsArr([['planeado', 'Planeado'], ['realizado', 'Realizado']], t.estado)))}${fld('Data', inp('data', t.data, 'type="date"'))}
    ${fld('Médico', sel('medico_id', opts(lk.medicos, t.medico_id, { only: x => x.ativo })), 's2')}
    ${fld('Preço (€)', inp('preco', t.preco ?? '', 'type="number" step="0.01"'))}${fld('Desconto %', inp('desconto_pct', t.desconto_pct ?? ent?.desconto_pct ?? 0, 'type="number" step="0.01"'))}
    ${fld('IVA %', inp('iva', t.iva ?? 0, 'type="number" step="0.01"'))}${fld('Notas', inp('notas', t.notas), 's3')}
  </form>`, buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.descricao) throw new Error('Indique a descrição');
    f.paciente_id = p.id; f.servico_id = f.servico_id ? Number(f.servico_id) : null; f.medico_id = Number(f.medico_id);
    f.faces = (f.faces || '').toUpperCase().replace(/[^OVLMDP]/g, '').replace(/P/g, 'L');
    t.id ? await PUT('t/tratamentos/' + t.id, f) : await POST('t/tratamentos', f);
    toast('Tratamento guardado'); onSaved();
  } }], onOpen: c => {
    const form = $('form', c.body);
    form.servico_id.onchange = () => { const s = byId(lk.servicos, form.servico_id.value); if (s) { form.descricao.value = s.nome; form.preco.value = s.preco; form.iva.value = s.iva; } };
  } });
}

// ---------- impressão da ficha ----------
async function imprimirFicha(p) {
  const [trat, notas] = await Promise.all([GET(`pacientes/${p.id}/tratamentos`), GET(`pacientes/${p.id}/notas`)]);
  const a = p.anamnese || {};
  printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Ficha clínica</h2>Processo n.º ${esc(p.numero)}<br>${fmtDate(isoDate())}</div></div>
    <h3>${esc(p.nome)}</h3><p>Data nasc.: ${fmtDate(p.data_nasc)} · NIF: ${esc(p.nif)} · SNS: ${esc(p.sns)}<br>${esc(p.morada)}, ${esc(p.cod_postal)} ${esc(p.localidade)}<br>Tel.: ${esc(p.telemovel)} ${esc(p.telefone)} · ${esc(p.email)}<br>Entidade: ${esc(p.entidade_nome || 'Particular')}</p>
    <h3>Anamnese</h3><p>Alergias: ${esc(a.alergias || '—')}<br>Doenças: ${esc(a.doencas || '—')}<br>Medicação: ${esc(a.medicacao || '—')}<br>Fumador: ${esc(a.fumador || '—')}
    ${['hipertensao', 'diabetes', 'cardiaco', 'anticoagulantes', 'hepatite', 'gravidez'].filter(k => a[k]).map(k => ' · ' + k).join('')}</p>
    <h3>Tratamentos</h3><table><tr><th>Data</th><th>Dente</th><th>Tratamento</th><th>Médico</th><th>Estado</th></tr>${trat.map(t => `<tr><td>${fmtDate(t.data)}</td><td>${esc(t.dente)} ${esc(t.faces)}</td><td>${esc(t.descricao)}</td><td>${esc(t.medico_nome)}</td><td>${esc(t.estado)}</td></tr>`).join('')}</table>
    <h3>Notas clínicas</h3>${notas.map(n => `<p><b>${esc(n.data)}</b> ${esc(n.medico_nome || '')}<br>${esc(n.texto).replace(/\n/g, '<br>')}</p>`).join('') || '<p>—</p>'}</div>`);
}
