'use strict';
// Teste de carga e de negação de serviço (npm run stress). Não faz parte do npm test.
// Arranca o servidor num processo à parte, com DATA_DIR temporário, dados DEMO e 20 000 pacientes, e ataca-o.
// Variáveis: USERS (utilizadores simultâneos, 50), DUR (segundos da mistura, 15), PACIENTES (20000),
//            SLOW_N (ligações slowloris, 1000), SLOW_S (segundos a segurá-las, 20; use 100 para ver o headersTimeout), UP_N (uploads em paralelo, 20)
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');

const USERS = Number(process.env.USERS) || 50, DUR = Number(process.env.DUR) || 15, NPAC = Number(process.env.PACIENTES) || 20000;
const SLOW_N = Number(process.env.SLOW_N) || 1000, SLOW_S = Number(process.env.SLOW_S) || 20, UP_N = Number(process.env.UP_N) || 20;
const LENTO_MS = 200;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-stress-'));
const env = { ...process.env, DATA_DIR: dir, DEMO: '1', ADMIN_PASSWORD: 'stress-admin-pw' };
const hoje = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

// ---------- dados: DEMO + NPAC pacientes + 2 marcações por paciente ----------
function semear() {
  Object.assign(process.env, env);
  const D = require('../db');
  const nomes = ['Maria', 'João', 'Ana', 'Pedro', 'Rita', 'Tiago', 'Sofia', 'Rui', 'Inês', 'Miguel', 'Beatriz', 'André', 'Catarina', 'Luís'];
  const apel = ['Silva', 'Santos', 'Ferreira', 'Pereira', 'Oliveira', 'Costa', 'Rodrigues', 'Martins', 'Sousa', 'Fernandes', 'Gonçalves', 'Lopes'];
  const r = i => (i * 2654435761) >>> 0;
  D.tx(() => {
    for (let i = 0; i < NPAC; i++) {
      const id = D.run(`INSERT INTO pacientes (numero, nome, data_nasc, telemovel, email, localidade, medico_id, ativo) VALUES (?,?,?,?,?,?,?,1)`,
        1000 + i, `${nomes[r(i) % 14]} ${apel[r(i + 7) % 12]} ${apel[r(i + 3) % 12]} ${i}`, `19${50 + r(i) % 50}-${String(1 + r(i) % 12).padStart(2, '0')}-${String(1 + r(i) % 28).padStart(2, '0')}`,
        '9' + String(10000000 + r(i) % 89999999), `p${i}@exemplo.pt`, 'Porto', 1 + i % 5).lastInsertRowid;
      for (let k = 0; k < 2; k++) {
        const d = new Date(Date.now() + ((r(i + k) % 360) - 180) * 864e5); const dia = d.toISOString().slice(0, 10), h = 8 + r(i * 3 + k) % 11;
        D.run('INSERT INTO marcacoes (paciente_id, medico_id, inicio, fim, estado_id) VALUES (?,?,?,?,1)', id, 1 + i % 5, `${dia}T${String(h).padStart(2, '0')}:00`, `${dia}T${String(h).padStart(2, '0')}:30`);
      }
    }
  });
  D.db.close();
}

// ---------- servidor filho ----------
let filho, port;
async function arrancar() {
  port = await new Promise(res => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
  filho = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], { env: { ...env, PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  filho.stderr.on('data', d => { erros5xx.push(String(d).split('\n')[0]); });
  await new Promise((res, rej) => { filho.stdout.on('data', d => String(d).includes('servidor ativo') && res()); filho.on('exit', c => rej(new Error('servidor saiu ' + c))); });
}
const erros5xx = [];
const rss = () => { try { const s = fs.readFileSync(`/proc/${filho.pid}/status`, 'utf8'); return { rss: +s.match(/VmRSS:\s+(\d+)/)[1] / 1024, pico: +s.match(/VmHWM:\s+(\d+)/)[1] / 1024 }; } catch { return { rss: NaN, pico: NaN }; } };

const agente = new http.Agent({ keepAlive: true, maxSockets: 256 });
function pedido(metodo, url, { corpo, ck, ip, tipo = 'application/json', bruto, timeout = 30000 } = {}) {
  return new Promise(resolve => {
    const t0 = process.hrtime.bigint(); const h = {}; if (ck) h.Cookie = ck;
    let dados; if (corpo !== undefined) { dados = bruto ? corpo : Buffer.from(JSON.stringify(corpo)); h['Content-Type'] = tipo; h['Content-Length'] = dados.length; }
    const fim = (status, extra = {}) => resolve({ status, ms: Number(process.hrtime.bigint() - t0) / 1e6, ...extra });
    const r = http.request({ host: '127.0.0.1', port, path: '/api/' + url, method: metodo, headers: h, agent: ip ? undefined : agente, localAddress: ip }, res => {
      const ch = []; res.on('data', c => ch.push(c)); res.on('end', () => fim(res.statusCode, { texto: Buffer.concat(ch).toString('utf8'), headers: res.headers }));
    });
    r.setTimeout(timeout, () => { r.destroy(); fim(0, { erro: 'timeout' }); });
    r.on('error', e => fim(0, { erro: e.code }));
    r.end(dados);
  });
}

// ---------- estatísticas ----------
const linhas = [];
function registar(nome, res, okFn = r => r.status >= 200 && r.status < 300) {
  const ms = res.map(r => r.ms).sort((a, b) => a - b); const q = p => ms.length ? ms[Math.min(ms.length - 1, Math.floor(p * ms.length))] : 0;
  const l = { nome, n: res.length, ok: res.filter(okFn).length, s5: res.filter(r => r.status >= 500).length, sem: res.filter(r => r.status === 0).length, p50: q(0.5), p95: q(0.95), max: ms.at(-1) || 0 };
  l.err = l.n - l.ok; l.st = [...new Set(res.map(r => r.status || r.erro))].slice(0, 4).join(','); linhas.push(l); return l;
}
const notas = [];

async function main() {
  const t = Date.now(); semear(); console.log(`dados: ${NPAC} pacientes + ${NPAC * 2} marcações em ${Date.now() - t} ms`);
  await arrancar(); console.log(`servidor filho pid ${filho.pid} porta ${port}, RSS ${rss().rss.toFixed(0)} MB`);
  const login = async () => (await pedido('POST', 'login', { corpo: { login: 'admin', password: 'stress-admin-pw' } })).headers['set-cookie'][0].split(';')[0];
  const ckA = await login();

  // 1. mistura realista: USERS utilizadores durante DUR segundos
  const ops = {
    'agenda do dia': () => ['GET', `agenda?de=${hoje()}`],
    'pesquisa paciente': () => ['GET', `pacientes?q=${encodeURIComponent(['silva', 'ana', 'rui s', '91', 'costa', 'p12'][Math.random() * 6 | 0])}`],
    'ficha resumo': () => ['GET', `pacientes/${1 + (Math.random() * NPAC | 0)}/resumo`],
    'criar marcação': () => { const d = new Date(Date.now() + (1 + Math.random() * 60 | 0) * 864e5).toISOString().slice(0, 10), h = String(8 + (Math.random() * 11 | 0)).padStart(2, '0'), mm = ['00', '30'][Math.random() * 2 | 0];
      return ['POST', 'marcacoes', { paciente_id: 1 + (Math.random() * NPAC | 0), medico_id: 1 + (Math.random() * 5 | 0), inicio: `${d}T${h}:${mm}`, fim: `${d}T${h}:${mm === '00' ? '25' : '55'}`, sem_aviso: 1 }]; },
    'emitir FR': () => ['POST', 'documentos', { tipo: 'FR', paciente_id: 1 + (Math.random() * NPAC | 0), linhas: [{ descricao: 'Consulta', preco: 40, iva: 0 }] }],
  };
  const pesos = [['agenda do dia', 3], ['pesquisa paciente', 4], ['ficha resumo', 3], ['criar marcação', 1], ['emitir FR', 1]];
  const sorteio = () => { let x = Math.random() * 12; for (const [n, p] of pesos) if ((x -= p) < 0) return n; return 'agenda do dia'; };
  const cks = await Promise.all(Array.from({ length: USERS }, login));
  const porOp = Object.fromEntries(pesos.map(([n]) => [n, []]));
  const ate = Date.now() + DUR * 1000;
  await Promise.all(cks.map(async ck => { while (Date.now() < ate) { const n = sorteio(); const [m, u, c] = ops[n](); porOp[n].push(await pedido(m, u, { ck, corpo: c })); } }));
  // 409 (conflito de horário / feriado / bloqueio) é resposta de negócio válida
  for (const [n, r] of Object.entries(porOp)) registar(`mistura ${USERS} utiliz.: ${n}`, r, x => (x.status >= 200 && x.status < 300) || (n === 'criar marcação' && x.status === 409));
  const tot = Object.values(porOp).flat(); notas.push(`mistura: ${tot.length} pedidos em ${DUR} s = ${(tot.length / DUR).toFixed(0)} pedidos/s, RSS ${rss().rss.toFixed(0)} MB`);

  // 2. endpoints pesados com NPAC pacientes (> LENTO_MS bloqueia o event loop: o node:sqlite é síncrono)
  const ano = hoje().slice(0, 4);
  const pesados = ['pacientes?q=a', 'pacientes?q=silva', 'pacientes?q=9', 'pacientes?limit=100000', 'pacientes?limit=-1', 't/pacientes', 'devedores',
    `listagens/ocupacao?de=${ano}-01-01&ate=${ano}-12-31`, `listagens/agenda?de=${ano}-01-01&ate=${ano}-12-31`,
    `aniversarios?de=${hoje().slice(0, 4)}-01-01&ate=${hoje().slice(0, 4)}-12-31`, 'estatisticas', `estatisticas?de=2000-01-01&ate=2100-12-31`, 'dashboard', 'lookups',
    `listagens/confirmar?de=${ano}-01-01&ate=${ano}-12-31`,
    ...['remarcacoes', 'faltas', 'ausencias', 'espera', 'caixa', 'comissoes', 'pendentes', 'producao', 'orcamentos', 'movimentos'].map(l => `listagens/${l}?de=2000-01-01&ate=2100-12-31`),
    'documentos', 'stocks/existencias', 'pesquisa-vagas?medico_id=1&medico2_id=2&limite=100', 'logs', 'sms/historico', 'pacientes/1/resumo', `agenda?de=${hoje().slice(0, 4)}-01-01&ate=${hoje().slice(0, 4)}-12-31`, 'backup'];
  // intervalos acima de 1 ano nas listagens que percorrem dias/marcações → 400 imediato
  for (const l of ['ocupacao', 'agenda', 'confirmar']) registar(`GET listagens/${l} 1900→2100 → 400`, [await pedido('GET', `listagens/${l}?de=1900-01-01&ate=2100-12-31`, { ck: ckA })], r => r.status === 400 && r.ms < 100);
  const lentos = [];
  for (const u of pesados) {
    const r = []; for (let i = 0; i < 3; i++) r.push(await pedido('GET', u, { ck: ckA }));
    const l = registar(`GET ${u}`, r); if (l.max > LENTO_MS) lentos.push(`${u} ${l.max.toFixed(0)} ms (${((r[0].texto || '').length / 1e6).toFixed(1)} MB)`);
  }
  notas.push(`> ${LENTO_MS} ms com ${NPAC} pacientes: ${lentos.join('; ') || 'nenhum'}`);
  // um só pedido de qualquer perfil com um intervalo de datas enorme prendia o event loop (3 anos: 10 s); agora é recusado
  const dos = pedido('GET', `listagens/ocupacao?de=${ano - 2}-01-01&ate=${ano}-12-31`, { ck: ckA, timeout: 300000 });
  await new Promise(r => setTimeout(r, 200));
  const vitima = await pedido('GET', 'me', { ck: ckA, timeout: 300000 });
  registar('listagens/ocupacao de 3 anos (1 pedido) → 400', [await dos], r => r.status === 400);
  registar('  …GET /api/me de outro posto durante esse pedido (<1 s)', [vitima], r => r.status === 200 && r.ms < 1000);

  // 3. slowloris: SLOW_N ligações a mandar cabeçalhos a conta-gotas; os pedidos legítimos continuam a ser servidos?
  const socks = []; let fechadas = 0;
  for (let i = 0; i < SLOW_N; i++) {
    const s = net.connect(port, '127.0.0.1'); s.on('error', () => {}); s.on('close', () => fechadas++);
    s.write('GET / HTTP/1.1\r\nHost: x\r\n'); socks.push(s);
  }
  const gota = setInterval(() => socks.forEach(s => !s.destroyed && s.write(`X-${Math.random() * 1e6 | 0}: a\r\n`)), 5000);
  const legit = []; const fimSlow = Date.now() + SLOW_S * 1000;
  while (Date.now() < fimSlow) { legit.push(await pedido('GET', 'me', { ck: ckA, timeout: 10000 })); await new Promise(r => setTimeout(r, 250)); }
  clearInterval(gota);
  registar(`slowloris ${SLOW_N} lig. ${SLOW_S} s: GET /api/me`, legit);
  notas.push(`slowloris: ${SLOW_N - fechadas}/${SLOW_N} ligações meio-abertas continuavam abertas ao fim de ${SLOW_S} s (headersTimeout 20 s, requestTimeout 120 s, keepAliveTimeout 5 s; sem limite de ligações)`);
  socks.forEach(s => s.destroy());

  // 4. uploads em paralelo (5 MB cada, ficam em memória até ao fim) + um acima do limite
  const antes = rss();
  const png = Buffer.alloc(5 * 1024 * 1024); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(png);
  const ups = await Promise.all(Array.from({ length: UP_N }, (_, i) => pedido('POST', `pacientes/${1 + i}/anexos?categoria=RX&nome=rx${i}.png`, { ck: ckA, corpo: png, bruto: true, tipo: 'application/octet-stream' })));
  registar(`${UP_N} uploads paralelos de 5 MB`, ups);
  const grande = await pedido('POST', 'pacientes/1/anexos', { ck: ckA, corpo: Buffer.alloc(25 * 1024 * 1024, 0x89), bruto: true, tipo: 'application/octet-stream' });
  registar('upload de 25 MB → 413', [grande], r => r.status === 413);
  notas.push(`uploads: RSS ${antes.rss.toFixed(0)} → ${rss().rss.toFixed(0)} MB, pico ${rss().pico.toFixed(0)} MB`);

  // 5. entradas abusivas (esperado 4xx rápido, nunca 5xx nem pendurado)
  // 4xx, ou ligação fechada pelo servidor antes de ler um corpo enorme sem sessão (EPIPE/ECONNRESET do lado do cliente)
  const abuso = r => (r.status >= 400 && r.status < 500) || ['EPIPE', 'ECONNRESET'].includes(r.erro);
  registar('query string 8 KB', [await pedido('GET', 'pacientes?q=' + 'a'.repeat(8000), { ck: ckA })]);
  // o Node responde 431 e fecha; o cliente pode ver só o ECONNRESET
  registar('query string 64 KB → 431', [await pedido('GET', 'pacientes?q=' + 'a'.repeat(65536), { ck: ckA })], r => abuso(r) || r.erro === 'ECONNRESET');
  registar('JSON aninhado 1e6 níveis → 400', [await pedido('POST', 'notas', { ck: ckA, corpo: Buffer.from('['.repeat(1e6) + ']'.repeat(1e6)), bruto: true })], abuso);
  registar('JSON aninhado 2,4e6 níveis sem sessão', [await pedido('POST', 'notas', { corpo: Buffer.from('['.repeat(2.4e6) + ']'.repeat(2.4e6)), bruto: true })], abuso);
  registar('JSON 4,9 MB com 300k chaves sem sessão', [await pedido('POST', 'notas', { corpo: Object.fromEntries(Array.from({ length: 300000 }, (_, i) => ['k' + i, i])) })], abuso);

  // 6. memória do Map de falhas de login (uma entrada por IP, nunca removida) + tamanho dos logs
  const m0 = rss(); const nIps = 5000; const logs0 = fs.statSync(path.join(dir, 'clinica.db')).size;
  const falh = [];
  for (let i = 0; i < nIps; i += 50) falh.push(...await Promise.all(Array.from({ length: 50 }, (_, k) => pedido('POST', 'login', { ip: `127.1.${(i + k) >> 8}.${((i + k) & 255) || 1}`, corpo: { login: 'nao-existe-' + 'x'.repeat(2000), password: 'x' } }))));
  // o mesmo login vindo de muitos IPs fica bloqueado por conta (429) — é o comportamento pretendido
  registar(`${nIps} logins falhados de IPs distintos → 401/429`, falh, r => r.status === 401 || r.status === 429);
  notas.push(`falhas Map: RSS ${m0.rss.toFixed(0)} → ${rss().rss.toFixed(0)} MB com ${nIps} IPs; logs/BD +${((fs.statSync(path.join(dir, 'clinica.db')).size + (fs.existsSync(path.join(dir, 'clinica.db-wal')) ? fs.statSync(path.join(dir, 'clinica.db-wal')).size : 0) - logs0) / 1e6).toFixed(1)} MB (login de 2 KB registado por inteiro)`);

  // ---------- resumo ----------
  const f = n => n.toFixed(0).padStart(6);
  console.log('\n' + 'cenário'.padEnd(62) + '     n    ok   err   5xx  p50ms  p95ms  maxms  status');
  for (const l of linhas) console.log(`${l.nome.slice(0, 61).padEnd(62)}${f(l.n)}${f(l.ok)}${f(l.err)}${f(l.s5)}${f(l.p50)}${f(l.p95)}${f(l.max)}  ${l.st}`);
  console.log('\n' + notas.map(n => '- ' + n).join('\n'));
  if (erros5xx.length) console.log('\nstderr do servidor (1.ª linhas):\n' + [...new Set(erros5xx)].slice(0, 10).join('\n'));
  const mau = linhas.filter(l => l.err || l.s5);
  console.log(mau.length ? `\nFALHOU: ${mau.map(l => l.nome).join(', ')}` : '\nOK: sem erros nem 5xx');
  return mau.length ? 1 : 0;
}

main().then(c => { process.exitCode = c; }, e => { console.error(e); process.exitCode = 2; })
  .finally(() => { filho?.kill(); agente.destroy(); fs.rmSync(dir, { recursive: true, force: true }); });
