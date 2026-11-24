'use strict';
// Testes da agenda: marcações, conflitos, bloqueios, feriados, remarcações, lista de espera, pesquisa de vagas e lembretes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-teste-'));
process.env.DATA_DIR = dir;
process.env.ADMIN_PASSWORD = 'segredo-de-teste';
const { server, pascoa, lembretesAutomaticos } = require('../server');
const COM = require('../comunicacao');

let base, cookie = '';
async function api(metodo, url, corpo) {
  const r = await fetch(base + '/api/' + url, { method: metodo, headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: corpo ? JSON.stringify(corpo) : undefined });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, body: await r.json() };
}
const ok = async (...a) => { const r = await api(...a); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const medico = async nome => (await ok('POST', 't/medicos', { nome })).id;
const paciente = async (nome, extra = {}) => (await ok('POST', 't/pacientes', { nome, ...extra })).id;
const marcar = (corpo) => api('POST', 'marcacoes', corpo);
const vagas = async qs => (await ok('GET', 'pesquisa-vagas?' + qs)).map(v => v.inicio);

let est, gab, pac, mA, mB;
before(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  await ok('POST', 'login', { login: 'admin', password: 'segredo-de-teste' });
  const lk = await ok('GET', 'lookups');
  est = Object.fromEntries(lk.estados.map(e => [e.nome, e.id]));
  gab = lk.gabinetes.map(g => g.id);
  mA = await medico('Dra. Agenda A'); mB = await medico('Dr. Agenda B');
  pac = await paciente('Paciente Agenda', { telemovel: '912345678' });
});
after(() => { server.close(); fs.rmSync(dir, { recursive: true, force: true }); });

// ---------- criação e validação ----------
test('marcação exige paciente, médico e fim depois do início', async () => {
  assert.equal((await marcar({ medico_id: mA, inicio: '2031-03-10T10:00', fim: '2031-03-10T10:30' })).status, 400);
  assert.equal((await marcar({ paciente_id: pac, inicio: '2031-03-10T10:00', fim: '2031-03-10T10:30' })).status, 400);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-10T10:00', fim: '2031-03-10T10:00' })).status, 400);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-10T10:30', fim: '2031-03-10T10:00' })).status, 400);
});

test('marcação nova fica no primeiro estado ("Marcada") e aparece na agenda do dia', async () => {
  const m = (await marcar({ paciente_id: pac, medico_id: mA, gabinete_id: gab[0], inicio: '2031-03-10T10:00', fim: '2031-03-10T10:30' })).body;
  assert.equal(m.estado_nome, 'Marcada');
  assert.equal(m.paciente_nome, 'Paciente Agenda');
  const dia = await ok('GET', 'agenda?de=2031-03-10');
  assert.deepEqual(dia.map(x => x.id), [m.id]);
  assert.deepEqual((await ok('GET', `agenda?de=2031-03-10&medico_id=${mB}`)), []);
});

// ---------- conflitos ----------
test('conflito com o mesmo médico (sobreposição parcial) dá 409', async () => {
  const r = await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-10T10:15', fim: '2031-03-10T10:45' });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /médico já tem uma marcação/);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-10T09:00', fim: '2031-03-10T11:00' })).status, 409); // envolve
});

test('fim de uma = início da outra não é conflito (médico e gabinete)', async () => {
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, gabinete_id: gab[0], inicio: '2031-03-10T10:30', fim: '2031-03-10T11:00' })).status, 200);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, gabinete_id: gab[0], inicio: '2031-03-10T09:30', fim: '2031-03-10T10:00' })).status, 200);
});

test('conflito de gabinete com outro médico dá 409; noutro gabinete passa', async () => {
  const r = await marcar({ paciente_id: pac, medico_id: mB, gabinete_id: gab[0], inicio: '2031-03-10T10:10', fim: '2031-03-10T10:20' });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /gabinete já está ocupado/);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mB, gabinete_id: gab[1], inicio: '2031-03-10T10:10', fim: '2031-03-10T10:20' })).status, 200);
});

test('marcação desmarcada ou falta liberta o horário; forcar ignora o conflito', async () => {
  const m = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-17T10:00', fim: '2031-03-17T10:30' });
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-17T10:00', fim: '2031-03-17T10:30' })).status, 409);
  await ok('PUT', `marcacoes/${m.id}`, { estado_id: est.Desmarcada, forcar: true });
  const n = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-17T10:00', fim: '2031-03-17T10:30' });
  await ok('PUT', `marcacoes/${n.id}`, { estado_id: est.Faltou, forcar: true });
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-17T10:00', fim: '2031-03-17T10:30' });
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-17T10:00', fim: '2031-03-17T10:30', forcar: true })).status, 200);
});

test('anular uma de duas marcações sobrepostas (forçadas) não dá conflito; mudar só notas também não', async () => {
  const a = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, gabinete_id: gab[0], inicio: '2031-03-18T10:00', fim: '2031-03-18T10:30' });
  const b = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, gabinete_id: gab[0], inicio: '2031-03-18T10:00', fim: '2031-03-18T10:30', forcar: true });
  assert.equal((await api('PUT', `marcacoes/${a.id}`, { notas: 'chega atrasado' })).status, 200);
  assert.equal((await api('PUT', `marcacoes/${b.id}`, { estado_id: est.Desmarcada })).status, 200);
  assert.equal((await api('PUT', `marcacoes/${a.id}`, { estado_id: est.Faltou })).status, 200);
  // mudar o horário continua a verificar conflitos
  const c = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-18T11:00', fim: '2031-03-18T11:30' });
  const d = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-18T12:00', fim: '2031-03-18T12:30' });
  assert.equal((await api('PUT', `marcacoes/${d.id}`, { inicio: '2031-03-18T11:15', fim: '2031-03-18T11:45' })).status, 409);
  assert.equal((await api('PUT', `marcacoes/${c.id}`, { estado_id: est.Confirmada })).status, 200);
});

test('com anos de agenda: conflito que atravessa a meia-noite (e a passagem de ano) continua a ser detetado', async () => {
  const mY = await medico('Dr. Anos');
  for (const ano of [2027, 2028, 2029, 2030]) await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mY, gabinete_id: gab[1], inicio: `${ano}-12-31T23:30`, fim: `${ano + 1}-01-01T00:30`, forcar: true });
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mY, gabinete_id: gab[1], inicio: '2031-12-31T23:30', fim: '2032-01-01T00:30', forcar: true });
  const r = await marcar({ paciente_id: pac, medico_id: mY, inicio: '2032-01-01T00:00', fim: '2032-01-01T00:15' });
  assert.equal(r.status, 409); assert.match(r.body.erro, /médico já tem/);
  const g = await marcar({ paciente_id: pac, medico_id: mB, gabinete_id: gab[1], inicio: '2032-01-01T00:15', fim: '2032-01-01T00:45' });
  assert.equal(g.status, 409); assert.match(g.body.erro, /gabinete/);
  // a meia-hora seguinte está livre (o feriado de 1 de janeiro só é verificado se não houver conflito)
  assert.match((await marcar({ paciente_id: pac, medico_id: mY, inicio: '2032-01-01T00:30', fim: '2032-01-01T01:00' })).body.erro || '', /feriado/);
  // pesquisa de vagas e ocupação só contam o próprio dia
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mY, inicio: '2031-03-03T08:30', fim: '2031-03-03T09:30' });
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mY, inicio: '2030-03-03T08:30', fim: '2030-03-03T12:30', forcar: true });
  assert.deepEqual(await vagas(`medico_id=${mY}&de=2031-03-03&limite=2`), ['2031-03-03T09:30', '2031-03-03T10:30']);
  const oc = await ok('GET', `listagens/ocupacao?de=2031-03-03&ate=2031-03-03&medico_id=${mY}`);
  assert.deepEqual(oc.rows.map(x => [x.marcacoes, x.horas_ocup]), [[1, 1]]);
});

// ---------- mover / remarcações ----------
test('mover conta remarcações só quando muda o início e não conflita consigo própria', async () => {
  const m = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-13T09:00', fim: '2031-03-13T09:30' });
  assert.equal(m.remarcacoes, 0);
  assert.equal((await ok('PUT', `marcacoes/${m.id}`, { notas: 'só notas' })).remarcacoes, 0);
  assert.equal((await ok('PUT', `marcacoes/${m.id}`, { inicio: '2031-03-13T10:00', fim: '2031-03-13T10:30' })).remarcacoes, 1);
  assert.equal((await ok('PUT', `marcacoes/${m.id}`, { fim: '2031-03-13T10:45' })).remarcacoes, 1);
  const outra = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mA, inicio: '2031-03-13T12:00', fim: '2031-03-13T12:30' });
  assert.equal((await api('PUT', `marcacoes/${m.id}`, { inicio: '2031-03-13T12:15', fim: '2031-03-13T12:45' })).status, 409);
  const mv = await ok('PUT', `marcacoes/${m.id}`, { inicio: '2031-03-13T11:00', fim: '2031-03-13T11:30' });
  assert.equal(mv.remarcacoes, 2);
  const lst = await ok('GET', 'listagens/remarcacoes?de=2031-03-13&ate=2031-03-13');
  assert.deepEqual(lst.rows.map(r => [r.id, r.remarcacoes]), [[m.id, 2]]);
  assert.ok(!lst.rows.some(r => r.id === outra.id));
  assert.equal((await api('PUT', 'marcacoes/999999', { notas: 'x' })).status, 404);
});

// ---------- bloqueios ----------
test('bloqueio de um médico impede marcações dele, não de outros; limites não colidem', async () => {
  await ok('POST', 't/bloqueios', { medico_id: mA, inicio: '2031-03-11T14:00', fim: '2031-03-11T16:00', tipo: 'ferias', motivo: 'Algarve' });
  const r = await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-11T15:00', fim: '2031-03-11T15:30' });
  assert.equal(r.status, 409);
  assert.match(r.body.erro, /Férias: Algarve/);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mB, inicio: '2031-03-11T15:00', fim: '2031-03-11T15:30' })).status, 200);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-11T16:00', fim: '2031-03-11T16:30' })).status, 200);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-03-11T13:30', fim: '2031-03-11T14:00' })).status, 200);
  const bl = await ok('GET', 'bloqueios?de=2031-03-11');
  assert.deepEqual(bl.map(b => [b.medico_id, b.tipo_nome]), [[mA, 'Férias']]);
});

test('bloqueio da clínica (sem médico) impede todos os médicos', async () => {
  await ok('POST', 't/bloqueios', { inicio: '2031-03-12T00:00', fim: '2031-03-12T23:59', tipo: 'fecho' });
  for (const md of [mA, mB]) {
    const r = await marcar({ paciente_id: pac, medico_id: md, inicio: '2031-03-12T09:00', fim: '2031-03-12T09:30' });
    assert.equal(r.status, 409); assert.match(r.body.erro, /Clínica fechada/);
  }
  const aus = await ok('GET', 'listagens/ausencias?de=2031-03-12&ate=2031-03-12');
  assert.deepEqual(aus.rows.map(r => r.medico_nome), ['Todos (clínica)']);
});

// ---------- feriados ----------
const fer = async ano => Object.fromEntries((await ok('GET', `feriados?ano=${ano}`)).map(f => [f.nome, f.data]));

test('Páscoa (algoritmo) para 2025, 2026, 2027', () => {
  assert.equal(pascoa(2025).toISOString().slice(0, 10), '2025-04-20');
  assert.equal(pascoa(2026).toISOString().slice(0, 10), '2026-04-05');
  assert.equal(pascoa(2027).toISOString().slice(0, 10), '2027-03-28');
  assert.equal(pascoa(2031).toISOString().slice(0, 10), '2031-04-13');
});

test('feriados móveis: Sexta-feira Santa, Páscoa, Corpo de Deus (Carnaval desligado por omissão)', async () => {
  const esperado = {
    2025: ['2025-04-18', '2025-04-20', '2025-06-19'],
    2026: ['2026-04-03', '2026-04-05', '2026-06-04'],
    2027: ['2027-03-26', '2027-03-28', '2027-05-27'],
  };
  for (const [ano, [sexta, pas, corpo]] of Object.entries(esperado)) {
    const f = await fer(ano);
    assert.equal(f['Sexta-feira Santa'], sexta, ano);
    assert.equal(f['Páscoa'], pas, ano);
    assert.equal(f['Corpo de Deus'], corpo, ano);
    assert.equal(f.Carnaval, undefined, ano);
    assert.equal(f.Natal, `${ano}-12-25`);
  }
});

test('Carnaval ligado na configuração: 47 dias antes da Páscoa', async () => {
  await ok('PUT', 'config', { feriado_carnaval: '1' });
  assert.equal((await fer(2025)).Carnaval, '2025-03-04');
  assert.equal((await fer(2026)).Carnaval, '2026-02-17');
  assert.equal((await fer(2027)).Carnaval, '2027-02-09');
  await ok('PUT', 'config', { feriado_carnaval: '0' });
});

test('feriado não fixo só conta no seu ano; feriado desligado deixa de contar', async () => {
  const f = await ok('POST', 't/feriados', { nome: 'Feriado municipal 2027', data: '2027-06-29', fixo: 0 });
  assert.equal((await fer(2027))['Feriado municipal 2027'], '2027-06-29');
  assert.equal((await fer(2026))['Feriado municipal 2027'], undefined);
  await ok('PUT', `t/feriados/${f.id}`, { ativo: 0 });
  assert.equal((await fer(2027))['Feriado municipal 2027'], undefined);
});

test('marcação num feriado dá 409 (com forcar passa)', async () => {
  const r = await marcar({ paciente_id: pac, medico_id: mA, inicio: '2027-03-26T10:00', fim: '2027-03-26T10:30' });
  assert.equal(r.status, 409); assert.match(r.body.erro, /feriado \(Sexta-feira Santa\)/);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2031-12-25T10:00', fim: '2031-12-25T10:30' })).status, 409);
  assert.equal((await marcar({ paciente_id: pac, medico_id: mA, inicio: '2027-03-26T10:00', fim: '2027-03-26T10:30', forcar: true })).status, 200);
});

// ---------- lista de espera ----------
test('lista de espera: entra a aguardar, sai quando muda de estado', async () => {
  const e = await ok('POST', 't/lista_espera', { paciente_id: pac, medico_id: mA, preferencia: 'Manhãs' });
  assert.equal(e.estado, 'aguarda');
  const lista = await ok('GET', 'espera');
  assert.deepEqual(lista.map(x => [x.id, x.paciente_nome, x.medico_nome]), [[e.id, 'Paciente Agenda', 'Dra. Agenda A']]);
  assert.equal((await ok('GET', 'listagens/espera')).rows.length, 1);
  await ok('PUT', `t/lista_espera/${e.id}`, { estado: 'marcado' });
  assert.deepEqual(await ok('GET', 'espera'), []);
  assert.deepEqual((await ok('GET', 'espera?estado=marcado')).map(x => x.id), [e.id]);
});

// ---------- pesquisa de vagas ----------
// configuração por omissão: 08:30–20:00, intervalo 15 min, segunda a sábado; até 4 vagas por dia, espaçadas de 1 h
test('pesquisa de vagas: dia livre, manhã/tarde e horas mínimas', async () => {
  const mP = await medico('Dr. Vagas Livre');
  assert.equal((await api('GET', 'pesquisa-vagas?de=2031-03-03')).status, 400); // sem médico
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-03&limite=5`),
    ['2031-03-03T08:30', '2031-03-03T09:30', '2031-03-03T10:30', '2031-03-03T11:30', '2031-03-04T08:30']);
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-03&limite=4&manha=0`),
    ['2031-03-03T13:00', '2031-03-03T14:00', '2031-03-03T15:00', '2031-03-03T16:00']);
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-03&limite=3&hora_min=18:00`),
    ['2031-03-03T18:00', '2031-03-03T19:00', '2031-03-04T18:00']);
  // 60 min com manhã só: a última vaga tem de acabar até às 13:00
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-03&limite=2&tarde=0&hora_min=11:00&duracao=60`),
    ['2031-03-03T11:00', '2031-03-03T12:00']);
  const um = (await ok('GET', `pesquisa-vagas?medico_id=${mP}&de=2031-03-03&limite=1`))[0];
  assert.deepEqual(um, { inicio: '2031-03-03T08:30', fim: '2031-03-03T09:00', medicos: [mP] });
});

test('pesquisa de vagas: dias da semana, domingo fechado, feriados e bloqueio da clínica', async () => {
  const mP = await medico('Dr. Vagas Dias');
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-03&limite=1&dias=2`), ['2031-03-04T08:30']); // terça
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-09&limite=1`), ['2031-03-10T08:30']); // domingo 9 não abre
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-04-11&limite=1&dias=5`), ['2031-04-18T08:30']); // Sexta-feira Santa
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-04-11&limite=1&dias=5&feriados=1`), ['2031-04-11T08:30']);
  assert.deepEqual(await vagas(`medico_id=${mP}&de=2031-03-12&limite=1&dias=3`), ['2031-03-19T08:30']); // 12/03 clínica fechada
});

test('pesquisa de vagas com 1 e com 2 médicos em simultâneo', async () => {
  const mC = await medico('Dr. Vagas C'), mD = await medico('Dr. Vagas D');
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mC, inicio: '2031-03-03T08:30', fim: '2031-03-03T09:30' });
  await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mD, inicio: '2031-03-03T09:30', fim: '2031-03-03T10:00' });
  assert.deepEqual(await vagas(`medico_id=${mC}&de=2031-03-03&limite=4`),
    ['2031-03-03T09:30', '2031-03-03T10:30', '2031-03-03T11:30', '2031-03-03T12:30']);
  assert.deepEqual(await vagas(`medico_id=${mC}&medico2_id=${mD}&de=2031-03-03&limite=4`),
    ['2031-03-03T10:00', '2031-03-03T11:00', '2031-03-03T12:00', '2031-03-03T13:00']);
  const [v] = await ok('GET', `pesquisa-vagas?medico_id=${mC}&medico2_id=${mD}&de=2031-03-03&limite=1`);
  assert.deepEqual(v.medicos, [mC, mD]);
});

// ---------- confirmações e lembretes ----------
const loc = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const daqui = h => { const d = new Date(Date.now() + h * 3600e3); d.setSeconds(0, 0); return d; };

test('confirmação automática ao criar marcação (e não com sem_aviso)', async () => {
  const enviados = []; const orig = COM.enviarSMS; COM.enviarSMS = async (cfg, m) => { enviados.push(m); };
  try {
    await ok('PUT', 'config', { confirmacao_auto: '1', sms_fornecedor: 'http' });
    const mC = await medico('Dra. Confirma');
    await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mC, inicio: '2031-03-03T15:00', fim: '2031-03-03T15:30' });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(enviados.length, 1);
    assert.equal(enviados[0].para, '912345678');
    assert.match(enviados[0].texto, /segunda-feira, 03\/03\/2031 às 15:00, com Dra\. Confirma/);
    await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mC, inicio: '2031-03-03T16:00', fim: '2031-03-03T16:30', sem_aviso: true });
    await new Promise(r => setTimeout(r, 100));
    assert.equal(enviados.length, 1);
  } finally { COM.enviarSMS = orig; await ok('PUT', 'config', { confirmacao_auto: '0' }); }
});

test('lembretes: só marcações dentro das próximas X horas, uma vez, sem faltas', async () => {
  const enviados = []; const orig = COM.enviarSMS; COM.enviarSMS = async (cfg, m) => { enviados.push(m); };
  try {
    await ok('PUT', 'config', { lembrete_auto: '1', lembrete_horas: '24', sms_fornecedor: 'http' });
    const mL = await medico('Dr. Lembrete');
    const semSms = await paciente('Sem SMS', { telemovel: '934444444', sms_ok: 0 });
    const nova = async (p, h, extra = {}) => (await ok('POST', 'marcacoes', { paciente_id: p, medico_id: mL, inicio: loc(daqui(h)), fim: loc(daqui(h + 0.5)), forcar: true, ...extra })).id;
    const a = await nova(pac, 2), b = await nova(pac, 30), c = await nova(pac, 3, { estado_id: est.Faltou }), d = await nova(semSms, 4), e = await nova(pac, -2);
    await lembretesAutomaticos();
    const lem = async id => (await ok('GET', `marcacoes/${id}`)).lembrete_em;
    assert.ok(await lem(a)); assert.ok(await lem(d));
    assert.equal(await lem(b), null); assert.equal(await lem(c), null); assert.equal(await lem(e), null);
    assert.deepEqual(enviados.map(m => m.para), ['912345678']); // sem consentimento não envia
    const hist = await ok('GET', 'sms/historico');
    assert.ok(hist.some(h => h.paciente_id === semSms && h.estado === 'sem consentimento'));
    await lembretesAutomaticos();
    assert.equal(enviados.length, 1); // não repete
    await ok('PUT', 'config', { lembrete_horas: '48' });
    await lembretesAutomaticos();
    assert.ok(await lem(b));
    assert.equal(enviados.length, 2);
  } finally { COM.enviarSMS = orig; await ok('PUT', 'config', { lembrete_auto: '0', lembrete_horas: '24' }); }
});

test('lembretes desligados ou sem fornecedor não marcam nada', async () => {
  const mL = await medico('Dr. Sem Lembrete');
  const { id } = await ok('POST', 'marcacoes', { paciente_id: pac, medico_id: mL, inicio: loc(daqui(1)), fim: loc(daqui(1.5)), forcar: true });
  await lembretesAutomaticos(); // lembrete_auto = 0
  await ok('PUT', 'config', { lembrete_auto: '1', sms_fornecedor: '' });
  await lembretesAutomaticos(); // sem fornecedor
  assert.equal((await ok('GET', `marcacoes/${id}`)).lembrete_em, null);
  await ok('PUT', 'config', { lembrete_auto: '0' });
});
