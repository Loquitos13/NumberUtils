'use strict';
// Base de dados SQLite (módulo node:sqlite embutido no Node.js >= 22.13)
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');

process.removeAllListeners('warning'); // silencia o aviso "experimental" do sqlite
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_FILE = path.join(DATA_DIR, 'clinica.db');

const db = new DatabaseSync(DB_FILE);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS config (chave TEXT PRIMARY KEY, valor TEXT);

CREATE TABLE IF NOT EXISTS especialidades (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS medicos (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, abreviatura TEXT, especialidade_id INTEGER REFERENCES especialidades(id),
  cedula TEXT, nif TEXT, email TEXT, telefone TEXT, cor TEXT DEFAULT '#2563eb', comissao_pct REAL DEFAULT 0,
  ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS gabinetes (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, login TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL,
  perfil TEXT NOT NULL DEFAULT 'rececao', medico_id INTEGER REFERENCES medicos(id), ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id INTEGER, criado_em TEXT);

CREATE TABLE IF NOT EXISTS estados (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, cor TEXT, categoria TEXT, ordem INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS razoes_visita (id INTEGER PRIMARY KEY, abreviatura TEXT, descricao TEXT, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS feriados (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, data TEXT NOT NULL, fixo INTEGER DEFAULT 1, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS entidades (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, nif TEXT, desconto_pct REAL DEFAULT 0, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS servicos (
  id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT NOT NULL, especialidade_id INTEGER REFERENCES especialidades(id),
  preco REAL DEFAULT 0, iva REAL DEFAULT 0, duracao_min INTEGER DEFAULT 30, por_dente INTEGER DEFAULT 0, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS pacientes (
  id INTEGER PRIMARY KEY, numero INTEGER, nome TEXT NOT NULL, data_nasc TEXT, genero TEXT, nif TEXT, sns TEXT, cc TEXT,
  telefone TEXT, telemovel TEXT, email TEXT, morada TEXT, cod_postal TEXT, localidade TEXT, profissao TEXT,
  razao_visita_id INTEGER REFERENCES razoes_visita(id), medico_id INTEGER REFERENCES medicos(id),
  entidade_id INTEGER REFERENCES entidades(id), num_beneficiario TEXT, notas TEXT,
  rgpd_consent INTEGER DEFAULT 0, rgpd_data TEXT, sms_ok INTEGER DEFAULT 1, email_ok INTEGER DEFAULT 1,
  ativo INTEGER DEFAULT 1, criado_em TEXT DEFAULT (datetime('now','localtime')));

CREATE TABLE IF NOT EXISTS anamnese (
  paciente_id INTEGER PRIMARY KEY REFERENCES pacientes(id) ON DELETE CASCADE,
  alergias TEXT, doencas TEXT, medicacao TEXT, fumador TEXT, gravidez INTEGER DEFAULT 0, hipertensao INTEGER DEFAULT 0,
  diabetes INTEGER DEFAULT 0, cardiaco INTEGER DEFAULT 0, anticoagulantes INTEGER DEFAULT 0, hepatite INTEGER DEFAULT 0,
  observacoes TEXT, atualizado_em TEXT);

CREATE TABLE IF NOT EXISTS marcacoes (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE,
  medico_id INTEGER REFERENCES medicos(id), gabinete_id INTEGER REFERENCES gabinetes(id),
  servico_id INTEGER REFERENCES servicos(id), inicio TEXT NOT NULL, fim TEXT NOT NULL,
  estado_id INTEGER REFERENCES estados(id), notas TEXT, primeira INTEGER DEFAULT 0,
  criado_por INTEGER, criado_em TEXT DEFAULT (datetime('now','localtime')));
CREATE INDEX IF NOT EXISTS idx_marc_inicio ON marcacoes(inicio);

CREATE TABLE IF NOT EXISTS orcamentos (
  id INTEGER PRIMARY KEY, numero TEXT, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE,
  medico_id INTEGER REFERENCES medicos(id), data TEXT, validade TEXT, estado TEXT DEFAULT 'aberto', notas TEXT, total REAL DEFAULT 0);

CREATE TABLE IF NOT EXISTS orcamento_linhas (
  id INTEGER PRIMARY KEY, orcamento_id INTEGER REFERENCES orcamentos(id) ON DELETE CASCADE,
  servico_id INTEGER, tratamento_id INTEGER, descricao TEXT, dente TEXT, qtd REAL DEFAULT 1, preco REAL DEFAULT 0, desconto_pct REAL DEFAULT 0, iva REAL DEFAULT 0);

CREATE TABLE IF NOT EXISTS tratamentos (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE,
  medico_id INTEGER REFERENCES medicos(id), servico_id INTEGER REFERENCES servicos(id), descricao TEXT,
  dente TEXT, faces TEXT, estado TEXT DEFAULT 'planeado', data TEXT, preco REAL DEFAULT 0, desconto_pct REAL DEFAULT 0,
  iva REAL DEFAULT 0, notas TEXT, orcamento_id INTEGER, documento_id INTEGER, marcacao_id INTEGER,
  criado_em TEXT DEFAULT (datetime('now','localtime')));

CREATE TABLE IF NOT EXISTS dentes_condicoes (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE,
  dente TEXT NOT NULL, condicao TEXT NOT NULL, faces TEXT, notas TEXT, data TEXT);

CREATE TABLE IF NOT EXISTS notas_clinicas (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE,
  medico_id INTEGER, user_id INTEGER, data TEXT, texto TEXT);

CREATE TABLE IF NOT EXISTS series (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, ano INTEGER NOT NULL, prefixo TEXT, ultimo INTEGER DEFAULT 0, UNIQUE(tipo, ano));

CREATE TABLE IF NOT EXISTS documentos (
  id INTEGER PRIMARY KEY, tipo TEXT NOT NULL, numero TEXT, paciente_id INTEGER REFERENCES pacientes(id),
  entidade_id INTEGER, medico_id INTEGER, data TEXT, total_base REAL DEFAULT 0, total_iva REAL DEFAULT 0, total REAL DEFAULT 0,
  estado TEXT DEFAULT 'emitido', ref_documento_id INTEGER, notas TEXT, user_id INTEGER,
  criado_em TEXT DEFAULT (datetime('now','localtime')));

CREATE TABLE IF NOT EXISTS documento_linhas (
  id INTEGER PRIMARY KEY, documento_id INTEGER REFERENCES documentos(id) ON DELETE CASCADE,
  servico_id INTEGER, tratamento_id INTEGER, descricao TEXT, dente TEXT, qtd REAL DEFAULT 1, preco REAL DEFAULT 0,
  desconto_pct REAL DEFAULT 0, iva REAL DEFAULT 0, total REAL DEFAULT 0);

CREATE TABLE IF NOT EXISTS pagamentos (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id), documento_id INTEGER, recibo_id INTEGER,
  data TEXT, valor REAL NOT NULL, metodo TEXT, notas TEXT, estado TEXT DEFAULT 'ativo');

CREATE TABLE IF NOT EXISTS laboratorios (
  id INTEGER PRIMARY KEY, nome TEXT NOT NULL, contacto TEXT, telefone TEXT, email TEXT, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS proteses (
  id INTEGER PRIMARY KEY, paciente_id INTEGER REFERENCES pacientes(id) ON DELETE CASCADE, medico_id INTEGER,
  laboratorio_id INTEGER REFERENCES laboratorios(id), tipo TEXT, descricao TEXT, dentes TEXT, cor TEXT, referencia TEXT,
  data_emissao TEXT, data_prevista TEXT, data_envio TEXT, data_rececao TEXT, data_entrega TEXT,
  fase TEXT DEFAULT 'pedido', custo REAL DEFAULT 0, notas TEXT);

CREATE TABLE IF NOT EXISTS armazens (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS produtos (
  id INTEGER PRIMARY KEY, codigo TEXT, nome TEXT NOT NULL, familia TEXT, unidade TEXT DEFAULT 'un',
  stock_min REAL DEFAULT 0, stock_ideal REAL DEFAULT 0, preco_custo REAL DEFAULT 0, fornecedor TEXT, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS movimentos_stock (
  id INTEGER PRIMARY KEY, produto_id INTEGER REFERENCES produtos(id) ON DELETE CASCADE,
  armazem_id INTEGER REFERENCES armazens(id), tipo TEXT NOT NULL, qtd REAL NOT NULL, lote TEXT, validade TEXT,
  data TEXT, motivo TEXT, user_id INTEGER);

CREATE TABLE IF NOT EXISTS sms_modelos (id INTEGER PRIMARY KEY, nome TEXT NOT NULL, texto TEXT, ativo INTEGER DEFAULT 1);

CREATE TABLE IF NOT EXISTS sms_historico (
  id INTEGER PRIMARY KEY, paciente_id INTEGER, telefone TEXT, texto TEXT, data TEXT, estado TEXT, user_id INTEGER);

CREATE TABLE IF NOT EXISTS logs (
  id INTEGER PRIMARY KEY, user_id INTEGER, acao TEXT, detalhe TEXT, data TEXT DEFAULT (datetime('now','localtime')));
`;

db.exec(SCHEMA);

// migrações simples para bases de dados criadas por versões anteriores
for (const sql of ['ALTER TABLE orcamento_linhas ADD COLUMN tratamento_id INTEGER']) {
  try { db.exec(sql); } catch { /* coluna já existe */ }
}

function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const h = crypto.scryptSync(pw, salt, 32).toString('hex');
  return `${salt}:${h}`;
}
function checkPassword(pw, stored) {
  const [salt, h] = String(stored).split(':');
  if (!salt || !h) return false;
  const c = crypto.scryptSync(pw, salt, 32);
  return crypto.timingSafeEqual(c, Buffer.from(h, 'hex'));
}

function all(sql, ...p) { return db.prepare(sql).all(...p); }
function get(sql, ...p) { return db.prepare(sql).get(...p); }
function run(sql, ...p) { return db.prepare(sql).run(...p); }

function tx(fn) {
  db.exec('BEGIN');
  try { const r = fn(); db.exec('COMMIT'); return r; }
  catch (e) { db.exec('ROLLBACK'); throw e; }
}

function seed() {
  if (get('SELECT COUNT(*) c FROM users').c > 0) return;
  tx(() => {
    const cfg = {
      clinica_nome: 'Clínica Dentária Sorriso',
      clinica_morada: 'Rua Exemplo, 100',
      clinica_cp: '4400-000 Vila Nova de Gaia',
      clinica_nif: '500000000',
      clinica_telefone: '220 000 000',
      clinica_email: 'geral@clinica.pt',
      clinica_ers: '',
      agenda_inicio: '08:30',
      agenda_fim: '20:00',
      agenda_intervalo: '15',
      agenda_dias: '1,2,3,4,5,6',
      feriado_pascoa: '1', feriado_carnaval: '0', feriado_sexta_santa: '1', feriado_corpo_deus: '1',
      iva_default: '0',
      moeda: '€',
      doc_rodape: 'Isento de IVA nos termos do art.º 9.º do CIVA.',
      validade_orcamento_dias: '90',
    };
    for (const [k, v] of Object.entries(cfg)) run('INSERT INTO config VALUES (?,?)', k, v);

    const esp = ['Medicina Dentária Geral', 'Ortodontia', 'Implantologia', 'Endodontia', 'Periodontologia',
      'Odontopediatria', 'Prostodontia', 'Cirurgia Oral', 'Higiene Oral', 'Estética Dentária'];
    esp.forEach(n => run('INSERT INTO especialidades (nome) VALUES (?)', n));

    const medicos = [
      ['Dra. Ana Ribeiro', 'AR', 1, '#2563eb'], ['Dr. Bruno Costa', 'BC', 3, '#16a34a'],
      ['Dra. Carla Mendes', 'CM', 2, '#db2777'], ['Dr. Duarte Silva', 'DS', 4, '#ea580c'],
      ['Hig. Eva Lopes', 'EL', 9, '#0891b2'],
    ];
    medicos.forEach(([n, a, e, c], i) => run(
      'INSERT INTO medicos (nome, abreviatura, especialidade_id, cor, cedula, comissao_pct) VALUES (?,?,?,?,?,?)',
      n, a, e, c, i < 4 ? String(10000 + i * 137) : '', i < 4 ? 40 : 30));

    ['Gabinete 1', 'Gabinete 2', 'Gabinete 3', 'Sala de Higiene'].forEach(n => run('INSERT INTO gabinetes (nome) VALUES (?)', n));

    run('INSERT INTO users (nome, login, pass_hash, perfil) VALUES (?,?,?,?)', 'Administrador', 'admin', hashPassword('admin'), 'admin');
    run('INSERT INTO users (nome, login, pass_hash, perfil) VALUES (?,?,?,?)', 'Receção', 'rececao', hashPassword('rececao'), 'rececao');
    run('INSERT INTO users (nome, login, pass_hash, perfil, medico_id) VALUES (?,?,?,?,?)', 'Dra. Ana Ribeiro', 'ana', hashPassword('ana'), 'medico', 1);

    const estados = [
      ['Marcada', '#38bdf8', 'OUTRAS'], ['Confirmada', '#7c3aed', 'OUTRAS'], ['A Confirmar', '#c084fc', 'OUTRAS'],
      ['Presente', '#16a34a', 'OUTRAS'], ['Em consulta', '#0d9488', 'OUTRAS'], ['Urgente', '#22d3ee', 'OUTRAS'],
      ['Faltou', '#dc2626', 'FALTAS'], ['Desmarcada', '#92400e', 'INATIVAS'], ['Cancelada', '#f97316', 'INATIVAS'],
      ['Atrasada', '#eab308', 'OUTRAS'], ['Concluída', '#1d4ed8', 'REALIZADAS'], ['Faturada', '#111827', 'REALIZADAS'],
    ];
    estados.forEach(([n, c, cat], i) => run('INSERT INTO estados (nome, cor, categoria, ordem) VALUES (?,?,?,?)', n, c, cat, i));

    const razoes = [['Branqueamento', 'Branqueamento'], ['Cirurgia', 'Intervenção Cirúrgica'], ['Siso', 'Siso incluso'],
      ['Generalista', 'Consulta Generalista'], ['H. Oral', 'Higiene Oral'], ['Implantologia', 'Colocação de Implantes'],
      ['Ortodontia', 'Colocação de Aparelho'], ['Prótese', 'Consulta de Prótese'], ['Urgência', 'Dor / Urgência'], ['Outro', 'Não definida']];
    razoes.forEach(([a, d]) => run('INSERT INTO razoes_visita (abreviatura, descricao) VALUES (?,?)', a, d));

    const feriados = [['Ano Novo', '01-01'], ['Dia da Liberdade', '04-25'], ['Dia do Trabalhador', '05-01'],
      ['Dia de Portugal', '06-10'], ['São João (feriado municipal)', '06-24'], ['Assunção de Nossa Senhora', '08-15'],
      ['Implantação da República', '10-05'], ['Dia de Todos os Santos', '11-01'], ['Restauração da Independência', '12-01'],
      ['Imaculada Conceição', '12-08'], ['Natal', '12-25']];
    feriados.forEach(([n, d]) => run('INSERT INTO feriados (nome, data, fixo) VALUES (?,?,1)', n, d));

    ['Particular', 'Médis', 'Multicare', 'AdvanceCare', 'SAMS', 'ADSE', 'Cheque-Dentista (SNS)']
      .forEach((n, i) => run('INSERT INTO entidades (nome, desconto_pct) VALUES (?,?)', n, i === 0 ? 0 : 10));

    const servicos = [
      ['C001', 'Consulta de avaliação', 1, 30, 30, 0], ['C002', 'Consulta de urgência', 1, 45, 30, 0],
      ['C003', 'Consulta de controlo', 1, 25, 20, 0],
      ['H001', 'Destartarização e polimento', 9, 50, 45, 0], ['H002', 'Aplicação de flúor', 9, 20, 15, 0],
      ['H003', 'Selante de fissuras', 9, 25, 20, 1],
      ['R001', 'Restauração compósito 1 face', 1, 50, 30, 1], ['R002', 'Restauração compósito 2 faces', 1, 65, 40, 1],
      ['R003', 'Restauração compósito 3+ faces', 1, 80, 45, 1],
      ['E001', 'Endodontia monorradicular', 4, 150, 60, 1], ['E002', 'Endodontia birradicular', 4, 200, 75, 1],
      ['E003', 'Endodontia multirradicular', 4, 250, 90, 1],
      ['X001', 'Extração simples', 8, 50, 30, 1], ['X002', 'Extração de siso incluso', 8, 150, 60, 1],
      ['I001', 'Implante dentário (cirurgia)', 3, 900, 90, 1], ['I002', 'Coroa sobre implante', 3, 600, 45, 1],
      ['P001', 'Coroa cerâmica', 7, 450, 60, 1], ['P002', 'Prótese removível acrílica', 7, 500, 45, 0],
      ['P003', 'Prótese esquelética', 7, 750, 45, 0], ['P004', 'Faceta cerâmica', 10, 400, 60, 1],
      ['O001', 'Estudo ortodôntico', 2, 120, 45, 0], ['O002', 'Aparelho fixo (colocação)', 2, 1200, 90, 0],
      ['O003', 'Manutenção ortodôntica mensal', 2, 50, 20, 0], ['O004', 'Alinhadores invisíveis', 2, 3000, 60, 0],
      ['B001', 'Branqueamento em consultório', 10, 300, 90, 0],
      ['D001', 'Ortopantomografia (RX panorâmico)', 1, 35, 15, 0], ['D002', 'RX periapical', 1, 10, 10, 1],
      ['PE01', 'Raspagem e alisamento radicular (quadrante)', 5, 80, 45, 0],
      ['OP01', 'Consulta de odontopediatria', 6, 35, 30, 0],
    ];
    servicos.forEach(([c, n, e, p, d, pd]) => run(
      'INSERT INTO servicos (codigo, nome, especialidade_id, preco, iva, duracao_min, por_dente) VALUES (?,?,?,?,0,?,?)', c, n, e, p, d, pd));

    run("INSERT INTO laboratorios (nome, telefone, email) VALUES ('Laboratório Dental Norte', '220 111 222', 'lab@exemplo.pt')");
    run("INSERT INTO laboratorios (nome, telefone, email) VALUES ('ProtLab Gaia', '220 333 444', 'geral@protlab.exemplo')");

    ['Armazém principal', 'Gabinete 1', 'Gabinete 2'].forEach(n => run('INSERT INTO armazens (nome) VALUES (?)', n));
    const produtos = [
      ['LUV-M', 'Luvas nitrilo M (caixa 100)', 'Descartáveis', 'cx', 5, 15, 6.5],
      ['MASC', 'Máscaras cirúrgicas (caixa 50)', 'Descartáveis', 'cx', 4, 10, 4],
      ['ANE-ART', 'Articaína 4% 1:100.000 (cx 50)', 'Anestésicos', 'cx', 2, 5, 38],
      ['COMP-A2', 'Compósito A2 seringa 4g', 'Restauração', 'un', 3, 8, 22],
      ['ADES', 'Adesivo universal 5ml', 'Restauração', 'un', 1, 3, 65],
      ['LIMA-K', 'Limas K 25mm sortidas', 'Endodontia', 'cx', 2, 6, 9.5],
      ['GUTA', 'Cones de guta-percha', 'Endodontia', 'cx', 2, 5, 12],
      ['ALG', 'Alginato 500g', 'Impressão', 'un', 2, 4, 11],
      ['SUT', 'Sutura 4/0', 'Cirurgia', 'cx', 1, 3, 45],
    ];
    produtos.forEach(([c, n, f, u, mi, id, pc]) => run(
      'INSERT INTO produtos (codigo, nome, familia, unidade, stock_min, stock_ideal, preco_custo) VALUES (?,?,?,?,?,?,?)', c, n, f, u, mi, id, pc));
    const hoje = new Date().toISOString().slice(0, 10);
    const qtds = [10, 6, 3, 2, 2, 4, 1, 3, 2];
    qtds.forEach((q, i) => run(
      "INSERT INTO movimentos_stock (produto_id, armazem_id, tipo, qtd, data, motivo, lote, validade) VALUES (?,1,'entrada',?,?,'Stock inicial',?,?)",
      i + 1, q, hoje, 'L' + (2400 + i), i === 2 ? addDays(hoje, 40) : addDays(hoje, 500)));

    const sms = [
      ['Lembrete de consulta', 'Olá {primeiro_nome}, lembramos a sua consulta na {clinica} no dia {data} às {hora} com {medico}. Responda SIM para confirmar. Obrigado!'],
      ['Aniversário', 'Parabéns {primeiro_nome}! A equipa da {clinica} deseja-lhe um feliz aniversário.'],
      ['Falta à consulta', 'Olá {primeiro_nome}, verificámos que não compareceu à consulta de {data}. Contacte-nos para remarcar: {telefone_clinica}.'],
      ['Prótese pronta', 'Olá {primeiro_nome}, o seu trabalho de prótese já se encontra na clínica. Contacte-nos para agendar: {telefone_clinica}.'],
      ['Revisão anual', 'Olá {primeiro_nome}, já passou um ano desde a sua última consulta. Marque a sua revisão na {clinica}: {telefone_clinica}.'],
    ];
    sms.forEach(([n, t]) => run('INSERT INTO sms_modelos (nome, texto) VALUES (?,?)', n, t));

    seedDemo();
  });
}

function addDays(iso, n) {
  const d = new Date(iso + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function nifValido(oito) {
  let soma = 0;
  for (let i = 0; i < 8; i++) soma += Number(oito[i]) * (9 - i);
  let c = 11 - (soma % 11); if (c >= 10) c = 0;
  return oito + c;
}

// Dados fictícios para demonstração
function seedDemo() {
  const nomes = ['Maria Fernandes', 'João Pereira', 'Rita Sousa', 'Pedro Almeida', 'Inês Carvalho', 'Tiago Rodrigues',
    'Sofia Martins', 'Miguel Gomes', 'Beatriz Oliveira', 'Rui Teixeira', 'Catarina Lopes', 'André Moreira'];
  const hoje = new Date();
  const iso = d => d.toISOString().slice(0, 10);
  nomes.forEach((n, i) => {
    const ano = 1960 + ((i * 7) % 50);
    const mes = String((i % 12) + 1).padStart(2, '0');
    const dia = String(((i * 3) % 27) + 1).padStart(2, '0');
    const r = run(`INSERT INTO pacientes (numero, nome, data_nasc, genero, nif, telemovel, email, morada, cod_postal, localidade,
      razao_visita_id, medico_id, entidade_id, rgpd_consent, rgpd_data) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,1,?)`,
      i + 1, n, `${ano}-${mes}-${dia}`, i % 2 ? 'M' : 'F', nifValido(String(20000000 + i * 1234567).slice(0, 8)),
      '91' + String(1000000 + i * 54321).slice(0, 7), n.toLowerCase().split(' ')[0] + '@exemplo.pt',
      `Rua Fictícia, ${10 + i}`, '4400-' + String(100 + i).padStart(3, '0'), 'Vila Nova de Gaia',
      (i % 9) + 1, (i % 5) + 1, i % 4 === 0 ? 2 : 1, iso(hoje));
    run('INSERT INTO anamnese (paciente_id, alergias, doencas, medicacao, fumador, hipertensao) VALUES (?,?,?,?,?,?)',
      r.lastInsertRowid, i % 3 === 0 ? 'Penicilina' : '', i % 4 === 0 ? 'Hipertensão arterial' : '', '', i % 5 === 0 ? 'Sim' : 'Não', i % 4 === 0 ? 1 : 0);
  });
  // Marcações na semana atual
  const base = new Date(hoje); base.setHours(0, 0, 0, 0);
  const slots = ['09:00', '09:30', '10:30', '11:15', '14:00', '15:00', '16:30', '17:30'];
  let k = 0;
  for (let d = -2; d <= 5; d++) {
    const day = new Date(base); day.setDate(day.getDate() + d);
    if (day.getDay() === 0) continue;
    for (let m = 1; m <= 4; m++) {
      for (let s = 0; s < 3; s++) {
        const slot = slots[(m + s * 3 + d + 10) % slots.length];
        const p = (k % 12) + 1; const serv = [1, 4, 7, 10, 3, 13][k % 6];
        const dur = get('SELECT duracao_min FROM servicos WHERE id=?', serv).duracao_min;
        const ini = `${iso(day)}T${slot}`;
        const [h, mi] = slot.split(':').map(Number);
        const f = new Date(day); f.setHours(h, mi + dur);
        const fim = `${iso(day)}T${String(f.getHours()).padStart(2, '0')}:${String(f.getMinutes()).padStart(2, '0')}`;
        const estado = d < 0 ? [11, 11, 7, 12][k % 4] : d === 0 ? [4, 2, 1, 3][k % 4] : [1, 2, 3][k % 3];
        // evita sobreposições do mesmo médico
        const clash = get('SELECT id FROM marcacoes WHERE medico_id=? AND inicio < ? AND fim > ?', m, fim, ini);
        if (!clash) run('INSERT INTO marcacoes (paciente_id, medico_id, gabinete_id, servico_id, inicio, fim, estado_id) VALUES (?,?,?,?,?,?,?)',
          p, m, m, serv, ini, fim, estado);
        k++;
      }
    }
  }
  // Tratamentos e condições de exemplo
  run("INSERT INTO dentes_condicoes (paciente_id, dente, condicao, data) VALUES (1,'36','ausente',?)", iso(hoje));
  run("INSERT INTO dentes_condicoes (paciente_id, dente, condicao, faces, data) VALUES (1,'16','carie','O',?)", iso(hoje));
  run("INSERT INTO tratamentos (paciente_id, medico_id, servico_id, descricao, dente, faces, estado, data, preco) VALUES (1,1,8,'Restauração compósito 2 faces','16','OM','planeado',?,65)", iso(hoje));
  run("INSERT INTO tratamentos (paciente_id, medico_id, servico_id, descricao, dente, estado, data, preco) VALUES (1,2,15,'Implante dentário (cirurgia)','36','planeado',?,900)", iso(hoje));
  run("INSERT INTO tratamentos (paciente_id, medico_id, servico_id, descricao, dente, estado, data, preco) VALUES (1,1,4,'Destartarização e polimento',NULL,'realizado',?,50)", iso(hoje));
  run("INSERT INTO proteses (paciente_id, medico_id, laboratorio_id, tipo, descricao, dentes, data_emissao, data_prevista, fase, custo) VALUES (2,2,1,'Coroa','Coroa zircónia','21',?,?,'enviado',180)",
    iso(hoje), addDays(iso(hoje), 7));
}

seed();

function getConfig() {
  const o = {};
  for (const r of all('SELECT chave, valor FROM config')) o[r.chave] = r.valor;
  return o;
}

function log(userId, acao, detalhe) {
  try { run('INSERT INTO logs (user_id, acao, detalhe) VALUES (?,?,?)', userId || null, acao, detalhe || ''); } catch { /* ignore */ }
}

module.exports = { db, DB_FILE, DATA_DIR, all, get, run, tx, hashPassword, checkPassword, getConfig, log, addDays };
