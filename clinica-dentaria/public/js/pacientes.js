'use strict';
/* Pacientes: lista, ficha, anamnese, odontograma, tratamentos, notas */

route('pacientes', async (view) => {
  view.innerHTML = `<div class="page-head"><h1>Pacientes</h1><div class="spacer"></div>
    <label class="check"><input type="checkbox" id="pl-inat"> Incluir inativos</label>
    <button id="pl-csv">Exportar</button></div>
    <div class="card"><input id="pl-q" placeholder="Pesquisar por nome, NIF, telemóvel, e-mail ou n.º de processo…" style="margin-bottom:12px"><div id="pl-res"></div></div>`;
  let rows = [], lim = 500;
  const cols = [
    { h: 'N.º', f: p => esc(p.numero) }, { h: 'Nome', f: p => `<b>${esc(p.nome)}</b>${p.ativo ? '' : ' <span class="badge">Inativo</span>'}` }, { h: 'Idade', f: p => esc(idade(p.data_nasc)) },
    { h: 'NIF', f: p => esc(p.nif) }, { h: 'Telemóvel', f: p => esc(p.telemovel || p.telefone) }, { h: 'E-mail', f: p => esc(p.email) },
    { h: 'Médico', f: p => esc(p.medico_nome) }, { h: 'Entidade', f: p => esc(p.entidade_nome) },
  ];
  const load = async () => {
    rows = await GET(`pacientes?limit=${lim}&ativos=${$('#pl-inat').checked ? 0 : 1}&q=${encodeURIComponent($('#pl-q').value)}`);
    $('#pl-res').innerHTML = `<div class="tbl-wrap">${table(rows, cols, { onClick: p => go('#/paciente/' + p.id), rowCls: p => p.ativo ? '' : 'off' })}</div>
      <div class="row muted small" style="margin-top:6px">${rows.length} paciente(s)${rows.length >= lim ? (lim < 1000 ? ` (mostrando os primeiros ${lim}) <button class="sm" id="pl-mais">Mostrar mais</button>` : ' (máximo de 1000 — use a pesquisa para encontrar os restantes)') : ''}</div>`;
    const mais = $('#pl-mais'); if (mais) mais.onclick = () => { lim = Math.min(lim + 500, 1000); load(); };
  };
  const reset = () => { lim = 500; load(); };
  $('#pl-q').oninput = debounce(reset); $('#pl-inat').onchange = reset;
  $('#pl-csv').onclick = () => downloadCSV('pacientes', rows, cols);
  $('#pl-q').focus();
  await load();
});

// ---------- criar/editar paciente ----------
// prefill (só em novo): valores iniciais, ex. { nome } vindo da pesquisa global
async function editPaciente(id, onSaved, prefill = {}) {
  const lk = L();
  const p = id ? await GET('t/pacientes/' + id) : { sms_ok: 1, email_ok: 1, ativo: 1, ...prefill };
  const body = `<form class="form-grid" onsubmit="return false">
    ${fld('Título', sel('titulo', optsArr(['', 'Sr.', 'Sra.', 'Dr.', 'Dra.', 'Eng.', 'Prof.', 'Criança'], p.titulo)))}${fld('Nome completo *', inp('nome', p.nome, 'required'), 's3')}
    ${fld('N.º processo', inp('numero', p.numero, 'type="number" placeholder="automático"'))}${fld('ID externo', inp('id_externo', p.id_externo, 'placeholder="ex.: n.º no sistema antigo"'))}
    ${fld('Data de nascimento', inp('data_nasc', p.data_nasc, 'type="date"'))}${fld('Género', sel('genero', optsArr([['', '—'], ['F', 'Feminino'], ['M', 'Masculino'], ['O', 'Outro']], p.genero)))}
    ${fld('NIF', inp('nif', p.nif, 'maxlength="9" inputmode="numeric"'))}${fld('N.º Utente SNS', inp('sns', p.sns))}
    ${fld('Telemóvel', inp('telemovel', p.telemovel, 'type="tel"'))}${fld('Telefone', inp('telefone', p.telefone, 'type="tel"'))}${fld('E-mail', inp('email', p.email, 'type="email"'), 's2')}
    ${fld('Morada', inp('morada', p.morada), 's2')}${fld('Código postal', inp('cod_postal', p.cod_postal, 'placeholder="0000-000"'))}${fld('Localidade', inp('localidade', p.localidade))}
    ${fld('Cartão de Cidadão', inp('cc', p.cc))}${fld('Profissão', inp('profissao', p.profissao))}
    ${fld('Nacionalidade', inp('nacionalidade', p.nacionalidade ?? (id ? '' : 'Portuguesa'), 'list="dl-nac"'))}${fld('Idioma', sel('idioma', optsArr([['', '—'], ['PT', 'Português'], ['EN', 'Inglês'], ['FR', 'Francês'], ['ES', 'Espanhol'], ['DE', 'Alemão'], ['IT', 'Italiano']], p.idioma)))}
    ${fld('Contacto de emergência (nome)', inp('contacto_emergencia', p.contacto_emergencia))}${fld('Telefone de emergência', inp('telefone_emergencia', p.telefone_emergencia, 'type="tel"'))}
    <div class="s2">${pacField('agregado_id', p.agregado_id, '', 'Agregado familiar — titular (deixe vazio se for o titular)')}</div>
    <datalist id="dl-nac">${['Portuguesa', 'Brasileira', 'Angolana', 'Cabo-verdiana', 'Espanhola', 'Francesa', 'Inglesa', 'Ucraniana', 'Romena'].map(n => `<option value="${n}">`).join('')}</datalist>
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
    for (const k of ['entidade_id', 'medico_id', 'razao_visita_id', 'agregado_id']) f[k] = f[k] ? Number(f[k]) : null;
    const r = id ? await PUT('t/pacientes/' + id, f) : await POST('t/pacientes', f);
    toast('Paciente guardado'); onSaved && onSaved(r);
  } }], onOpen: async c => {
    const form = $('form', c.body);
    bindPacField(form, 'agregado_id');
    if (p.agregado_id) { const t = await GET('t/pacientes/' + p.agregado_id).catch(() => null); if (t) $('[data-pac="agregado_id"]', form).value = t.nome; }
  } });
}

// redimensiona a foto no browser (máx. 320 px) antes de guardar
function escolherFoto(pid) {
  const i = document.createElement('input'); i.type = 'file'; i.accept = 'image/*';
  i.onchange = () => {
    const file = i.files[0]; if (!file) return;
    const img = new Image();
    img.onload = async () => {
      const k = Math.min(1, 320 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas'); cv.width = Math.round(img.width * k); cv.height = Math.round(img.height * k);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      await act(() => PUT('t/pacientes/' + pid, { foto: cv.toDataURL('image/jpeg', 0.85) }), 'Foto atualizada');
      URL.revokeObjectURL(img.src); render();
    };
    img.src = URL.createObjectURL(file);
  };
  i.click();
}

// ---------- ficha do paciente ----------
const FICHA_TABS = [['resumo', 'Resumo'], ['odontograma', 'Odontograma'], ['perio', 'Periodontograma'], ['tratamentos', 'Tratamentos'], ['anamnese', 'Anamnese'],
  ['notas', 'Notas clínicas'], ['marcacoes', 'Marcações'], ['orcamentos', 'Orçamentos'], ['cc', 'Conta corrente'], ['proteses', 'Próteses'], ['anexos', 'Ficheiros']];

route('paciente', async (view, [id, tab = 'resumo']) => {
  const p = await GET(`pacientes/${id}/resumo`);
  view.innerHTML = `<div class="card" style="padding:14px 16px">
    <div class="row">
      <button type="button" id="pf-foto" class="ghost" style="padding:0;border-radius:50%" title="Alterar foto" aria-label="Alterar foto">${p.foto ? `<img class="avatar" src="${esc(p.foto)}" alt="">`
        : `<span class="avatar">${esc(iniciais(p.nome))}</span>`}</button>
      <div><h1 style="margin:0">${p.titulo && p.titulo !== 'Criança' ? `<span class="muted" style="font-weight:400">${esc(p.titulo)}</span> ` : ''}${esc(p.nome)} ${p.ativo ? '' : '<span class="badge">Inativo</span>'}</h1>
        <div class="muted small">Processo n.º ${esc(p.numero)} · ${p.data_nasc ? `${fmtDate(p.data_nasc)} (${idade(p.data_nasc)} anos)` : 'sem data de nascimento'}
        ${p.nif ? ' · NIF ' + esc(p.nif) : ''}${p.telemovel ? ' · Tlm. ' + esc(p.telemovel) : ''}${p.entidade_nome ? ' · ' + esc(p.entidade_nome) : ''}</div></div>
      <div class="spacer"></div>
      ${p.saldo.saldo > 0 ? `<button type="button" id="pf-saldo" class="ghost right" title="Receber pagamento" aria-label="Saldo em dívida ${eur(p.saldo.saldo)}: receber pagamento">` : '<div class="right">'}<div class="muted small">Saldo</div><div class="bold ${p.saldo.saldo > 0 ? 'danger' : 'ok'}" style="font-size:1.2rem">${eur(p.saldo.saldo)}</div>${p.saldo.saldo > 0 ? '</button>' : '</div>'}
      <div class="row" style="flex-wrap:nowrap"><button id="pf-edit">Editar</button>
        <details class="mais"><summary class="btn" aria-label="Mais ações">Mais ⋯</summary><div class="mais-menu" role="menu">
          <button role="menuitem" id="pf-vaga">Procurar vaga</button><button role="menuitem" id="pf-esp">Lista de espera</button><button role="menuitem" id="pf-print">Imprimir ficha</button></div></details></div>
    </div>
    ${alertasHtml(p)}
    ${p.anamnese?.atualizado_em ? '' : `<div class="alert" style="margin:10px 0 0">Anamnese por preencher. <a href="#/paciente/${p.id}/anamnese">Preencher anamnese</a></div>`}
    ${!p.rgpd_consent ? '<div class="alert" style="margin:10px 0 0">Sem consentimento RGPD registado.</div>' : ''}
  </div>
  ${secTabs(FICHA_TABS.map(([k, l]) => [`#/paciente/${id}/${k}`, l]), `#/paciente/${id}/${FICHA_TABS.some(([k]) => k === tab) ? tab : 'resumo'}`)}
  <div id="pf-body"></div>`;
  $$('.mais-menu button', view).forEach(b => b.addEventListener('click', () => { b.closest('details').open = false; }));
  $('#pf-edit').onclick = () => editPaciente(p.id, () => render());
  if ($('#pf-saldo')) $('#pf-saldo').onclick = () => emitirRecibo({ paciente: p, onDone: () => render() });
  $('#pf-vaga').onclick = () => procurarVaga({ medico_id: p.medico_id, paciente: { id: p.id, nome: p.nome } });
  $('#pf-esp').onclick = () => editEspera(null, { id: p.id, nome: p.nome });
  $('#pf-foto').onclick = () => escolherFoto(p.id);
  $('#pf-print').onclick = () => imprimirFicha(p);
  const body = $('#pf-body');
  const fns = { resumo: tabResumo, odontograma: tabOdonto, perio: tabPerio, tratamentos: tabTratamentos, anamnese: tabAnamnese, notas: tabNotas,
    marcacoes: tabMarcacoes, orcamentos: tabOrcamentosPac, cc: tabContaCorrente, proteses: tabProtesesPac, anexos: tabAnexos };
  await (fns[tab] || tabResumo)(body, p);
});

async function tabResumo(el, p) {
  const [trat, notas] = await Promise.all([GET(`pacientes/${p.id}/tratamentos`), GET(`pacientes/${p.id}/notas`)]);
  const plan = trat.filter(t => t.estado === 'planeado');
  const morada = [p.morada, [p.cod_postal, p.localidade].filter(Boolean).join(' ')].filter(Boolean).map(esc).join('<br>');
  el.innerHTML = `<div class="grid g3">
    <div class="card"><h2 style="font-size:.92rem">Contactos</h2>
      <div>${morada || '<span class="muted">Sem morada</span>'}</div>
      <dl class="kv" style="margin-top:8px"><dt>Telemóvel</dt><dd class="num">${esc(p.telemovel || '—')}</dd>${p.telefone ? `<dt>Telefone</dt><dd class="num">${esc(p.telefone)}</dd>` : ''}<dt>E-mail</dt><dd>${esc(p.email || '—')}</dd></dl>
      <div class="muted small" style="margin-top:8px">SNS: ${esc(p.sns || '—')} · CC: ${esc(p.cc || '—')}<br>Profissão: ${esc(p.profissao || '—')}</div>
      <div class="muted small" style="margin-top:8px">Médico: ${esc(p.medico_nome || '—')}<br>1.ª visita: ${esc(p.razao_nome || '—')}<br>Criado em ${fmtDate(p.criado_em)}${p.alterado_em ? `<br>Alterado por ${esc(p.alterado_por_nome || '—')} em ${fmtDT(p.alterado_em)}` : ''}</div>
      ${p.contacto_emergencia || p.telefone_emergencia ? `<div style="margin-top:8px"><span class="danger bold">Emergência:</span> ${esc(p.contacto_emergencia || '')} ${esc(p.telefone_emergencia || '')}</div>` : ''}
      ${p.nacionalidade || p.idioma ? `<div class="muted small" style="margin-top:4px">${esc(p.nacionalidade || '')}${p.idioma ? ' · idioma ' + esc(p.idioma) : ''}</div>` : ''}
      ${p.agregado.length || p.titular_nome ? `<h2 style="font-size:.92rem;margin-top:14px">Agregado familiar</h2>${p.titular_nome ? '' : '<div class="muted small">Titular do agregado</div>'}
        ${p.agregado.map(m => `<div><a href="#/paciente/${m.id}">${esc(m.nome)}</a> <span class="muted small">${m.id === p.agregado_id ? '(titular)' : ''}${m.data_nasc ? ' ' + idade(m.data_nasc) + ' anos' : ''}</span></div>`).join('')}` : ''}
      ${p.notas ? `<div class="alert info" style="margin-top:10px">${esc(p.notas)}</div>` : ''}</div>
    <div class="card"><h2 style="font-size:.92rem">Consultas</h2>
      <div><span class="muted">Próxima:</span> ${p.proxima ? `<b>${fmtDT(p.proxima.inicio)}</b> · ${esc(p.proxima.medico_nome)}<br><span class="small">${[p.proxima.servico_nome, p.proxima.estado_nome].filter(Boolean).map(esc).join(' · ')}</span>` : '—'}</div>
      <div style="margin-top:10px"><span class="muted">Última:</span> ${p.ultima ? `${fmtDT(p.ultima.inicio)} · ${esc(p.ultima.medico_nome)} · ${esc(p.ultima.estado_nome)}` : '—'}</div>
      <h2 style="font-size:.92rem;margin-top:16px">Financeiro</h2>
      <div class="grid g3 small"><div><div class="muted">Faturado</div><b>${eur(p.saldo.faturado)}</b></div><div><div class="muted">Pago</div><b>${eur(p.saldo.pago)}</b></div>
      <div><div class="muted">Em dívida</div><b class="${p.saldo.saldo > 0 ? 'danger' : ''}">${eur(p.saldo.saldo)}</b></div>
      <div><div class="muted">Crédito</div><b class="ok">${eur(p.saldo.saldo < 0 ? -p.saldo.saldo : 0)}</b></div><div><div class="muted">Por realizar</div><b class="${p.por_realizar > 0 ? 'danger' : ''}">${eur(p.por_realizar)}</b></div></div>
      <h2 style="font-size:.92rem;margin-top:16px">Assiduidade</h2>
      <div class="grid g3 small"><div><div class="muted">Realizadas</div><b>${p.stats.realizadas || 0}</b></div><div><div class="muted">Faltas</div><b class="${p.stats.faltas ? 'danger' : ''}">${p.stats.faltas || 0}</b></div>
      <div><div class="muted">Desmarcadas</div><b>${p.stats.inativas || 0}</b></div><div><div class="muted">Futuras</div><b>${p.stats.futuras || 0}</b></div><div><div class="muted">Total</div><b>${p.stats.total || 0}</b></div></div></div>
    <div class="card"><h2 style="font-size:.92rem">Plano de tratamento (${plan.length})</h2>
      ${plan.length ? plan.slice(0, 8).map(t => `<div class="row between small" style="padding:3px 0;border-bottom:1px solid var(--line2)"><span>${t.dente ? `<b>${esc(t.dente)}</b> ` : ''}${esc(t.descricao)}</span><span class="danger">${eur(liqTrat(t))}</span></div>`).join('')
        + (plan.length > 8 ? `<div class="small" style="padding:4px 0"><a href="#/paciente/${p.id}/tratamentos">Ver todos (${plan.length})</a></div>` : '')
        + `<div class="row between" style="margin-top:6px"><b>Por fazer${plan.length > 8 ? ` (${plan.length})` : ''}</b><b class="danger">${eur(plan.reduce((s, t) => s + liqTrat(t), 0))}</b></div>` : '<div class="muted">Sem tratamentos planeados</div>'}
    </div></div>
    <div class="card"><h2 style="font-size:.92rem">Últimas notas clínicas</h2>${notas.slice(0, 5).map(n => `<div style="padding:6px 0;border-bottom:1px solid var(--line2)"><div class="muted small">${fmtDT(n.data.replace(' ', 'T'))} · ${esc(n.medico_nome || n.user_nome || '')}</div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="muted">Sem notas</div>'}</div>`;
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
    <div class="s4" id="an-extra"></div>
    <div class="s4 row between"><span class="muted small">${a.atualizado_em ? 'Atualizado em ' + fmtDT(a.atualizado_em) : ''}</span><button class="primary" id="an-save">Guardar anamnese</button></div>
  </form></div>`;
  const guardarExtra = await anamneseExtra($('#an-extra', el), p.id);
  $('#an-save').onclick = async () => { await act(async () => { await PUT('anamnese/' + p.id, readForm($('form', el))); await guardarExtra(); }, 'Anamnese guardada'); render(); };
}

// ---------- notas clínicas ----------
async function tabNotas(el, p) {
  const notas = await GET(`pacientes/${p.id}/notas`);
  el.innerHTML = `<div class="card"><h3>Nova nota</h3><textarea id="nt-txt" placeholder="Descrição clínica, observações, procedimentos efetuados…" style="min-height:90px"></textarea>
    <div class="row end" style="margin-top:8px">${fld('Médico', sel('nt-med', opts(ativos(L().medicos), App.user.medico_id || p.medico_id, { empty: '—' }), 'id="nt-med"'))}<button class="primary" id="nt-add" data-save>Guardar nota</button></div></div>
    <div class="card">${notas.map(n => `<div style="padding:10px 0;border-bottom:1px solid var(--line2)"><div class="row between"><span class="muted small">${fmtDT(n.data)} · ${esc(n.medico_nome || '')} ${n.user_nome ? '(registado por ' + esc(n.user_nome) + ')' : ''}</span>
      <button class="ghost sm icon" data-del="${n.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button></div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="empty">Sem notas clínicas</div>'}</div>`;
  $('#nt-add').onclick = async e => {
    const b = e.currentTarget, texto = $('#nt-txt').value.trim(); if (!texto) return toast('Escreva a nota', true);
    if (b.disabled) return; b.disabled = true; // duplo clique / Ctrl+S não cria duas notas
    const ok = await act(() => POST('notas', { paciente_id: p.id, texto, medico_id: Number($('#nt-med').value) || null }), 'Nota adicionada').then(() => true, () => false);
    b.disabled = false; if (ok) render();
  };
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar esta nota?', 'Eliminar', true)) { await DEL('notas/' + b.dataset.del); render(); } });
}

// ---------- marcações do paciente ----------
async function tabMarcacoes(el, p) {
  const ms = await GET(`pacientes/${p.id}/marcacoes`);
  const faltas = ms.filter(m => m.estado_categoria === 'FALTAS').length;
  el.innerHTML = `<div class="card"><div class="muted" style="margin-bottom:10px">${ms.length} marcações · ${faltas} falta(s)</div>${table(ms, [
    { h: 'Data', f: m => `<b>${fmtDT(m.inicio)}</b>` }, { h: 'Médico', f: m => esc(m.medico_nome) }, { h: 'Serviço', f: m => esc(m.servico_nome) },
    { h: 'Gabinete', f: m => esc(m.gabinete_nome) }, { h: 'Estado', f: m => `<span class="dot" style="background:${esc(m.estado_cor)}"></span>${esc(m.estado_nome)}` }, { h: 'Notas', f: m => esc(m.notas) },
    { h: '', cls: 'right', f: m => `<a class="btn sm" href="#/consulta/${m.id}">Abrir consulta</a>` },
  ], { onClick: m => openMarcacao({ id: m.id }) })}</div>`;
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

function tabOdonto(el, p) { return odontograma(el, p); }

// ---------- tratamentos ----------
async function tabTratamentos(el, p) {
  const trat = await GET(`pacientes/${p.id}/tratamentos`);
  const st = el._tr ||= { filtro: 'todos', sel: new Set() };
  for (const t of trat) t._e = estadoTrat(t).k;
  st.sel = new Set([...st.sel].filter(id => trat.some(t => t.id === id)));
  const cont = k => trat.filter(t => t._e === k);
  const vis = st.filtro === 'todos' ? trat : cont(st.filtro);
  const soma = l => l.reduce((s, t) => s + liqTrat(t), 0);
  const sels = () => trat.filter(t => st.sel.has(t.id));
  const selecionados = sels();
  const todosSel = () => vis.length && vis.every(t => st.sel.has(t.id));
  el.innerHTML = `<div class="card">
    <div class="row" style="margin-bottom:10px">
      <span class="seg st-filtros" role="group" aria-label="Filtrar por estado">
        <button type="button" data-f="todos" class="${st.filtro === 'todos' ? 'on' : ''}" aria-pressed="${st.filtro === 'todos'}">Todos <span class="muted num">${trat.length}</span></button>
        ${ESTADOS_TRAT.map(([k, l]) => `<button type="button" data-f="${k}" class="${st.filtro === k ? 'on' : ''}" aria-pressed="${st.filtro === k}"><span class="st-dot st-${k}"></span>${l} <span class="muted num">${cont(k).length}</span></button>`).join('')}
      </span>
      <div class="spacer"></div><button class="primary" id="tr-new">Novo tratamento</button>
    </div>
    <div class="tbl-wrap">${table(vis, [
      { h: '', f: t => `<input type="checkbox" data-sel="${t.id}" ${st.sel.has(t.id) ? 'checked' : ''} aria-label="Selecionar">` },
      { h: 'Data', cls: 'nowrap', f: t => `<span class="num">${fmtDate(t.data)}</span>` }, { h: 'Dente', cls: 'nowrap', f: t => `<b class="num">${esc(t.dente || '')}</b>${t.faces ? ' <span class="muted small">' + esc(t.faces) + '</span>' : ''}` },
      { h: 'Tratamento', f: t => esc(t.descricao) }, { h: 'Médico', cls: 'nowrap', f: t => esc(t.medico_nome) },
      { h: 'Estado', cls: 'nowrap', f: t => t.documento_id ? `<a href="#" data-doc="${t.documento_id}" class="plain">${estadoChip(t)}</a>` : estadoChip(t) },
      { h: 'Valor', cls: 'right nowrap', f: t => eur(liqTrat(t)) + (t.desconto_pct ? ` <span class="muted small">-${num(t.desconto_pct)}%</span>` : '') },
      { h: '', cls: 'right nowrap', f: t => `<button class="ghost sm icon" data-ed="${t.id}" aria-label="Editar" title="Editar"><i data-ic="edit"></i></button>${t.documento_id || (t.estado === 'realizado' && App.user.perfil !== 'admin') ? '' : `<button class="ghost sm icon" data-del="${t.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button>`}` },
    ], { empty: st.filtro === 'todos' ? 'Sem tratamentos registados' : 'Nenhum tratamento neste estado', rowCls: t => 'row-' + t._e })}</div>
    <div class="row" style="margin-top:8px">
      <button class="sm ghost" id="tr-all">${todosSel() ? 'Desmarcar todos' : 'Selecionar todos'}</button>
      <div class="spacer"></div>
      ${ESTADOS_TRAT.filter(([k]) => cont(k).length).map(([k, l]) => `<span class="small"><span class="st-dot st-${k}"></span>${l.split(' · ')[0]} <b class="num">${eur(soma(cont(k)))}</b></span>`).join('<span class="muted">·</span>')}
    </div>
  </div>
  <div class="actionbar ${selecionados.length ? '' : 'hidden'}" role="region" aria-label="Ações sobre a seleção">
    <span><b class="num" data-n>${selecionados.length}</b> selecionado(s) · <b class="num" data-v>${eur(soma(selecionados))}</b></span>
    <div class="spacer"></div>
    <button data-act="orc">Orçamento</button>
    <button data-act="agendar">Agendar</button>
    <button data-act="feito">Marcar feito</button>
    <button data-act="faturar" class="primary">Faturar</button>
    <button data-act="receber">Receber pagamento</button>
  </div>`;
  const redo = () => tabTratamentos(el, p);
  $$('.st-filtros [data-f]', el).forEach(b => b.onclick = () => { st.filtro = b.dataset.f; redo(); });
  // seleção atualizada no lugar: sem novo pedido nem redesenho, o foco fica na checkbox
  const sync = () => {
    const s = sels(), bar = $('.actionbar', el);
    bar.classList.toggle('hidden', !s.length);
    $('[data-n]', bar).textContent = s.length; $('[data-v]', bar).textContent = eur(soma(s));
    $('#tr-all', el).textContent = todosSel() ? 'Desmarcar todos' : 'Selecionar todos';
  };
  $$('[data-sel]', el).forEach(c => c.onchange = () => { c.checked ? st.sel.add(Number(c.dataset.sel)) : st.sel.delete(Number(c.dataset.sel)); sync(); });
  $('#tr-all', el).onclick = () => {
    const all = todosSel(); vis.forEach(t => all ? st.sel.delete(t.id) : st.sel.add(t.id));
    $$('[data-sel]', el).forEach(c => { c.checked = st.sel.has(Number(c.dataset.sel)); }); sync();
  };
  $('#tr-new', el).onclick = () => editTratamento(null, p, redo);
  $$('[data-ed]', el).forEach(b => b.onclick = () => editTratamento(byId(trat, b.dataset.ed), p, redo));
  $$('[data-del]', el).forEach(b => b.onclick = async () => { if (await confirmDlg('Eliminar este tratamento?', 'Eliminar', true)) { await act(() => DEL('t/tratamentos/' + b.dataset.del)); redo(); } });
  $$('[data-doc]', el).forEach(a => a.onclick = e => { e.preventDefault(); verDocumento(Number(a.dataset.doc)); });
  const done = () => { st.sel.clear(); redo(); };
  $$('[data-act]', el).forEach(b => b.onclick = async () => {
    const a = b.dataset.act, selecionados = sels();
    if (a === 'feito') {
      const l = selecionados.filter(t => t.estado === 'planeado'); if (!l.length) return toast('Nenhum dos selecionados está por fazer', true);
      let n = 0; b.disabled = true;
      await act(async () => { for (const t of l) { await PUT('t/tratamentos/' + t.id, { estado: 'realizado', data: isoDate() }); n++; } }, `${l.length} tratamento(s) marcado(s) como feito`)
        .catch(() => toast(`Só ${n} de ${l.length} tratamento(s) ficaram marcados como feito`, true));
      return done();
    }
    if (a === 'agendar') {
      const l = selecionados.filter(t => t.estado === 'planeado'); if (!l.length) return toast('Selecione tratamentos por fazer', true);
      return agendarTratamentos(l, p, done);
    }
    if (a === 'orc') {
      const l = selecionados.filter(t => !t.documento_id); if (!l.length) return toast('Os selecionados já estão faturados', true);
      return editOrcamento(null, { paciente: p, linhas: l.map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco, desconto_pct: t.desconto_pct, iva: t.iva, iva_id: t.iva_id })) });
    }
    if (a === 'receber') {
      const docs = [...new Set(selecionados.filter(t => t._e === 'fat').map(t => t.documento_id))];
      return emitirRecibo({ paciente: p, documentos: docs.length ? docs : null, onDone: done });
    }
    const l = selecionados.filter(t => !t.documento_id);
    if (!l.length) return toast('Os selecionados já estão faturados. Para pagar, use "Receber pagamento".', true);
    if (l.length < selecionados.length) toast(`${selecionados.length - l.length} já faturado(s) ficaram de fora`);
    emitirDocumento({ paciente: p, tratamentos: l, onDone: done }); // o tipo escolhe-se no modal (FR por omissão)
  });
}

function editTratamento(t, p, onSaved) {
  const lk = L(); t = t || { estado: 'planeado', data: isoDate(), medico_id: App.user.medico_id || p.medico_id };
  const ent = byId(lk.entidades, p.entidade_id);
  const faturado = !!t.documento_id; // o servidor só aceita alterar as notas de um tratamento faturado
  modal({ title: t.id ? 'Editar tratamento' : 'Novo tratamento', body: `<form class="form-grid" onsubmit="return false">
    ${fld('Tratamento', sel('servico_id', opts(lk.servicos, t.servico_id, { empty: '—', only: x => x.ativo, label: x => `${x.codigo || ''} ${x.nome}` })), 's4')}
    ${fld('Descrição', inp('descricao', t.descricao), 's4')}
    ${fld('Dente(s)', inp('dente', t.dente, 'placeholder="ex.: 16 ou 11,21"'))}${fld('Faces', inp('faces', t.faces, 'placeholder="O M D V L"'))}
    ${fld('Estado', sel('estado', optsArr([['planeado', 'Necessário'], ['realizado', 'Feito']], t.estado)))}${fld('Data', inp('data', t.data, 'type="date"'))}
    ${fld('Médico', sel('medico_id', opts(lk.medicos, t.medico_id, { only: x => x.ativo })), 's2')}
    ${fld('Preço (€)', inp('preco', t.preco ?? '', 'type="number" step="0.01"'))}${fld('Desconto %', inp('desconto_pct', t.desconto_pct ?? ent?.desconto_pct ?? 0, 'type="number" step="0.01"'))}
    ${fld('IVA', sel('iva_id', ivaOpts(ivaFix({ ...t }).iva_id)))}${fld('Notas', inp('notas', t.notas), 's3')}
    ${faturado ? `<div class="s4 muted small">Faturado${t.documento_numero ? ' em ' + esc(t.documento_numero) : ''}: só as notas podem ser alteradas.</div>` : ''}
  </form>`, buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (faturado) { await PUT('t/tratamentos/' + t.id, { notas: f.notas }); toast('Tratamento guardado'); return onSaved(); }
    if (!f.descricao) throw new Error('Indique a descrição');
    f.paciente_id = p.id; f.servico_id = f.servico_id ? Number(f.servico_id) : null; f.medico_id = Number(f.medico_id);
    f.iva_id = Number(f.iva_id); f.iva = byId(L().ivas, f.iva_id)?.taxa ?? 0;
    f.faces = (f.faces || '').toUpperCase().replace(/[^OVLMDP]/g, '').replace(/P/g, 'L');
    t.id ? await PUT('t/tratamentos/' + t.id, f) : await POST('t/tratamentos', f);
    toast('Tratamento guardado'); onSaved();
  } }], onOpen: c => {
    const form = $('form', c.body);
    if (faturado) $$('input, select', form).forEach(x => { if (x.name !== 'notas') x.disabled = true; });
    form.servico_id.onchange = () => { const s = byId(lk.servicos, form.servico_id.value); if (s) { form.descricao.value = s.nome; form.preco.value = s.preco; if (s.iva_id) form.iva_id.value = s.iva_id; } };
  } });
}

// ---------- impressão da ficha ----------
async function imprimirFicha(p) {
  const [trat, notas] = await Promise.all([GET(`pacientes/${p.id}/tratamentos`), GET(`pacientes/${p.id}/notas`)]);
  const a = p.anamnese || {};
  // só os campos preenchidos: "Rótulo: valor · Rótulo: valor"
  const kv = (pares, sep = ' · ') => pares.filter(([, v]) => v).map(([l, v]) => `${l}: ${esc(v)}`).join(sep);
  const COND_AN = { hipertensao: 'Hipertensão', diabetes: 'Diabetes', cardiaco: 'Doença cardíaca', anticoagulantes: 'Anticoagulantes', hepatite: 'Hepatite', gravidez: 'Gravidez' };
  const ident = [kv([['Data nasc.', fmtDate(p.data_nasc)], ['NIF', p.nif], ['SNS', p.sns]]),
    esc([p.morada, [p.cod_postal, p.localidade].filter(Boolean).join(' ')].filter(Boolean).join(', ')),
    kv([['Tel.', [p.telemovel, p.telefone].filter(Boolean).join(' / ')], ['E-mail', p.email]]), 'Entidade: ' + esc(p.entidade_nome || 'Particular')].filter(Boolean).join('<br>');
  const anam = [kv([['Alergias', a.alergias], ['Doenças', a.doencas], ['Medicação', a.medicacao], ['Fumador', a.fumador], ['Observações', a.observacoes]], '<br>'),
    Object.keys(COND_AN).filter(k => a[k]).map(k => COND_AN[k]).join(' · ')].filter(Boolean).join('<br>');
  const estadoLbl = t => { const k = estadoTrat(t).k; return ESTADOS_TRAT.find(e => e[0] === k)[1]; };
  printHTML(`<div class="doc"><div class="dh">${cabecalhoClinica()}<div><h2>Ficha clínica</h2>Processo n.º ${esc(p.numero)}<br>${fmtDate(isoDate())}</div></div>
    <h3>${esc(p.nome)}</h3><p>${ident}</p>
    <h3>Anamnese</h3><p>${anam || 'Sem registo'}</p>
    <h3>Tratamentos</h3>${trat.length ? `<table><tr><th>Data</th><th>Dente</th><th>Tratamento</th><th>Médico</th><th>Estado</th></tr>${trat.map(t => `<tr><td>${fmtDate(t.data)}</td><td>${esc([t.dente, t.faces].filter(Boolean).join(' '))}</td><td>${esc(t.descricao)}</td><td>${esc(t.medico_nome)}</td><td>${esc(estadoLbl(t))}</td></tr>`).join('')}</table>` : '<p>Sem tratamentos</p>'}
    <h3>Notas clínicas</h3>${notas.map(n => `<p><b>${fmtDT(n.data)}</b> ${esc(n.medico_nome || '')}<br>${esc(n.texto).replace(/\n/g, '<br>')}</p>`).join('') || '<p>Sem notas</p>'}</div>`);
}
