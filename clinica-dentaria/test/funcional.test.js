'use strict';
// Fluxos de negócio de ponta a ponta pela API: listagens e estatísticas num conjunto pequeno de dados,
// paciente → consulta → faturação, orçamentos, próteses e mensagens (SMS/e-mail com e sem consentimento).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server } = require('../server');
const COM = require('../comunicacao');

let base, cookie = '';
async function api(metodo, url, corpo) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const HOJE = iso(new Date());
const ONTEM = (d => (d.setDate(d.getDate() - 1), iso(d)))(new Date()); // dia de calendário, não −24 h (mudança da hora)
const soma = (rows, k) => Math.round(rows.reduce((a, r) => a + r[k], 0) * 100) / 100;

let est, modelos;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  const lk = await ok('GET', 'lookups');
  est = Object.fromEntries(lk.estados.map(e => [e.nome, e.id]));
  modelos = Object.fromEntries(lk.sms_modelos.map(m => [m.nome, m.id]));
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------- conjunto pequeno de dados para listagens e estatísticas (corre primeiro) ----------
let M, P1, P2, frDoc;
test('dados de base: 2 pacientes, 3 marcações hoje, FR 100 + FT 60 com recibo de 20', async () => {
  M = (await ok('POST', 't/medicos', { nome: 'Dra. Listagem', comissao_pct: 30 })).id;
  P1 = (await ok('POST', 't/pacientes', { nome: 'Ana Lista', medico_id: M })).id;
  P2 = (await ok('POST', 't/pacientes', { nome: 'Bruno Lista' })).id;
  const marc = (p, h, extra = {}) => ok('POST', 'marcacoes', { paciente_id: p, medico_id: M, inicio: `${HOJE}T${h}`, fim: `${HOJE}T${h.replace(':00', ':30')}`, forcar: true, ...extra });
  await marc(P1, '10:00', { estado_id: est['Concluída'] });
  await marc(P2, '11:00', { estado_id: est.Faltou });
  const m3 = await marc(P1, '12:00');
  await ok('PUT', `marcacoes/${m3.id}`, { inicio: `${HOJE}T12:30`, fim: `${HOJE}T13:00`, forcar: true });
  const t = (await ok('POST', 't/tratamentos', { paciente_id: P1, medico_id: M, descricao: 'Endodontia', preco: 100, estado: 'realizado', data: HOJE })).id;
  frDoc = await ok('POST', 'documentos', { tipo: 'FR', paciente_id: P1, linhas: [{ tratamento_id: t, descricao: 'Endodontia', preco: 100, iva: 0 }] });
  const ft = await ok('POST', 'documentos', { tipo: 'FT', paciente_id: P2, linhas: [{ descricao: 'Consulta', preco: 60, iva: 0 }] });
  await ok('POST', 'recibos', { paciente_id: P2, valor: 20, documento_ids: [ft.id], metodo: 'MB' });
  await ok('POST', 'orcamentos', { paciente_id: P2, medico_id: M, linhas: [{ descricao: 'Implante', preco: 900 }] });
  await ok('POST', 't/lista_espera', { paciente_id: P2, medico_id: M });
  // ocupação num dia fixo (segunda-feira): 1 h marcada, 2 h bloqueadas, clínica aberta 08:30–20:00
  await ok('POST', 'marcacoes', { paciente_id: P1, medico_id: M, inicio: '2031-03-03T09:00', fim: '2031-03-03T10:00' });
  await ok('POST', 't/bloqueios', { medico_id: M, inicio: '2031-03-03T14:00', fim: '2031-03-03T16:00', tipo: 'congresso' });
});

test('cada listagem devolve 200 com os totais certos', async () => {
  const L = async (tipo, qs = '') => { const r = await ok('GET', `listagens/${tipo}?de=${HOJE}&ate=${HOJE}${qs}`); assert.ok(r.titulo && Array.isArray(r.cols) && Array.isArray(r.rows), tipo); return r.rows; };
  for (const por of ['medico', 'entidade', 'utilizador', 'paciente']) assert.equal((await L('agenda', `&por=${por}`)).length, 3, por);
  assert.deepEqual((await L('agenda', `&paciente_id=${P1}`)).map(r => r.entidade_nome), ['Particular', 'Particular']);
  assert.deepEqual((await L('confirmar')).map(r => r.paciente_nome), ['Ana Lista']);
  assert.deepEqual((await L('faltas')).map(r => r.paciente_nome), ['Bruno Lista']);
  assert.deepEqual((await L('remarcacoes')).map(r => [r.paciente_nome, r.remarcacoes]), [['Ana Lista', 1]]);
  assert.deepEqual((await L('espera')).map(r => r.paciente_nome), ['Bruno Lista']);
  const caixa = await L('caixa');
  assert.deepEqual([caixa.length, soma(caixa, 'valor')], [2, 120]);
  const com = await L('comissoes');
  assert.deepEqual(com.map(r => [r.medico_nome, r.valor, r.comissao]), [['(sem médico)', 60, 0], ['Dra. Listagem', 100, 30]]);
  assert.deepEqual((await L('pendentes')).map(r => [r.nome, r.faturado, r.pago, r.saldo]), [['Bruno Lista', 60, 20, 40]]);
  assert.deepEqual((await L('producao')).map(r => [r.descricao, r.valor, r.documento]), [['Endodontia', 100, frDoc.numero]]);
  assert.deepEqual((await L('orcamentos')).map(r => [r.paciente_nome, r.estado, r.total]), [['Bruno Lista', 'aberto', 900]]);
  assert.deepEqual((await L('orcamentos', '&estado=aceite')), []);
  const mov = await L('movimentos');
  assert.deepEqual([mov.length, soma(mov, 'debito'), soma(mov, 'credito')], [4, 160, 120]);
  const oc = (await ok('GET', `listagens/ocupacao?de=2031-03-03&ate=2031-03-03&medico_id=${M}`)).rows;
  assert.deepEqual(oc, [{ medico_nome: 'Dra. Listagem', marcacoes: 1, horas_disp: 9.5, horas_ocup: 1, taxa: 10.53 }]);
  assert.deepEqual((await ok('GET', 'listagens/ausencias?de=2031-03-03&ate=2031-03-03')).rows.map(r => r.tipo_nome), ['Congresso/formação']);
  assert.equal((await api('GET', 'listagens/nao-existe')).status, 404);
});

test('estatísticas do dia batem com os dados', async () => {
  const e = await ok('GET', `estatisticas?de=${HOJE}&ate=${HOJE}`);
  assert.deepEqual(e.kpi, { marcacoes: 3, faltas: 1, taxaFaltas: 33.33, novos: 2, faturado: 160, recebido: 120, emDivida: 40 });
  assert.deepEqual(e.porMedico.map(m => [m.nome, m.n, m.realizadas, m.faltas]), [['Dra. Listagem', 3, 1, 1]]);
  assert.deepEqual(e.recebMetodo.map(r => [r.metodo, r.total]), [['Numerário', 100], ['MB', 20]]);
  assert.deepEqual(e.fatMedico.map(f => [f.nome, f.total, f.comissao]), [['Dra. Listagem', 100, 30], ['(sem médico)', 60, 0]]);
  assert.deepEqual(e.fatMes.map(f => f.total), [160]);
  assert.deepEqual(e.topServicos.map(s => [s.nome, s.n, s.valor]), [['Endodontia', 1, 100]]);
  const dash = await ok('GET', 'dashboard');
  assert.deepEqual([dash.faturado_hoje, dash.recebido_hoje, dash.orcamentos_abertos, dash.hoje.length], [160, 120, 1, 3]);
});

// ---------- paciente → consulta → faturação ----------
test('fluxo completo: ficha, anamnese, marcação, consulta, odontograma, FR, FT + recibo, saldo 0', async () => {
  const med = (await ok('POST', 't/medicos', { nome: 'Dr. Fluxo' })).id;
  const p = await ok('POST', 't/pacientes', { nome: 'Carla Fluxo', nif: '123456789', telemovel: '913000000', rgpd_consent: 1, rgpd_data: HOJE });
  assert.ok(p.numero > 0);
  await ok('PUT', `anamnese/${p.id}`, { alergias: 'Látex', anticoagulantes: 1 });
  let r = await ok('GET', `pacientes/${p.id}/resumo`);
  assert.equal(r.anamnese.alergias, 'Látex');
  assert.equal(r.anamnese.anticoagulantes, 1);
  const m = await ok('POST', 'marcacoes', { paciente_id: p.id, medico_id: med, inicio: `${HOJE}T16:00`, fim: `${HOJE}T16:45`, forcar: true });
  for (const e of ['Presente', 'Em consulta', 'Concluída']) assert.equal((await ok('PUT', `marcacoes/${m.id}`, { estado_id: est[e], forcar: true })).estado_nome, e);
  // odontograma: cárie no 16 → restauração necessária → feita na consulta
  await ok('POST', 't/dentes_condicoes', { paciente_id: p.id, dente: '16', condicao: 'carie', faces: 'O', data: HOJE });
  assert.deepEqual((await ok('GET', `t/dentes_condicoes?paciente_id=${p.id}`)).map(c => [c.dente, c.condicao]), [['16', 'carie']]);
  const sv = (await ok('GET', 'lookups')).servicos.find(s => s.codigo === 'R001');
  const t1 = await ok('POST', 't/tratamentos', { paciente_id: p.id, medico_id: med, servico_id: sv.id, descricao: sv.nome, dente: '16', faces: 'O', preco: sv.preco });
  assert.equal(t1.estado, 'planeado');
  assert.equal((await ok('GET', `pacientes/${p.id}/resumo`)).por_realizar, 50);
  await ok('PUT', `t/tratamentos/${t1.id}`, { estado: 'realizado', data: HOJE, marcacao_id: m.id });
  const t2 = await ok('POST', 't/tratamentos', { paciente_id: p.id, medico_id: med, descricao: 'RX periapical', dente: '16', preco: 10, estado: 'realizado', data: HOJE, marcacao_id: m.id });
  await ok('POST', 'notas', { paciente_id: p.id, marcacao_id: m.id, texto: 'Restauração 16 O sem intercorrências' });
  const fr = await ok('POST', 'documentos', { tipo: 'FR', paciente_id: p.id, linhas: [{ tratamento_id: t1.id, descricao: sv.nome, dente: '16', preco: 50, iva: 0 }] });
  const ft = await ok('POST', 'documentos', { tipo: 'FT', paciente_id: p.id, linhas: [{ tratamento_id: t2.id, descricao: 'RX periapical', preco: 10, iva: 0 }] });
  assert.equal((await ok('GET', `pacientes/${p.id}/contacorrente`)).saldo, 10);
  await ok('POST', 'recibos', { paciente_id: p.id, valor: 10, documento_ids: [ft.id] });
  r = await ok('GET', `pacientes/${p.id}/resumo`);
  assert.deepEqual(r.saldo, { faturado: 60, creditos: 0, pago: 60, saldo: 0 });
  assert.equal(r.por_realizar, 0);
  assert.equal(r.stats.realizadas, 1);
  const trats = await ok('GET', `pacientes/${p.id}/tratamentos`);
  assert.deepEqual(trats.map(t => [t.descricao, t.documento_numero, t.documento_pago, t.marcacao_inicio]).sort(),
    [['RX periapical', ft.numero, 10, `${HOJE}T16:00`], [sv.nome, fr.numero, 50, `${HOJE}T16:00`]].sort());
  assert.equal((await ok('GET', `pacientes/${p.id}/notas`)).length, 1);
  assert.deepEqual(await ok('GET', `pacientes/${p.id}/em-aberto`), []);
});

// ---------- orçamentos ----------
test('fluxo de orçamento: aberto → aceite → tratamentos → faturado; recusado e expirado nas listagens', async () => {
  const p = (await ok('POST', 't/pacientes', { nome: 'Diana Orçamento' })).id;
  const o = await ok('POST', 'orcamentos', { paciente_id: p, linhas: [{ descricao: 'Coroa cerâmica', dente: '21', preco: 450 }, { descricao: 'Consulta', preco: 30 }] });
  assert.equal(o.total, 480);
  assert.deepEqual((await ok('GET', `orcamentos?paciente_id=${p}&estado=aberto`)).map(x => x.id), [o.id]);
  await ok('POST', `orcamentos/${o.id}/aceitar`);
  const plano = await ok('GET', `pacientes/${p}/tratamentos`);
  assert.deepEqual(plano.map(t => [t.descricao, t.estado, t.orcamento_numero, t.orcamento_estado]).sort(),
    [['Consulta', 'planeado', o.numero, 'aceite'], ['Coroa cerâmica', 'planeado', o.numero, 'aceite']]);
  // faturar um tratamento planeado passa-o a realizado
  const coroa = plano.find(t => t.descricao === 'Coroa cerâmica');
  await ok('POST', 'documentos', { tipo: 'FR', paciente_id: p, linhas: [{ tratamento_id: coroa.id, descricao: coroa.descricao, preco: coroa.preco, iva: 0 }] });
  const depois = (await ok('GET', `pacientes/${p}/tratamentos`)).find(t => t.id === coroa.id);
  assert.deepEqual([depois.estado, depois.data], ['realizado', HOJE]);
  assert.equal((await ok('GET', `pacientes/${p}/resumo`)).por_realizar, 30);
  const rec = await ok('POST', 'orcamentos', { paciente_id: p, linhas: [{ descricao: 'Branqueamento', preco: 300 }] });
  await ok('POST', `orcamentos/${rec.id}/recusar`);
  const velho = await ok('POST', 'orcamentos', { paciente_id: p, data: '2020-01-10', linhas: [{ descricao: 'Antigo', preco: 10 }] });
  const lst = async estado => (await ok('GET', `listagens/orcamentos?de=2020-01-01&ate=${HOJE}&estado=${estado}`)).rows.map(r => r.numero);
  assert.deepEqual(await lst('aceite'), [o.numero]);
  assert.deepEqual(await lst('recusado'), [rec.numero]);
  assert.deepEqual(await lst('expirado'), [velho.numero]);
  await ok('DELETE', `orcamentos/${velho.id}`);
  assert.equal((await api('GET', `orcamentos/${velho.id}`)).status, 404);
});

// ---------- próteses ----------
test('prótese: pedido → enviado → recebido → entregue, com filtros e painel', async () => {
  const lab = (await ok('POST', 't/laboratorios', { nome: 'Lab Fluxo' })).id;
  const p = (await ok('POST', 't/pacientes', { nome: 'Eva Prótese' })).id;
  const pr = await ok('POST', 't/proteses', { paciente_id: p, laboratorio_id: lab, tipo: 'Coroa', dentes: '11', data_emissao: ONTEM, data_prevista: ONTEM, custo: 180 });
  assert.equal(pr.fase, 'pedido');
  const ids = async f => (await ok('GET', `proteses?filtro=${f}&laboratorio_id=${lab}`)).map(x => x.id);
  const dash = async () => { const d = await ok('GET', 'dashboard'); return [d.proteses_atraso, d.proteses_clinica]; };
  assert.deepEqual([await ids('para_enviar'), await ids('pendentes'), await ids('atraso')], [[pr.id], [pr.id], [pr.id]]);
  assert.deepEqual(await dash(), [1, 0]);
  await ok('PUT', `t/proteses/${pr.id}`, { fase: 'enviado', data_envio: HOJE });
  assert.deepEqual([await ids('para_enviar'), await ids('atraso')], [[], [pr.id]]);
  await ok('PUT', `t/proteses/${pr.id}`, { fase: 'recebido', data_rececao: HOJE });
  assert.deepEqual([await ids('na_clinica'), await ids('pendentes'), await ids('atraso')], [[pr.id], [], []]);
  assert.deepEqual(await dash(), [0, 1]);
  await ok('PUT', `t/proteses/${pr.id}`, { fase: 'entregue', data_entrega: HOJE });
  assert.deepEqual([await ids('entregues'), await ids('na_clinica')], [[pr.id], []]);
  assert.deepEqual(await dash(), [0, 0]);
  const c = await ok('POST', 't/proteses', { paciente_id: p, laboratorio_id: lab, fase: 'cancelado', data_prevista: ONTEM });
  assert.deepEqual([await ids('canceladas'), await ids('atraso')], [[c.id], []]);
  assert.deepEqual((await ok('GET', `proteses?paciente_id=${p}`)).map(x => x.laboratorio_nome), ['Lab Fluxo', 'Lab Fluxo']);
});

// ---------- mensagens ----------
test('SMS/e-mail: preparar e enviar respeitam o consentimento e nunca enviam sem ele', async () => {
  const sms = [], mails = [];
  const oS = COM.enviarSMS, oE = COM.enviarEmail;
  COM.enviarSMS = async (cfg, m) => { sms.push(m); }; COM.enviarEmail = async (cfg, m) => { mails.push(m); };
  try {
    const nao = (await ok('POST', 't/pacientes', { nome: 'Rui Recusa', telemovel: '911111111', email: 'rui@exemplo.pt', sms_ok: 0, email_ok: 0 })).id;
    const sim = (await ok('POST', 't/pacientes', { nome: 'Sara Aceita Silva', telemovel: '922222222', email: 'sara@exemplo.pt' })).id;
    const semNum = (await ok('POST', 't/pacientes', { nome: 'Tó Sem Contactos' })).id;
    const corpo = { modelo_id: modelos['Aniversário'], paciente_ids: [nao, sim, semNum], canais: ['sms', 'email'] };
    const estados = r => r.map(x => [x.nome.split(' ')[0], x.canal, x.estado]).sort();
    // sem fornecedor configurado: só prepara
    assert.deepEqual(estados(await ok('POST', 'sms/preparar', corpo)), [
      ['Rui', 'email', 'sem consentimento'], ['Rui', 'sms', 'sem consentimento'],
      ['Sara', 'email', 'preparado'], ['Sara', 'sms', 'preparado'], ['Tó', 'email', 'sem e-mail'], ['Tó', 'sms', 'sem número']]);
    await ok('PUT', 'config', { sms_fornecedor: 'http', smtp_host: 'smtp.exemplo.pt', smtp_de: 'clinica@exemplo.pt' });
    assert.deepEqual((await ok('GET', 'sms/estado')), { email: true, sms: true });
    const prep = await ok('POST', 'sms/preparar', corpo); // preparar nunca envia, mesmo configurado
    assert.ok(prep.every(x => x.estado !== 'enviado'));
    assert.deepEqual([sms.length, mails.length], [0, 0]);
    const env = await ok('POST', 'sms/enviar', corpo);
    assert.deepEqual(estados(env).filter(x => x[0] !== 'Tó'), [
      ['Rui', 'email', 'sem consentimento'], ['Rui', 'sms', 'sem consentimento'], ['Sara', 'email', 'enviado'], ['Sara', 'sms', 'enviado']]);
    assert.deepEqual([sms.map(m => m.para), mails.map(m => m.para)], [['922222222'], ['sara@exemplo.pt']]);
    assert.equal(sms[0].texto, 'Parabéns Sara! A equipa da OralSaúde — Clínica de Saúde Oral deseja-lhe um feliz aniversário.');
    assert.equal(mails[0].assunto, 'Feliz aniversário!');
    const hist = (await ok('GET', 'sms/historico')).filter(h => h.paciente_id === nao);
    assert.equal(hist.length, 6); // 3 pedidos × 2 canais
    assert.ok(hist.every(h => h.estado === 'sem consentimento'));
    assert.equal((await api('POST', 'sms/preparar', { modelo_id: 99999, paciente_ids: [sim] })).status, 400);
  } finally { COM.enviarSMS = oS; COM.enviarEmail = oE; await ok('PUT', 'config', { sms_fornecedor: '', smtp_host: '', smtp_de: '' }); }
});

test('falha do fornecedor de SMS fica registada como erro, sem derrubar o pedido', async () => {
  const oS = COM.enviarSMS; COM.enviarSMS = async () => { throw new Error('saldo insuficiente'); };
  try {
    await ok('PUT', 'config', { sms_fornecedor: 'http' });
    const p = (await ok('POST', 't/pacientes', { nome: 'Vera Erro', telemovel: '933333333' })).id;
    const [r] = await ok('POST', 'sms/enviar', { modelo_id: modelos['Revisão anual'], paciente_ids: [p] });
    assert.deepEqual([r.estado, r.erro], ['erro', 'saldo insuficiente']);
  } finally { COM.enviarSMS = oS; await ok('PUT', 'config', { sms_fornecedor: '' }); }
});
