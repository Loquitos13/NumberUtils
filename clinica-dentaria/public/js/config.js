'use strict';
/* Configuração: clínica, agenda, tabelas de referência, utilizadores, registos, cópias de segurança */
const CFG_SECTIONS = [
  ['clinica', 'Empresa / clínica'], ['agenda', 'Agenda e feriados'], ['ivas', 'Tabela de IVA'], ['medicos', 'Médicos'], ['servicos', 'Tratamentos e preços'], ['especialidades', 'Especialidades'],
  ['gabinetes', 'Gabinetes'], ['estados', 'Estados das consultas'], ['razoes', 'Razões 1.ª visita'], ['entidades', 'Entidades / seguros'],
  ['laboratorios', 'Laboratórios'], ['armazens', 'Armazéns'], ['mensagens', 'E-mail e SMS'], ['sms', 'Modelos de mensagem'], ['anamnese', 'Anamnese'], ['utilizadores', 'Utilizadores'], ['registos', 'Registos'], ['importar', 'Importar pacientes'], ['backup', 'Cópia de segurança'],
];

// definição genérica: k = coluna, t = tipo
const CRUD_DEFS = {
  medicos: { table: 'medicos', title: 'Médico', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'abreviatura', h: 'Abrev.' },
    { k: 'especialidade_id', h: 'Especialidade', t: 'sel', list: () => L().especialidades, span: 2 }, { k: 'cedula', h: 'Cédula OMD' }, { k: 'nif', h: 'NIF' },
    { k: 'telefone', h: 'Telefone' }, { k: 'email', h: 'E-mail', span: 2 }, { k: 'cor', h: 'Cor', t: 'color' }, { k: 'comissao_pct', h: 'Comissão %', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  servicos: { table: 'servicos', title: 'Tratamento', cols: [{ k: 'codigo', h: 'Código' }, { k: 'nome', h: 'Nome', req: 1, span: 3 },
    { k: 'especialidade_id', h: 'Especialidade', t: 'sel', list: () => L().especialidades, span: 2 }, { k: 'preco', h: 'Preço €', t: 'num' }, { k: 'iva', h: 'IVA %', t: 'num' },
    { k: 'iva_id', h: 'IVA', t: 'sel', list: () => L().ivas, lab: ivaLabel }, { k: 'duracao_min', h: 'Duração (min)', t: 'num' },
    { k: 'simbolo', h: 'Símbolo no odontograma', t: 'opt', opts: () => SIMBOLOS, span: 2 }, { k: 'atalho', h: 'Atalho no odontograma', t: 'bool' }, { k: 'por_dente', h: 'Por dente', t: 'bool' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  especialidades: { table: 'especialidades', title: 'Especialidade', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'abreviatura', h: 'Abreviatura' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  gabinetes: { table: 'gabinetes', title: 'Gabinete', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  estados: { table: 'estados', title: 'Estado', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'cor', h: 'Cor', t: 'color' },
    { k: 'categoria', h: 'Categoria', t: 'opt', opts: [['OUTRAS', 'Outras (ativa)'], ['REALIZADAS', 'Realizada'], ['FALTAS', 'Falta'], ['INATIVAS', 'Inativa (desmarcada/cancelada)']] },
    { k: 'ordem', h: 'Ordem', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  razoes: { table: 'razoes_visita', title: 'Razão da 1.ª visita', cols: [{ k: 'abreviatura', h: 'Abreviatura', req: 1 }, { k: 'descricao', h: 'Descrição', span: 2 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  entidades: { table: 'entidades', title: 'Entidade', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'nif', h: 'NIF' }, { k: 'desconto_pct', h: 'Desconto %', t: 'num' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  laboratorios: { table: 'laboratorios', title: 'Laboratório', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 2 }, { k: 'contacto', h: 'Contacto' }, { k: 'telefone', h: 'Telefone' }, { k: 'email', h: 'E-mail', span: 2 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  ivas: { table: 'ivas', title: 'Taxa de IVA', cols: [{ k: 'taxa', h: 'Taxa %', t: 'num', req: 0 }, { k: 'descricao', h: 'Descrição', span: 3 },
    { k: 'regiao', h: 'Região', t: 'opt', opts: [['PT', 'PT — Portugal continental'], ['PT-AC', 'PT-AC — Açores'], ['PT-MA', 'PT-MA — Madeira']] },
    { k: 'codigo', h: 'Código', t: 'opt', opts: [['ISE', 'ISE — Isenta'], ['RED', 'RED — Reduzida'], ['INT', 'INT — Intermédia'], ['NOR', 'NOR — Normal'], ['OUT', 'OUT — Outros']] },
    { k: 'isencao_cod', h: 'Cód. isenção', t: 'opt', opts: () => [['', '—'], ...L().isencoes.map(([c, m]) => [c, `${c} — ${m}`])] },
    { k: 'isencao_motivo', h: 'Artigo / motivo de isenção', span: 3, help: 'Obrigatório nas taxas de 0%. Aparece impresso nos documentos.' }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  armazens: { table: 'armazens', title: 'Armazém', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' }] },
  sms: { table: 'sms_modelos', title: 'Modelo de mensagem', cols: [{ k: 'nome', h: 'Nome', req: 1, span: 3 }, { k: 'ativo', h: 'Ativo', t: 'bool' },
    { k: 'assunto', h: 'Assunto (e-mail)', span: 4 },
    { k: 'texto', h: 'Texto (SMS e corpo do e-mail)', t: 'area', span: 4, help: 'Variáveis: {nome} {primeiro_nome} {data} {dia_semana} {hora} {medico} {servico} {gabinete} {clinica} {telefone_clinica} {email_clinica} {morada_clinica}' }] },
  anamnese: { table: 'anamnese_perguntas', title: 'Pergunta da anamnese', cols: [{ k: 'texto', h: 'Pergunta', req: 1, span: 3 },
    { k: 'tipo', h: 'Tipo', t: 'opt', opts: [['sn', 'Sim / não'], ['texto', 'Texto'], ['escolha', 'Escolha']] },
    { k: 'opcoes', h: 'Opções (só para escolha)', span: 2, help: 'Separadas por ";". Ex.: A; B; AB; O' }, { k: 'ordem', h: 'Ordem', t: 'num' },
    { k: 'alerta', h: 'Alerta clínico', t: 'bool', help: 'A resposta "sim" aparece na faixa vermelha da ficha e da consulta.' }, { k: 'ativo', h: 'Ativa', t: 'bool', help: 'Desativar esconde a pergunta mas guarda as respostas já dadas.' }] },
};

function cellView(c, r) {
  const v = r[c.k];
  if (c.t === 'bool') return v ? 'Sim' : '<span class="muted">—</span>';
  if (c.t === 'color') return `<span class="dot" style="background:${esc(v)}"></span>`;
  if (c.t === 'sel') { const o = byId(c.list(), v); return esc(o ? (c.lab ? c.lab(o) : o.nome) : ''); }
  if (c.t === 'opt') { const os = typeof c.opts === 'function' ? c.opts() : c.opts; return esc(((os.find(o => o[0] === v) || [])[1] || v || '').split(' — ')[0]); }
  if (c.k === 'preco') return eur(v);
  if (c.t === 'area') return `<span class="small">${esc(v)}</span>`;
  return esc(v);
}
function cellInput(c, v) {
  if (c.t === 'bool') return `<div style="padding-top:6px">${chk(c.k, v, c.h)}</div>`;
  if (c.t === 'color') return inp(c.k, v || '#2563eb', 'type="color"');
  if (c.t === 'num') return inp(c.k, v ?? 0, 'type="number" step="any"');
  if (c.t === 'sel') return sel(c.k, opts(c.list(), v, { empty: '—', label: c.lab || 'nome' }));
  if (c.t === 'opt') return sel(c.k, optsArr(typeof c.opts === 'function' ? c.opts() : c.opts, v));
  if (c.t === 'area') return txt(c.k, v);
  return inp(c.k, v);
}
async function crudSection(body, def) {
  const rows = await GET('t/' + def.table);
  body.innerHTML = `<div class="row" style="margin-bottom:10px"><input id="cr-q" placeholder="Filtrar…" style="max-width:260px"><div class="spacer"></div>
    <button id="cr-csv">Exportar</button><button class="primary" id="cr-new">Adicionar</button></div><div id="cr-tbl"></div>`;
  const cols = def.cols.map(c => ({ h: c.h, cls: c.t === 'num' ? 'right' : '', f: r => cellView(c, r), csv: r => r[c.k] }));
  const draw = () => {
    const q = $('#cr-q').value.toLowerCase();
    const fr = rows.filter(r => !q || def.cols.some(c => String(r[c.k] ?? '').toLowerCase().includes(q)));
    $('#cr-tbl').innerHTML = `<div class="tbl-wrap">${table(fr, cols, { onClick: r => edit(r), rowCls: r => r.ativo === 0 ? 'off' : '' })}</div>`;
  };
  const edit = r => {
    const isNew = !r; r = r || { ativo: 1 };
    const buttons = [];
    if (!isNew) buttons.push({ label: 'Eliminar', cls: 'danger', left: true, onClick: async () => {
      if (!await confirmDlg(`Eliminar "${r.nome || r.abreviatura || r.texto}"?`, 'Eliminar', true)) return false;
      await DEL(`t/${def.table}/${r.id}`); toast('Eliminado'); await refreshLookups(); render();
    } });
    buttons.push({ label: 'Cancelar' }, { label: 'Guardar', cls: 'primary', onClick: async c => {
      const f = readForm($('form', c.body));
      for (const col of def.cols) { if (col.req && !f[col.k]) throw new Error(`Preencha: ${col.h}`); if (col.t === 'sel') f[col.k] = f[col.k] ? Number(f[col.k]) : null; }
      if (def.table === 'ivas') {
        if (f.taxa === 0 && !f.isencao_cod) throw new Error('As taxas de 0% precisam de código e motivo de isenção');
        if (f.isencao_cod && !f.isencao_motivo) f.isencao_motivo = (L().isencoes.find(i => i[0] === f.isencao_cod) || [])[1];
      }
      if (def.table === 'servicos' && f.iva_id) f.iva = byId(L().ivas, f.iva_id)?.taxa ?? 0;
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
    <div class="subnav">${CFG_SECTIONS.map(([k, l]) => `<button class="${k === sec ? 'active' : ''}" ${k === sec ? 'aria-current="page"' : ''} data-s="${k}">${l}</button>`).join('')}</div>
    ${admin ? '' : '<div class="alert">Apenas administradores podem alterar a configuração. Está em modo de consulta.</div>'}
    <div class="card" id="cf-body"></div>`;
  $$('.subnav button', view).forEach(b => b.onclick = () => go('#/config/' + b.dataset.s));
  const body = $('#cf-body');
  if (CRUD_DEFS[sec]) return crudSection(body, CRUD_DEFS[sec]);
  if (sec === 'importar') return importarSection(body, admin);
  const c = L().config;
  const saveCfg = async (form) => { await act(() => PUT('config', readForm(form)), 'Configuração guardada'); await refreshLookups(); render(); };

  if (sec === 'clinica') {
    body.innerHTML = `<form class="form-grid" onsubmit="return false">
      <div class="s4"><h3>Identificação</h3></div>
      ${fld('Nome / denominação social', inp('clinica_nome', c.clinica_nome), 's3')}${fld('NIF', inp('clinica_nif', c.clinica_nif, 'maxlength="9"'))}
      ${fld('Morada', inp('clinica_morada', c.clinica_morada), 's2')}${fld('Código postal e localidade', inp('clinica_cp', c.clinica_cp), 's2')}
      ${fld('Telefone', inp('clinica_telefone', c.clinica_telefone))}${fld('Telemóvel', inp('clinica_telemovel', c.clinica_telemovel))}
      ${fld('E-mail', inp('clinica_email', c.clinica_email))}${fld('Website', inp('clinica_website', c.clinica_website))}
      <div class="s4"><h3 style="margin-top:8px">Registo comercial e bancário</h3></div>
      ${fld('Capital social', inp('clinica_capital', c.clinica_capital, 'placeholder="ex.: 5.000,00 €"'))}${fld('Conservatória (local CRC)', inp('clinica_crc', c.clinica_crc))}
      ${fld('N.º registo ERS', inp('clinica_ers', c.clinica_ers))}${fld('IBAN', inp('clinica_iban', c.clinica_iban))}
      <div class="s4"><h3 style="margin-top:8px">Faturação</h3></div>
      ${fld('Região fiscal de IVA', sel('clinica_regiao_iva', optsArr([['PT', 'Portugal continental'], ['PT-AC', 'Açores'], ['PT-MA', 'Madeira']], c.clinica_regiao_iva || 'PT')))}
      ${fld('Taxa de IVA por omissão (%)', inp('iva_default', c.iva_default, 'type="number"'))}
      ${fld('Validade dos orçamentos (dias)', inp('validade_orcamento_dias', c.validade_orcamento_dias, 'type="number"'))}
      ${fld('Representante legal (temas fiscais)', inp('representante_nome', c.representante_nome))}${fld('NIF do representante', inp('representante_nif', c.representante_nif))}<div></div>
      ${fld('Rodapé / notas dos documentos', txt('doc_rodape', c.doc_rodape), 's4')}
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
      ${fld('Mensagem global (aparece na agenda de todos)', txt('agenda_mensagem', c.agenda_mensagem), 's4')}
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
  if (sec === 'mensagens') {
    const mSel = (k) => sel(k, opts(ativos(L().sms_modelos), c[k]));
    const canais = (k) => `${chk(k + '_sms', (c[k] || '').includes('sms'), 'SMS')}${chk(k + '_email', (c[k] || '').includes('email'), 'E-mail')}`;
    body.innerHTML = `<form class="form-grid" id="cf-msg" onsubmit="return false">
      <div class="s4"><h3>E-mail (SMTP)</h3><p class="muted small" style="margin-top:0">Use os dados da conta de e-mail da clínica (ex.: Microsoft 365: smtp.office365.com, porta 587, STARTTLS; Gmail: smtp.gmail.com, porta 587, com palavra-passe de aplicação).</p></div>
      ${fld('Servidor SMTP', inp('smtp_host', c.smtp_host, 'placeholder="smtp.exemplo.pt"'), 's2')}${fld('Porta', inp('smtp_porta', c.smtp_porta, 'type="number"'))}
      ${fld('Segurança', sel('smtp_seguranca', optsArr([['starttls', 'STARTTLS (587)'], ['ssl', 'SSL/TLS (465)'], ['nenhuma', 'Sem cifra (não recomendado)']], c.smtp_seguranca)))}
      ${fld('Utilizador', inp('smtp_utilizador', c.smtp_utilizador, 'autocomplete="off"'))}${fld('Palavra-passe', inp('smtp_password', c.smtp_password, 'type="password" autocomplete="new-password"'))}
      ${fld('E-mail do remetente', inp('smtp_de', c.smtp_de, 'type="email"'))}${fld('Nome do remetente', inp('smtp_nome', c.smtp_nome || c.clinica_nome))}
      <div class="s4"><h3 style="margin-top:6px">SMS</h3></div>
      ${fld('Fornecedor', sel('sms_fornecedor', optsArr([['', 'Nenhum (preparar e enviar pelo telemóvel)'], ['twilio', 'Twilio'], ['http', 'Outro fornecedor (API HTTP)']], c.sms_fornecedor)), 's2')}
      ${fld('Remetente (nome ou número)', inp('sms_remetente', c.sms_remetente, 'maxlength="11"'))}${fld('Indicativo por omissão', inp('sms_indicativo', c.sms_indicativo))}
      ${fld('Conta (Account SID)', inp('sms_conta', c.sms_conta), 's2 sms-twilio')}${fld('Token / chave da API', inp('sms_token', c.sms_token, 'type="password" autocomplete="new-password"'), 's2 sms-any')}
      ${fld('URL da API (use {para} {numero} {texto} {remetente} {token})', inp('sms_url', c.sms_url, 'placeholder="https://api.fornecedor.pt/sms?to={numero}&text={texto}"'), 's4 sms-http')}
      ${fld('Método', sel('sms_metodo', optsArr(['POST', 'GET'], c.sms_metodo)), 'sms-http')}${fld('Cabeçalho de autenticação', inp('sms_auth_header', c.sms_auth_header, 'placeholder="Authorization"'), 'sms-http')}
      ${fld('Prefixo do token', inp('sms_auth_prefixo', c.sms_auth_prefixo, 'placeholder="Bearer"'), 'sms-http')}<div class="sms-http"></div>
      ${fld('Corpo do pedido (JSON ou formulário)', txt('sms_corpo', c.sms_corpo, 'placeholder=\'{"to":"{para}","from":"{remetente}","text":"{texto}"}\''), 's4 sms-http')}
      <div class="s4"><h3 style="margin-top:6px">Envios automáticos</h3></div>
      <div class="s2">${chk('confirmacao_auto', c.confirmacao_auto === '1', 'Enviar confirmação quando se cria uma marcação')}<div style="margin:6px 0 0 22px">${canais('confirmacao_canais')}</div></div>
      ${fld('Modelo da confirmação', mSel('confirmacao_modelo_id'), 's2')}
      <div class="s2">${chk('lembrete_auto', c.lembrete_auto === '1', 'Enviar lembrete antes da consulta')}<div style="margin:6px 0 0 22px">${canais('lembrete_canais')}</div></div>
      ${fld('Horas de antecedência', inp('lembrete_horas', c.lembrete_horas || 24, 'type="number" min="1"'))}${fld('Modelo do lembrete', mSel('lembrete_modelo_id'))}
      <div class="s4 small muted">Os lembretes são verificados a cada 5 minutos enquanto o servidor estiver ligado. Só se enviam a pacientes com consentimento de SMS/e-mail na ficha.</div>
      <div class="s4 row" style="margin-top:8px"><button type="button" id="msg-test-email">Testar e-mail</button><button type="button" id="msg-test-sms">Testar SMS</button><div class="spacer"></div><button class="primary" id="msg-save">Guardar</button></div>
    </form>`;
    const form = $('#cf-msg');
    const vis = () => { const v = form.sms_fornecedor.value; $$('.sms-twilio', form).forEach(x => x.classList.toggle('hidden', v !== 'twilio')); $$('.sms-http', form).forEach(x => x.classList.toggle('hidden', v !== 'http')); $$('.sms-any', form).forEach(x => x.classList.toggle('hidden', !v)); };
    form.sms_fornecedor.onchange = vis; vis();
    const guardar = async () => {
      const f = readForm(form);
      for (const k of ['confirmacao_canais', 'lembrete_canais']) { f[k] = [f[k + '_sms'] && 'sms', f[k + '_email'] && 'email'].filter(Boolean).join(','); delete f[k + '_sms']; delete f[k + '_email']; }
      f.confirmacao_auto = String(f.confirmacao_auto); f.lembrete_auto = String(f.lembrete_auto);
      await PUT('config', f); await refreshLookups(); App.dirty = false;
    };
    $('#msg-save').onclick = async () => { await act(guardar, 'Configuração guardada'); };
    $('#msg-test-email').onclick = async () => { await act(guardar); const para = await promptDlg('Testar e-mail', 'Enviar teste para', c.smtp_de || ''); if (para) await act(() => POST('sms/teste', { canal: 'email', para }), 'E-mail de teste enviado'); };
    $('#msg-test-sms').onclick = async () => { await act(guardar); const para = await promptDlg('Testar SMS', 'Enviar teste para o número', ''); if (para) await act(() => POST('sms/teste', { canal: 'sms', para }), 'SMS de teste enviado'); };
    return;
  }
  if (sec === 'utilizadores') {
    if (!admin) { body.innerHTML = '<div class="empty">Sem permissão</div>'; return; }
    const us = await GET('users');
    const PERFIS = [['admin', 'Administrador'], ['medico', 'Médico'], ['rececao', 'Receção'], ['assistente', 'Assistente']];
    body.innerHTML = `<div class="row end" style="margin-bottom:10px"><button class="primary" id="us-new">Novo utilizador</button></div>${table(us, [
      { h: 'Nome', f: u => `<b>${esc(u.nome)}</b>` }, { h: 'Login', f: u => esc(u.login) }, { h: 'Perfil', f: u => esc((PERFIS.find(p => p[0] === u.perfil) || [])[1]) },
      { h: 'Médico associado', f: u => esc(byId(L().medicos, u.medico_id)?.nome || '') }, { h: 'Ativo', f: u => u.ativo ? 'Sim' : 'Não' }], { onClick: u => editU(u), rowCls: u => u.ativo ? '' : 'off' })}
      <p class="muted small">Perfis: <b>Administrador</b> — acesso total incl. configuração; <b>Médico</b> — agenda filtrada pelo próprio; <b>Receção/Assistente</b> — operação diária.</p>`;
    const editU = u => {
      const isNew = !u; u = u || { perfil: 'rececao', ativo: 1 };
      modal({ title: isNew ? 'Novo utilizador' : 'Editar utilizador', body: `<form class="form-grid" onsubmit="return false">
        ${fld('Nome', inp('nome', u.nome), 's2')}${fld('Login', inp('login', u.login, 'autocomplete="off"'), 's2')}
        ${fld('Perfil', sel('perfil', optsArr(PERFIS, u.perfil)), 's2')}${fld('Médico associado', sel('medico_id', opts(L().medicos, u.medico_id, { empty: '—' })), 's2')}
        ${fld(isNew ? 'Palavra-passe provisória (mín. 8)' : 'Nova palavra-passe provisória (vazio = manter)', inp('password', '', 'type="password" autocomplete="new-password" minlength="8"'), 's2')}
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
    body.innerHTML = `<h3>Cópia de segurança</h3><p>Descarrega um ficheiro <strong>.zip</strong> com a base de dados (pacientes, agenda, faturação, stocks e configuração) e os ficheiros dos pacientes (RX, fotos, documentos).
      Guarde-o num disco externo ou na nuvem. Recomenda-se uma cópia diária.</p>
      <p><a class="btn primary" href="/api/backup" ${admin ? '' : 'onclick="return false" aria-disabled="true" style="opacity:.5"'}>Descarregar cópia de segurança</a></p>
      <p class="muted small">Para restaurar: extraia o .zip, pare o servidor, substitua <code>data/clinica.db</code> e a pasta <code>data/anexos</code> pelos do .zip e volte a iniciar.</p>`;
  }
});
