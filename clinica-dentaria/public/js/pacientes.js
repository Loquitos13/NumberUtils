'use strict';
/* Pacientes: lista, ficha, anamnese, odontograma, tratamentos, notas */

route('pacientes', async (view) => {
  view.innerHTML = `<div class="page-head"><h1>Pacientes</h1><div class="spacer"></div>
    <label class="check"><input type="checkbox" id="pl-inat"> Incluir inativos</label>
    <button id="pl-csv">Exportar</button><button class="primary" id="pl-new">Novo paciente</button></div>
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
const FICHA_TABS = [['resumo', 'Resumo'], ['odontograma', 'Odontograma'], ['tratamentos', 'Tratamentos'], ['anamnese', 'Anamnese'],
  ['notas', 'Notas clínicas'], ['marcacoes', 'Marcações'], ['orcamentos', 'Orçamentos'], ['cc', 'Conta corrente'], ['proteses', 'Próteses']];

route('paciente', async (view, [id, tab = 'resumo']) => {
  const p = await GET(`pacientes/${id}/resumo`);
  const a = p.anamnese || {};
  const alertas = [a.alergias && `Alergias: ${a.alergias}`, a.anticoagulantes && 'Anticoagulantes', a.cardiaco && 'Doença cardíaca', a.diabetes && 'Diabetes',
    a.hipertensao && 'Hipertensão', a.gravidez && 'Gravidez', a.hepatite && 'Hepatite'].filter(Boolean);
  view.innerHTML = `<div class="card" style="padding:14px 16px">
    <div class="row">
      <div id="pf-foto" title="Clique para alterar a foto" style="cursor:pointer">${p.foto ? `<img class="avatar" src="${esc(p.foto)}" alt="">`
        : `<div class="avatar">${esc(p.nome.split(' ').filter(Boolean).map(w => w[0]).filter((_, i, a) => i === 0 || i === a.length - 1).join('').toUpperCase())}</div>`}</div>
      <div><h1 style="margin:0">${p.titulo && p.titulo !== 'Criança' ? `<span class="muted" style="font-weight:400">${esc(p.titulo)}</span> ` : ''}${esc(p.nome)} ${p.ativo ? '' : '<span class="badge">Inativo</span>'}</h1>
        <div class="muted small">Processo n.º ${esc(p.numero)} · ${p.data_nasc ? `${fmtDate(p.data_nasc)} (${idade(p.data_nasc)} anos)` : 'sem data de nascimento'}
        ${p.nif ? ' · NIF ' + esc(p.nif) : ''}${p.telemovel ? ' · Tlm. ' + esc(p.telemovel) : ''}${p.entidade_nome ? ' · ' + esc(p.entidade_nome) : ''}</div></div>
      <div class="spacer"></div>
      <div class="right"><div class="muted small">Saldo</div><div class="bold ${p.saldo.saldo > 0 ? 'danger' : 'ok'}" style="font-size:1.2rem">${eur(p.saldo.saldo)}</div></div>
      <button id="pf-marc" class="primary">Nova marcação</button><button id="pf-vaga" class="icon" title="Procurar vaga" aria-label="Procurar vaga"><i data-ic="search"></i></button><button id="pf-esp" class="icon" title="Lista de espera" aria-label="Lista de espera"><i data-ic="clock"></i></button><button id="pf-edit">Editar</button><button id="pf-print" class="icon" title="Imprimir ficha" aria-label="Imprimir ficha"><i data-ic="printer"></i></button>
    </div>
    ${alertas.length ? `<div class="alert danger" style="margin:10px 0 0">${alertas.map(esc).join(' · ')}</div>` : ''}
    ${!p.rgpd_consent ? '<div class="alert" style="margin:10px 0 0">Sem consentimento RGPD registado.</div>' : ''}
  </div>
  <div class="tabs">${FICHA_TABS.map(([k, l]) => `<button class="${k === tab ? 'active' : ''}" data-t="${k}">${l}</button>`).join('')}</div>
  <div id="pf-body"></div>`;
  $$('.tabs button', view).forEach(b => b.onclick = () => go(`#/paciente/${id}/${b.dataset.t}`));
  $('#pf-edit').onclick = () => editPaciente(p.id, () => render());
  $('#pf-marc').onclick = () => openMarcacao({ paciente: { id: p.id, nome: p.nome }, medico_id: p.medico_id });
  $('#pf-vaga').onclick = () => procurarVaga({ medico_id: p.medico_id, paciente: { id: p.id, nome: p.nome } });
  $('#pf-esp').onclick = () => editEspera(null, { id: p.id, nome: p.nome });
  $('#pf-foto').onclick = () => escolherFoto(p.id);
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
      <dl class="kv" style="margin-top:8px"><dt>Telemóvel</dt><dd class="num">${esc(p.telemovel || '—')}</dd>${p.telefone ? `<dt>Telefone</dt><dd class="num">${esc(p.telefone)}</dd>` : ''}<dt>E-mail</dt><dd>${esc(p.email || '—')}</dd></dl>
      <div class="muted small" style="margin-top:8px">SNS: ${esc(p.sns || '—')} · CC: ${esc(p.cc || '—')}<br>Profissão: ${esc(p.profissao || '—')}</div>
      <div class="muted small" style="margin-top:8px">Médico: ${esc(p.medico_nome || '—')}<br>1.ª visita: ${esc(p.razao_nome || '—')}<br>Criado em ${fmtDate(p.criado_em)}${p.alterado_em ? `<br>Alterado por ${esc(p.alterado_por_nome || '—')} em ${esc(p.alterado_em)}` : ''}</div>
      ${p.contacto_emergencia || p.telefone_emergencia ? `<div style="margin-top:8px"><span class="danger bold">Emergência:</span> ${esc(p.contacto_emergencia || '')} ${esc(p.telefone_emergencia || '')}</div>` : ''}
      ${p.nacionalidade || p.idioma ? `<div class="muted small" style="margin-top:4px">${esc(p.nacionalidade || '')}${p.idioma ? ' · idioma ' + esc(p.idioma) : ''}</div>` : ''}
      ${p.agregado.length || p.titular_nome ? `<h3 style="margin-top:14px">Agregado familiar</h3>${p.titular_nome ? '' : '<div class="muted small">Titular do agregado</div>'}
        ${p.agregado.map(m => `<div><a href="#/paciente/${m.id}">${esc(m.nome)}</a> <span class="muted small">${m.id === p.agregado_id ? '(titular)' : ''}${m.data_nasc ? ' ' + idade(m.data_nasc) + ' anos' : ''}</span></div>`).join('')}` : ''}
      ${p.notas ? `<div class="alert info" style="margin-top:10px">${esc(p.notas)}</div>` : ''}</div>
    <div class="card"><h3>Consultas</h3>
      <div><span class="muted">Próxima:</span> ${p.proxima ? `<b>${fmtDT(p.proxima.inicio)}</b> · ${esc(p.proxima.medico_nome)}<br><span class="small">${esc(p.proxima.servico_nome || '')} · ${esc(p.proxima.estado_nome)}</span>` : '—'}</div>
      <div style="margin-top:10px"><span class="muted">Última:</span> ${p.ultima ? `${fmtDT(p.ultima.inicio)} · ${esc(p.ultima.medico_nome)} · ${esc(p.ultima.estado_nome)}` : '—'}</div>
      <h3 style="margin-top:16px">Financeiro</h3>
      <div class="grid g3 small"><div><div class="muted">Faturado</div><b>${eur(p.saldo.faturado)}</b></div><div><div class="muted">Pago</div><b>${eur(p.saldo.pago)}</b></div>
      <div><div class="muted">Em dívida</div><b class="${p.saldo.saldo > 0 ? 'danger' : ''}">${eur(p.saldo.saldo)}</b></div>
      <div><div class="muted">Crédito</div><b class="ok">${eur(p.saldo.saldo < 0 ? -p.saldo.saldo : 0)}</b></div><div><div class="muted">Por realizar</div><b class="${p.por_realizar > 0 ? 'danger' : ''}">${eur(p.por_realizar)}</b></div></div>
      <h3 style="margin-top:16px">Assiduidade</h3>
      <div class="grid g3 small"><div><div class="muted">Realizadas</div><b>${p.stats.realizadas || 0}</b></div><div><div class="muted">Faltas</div><b class="${p.stats.faltas ? 'danger' : ''}">${p.stats.faltas || 0}</b></div>
      <div><div class="muted">Desmarcadas</div><b>${p.stats.inativas || 0}</b></div><div><div class="muted">Futuras</div><b>${p.stats.futuras || 0}</b></div><div><div class="muted">Total</div><b>${p.stats.total || 0}</b></div></div></div>
    <div class="card"><h3>Plano de tratamento (${plan.length})</h3>
      ${plan.length ? plan.slice(0, 8).map(t => `<div class="row between small" style="padding:3px 0;border-bottom:1px solid var(--line2)"><span>${t.dente ? `<b>${esc(t.dente)}</b> ` : ''}${esc(t.descricao)}</span><span class="danger">${eur(t.preco * (1 - (t.desconto_pct || 0) / 100))}</span></div>`).join('')
        + `<div class="row between" style="margin-top:6px"><b>Por fazer</b><b class="danger">${eur(plan.reduce((s, t) => s + t.preco * (1 - (t.desconto_pct || 0) / 100), 0))}</b></div>` : '<div class="muted">Sem tratamentos planeados</div>'}
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
      <button class="ghost sm icon" data-del="${n.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button></div>${esc(n.texto).replace(/\n/g, '<br>')}</div>`).join('') || '<div class="empty">Sem notas clínicas</div>'}</div>`;
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
    <button class="primary" id="pm-new">Nova marcação</button></div>${table(ms, [
    { h: 'Data', f: m => `<b>${fmtDT(m.inicio)}</b>` }, { h: 'Médico', f: m => esc(m.medico_nome) }, { h: 'Serviço', f: m => esc(m.servico_nome) },
    { h: 'Gabinete', f: m => esc(m.gabinete_nome) }, { h: 'Estado', f: m => `<span class="dot" style="background:${esc(m.estado_cor)}"></span>${esc(m.estado_nome)}` }, { h: 'Notas', f: m => esc(m.notas) },
    { h: '', cls: 'right', f: m => `<a class="btn sm" href="#/consulta/${m.id}">Consulta</a>` },
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
  if (st.planned) extra += '<circle cx="34" cy="6" r="4.5" style="fill:#b8202d;stroke:#fff"/>';
  if (st.done) extra += '<circle cx="6" cy="6" r="4.5" style="fill:#2f5cc4;stroke:#fff"/>';
  return `<svg viewBox="0 0 40 40">
    <path data-f="${fp.top}" d="M2 2 L38 2 L28 12 L12 12 Z" style="fill:${fill(fp.top)}"/>
    <path data-f="${fp.bottom}" d="M2 38 L38 38 L28 28 L12 28 Z" style="fill:${fill(fp.bottom)}"/>
    <path data-f="${fp.left}" d="M2 2 L12 12 L12 28 L2 38 Z" style="fill:${fill(fp.left)}"/>
    <path data-f="${fp.right}" d="M38 2 L28 12 L28 28 L38 38 Z" style="fill:${fill(fp.right)}"/>
    <rect data-f="O" x="12" y="12" width="16" height="16" style="fill:${fill('O')}"/>${extra}</svg>`;
}

function tabOdonto(el, p) { return odontograma(el, p); }

// ---------- tratamentos ----------
async function tabTratamentos(el, p) {
  const trat = await GET(`pacientes/${p.id}/tratamentos`);
  const liq = t => t.preco * (1 - (t.desconto_pct || 0) / 100) * (1 + (t.iva || 0) / 100);
  const porFaturar = trat.filter(t => t.estado === 'realizado' && !t.documento_id);
  el.innerHTML = `<div class="card"><div class="row" style="margin-bottom:10px">
      <button class="primary" id="tr-new">Novo tratamento</button>
      <button id="tr-fat" ${porFaturar.length ? '' : 'disabled'}>Faturar realizados (${porFaturar.length})</button>
      <button id="tr-orc">Orçamento do plano</button>
      <div class="spacer"></div><span class="muted small">Selecione linhas para ações em lote:</span>
      <button class="sm" id="tr-done">Marcar realizado</button><button class="sm" id="tr-fsel">Faturar seleção</button></div>
    ${table(trat, [
      { h: '', f: t => `<input type="checkbox" data-sel="${t.id}">` },
      { h: 'Data', f: t => fmtDate(t.data) }, { h: 'Dente', f: t => `<b>${esc(t.dente)}</b>${t.faces ? ' <span class="muted small">' + esc(t.faces) + '</span>' : ''}` },
      { h: 'Tratamento', f: t => esc(t.descricao) }, { h: 'Médico', f: t => esc(t.medico_nome) },
      { h: 'Estado', f: t => `<span class="badge ${t.estado === 'realizado' ? 'info' : 'warn'}">${esc(t.estado)}</span>` },
      { h: 'Valor', cls: 'right', f: t => `<span class="${t.estado === 'planeado' ? 'danger' : 'ok'}">${eur(liq(t))}</span>` + (t.desconto_pct ? ` <span class="muted small">-${num(t.desconto_pct)}%</span>` : '') },
      { h: 'Documento', f: t => t.documento_numero ? `<a href="#" data-doc="${t.documento_id}">${esc(t.documento_numero)}</a>` : (t.estado === 'realizado' ? '<span class="danger small">por faturar</span>' : '') },
      { h: '', cls: 'right', f: t => `<button class="ghost sm icon" data-ed="${t.id}" aria-label="Editar" title="Editar"><i data-ic="edit"></i></button>${t.documento_id ? '' : `<button class="ghost sm icon" data-del="${t.id}" aria-label="Eliminar" title="Eliminar"><i data-ic="trash"></i></button>`}` },
    ], { empty: 'Sem tratamentos registados' })}
    <div class="row end" style="margin-top:10px;gap:24px"><span>Por fazer: <b class="danger">${eur(trat.filter(t => t.estado === 'planeado').reduce((s, t) => s + liq(t), 0))}</b></span>
      <span>Realizado: <b class="ok">${eur(trat.filter(t => t.estado === 'realizado').reduce((s, t) => s + liq(t), 0))}</b></span></div></div>`;
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
    editOrcamento(null, { paciente: p, linhas: plan.map(t => ({ servico_id: t.servico_id, tratamento_id: t.id, descricao: t.descricao, dente: t.dente, qtd: 1, preco: t.preco, desconto_pct: t.desconto_pct, iva: t.iva, iva_id: t.iva_id })) });
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
    ${fld('IVA', sel('iva_id', ivaOpts(ivaFix({ ...t }).iva_id)))}${fld('Notas', inp('notas', t.notas), 's3')}
  </form>`, buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
    const f = readForm($('form', c.body));
    if (!f.descricao) throw new Error('Indique a descrição');
    f.paciente_id = p.id; f.servico_id = f.servico_id ? Number(f.servico_id) : null; f.medico_id = Number(f.medico_id);
    f.iva_id = Number(f.iva_id); f.iva = byId(L().ivas, f.iva_id)?.taxa ?? 0;
    f.faces = (f.faces || '').toUpperCase().replace(/[^OVLMDP]/g, '').replace(/P/g, 'L');
    t.id ? await PUT('t/tratamentos/' + t.id, f) : await POST('t/tratamentos', f);
    toast('Tratamento guardado'); onSaved();
  } }], onOpen: c => {
    const form = $('form', c.body);
    form.servico_id.onchange = () => { const s = byId(lk.servicos, form.servico_id.value); if (s) { form.descricao.value = s.nome; form.preco.value = s.preco; if (s.iva_id) form.iva_id.value = s.iva_id; } };
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
