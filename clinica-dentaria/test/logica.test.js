'use strict';
// Lógica de dinheiro e impostos: IVA por linha, arredondamentos, séries, limites da FS, NC/ND, recibos,
// saldos após anulações, orçamentos, comissões, mapa de caixa, NIF e stocks.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server, r2 } = require('../server');
const D = require('../db');

let base, cookie = '', ckRec = '', recId;
async function api(metodo, url, corpo, ck = cookie) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: ck }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc && ck === cookie) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hoje = () => iso(new Date());
const ANO = new Date().getFullYear();
const paciente = async (nome, extra = {}) => (await ok('POST', 't/pacientes', { nome, ...extra })).id;
const doc = (tipo, paciente_id, linhas, extra = {}) => api('POST', 'documentos', { tipo, paciente_id, linhas, ...extra });
const okDoc = async (...a) => { const r = await doc(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const saldo = async pid => (await ok('GET', `pacientes/${pid}/contacorrente`)).saldo;
const L = (preco, extra = {}) => ({ descricao: 'Linha ' + preco, preco, iva: 0, ...extra });

before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  recId = (await ok('POST', 'users', { nome: 'Caixa', login: 'caixa', password: 'provisoria1', perfil: 'rececao' })).id;
  ckRec = (await fetch(base + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login: 'caixa', password: 'provisoria1' }) }))
    .headers.get('set-cookie').split(';')[0];
  await ok('POST', 'password', { atual: 'provisoria1', nova: 'caixa-nova-boa' }, ckRec);
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------- numeração ----------
test('numeração por série e ano, sem buracos quando a emissão falha, e mudança de ano', async () => {
  const p = await paciente('Numeração');
  assert.equal((await okDoc('FT', p, [L(10)])).numero, `FT ${ANO}/1`);
  assert.equal((await okDoc('FR', p, [L(10)])).numero, `FR ${ANO}/1`); // série própria
  // taxa a 0% sem motivo de isenção: a emissão falha dentro da transação
  const semMotivo = await ok('POST', 't/ivas', { taxa: 0, descricao: 'Zero sem motivo', regiao: 'PT-XX', codigo: 'ZZ' });
  assert.equal((await doc('FT', p, [L(10, { iva_id: semMotivo.id })])).status, 400);
  assert.equal((await doc('FS', p, [L(150)])).status, 400); // acima do limite
  assert.equal((await okDoc('FT', p, [L(10)])).numero, `FT ${ANO}/2`);
  assert.equal((await okDoc('FS', p, [L(10)])).numero, `FS ${ANO}/1`);
  const ft3 = await okDoc('FT', p, [L(10)]);
  await ok('POST', `documentos/${ft3.id}/anular`, { motivo: 'erro' });
  assert.equal((await okDoc('FT', p, [L(10)])).numero, `FT ${ANO}/4`); // número anulado não é reutilizado
  // documentos com data do ano anterior abrem a série desse ano
  assert.equal((await okDoc('FT', p, [L(10)], { data: `${ANO - 1}-12-31` })).numero, `FT ${ANO - 1}/1`);
  assert.equal((await doc('FT', p, [L(10)], { data: `${ANO - 1}-12-30` })).status, 400); // anterior ao último da série
  assert.equal((await okDoc('FT', p, [L(10)], { data: `${ANO - 1}-12-31` })).numero, `FT ${ANO - 1}/2`);
  assert.equal((await okDoc('FT', p, [L(10)])).numero, `FT ${ANO}/5`);
  assert.equal((await doc('FT', p, [L(10)], { data: '2026-02-30x' })).status, 400);
});

// ---------- IVA, desconto, arredondamentos ----------
test('IVA calculado por linha sobre o valor com desconto', async () => {
  const p = await paciente('IVA Linhas');
  const d = await okDoc('FT', p, [
    { descricao: 'Coroa', preco: 100, desconto_pct: 10, iva: 23 }, // base 90,00 · IVA 20,70
    { descricao: 'Material', preco: 19.99, qtd: 3, desconto_pct: 15, iva: 6 }, // base 50,97 · IVA 3,06
  ]);
  assert.deepEqual(d.linhas.map(l => [l.qtd, l.preco, l.desconto_pct, l.iva, l.total, l.isencao_cod]),
    [[1, 100, 10, 23, 110.7, null], [3, 19.99, 15, 6, 54.03, null]]);
  assert.deepEqual([d.total_base, d.total_iva, d.total], [140.97, 23.76, 164.73]);
  assert.equal(await saldo(p), 164.73);
});

test('arredondamento ao cêntimo: 3 linhas de 33,333 € vs. 1 linha com qtd 3', async () => {
  const p = await paciente('Arredonda');
  const tres = await okDoc('FR', p, [L(33.333), L(33.333), L(33.333)]);
  assert.deepEqual(tres.linhas.map(l => l.total), [33.33, 33.33, 33.33]);
  assert.equal(tres.total, 99.99);
  const uma = await okDoc('FR', p, [L(33.333, { qtd: 3 })]);
  assert.equal(uma.total, 100);
  assert.equal(await saldo(p), 0);
});

test('IVA a meio cêntimo arredonda para cima (2,50 € a 23% = 0,575 → 0,58)', async () => {
  const p = await paciente('Meio Cêntimo');
  const d = await okDoc('FT', p, [{ descricao: 'Fio dentário', preco: 2.5, iva: 23 }, { descricao: 'Escova', preco: 4.5, iva: 23 }]);
  assert.deepEqual(d.linhas.map(l => l.total), [3.08, 5.54]); // 0,575 → 0,58 e 1,035 → 1,04
  assert.equal(d.total_iva, 1.62);
});

test('r2: meio cêntimo afasta-se do zero, também em negativos (NC, saldos)', () => {
  assert.equal(r2(1.005), 1.01);
  assert.equal(r2(-1.005), -1.01);
  assert.equal(r2(0.575), 0.58);
  assert.equal(r2(-0.575), -0.58);
  assert.equal(r2(1.035), 1.04);
  assert.equal(r2(1234567.885), 1234567.89);
  assert.equal(r2(1.004), 1);
  assert.equal(r2(-1.004), -1);
  assert.equal(r2(-0.001), 0);
  assert.ok(Object.is(r2(-0.001), 0)); // sem -0 nos documentos
  assert.equal(r2('abc'), 0);
});

test('fatura 1,005 € isento arredonda para 1,01 €', async () => {
  const p = await paciente('Um e Meio Cêntimo');
  const d = await okDoc('FR', p, [L(1.005)]);
  assert.deepEqual([d.linhas[0].total, d.total], [1.01, 1.01]);
});

test('IVA a 0% leva o motivo de isenção M07; taxas positivas não levam motivo', async () => {
  const p = await paciente('Isenção');
  const d = await okDoc('FT', p, [L(40), { descricao: 'Pasta', preco: 10, iva: 23 }]);
  assert.deepEqual(d.linhas.map(l => [l.iva, l.isencao_cod, l.isencao_motivo]),
    [[0, 'M07', 'Isento artigo 9.º do CIVA'], [23, null, null]]);
  assert.equal(d.total, 52.3);
  assert.equal((await doc('FT', p, [L(0)])).status, 400); // total zero
  assert.equal((await doc('FT', p, [{ preco: 10 }])).status, 400); // linha sem descrição é ignorada → sem linhas
  assert.equal((await doc('XX', p, [L(10)])).status, 400);
});

// ---------- fatura simplificada ----------
test('fatura simplificada: 100,00 € exatos passa, 100,01 € não (também com IVA)', async () => {
  const p = await paciente('Simplificada');
  assert.equal((await okDoc('FS', p, [L(100)])).total, 100);
  assert.equal((await doc('FS', p, [L(100.01)])).status, 400);
  assert.equal((await okDoc('FS', p, [{ descricao: 'x', preco: 81.30, iva: 23 }])).total, 100); // 81,30 + 18,70
  assert.equal((await doc('FS', p, [{ descricao: 'x', preco: 81.31, iva: 23 }])).status, 400); // 81,31 + 18,70
  assert.equal(await saldo(p), 0); // paga no ato
  await okDoc('FS', p, [L(25)], { pago_ato: false });
  assert.equal(await saldo(p), 25);
});

// ---------- NC / ND ----------
test('nota de débito e nota de crédito referem documento de débito válido do mesmo paciente', async () => {
  const p = await paciente('Notas');
  const ft = await okDoc('FT', p, [L(100)]);
  assert.equal((await doc('ND', p, [L(20)])).status, 400); // sem origem
  const nd = await okDoc('ND', p, [L(20)], { ref_documento_id: ft.id });
  assert.equal(nd.ref_numero, ft.numero);
  assert.equal(await saldo(p), 120);
  const nc = await okDoc('NC', p, [L(30)], { ref_documento_id: ft.id });
  assert.equal(await saldo(p), 90);
  assert.equal((await doc('NC', p, [L(5)], { ref_documento_id: nc.id })).status, 400); // NC de NC
  const pf = await okDoc('PF', p, [L(50)]);
  assert.equal((await doc('NC', p, [L(5)], { ref_documento_id: pf.id })).status, 400); // pró-forma não é débito
  assert.equal(await saldo(p), 90); // a pró-forma não entra no saldo
  const rc = await ok('POST', 'recibos', { paciente_id: p, valor: 10, documento_ids: [ft.id] });
  assert.equal((await doc('NC', p, [L(5)], { ref_documento_id: rc.id })).status, 400);
  assert.equal((await doc('NC', p, [L(71)], { ref_documento_id: ft.id })).status, 400); // só restam 70
  await okDoc('NC', p, [L(20)], { ref_documento_id: nd.id }); // a ND também se credita
  const ab = await ok('GET', `pacientes/${p}/em-aberto`);
  assert.deepEqual(ab.map(d => [d.numero, d.em_divida]), [[ft.numero, 60]]);
  assert.equal(await saldo(p), 60);
  assert.equal((await api('POST', `documentos/${ft.id}/anular`, { motivo: 'x' })).status, 409); // tem ND/NC/recibo
});

// ---------- recibos ----------
test('recibo reparte pelos documentos do mais antigo para o mais recente', async () => {
  const p = await paciente('Repartição');
  const a = await okDoc('FT', p, [L(30)]), b = await okDoc('FT', p, [L(50)]);
  const rc = await ok('POST', 'recibos', { paciente_id: p, valor: 60, documento_ids: [b.id, a.id] });
  assert.deepEqual(rc.linhas.map(l => [l.descricao.split(' de ')[0], l.total]), [[`Liquidação ${a.numero}`, 30], [`Liquidação ${b.numero}`, 30]]);
  assert.equal(rc.ref_documento_id, null); // liquida mais de um
  assert.deepEqual((await ok('GET', `pacientes/${p}/em-aberto`)).map(d => [d.id, d.em_divida]), [[b.id, 20]]);
  assert.equal((await ok('GET', `documentos/${a.id}`)).em_divida, 0);
  assert.equal((await ok('GET', `documentos/${b.id}`)).pago, 30);
  const rc2 = await ok('POST', 'recibos', { paciente_id: p, valor: 25, documento_ids: [b.id] });
  assert.equal(rc2.ref_documento_id, b.id);
  assert.deepEqual(rc2.linhas.map(l => l.total), [20, 5]);
  assert.equal(rc2.linhas[1].descricao, 'Pagamento por conta');
  assert.equal(await saldo(p), -5);
  assert.equal((await api('POST', 'recibos', { paciente_id: p, valor: 0 })).status, 400);
  assert.equal((await api('POST', 'recibos', { paciente_id: p, valor: -5 })).status, 400);
});

test('recibo com documentos de outro paciente não os liquida', async () => {
  const p1 = await paciente('Dono'), p2 = await paciente('Intruso');
  const ft = await okDoc('FT', p1, [L(40)]);
  const rc = await ok('POST', 'recibos', { paciente_id: p2, valor: 40, documento_ids: [ft.id] });
  assert.deepEqual(rc.linhas.map(l => l.descricao), ['Pagamento por conta']);
  assert.equal(await saldo(p1), 40);
  assert.equal(await saldo(p2), -40);
});

test('saldo e conta corrente depois de anulações', async () => {
  const p = await paciente('Anulações');
  const t = (await ok('POST', 't/tratamentos', { paciente_id: p, descricao: 'Extração', preco: 70, estado: 'realizado', data: hoje() })).id;
  const fr = await okDoc('FR', p, [L(40)]);
  const ft = await okDoc('FT', p, [{ tratamento_id: t, descricao: 'Extração', preco: 70, iva: 0 }]);
  const rc = await ok('POST', 'recibos', { paciente_id: p, valor: 70, documento_ids: [ft.id] });
  assert.equal(await saldo(p), 0);
  await ok('POST', `documentos/${rc.id}/anular`, { motivo: 'cheque devolvido' });
  assert.equal(await saldo(p), 70);
  await ok('POST', `documentos/${ft.id}/anular`, { motivo: 'erro' });
  assert.equal(await saldo(p), 0);
  assert.equal((await ok('GET', `pacientes/${p}/tratamentos`)).find(x => x.id === t).documento_id, null); // pode voltar a faturar-se
  await ok('POST', `documentos/${fr.id}/anular`, { motivo: 'erro' });
  const cc = await ok('GET', `pacientes/${p}/contacorrente`);
  assert.deepEqual([cc.faturado, cc.creditos, cc.pago, cc.saldo], [0, 0, 0, 0]);
  assert.ok(cc.movimentos.every(m => m.anulado));
  assert.equal(cc.movimentos.length, 4); // FR débito + FR pagamento + FT + RC
  assert.equal((await api('POST', `documentos/${fr.id}/anular`, { motivo: 'x' })).status, 400); // já anulado
  await okDoc('FT', p, [{ tratamento_id: t, descricao: 'Extração', preco: 70, iva: 0 }]);
  assert.equal(await saldo(p), 70);
});

// ---------- orçamentos ----------
test('orçamento aceite: liga o tratamento planeado e cria os restantes, sem duplicar', async () => {
  const p = await paciente('Orçamento');
  const t = (await ok('POST', 't/tratamentos', { paciente_id: p, descricao: 'Restauração', dente: '16', preco: 100 })).id;
  const o = await ok('POST', 'orcamentos', { paciente_id: p, linhas: [
    { tratamento_id: t, descricao: 'Restauração', dente: '16', preco: 90 },
    { descricao: 'Coroa', qtd: 2, preco: 450, desconto_pct: 10 },
  ] });
  assert.equal(o.total, 900); // 90 + 2 × 405
  assert.match(o.numero, new RegExp(`^OR ${ANO}/\\d+$`));
  const ac = await ok('POST', `orcamentos/${o.id}/aceitar`);
  assert.equal(ac.estado, 'aceite');
  const trats = (await ok('GET', `pacientes/${p}/tratamentos`)).map(x => [x.descricao, x.preco, x.desconto_pct, x.estado, x.orcamento_id]).sort();
  assert.deepEqual(trats, [['Coroa', 450, 10, 'planeado', o.id], ['Coroa', 450, 10, 'planeado', o.id], ['Restauração', 90, 0, 'planeado', o.id]]);
  assert.equal((await api('POST', `orcamentos/${o.id}/aceitar`)).status, 400);
  assert.equal((await ok('GET', `pacientes/${p}/tratamentos`)).length, 3);
  assert.equal((await ok('GET', `pacientes/${p}/resumo`)).por_realizar, 900);
});

test('orçamento aceite depois de o tratamento ter sido faturado não o volta a criar', async () => {
    const p = await paciente('Orçamento Faturado');
    const t = (await ok('POST', 't/tratamentos', { paciente_id: p, descricao: 'Extração', preco: 50 })).id;
    const o = await ok('POST', 'orcamentos', { paciente_id: p, linhas: [{ tratamento_id: t, descricao: 'Extração', preco: 50 }] });
    await okDoc('FR', p, [{ tratamento_id: t, descricao: 'Extração', preco: 50, iva: 0 }]);
    await ok('POST', `orcamentos/${o.id}/aceitar`);
    assert.equal((await ok('GET', `pacientes/${p}/tratamentos`)).length, 1);
  });

test('orçamento recusado não cria tratamentos; total com IVA', async () => {
  const p = await paciente('Recusa');
  const o = await ok('POST', 'orcamentos', { paciente_id: p, data: '2026-01-10', linhas: [{ descricao: 'Branqueamento', preco: 300, iva: 23 }] });
  assert.equal(o.total, 369);
  assert.equal(o.validade, '2026-04-10'); // 90 dias
  assert.equal((await ok('POST', `orcamentos/${o.id}/recusar`)).estado, 'recusado');
  assert.deepEqual(await ok('GET', `pacientes/${p}/tratamentos`), []);
});

// ---------- entidades ----------
test('desconto da entidade aplicado no tratamento passa para a fatura e para a produção', async () => {
  const ent = (await ok('GET', 'lookups')).entidades.find(e => e.nome === 'Médis');
  assert.equal(ent.desconto_pct, 10);
  const p = await paciente('Segurado', { entidade_id: ent.id });
  const t = (await ok('POST', 't/tratamentos', { paciente_id: p, descricao: 'Destartarização', preco: 50, desconto_pct: ent.desconto_pct, estado: 'realizado', data: hoje() })).id;
  const d = await okDoc('FR', p, [{ tratamento_id: t, descricao: 'Destartarização', preco: 50, desconto_pct: 10, iva: 0 }], { entidade_id: ent.id });
  assert.equal(d.total, 45);
  assert.equal(d.entidade_nome, 'Médis');
  const prod = (await ok('GET', `listagens/producao?de=${hoje()}&ate=${hoje()}`)).rows.find(r => r.paciente_nome === 'Segurado');
  assert.deepEqual([prod.valor, prod.documento], [45, d.numero]);
});

// ---------- comissões ----------
test('comissões por médico: % sobre o faturado, notas de crédito descontam', async () => {
  const mc = (await ok('POST', 't/medicos', { nome: 'Dr. Comissão', comissao_pct: 40 })).id;
  const md = (await ok('POST', 't/medicos', { nome: 'Dra. Documento', comissao_pct: 25 })).id;
  const p = await paciente('Comissionado');
  const t = (await ok('POST', 't/tratamentos', { paciente_id: p, medico_id: mc, descricao: 'Implante', preco: 200, estado: 'realizado', data: hoje() })).id;
  const fr = await okDoc('FR', p, [{ tratamento_id: t, descricao: 'Implante', preco: 200, iva: 0 }]);
  await okDoc('NC', p, [{ tratamento_id: t, descricao: 'Desconto', preco: 50, iva: 0 }], { ref_documento_id: fr.id });
  await okDoc('FR', p, [L(80)], { medico_id: md }); // sem tratamento: conta o médico do documento
  const q = `de=${hoje()}&ate=${hoje()}`;
  const todas = (await ok('GET', `listagens/comissoes?${q}`)).rows;
  assert.deepEqual(todas.filter(r => r.medico_nome === 'Dr. Comissão').map(r => [r.valor, r.pct, r.comissao]), [[200, 40, 80], [-50, 40, -20]]);
  assert.deepEqual(todas.filter(r => r.medico_nome === 'Dra. Documento').map(r => [r.valor, r.comissao]), [[80, 20]]);
  const est = await ok('GET', `estatisticas?${q}`);
  assert.deepEqual(est.fatMedico.filter(f => ['Dr. Comissão', 'Dra. Documento'].includes(f.nome)).map(f => [f.nome, f.total, f.comissao]),
    [['Dr. Comissão', 150, 60], ['Dra. Documento', 80, 20]]);
});

test('listagem de comissões filtrada por médico', async () => {
  const mc = (await ok('GET', 'lookups')).medicos.find(m => m.nome === 'Dr. Comissão').id;
  const rows = (await ok('GET', `listagens/comissoes?de=${hoje()}&ate=${hoje()}&medico_id=${mc}`)).rows;
  assert.deepEqual(rows.map(r => [r.valor, r.comissao]), [[200, 80], [-50, -20]]);
});

test('filtros por id de todas as listagens comparam como número', async () => {
  const mx = (await ok('POST', 't/medicos', { nome: 'Dr. Filtro', comissao_pct: 10 })).id;
  const ent = (await ok('GET', 'lookups')).entidades.find(e => e.nome === 'Médis').id;
  const p = await paciente('Filtrado', { entidade_id: ent });
  const dia = '2031-03-18';
  await ok('POST', 'marcacoes', { paciente_id: p, medico_id: mx, inicio: dia + 'T10:00', fim: dia + 'T10:30' });
  const t = (await ok('POST', 't/tratamentos', { paciente_id: p, medico_id: mx, descricao: 'Filtro', preco: 30, estado: 'realizado', data: dia })).id;
  await okDoc('FR', p, [{ tratamento_id: t, descricao: 'Filtro', preco: 30, iva: 0 }], { medico_id: mx, data: hoje() });
  await ok('POST', 'orcamentos', { paciente_id: p, medico_id: mx, data: hoje(), linhas: [L(10)] });
  const casos = [
    ['agenda', dia, 'medico_id', mx], ['agenda', dia, 'entidade_id', ent], ['agenda', dia, 'user_id', 1], ['agenda', dia, 'paciente_id', p],
    ['caixa', hoje(), 'medico_id', mx], ['caixa', hoje(), 'user_id', 1], ['comissoes', hoje(), 'medico_id', mx], ['producao', dia, 'medico_id', mx],
    ['orcamentos', hoje(), 'medico_id', mx], ['movimentos', hoje(), 'medico_id', mx], ['movimentos', hoje(), 'user_id', 1], ['movimentos', hoje(), 'paciente_id', p],
  ];
  for (const [tipo, d, k, v] of casos) {
    const nossas = async id => (await ok('GET', `listagens/${tipo}?de=${d}&ate=${d}&${k}=${id}`)).rows.filter(r => r.paciente_nome === 'Filtrado').length;
    assert.ok(await nossas(v) > 0, `${tipo} ${k}=${v}`);
    assert.equal(await nossas(999999), 0, `${tipo} ${k}=999999`);
  }
});

// ---------- mapa de caixa ----------
test('mapa de caixa: totais por meio de pagamento, sem anulados', async () => {
  const p = await paciente('Caixa');
  const fr = (preco, metodo) => api('POST', 'documentos', { tipo: 'FR', paciente_id: p, metodo, linhas: [L(preco)] }, ckRec);
  assert.equal((await fr(30, 'MB')).status, 200);
  assert.equal((await fr(20, 'Numerário')).status, 200);
  const ft = (await api('POST', 'documentos', { tipo: 'FT', paciente_id: p, linhas: [L(100)] }, ckRec)).body;
  await api('POST', 'recibos', { paciente_id: p, valor: 60, documento_ids: [ft.id] }, ckRec);
  await api('POST', 'recibos', { paciente_id: p, valor: 40, documento_ids: [ft.id], metodo: 'Cartão' }, ckRec);
  const anul = (await api('POST', 'recibos', { paciente_id: p, valor: 10, metodo: 'MB' }, ckRec)).body;
  await ok('POST', `documentos/${anul.id}/anular`, { motivo: 'engano' });
  const cx = await ok('GET', `listagens/caixa?de=${hoje()}&ate=${hoje()}&user_id=${recId}`);
  assert.equal(cx.grupo, 'metodo');
  const tot = {}; for (const r of cx.rows) tot[r.metodo] = Math.round(((tot[r.metodo] || 0) + r.valor) * 100) / 100;
  assert.deepEqual(tot, { 'Cartão': 40, MB: 30, 'Numerário': 80 });
  assert.deepEqual(cx.rows.map(r => r.metodo), ['Cartão', 'MB', 'Numerário', 'Numerário']);
  assert.ok(cx.rows.every(r => r.user_nome === 'Caixa'));
  assert.equal(await saldo(p), 0);
});

// ---------- NIF ----------
test('NIF: dígito de controlo (incl. 5xx e 9xx)', async () => {
  for (const nif of ['123456789', '501442600', '500000000', '980000009', '999999990', '123 456 789']) {
    assert.doesNotThrow(() => D.validarNif(nif), nif);
    assert.equal((await api('POST', 't/pacientes', { nome: 'NIF ' + nif, nif })).status, 200, nif);
  }
  for (const nif of ['123456780', '501442601', '980000000', '12345678', '1234567890', 'abcdefghi', '12345678X']) {
    assert.throws(() => D.validarNif(nif), e => e.status === 400, nif);
    assert.equal((await api('POST', 't/pacientes', { nome: 'NIF ' + nif, nif })).status, 400, nif);
  }
  const p = await paciente('NIF Editar');
  assert.equal((await api('PUT', `t/pacientes/${p}`, { nif: '123456780' })).status, 400);
  assert.equal((await api('PUT', `t/pacientes/${p}`, { nif: '' })).status, 200); // vazio é permitido
});

test('NIF com primeiro dígito inexistente (0 ou 4) é recusado', () => {
  assert.throws(() => D.validarNif('000000000'));
  assert.throws(() => D.validarNif('400000008'));
  // dígito de controlo certo, prefixo não atribuído pela AT
  for (const nif of ['440000009', '730000001', '760000000', '920000002', '970000006']) assert.throws(() => D.validarNif(nif), /não atribuídos/, nif);
  for (const nif of ['300000006', '450000001', '600000001', '700000003', '740000004', '780000005', '800000005', '900000007', '910000000'])
    assert.doesNotThrow(() => D.validarNif(nif), nif);
});

// ---------- stocks ----------
test('stocks: entradas, saídas, transferência entre armazéns, lotes e alerta de stock mínimo', async () => {
  const pr = (await ok('POST', 't/produtos', { nome: 'Luvas teste', stock_min: 8, stock_ideal: 15 })).id;
  const mov = (o) => api('POST', 't/movimentos_stock', { produto_id: pr, armazem_id: 1, ...o });
  const ex = async (arm) => (await ok('GET', 'stocks/existencias' + (arm ? `?armazem_id=${arm}` : ''))).find(x => x.id === pr);
  assert.equal((await mov({ tipo: 'entrada', qtd: 0 })).status, 400);
  assert.equal((await mov({ tipo: 'entrada', qtd: -3 })).status, 400);
  assert.equal((await api('POST', 't/movimentos_stock', { tipo: 'entrada', qtd: 3 })).status, 400);
  assert.equal((await mov({ tipo: 'entrada', qtd: 10, lote: 'L1', validade: '2031-01-01' })).status, 200);
  assert.equal((await mov({ tipo: 'saida', qtd: 3, lote: 'L1', validade: '2031-01-01' })).status, 200);
  assert.deepEqual([(await ex()).qtd, (await ex()).alertas], [7, ['minimo']]);
  await ok('POST', 'stocks/transferir', { produto_id: pr, qtd: 2, de: 1, para: 2, lote: 'L1', validade: '2031-01-01' });
  assert.equal((await api('POST', 'stocks/transferir', { produto_id: pr, qtd: 2, de: 1, para: 1 })).status, 400);
  assert.equal((await api('POST', 'stocks/transferir', { produto_id: pr, qtd: 0, de: 1, para: 2 })).status, 400);
  assert.deepEqual([(await ex()).qtd, (await ex(1)).qtd, (await ex(2)).qtd], [7, 5, 2]);
  assert.deepEqual((await ok('GET', `stocks/lotes?produto_id=${pr}`)).map(l => [l.lote, l.armazem_id, l.qtd]), [['L1', 1, 5], ['L1', 2, 2]]);
  await mov({ tipo: 'entrada', qtd: 1 });
  assert.deepEqual((await ex()).alertas, ['ideal']); // 8 = mínimo: já não está abaixo
  await mov({ tipo: 'entrada', qtd: 7 });
  assert.deepEqual((await ex()).alertas, []); // 15 = ideal
  await mov({ tipo: 'saida', qtd: 20 });
  assert.deepEqual([(await ex()).qtd, (await ex()).alertas], [-5, ['negativo']]);
});

test('stocks: alerta de validade só para lotes com existências', async () => {
  const pr = (await ok('POST', 't/produtos', { nome: 'Anestésico teste', stock_min: 0, stock_ideal: 0 })).id;
  const em30 = iso(new Date(Date.now() + 30 * 864e5)), em20 = iso(new Date(Date.now() + 20 * 864e5));
  const mov = o => ok('POST', 't/movimentos_stock', { produto_id: pr, armazem_id: 1, ...o });
  await mov({ tipo: 'entrada', qtd: 5, lote: 'LONGE', validade: '2031-06-30' });
  await mov({ tipo: 'entrada', qtd: 2, lote: 'GASTO', validade: em20 });
  await mov({ tipo: 'saida', qtd: 2, lote: 'GASTO', validade: em20 });
  let p = (await ok('GET', 'stocks/existencias')).find(x => x.id === pr);
  assert.deepEqual([p.qtd, p.prox_validade, p.alertas], [5, '2031-06-30', []]);
  await mov({ tipo: 'entrada', qtd: 1, lote: 'PERTO', validade: em30 });
  p = (await ok('GET', 'stocks/existencias')).find(x => x.id === pr);
  assert.deepEqual([p.qtd, p.prox_validade, p.alertas], [6, em30, ['validade']]);
});
