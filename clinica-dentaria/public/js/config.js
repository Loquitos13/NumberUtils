'use strict';
/* Configuração: clínica, agenda, tabelas de referência, utilizadores, registos, cópias de segurança */
const CFG_SECTIONS = [
  ['clinica', 'Clínica'], ['agenda', 'Agenda e feriados'], ['medicos', 'Médicos'], ['servicos', 'Tratamentos e preços'], ['especialidades', 'Especialidades'],
  ['gabinetes', 'Gabinetes'], ['estados', 'Estados das consultas'], ['razoes', 'Razões 1.ª visita'], ['entidades', 'Entidades / seguros'],
  ['laboratorios', 'Laboratórios'], ['armazens', 'Armazéns'], ['sms', 'Modelos de SMS'], ['utilizadores', 'Utilizadores'], ['registos', 'Registos'], ['backup', 'Cópia de segurança'],
];

// definição genérica: k = coluna, t = tipo
const CRUD_DEFS = {
  medicos: { table: 'medicos', title: 'Médico', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'abreviatura', h: 'Abrev.' },
    { k: 'especialidade_id', h: 'Especialidade', t: 'sel', list: () => L().especialidades, span: 2 }, { k: 'cedula', h: 'Cédula OMD' }, { k: 'nif', h: 'NIF' },
    { k: 'telefone', h: 'Telefone' }, { k: 'email', h: 'E-mail', span: 2 }, { k: 'cor', h: 'Cor', t: 'color' }, { k: 'comissao_pct', h: 'Comissão %', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  servicos: { table: 'servicos', title: 'Tratamento', cols: [{ k: 'codigo', h: 'Código' }, { k: 'nome', h: 'Nome', req: 1, span: 3 },
    { k: 'especialidade_id', h: 'Especialidade', t: 'sel', list: () => L().especialidades, span: 2 }, { k: 'preco', h: 'Preço €', t: 'num' }, { k: 'iva', h: 'IVA %', t: 'num' },
    { k: 'duracao_min', h: 'Duração (min)', t: 'num' }, { k: 'por_dente', h: 'Por dente', t: 'bool' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  especialidades: { table: 'especialidades', title: 'Especialidade', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  gabinetes: { table: 'gabinetes', title: 'Gabinete', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  estados: { table: 'estados', title: 'Estado', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'cor', h: 'Cor', t: 'color' },
    { k: 'categoria', h: 'Categoria', t: 'opt', opts: [['OUTRAS', 'Outras (ativa)'], ['REALIZADAS', 'Realizada'], ['FALTAS', 'Falta'], ['INATIVAS', 'Inativa (desmarcada/cancelada)']] },
    { k: 'ordem', h: 'Ordem', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  razoes: { table: 'razoes_visita', title: 'Razão da 1.ª visita', cols: [{ k: 'abreviatura', h: 'Abreviatura', req: 1 }, { k: 'descricao', h: 'Descrição', span: 2 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  entidades: { table: 'entidades', title: 'Entidade', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'nif', h: 'NIF' }, { k: 'desconto_pct', h: 'Desconto %', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  laboratorios: { table: 'laboratorios', title: 'Laboratório', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'contacto', h: 'Contacto' }, { k: 'telefone', h: 'Telefone' }, { k: 'email', h: 'E-mail', span: 2 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  armazens: { table: 'armazens', title: 'Armazém', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  sms: { table: 'sms_modelos', title: 'Modelo de SMS', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' },
    { k: 'texto', h: 'Texto', t: 'area', span: 4, help: 'Variáveis: {nome} {primeiro_nome} {data} {hora} {medico} {servico} {clinica} {telefone_clinica}' }] },
};

function cellView(c, r) {
  const v = r[c.k];
  if (c.t === 'bool') return v ? '✔' : '<span class="muted">—</span>';
  if (c.t === 'color') return `<span class="dot" style="background:${esc(v)}"></span>`;
  if (c.t === 'sel') return esc(byId(c.list(), v)?.nome || '');
  if (c.t === 'opt') return esc((c.opts.find(o => o[0] === v) || [])[1] || v);
  if (c.k === 'preco') return eur(v);
  if (c.t === 'area') return `<span class="small">${esc(v)}</span>`;
  return esc(v);
}
function cellInput(c, v) {
  if (c.t === 'bool') return `<div style="padding-top:6px">${chk(c.k, v, c.h)}</div>`;
  if (c.t === 'color') return inp(c.k, v || '#2563eb', 'type="color"');
  if (c.t === 'num') return inp(c.k, v ?? 0, 'type="number" step="any"');
  if (c.t === 'sel') return sel(c.k, opts(c.list(), v, { empty: '—' }));
  if (c.t === 'opt') return sel(c.k, optsArr(c.opts, v));
  if (c.t === 'area') return txt(c.k, v);
  return inp(c.k, v);
}
async function crudSection(body, def) {
  const rows = await GET('t/' + def.table);
  body.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="cr-q" placeholder="Filtrar…" style="max-width:260px"><div class="spacer"></div>
    <button id="cr-csv">⇩ Exportar</button><button class="primary" id="cr-new">＋ ${esc(def.title)}</button></div><div id="cr-tbl"></div>`;
  const cols = def.cols.map(c => ({ h: c.h, cls: c.t === 'num' ? 'right' : '', f: r => cellView(c, r), csv: r => r[c.k] }));
  const draw = () => {
    const q = $('#cr-q').value.toLowerCase();
    const fr = rows.filter(r => !q || def.cols.some(c => String(r[c.k] ?? '').toLowerCase().includes(q)));
    $('#cr-tbl').innerHTML = `<div class="tbl-wrap">${table(fr, cols, { onClick: r => edit(r), rowCls: r => r.ativo === 0 ? 'off' : '' })}</div>`;
  };
  const edit = r => {
    const isNew = !r; r = r || { ativo: 1 };
    const buttons = [];
    if (!isNew) buttons.push({ label: '🗑 Eliminar', cls: 'danger', left: true, onClick: async () => {
      if (!await confirmDlg(`Eliminar "${r.nome || r.abreviatura}"?`, 'Eliminar', true)) return false;
      await DEL(`t/${def.table}/${r.id}`); toast('Eliminado'); await refreshLookups(); render();
    } });
    buttons.push({ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
      const f = readForm($('form', c.body));
      for (const col of def.cols) { if (col.req && !f[col.k]) throw new Error(`Preencha: ${col.h}`); if (col.t === 'sel') f[col.k] = f[col.k] ? Number(f[col.k]) : null; }
      isNew ? await POST('t/' + def.table, f) : await PUT(`t/${def.table}/${r.id}`, f);
      toast('Guardado'); await refreshLookups(); render();
    } });
    modal({ title: (isNew ? 'Novo: ' : 'Editar: ') + def.title, body: `<form class="form-grid" onsubmit="return false">${def.cols.map(c => fld(c.h, cellInput(c, r[c.k]) + (c.help ? `<div class="muted small">${esc(c.help)}</div>` : ''), c.span ? 's' + c.span : '')).join('')}</form>`, buttons });
  };
  $('#cr-q').oninput = draw; $('#cr-new').onclick = () => edit(null);
  $('#cr-csv').onclick = () => downloadCSV(def.table, rows, cols);
  draw();
}

route('config', async (view, [sec = 'clinica']) => {
  const admin = App.user.perfil === 'admin';
  view.innerHTML = `<div class="page-head"><h1>Configuração</h1></div>
    <div class="subnav">${CFG_SECTIONS.map(([k, l]) => `<button class="${k === sec ? 'active' : ''}" data-s="${k}">${l}</button>`).join('')}</div>
    ${admin ? '' : '<div class="alert">Apenas administradores podem alterar a configuração. Está em modo de consulta.</div>'}
    <div class="card" id="cf-body"></div>`;
  $$('.subnav button', view).forEach(b => b.onclick = () => go('#/config/' + b.dataset.s));
  const body = $('#cf-body');
  if (CRUD_DEFS[sec]) return crudSection(body, CRUD_DEFS[sec]);
  const c = L().config;
  const saveCfg = async (form) => { await act(() => PUT('config', readForm(form)), 'Configuração guardada'); await refreshLookups(); render(); };

  if (sec === 'clinica') {
    body.innerHTML = `<form class="form-grid" onsubmit="return false">
      ${fld('Nome da clínica', inp('clinica_nome', c.clinica_nome), 's2')}${fld('NIF', inp('clinica_nif', c.clinica_nif))}${fld('N.º registo ERS', inp('clinica_ers', c.clinica_ers))}
      ${fld('Morada', inp('clinica_morada', c.clinica_morada), 's2')}${fld('Código postal e localidade', inp('clinica_cp', c.clinica_cp), 's2')}
      ${fld('Telefone', inp('clinica_telefone', c.clinica_telefone))}${fld('E-mail', inp('clinica_email', c.clinica_email))}
      ${fld('IVA por omissão (%)', inp('iva_default', c.iva_default, 'type="number"'))}${fld('Validade dos orçamentos (dias)', inp('validade_orcamento_dias', c.validade_orcamento_dias, 'type="number"'))}
      ${fld('Rodapé dos documentos', txt('doc_rodape', c.doc_rodape), 's4')}
      <div class="s4 row end"><button class="primary" id="cf-save">Guardar</button></div></form>`;
    $('#cf-save').onclick = () => saveCfg($('form', body));
    return;
  }
  if (sec === 'agenda') {
    const dias = (c.agenda_dias || '').split(',');
    const ano = new Date().getFullYear();
    const calc = await GET('feriados?ano=' + ano);
    body.innerHTML = `<form class="form-grid" onsubmit="return false" id="cf-ag">
      ${fld('Hora de abertura', inp('agenda_inicio', c.agenda_inicio, 'type="time"'))}${fld('Hora de fecho', inp('agenda_fim', c.agenda_fim, 'type="time"'))}
      ${fld('Intervalo da agenda (min)', sel('agenda_intervalo', optsArr(['5', '10', '15', '20', '30', '60'], c.agenda_intervalo)))}<div></div>
      <div class="s4"><label class="f">Dias de funcionamento</label>${[1, 2, 3, 4, 5, 6, 0].map(d => `<label class="check"><input type="checkbox" data-dia="${d}" ${dias.includes(String(d)) ? 'checked' : ''}> ${DIAS[d]}</label>`).join('')}</div>
      <div class="s4"><label class="f">Feriados móveis calculados automaticamente</label>
        ${chk('feriado_pascoa', c.feriado_pascoa === '1', 'Páscoa')}${chk('feriado_sexta_santa', c.feriado_sexta_santa === '1', 'Sexta-feira Santa')}
        ${chk('feriado_corpo_deus', c.feriado_corpo_deus === '1', 'Corpo de Deus')}${chk('feriado_carnaval', c.feriado_carnaval === '1', 'Carnaval')}</div>
      <div class="s4 row end"><button class="primary" id="cf-save">Guardar</button></div></form>
      <div class="grid g2" style="margin-top:16px"><div><h3>Feriados configurados</h3><div id="cf-fer"></div></div>
      <div><h3>Calendário de feriados ${ano}</h3>${table(calc, [{ h: 'Data', f: f => `${fmtDate(f.data)} <span class="muted small">${DIAS_C[new Date(f.data + 'T12:00').getDay()]}</span>` }, { h: 'Feriado', f: f => esc(f.nome) }])}</div></div>`;
    $('#cf-save').onclick = async () => {
      const f = readForm($('#cf-ag'));
      for (const k of ['feriado_pascoa', 'feriado_sexta_santa', 'feriado_corpo_deus', 'feriado_carnaval']) f[k] = String(f[k]);
      f.agenda_dias = $$('[data-dia]:checked', body).map(i => i.dataset.dia).join(',');
      await act(() => PUT('config', f), 'Configuração guardada'); await refreshLookups(); AG.feriados = {}; render();
    };
    crudSection($('#cf-fer'), { table: 'feriados', title: 'Feriado', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 },
      { k: 'data', h: 'Data (MM-DD se fixo, AAAA-MM-DD se pontual)', req: 1, span: 2 }, { k: 'fixo', h: 'Repete todos os anos', t: 'bool' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] });
    return;
  }
  if (sec === 'utilizadores') {
    if (!admin) { body.innerHTML = '<div class="empty">Sem permissão</div>'; return; }
    const us = await GET('users');
    const PERFIS = [['admin', 'Administrador'], ['medico', 'Médico'], ['rececao', 'Receção'], ['assistente', 'Assistente']];
    body.innerHTML = `<div class="row end" style="margin-bottom:10px"><button class="primary" id="us-new">＋ Utilizador</button></div>${table(us, [
      { h: 'Nome', f: u => `<b>${esc(u.nome)}</b>` }, { h: 'Login', f: u => esc(u.login) }, { h: 'Perfil', f: u => esc((PERFIS.find(p => p[0] === u.perfil) || [])[1]) },
      { h: 'Médico associado', f: u => esc(byId(L().medicos, u.medico_id)?.nome || '') }, { h: 'Ativo', f: u => u.ativo ? '✔' : '—' }], { onClick: u => editU(u), rowCls: u => u.ativo ? '' : 'off' })}
      <p class="muted small">Perfis: <b>Administrador</b> — acesso total incl. configuração; <b>Médico</b> — agenda filtrada pelo próprio; <b>Receção/Assistente</b> — operação diária.</p>`;
    const editU = u => {
      const isNew = !u; u = u || { perfil: 'rececao', ativo: 1 };
      modal({ title: isNew ? 'Novo utilizador' : 'Editar utilizador', body: `<form class="form-grid" onsubmit="return false">
        ${fld('Nome', inp('nome', u.nome), 's2')}${fld('Login', inp('login', u.login, 'autocomplete="off"'), 's2')}
        ${fld('Perfil', sel('perfil', optsArr(PERFIS, u.perfil)), 's2')}${fld('Médico associado', sel('medico_id', opts(L().medicos, u.medico_id, { empty: '—' })), 's2')}
        ${fld(isNew ? 'Palavra-passe' : 'Nova palavra-passe (deixe vazio para manter)', inp('password', '', 'type="password" autocomplete="new-password"'), 's2')}
        <div class="s2" style="padding-top:22px">${chk('ativo', u.ativo, 'Ativo')}</div></form>`,
      buttons: [{ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
        const f = readForm($('form', c.body)); f.medico_id = f.medico_id ? Number(f.medico_id) : null;
        if (!f.password) delete f.password;
        isNew ? await POST('users', f) : await PUT('users/' + u.id, f); toast('Utilizador guardado'); render();
      } }] });
    };
    $('#us-new').onclick = () => editU(null);
    return;
  }
  if (sec === 'registos') {
    if (!admin) { body.innerHTML = '<div class="empty">Sem permissão</div>'; return; }
    const logs = await GET('logs');
    body.innerHTML = `<div class="tbl-wrap">${table(logs, [{ h: 'Data', f: l => esc(l.data) }, { h: 'Utilizador', f: l => esc(l.user_nome || '—') }, { h: 'Ação', f: l => esc(l.acao) }, { h: 'Detalhe', f: l => esc(l.detalhe) }])}</div>`;
    return;
  }
  if (sec === 'backup') {
    body.innerHTML = `<h3>Cópia de segurança</h3><p>Descarrega uma cópia completa da base de dados (pacientes, agenda, faturação, stocks e configuração).
      Guarde-a num disco externo ou na nuvem. Recomenda-se uma cópia diária.</p>
      <p><a class="btn primary" href="/api/backup" ${admin ? '' : 'onclick="return false" style="opacity:.5"'}>⇩ Descarregar cópia de segurança</a></p>
      <p class="muted small">Para restaurar: pare o servidor, substitua o ficheiro <code>data/clinica.db</code> pela cópia (renomeada para clinica.db) e volte a iniciar.</p>`;
  }
});
