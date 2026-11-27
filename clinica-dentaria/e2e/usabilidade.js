'use strict';
// Testes de usabilidade (Playwright, se estiver instalado — não é dependência do projeto).
// Arranca um servidor próprio (DEMO=1) numa pasta temporária, corre critérios mensuráveis e imprime uma tabela.
// Uso: npm run e2e
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

let pw;
try { pw = require('playwright'); } catch {
  console.log('e2e/usabilidade: o Playwright não está instalado — testes de usabilidade ignorados (npm i -g playwright para os correr).');
  process.exit(0);
}

// Problemas conhecidos da aplicação: são verificados e reportados, mas não falham a execução.
// Quando um destes passar a "ok", retire-o daqui.
const CONHECIDOS = {
  'Agenda: Esc durante o arrasto (foco fora da grelha) cancela': 'F2 por juntar (agenda.js só ouve o Esc na grelha)',
};

// ---------- servidor ----------
const freePort = () => new Promise((res, rej) => { const s = net.createServer(); s.on('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
async function startServer() {
  const port = await freePort();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'clinica-e2e-'));
  const proc = spawn(process.execPath, ['server.js'], { cwd: path.join(__dirname, '..'), env: { ...process.env, PORT: String(port), DATA_DIR: dataDir, DEMO: '1', ADMIN_PASSWORD: 'admin' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let log = ''; proc.stdout.on('data', d => { log += d; }); proc.stderr.on('data', d => { log += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    if (proc.exitCode !== null) throw new Error('o servidor terminou:\n' + log);
    try { await fetch(base + '/api/me'); return { base, proc, dataDir }; } catch { await new Promise(r => setTimeout(r, 100)); }
  }
  proc.kill(); throw new Error('o servidor não arrancou:\n' + log);
}

// ---------- registo de resultados ----------
const resultados = [];
async function check(nome, fn) {
  const t = Date.now();
  try { const det = await fn(); resultados.push({ nome, ok: true, det: det || '', ms: Date.now() - t }); }
  catch (e) { resultados.push({ nome, ok: false, det: (e.message || String(e)).split('\n')[0].slice(0, 600), ms: Date.now() - t }); }
}

// ---------- utilitários de página ----------
const ROTAS = ['#/inicio', '#/agenda', '#/pacientes', '#/faturacao', '#/faturacao/devedores', '#/faturacao/caixa', '#/orcamentos',
  '#/proteses', '#/stocks', '#/listagens', '#/estatisticas', '#/comunicacao', '#/config'];
const FICHA_TABS = ['resumo', 'odontograma', 'perio', 'tratamentos', 'anamnese', 'notas', 'marcacoes', 'orcamentos', 'cc', 'proteses', 'anexos'];

async function main() {
  const { base, proc, dataDir } = await startServer();
  const browser = await pw.chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-PT' });
  // regista todos os toasts (desaparecem ao fim de 3–6 s)
  await ctx.addInitScript(() => {
    window.__toasts = [];
    new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) if (n.nodeType === 1 && n.classList.contains('toast')) window.__toasts.push({ t: n.textContent, err: n.classList.contains('err') }); })
      .observe(document, { childList: true, subtree: true });
  });
  const page = await ctx.newPage();
  const erros = []; let rotaAtual = 'login', logado = false, aceita400 = false;
  page.on('pageerror', e => erros.push(`${rotaAtual}: pageerror ${e.message}`));
  page.on('console', m => {
    if (m.type() !== 'error') return;
    const url = m.location()?.url || '';
    if (!logado && /\/api\/me/.test(url) && /401/.test(m.text())) return; // 401 esperado antes do login
    if (aceita400 && /status of 400/.test(m.text())) return; // 400 provocado de propósito
    erros.push(`${rotaAtual}: ${m.text()}`);
  });

  let pendentes = 0;
  page.on('request', () => pendentes++); page.on('requestfinished', () => pendentes--); page.on('requestfailed', () => pendentes--);
  const idle = async () => { for (let calmo = 0, i = 0; calmo < 3 && i < 100; i++) { await page.waitForTimeout(50); calmo = pendentes <= 0 ? calmo + 1 : 0; } };
  const nav = async h => { rotaAtual = h; await page.evaluate(h => { location.hash = h; }, h); await idle(); };
  const toasts = () => page.evaluate(() => window.__toasts.splice(0));
  const esperaToast = async (re, ms = 3000) => {
    const fim = Date.now() + ms; const vistos = [];
    while (Date.now() < fim) { vistos.push(...await toasts()); const t = vistos.find(x => re.test(x.t)); if (t) return t; await page.waitForTimeout(50); }
    throw new Error(`sem toast ${re} (vistos: ${JSON.stringify(vistos.map(x => x.t))})`);
  };
  const ativo = () => page.evaluate(() => { const a = document.activeElement; return { tag: a?.tagName, id: a?.id, name: a?.name || '', txt: (a?.textContent || '').trim().slice(0, 40), cls: a?.className || '', inModal: !!a?.closest('.modal-bg'), act: a?.dataset?.act || '', sel: a?.dataset?.sel || '' }; });
  // carrega Tab até pred(elemento ativo) ser verdadeiro; devolve n.º de Tabs
  const tabAte = async (pred, max = 80, tecla = 'Tab') => { for (let i = 1; i <= max; i++) { await page.keyboard.press(tecla); if (pred(await ativo())) return i; } throw new Error(`não alcançável com ${tecla} em ${max} toques (foco em ${JSON.stringify(await ativo())})`); };
  const fecharModais = () => page.evaluate(() => document.querySelectorAll('.modal-bg').forEach(m => m.remove()));
  const modalTopo = '.modal-bg:last-of-type';

  try {
    // ---------- login ----------
    await page.goto(base + '/');
    await page.fill('#login-form input[name=login]', 'admin');
    await page.fill('#login-form input[name=password]', 'admin');
    await page.press('#login-form input[name=password]', 'Enter');
    await page.waitForSelector('#app:not(.hidden)'); logado = true; await idle();

    await check('Acessibilidade: html lang="pt"', async () => {
      const lang = await page.evaluate(() => document.documentElement.lang);
      assert.match(lang, /^pt(-PT)?$/i, `lang="${lang}"`); return `lang="${lang}"`;
    });

    // ---------- eficiência ----------
    await check('Eficiência: marcação a partir da agenda ≤ 5 ações', async () => {
      await nav('#/agenda'); await toasts(); let n = 0;
      await page.locator('.col').first().locator('.slot[data-t="19:00"]').click(); n++;
      await page.waitForSelector(`${modalTopo} [data-pac="paciente_id"]`);
      await page.locator(`${modalTopo} [data-pac="paciente_id"]`).fill('Rita'); n++;
      await page.waitForSelector(`${modalTopo} .ac-list b`);
      await page.keyboard.press('Enter'); n++;
      await page.locator(`${modalTopo} footer button.primary`).click(); n++;
      await idle();
      if (await page.locator('.modal-bg').count() > 1) { await page.locator(`${modalTopo} footer button.primary`).click(); n++; } // conflito → gravar mesmo assim
      await esperaToast(/Marcação guardada/);
      assert.ok(n <= 5, `${n} ações`); return `${n} ações`;
    });

    await check('Eficiência: Ctrl+K → ficha em ≤ 3 ações', async () => {
      await nav('#/inicio'); let n = 0;
      await page.keyboard.press('Control+k'); n++;
      assert.equal((await ativo()).id, 'global-search', 'Ctrl+K não pôs o foco na pesquisa');
      await page.keyboard.type('João'); n++;
      await page.waitForSelector('#topbar .ac-list b');
      await page.keyboard.press('Enter'); n++;
      await page.waitForFunction(() => /^#\/paciente\/\d+/.test(location.hash)); await idle();
      assert.match(await page.locator('#view h1').first().innerText(), /João/);
      assert.ok(n <= 3, `${n} ações`); return `${n} ações (Ctrl+K, escrever, Enter)`;
    });

    const tratLinha = d => page.locator(`#pf-body tr:has-text("${d}") [data-sel]`);
    await check('Feedback: erro de validação legível (FS > 100 €)', async () => {
      await nav('#/paciente/1/tratamentos'); await toasts();
      await tratLinha('Implante').check(); await idle();
      await page.click('[data-act="faturar"]'); await page.waitForSelector(modalTopo);
      await page.selectOption(`${modalTopo} select[name=tipo]`, 'FS');
      await page.locator(`${modalTopo} footer button.primary`).click();
      const t = await esperaToast(/./);
      assert.ok(t.err, 'o toast não é de erro');
      assert.match(t.t, /fatura simplificada|100/i); assert.doesNotMatch(t.t, /undefined|null|Error|Erro \d{3}|\[object/);
      await page.keyboard.press('Escape'); return `"${t.t.slice(0, 60)}…"`;
    });

    await check('Feedback: erro da API (400) mostra mensagem pt-PT', async () => {
      await fecharModais(); await toasts();
      await page.click('#btn-new-pac'); await page.waitForSelector(`${modalTopo} input[name=nome]`);
      await page.fill(`${modalTopo} input[name=nome]`, 'Teste NIF Errado');
      await page.fill(`${modalTopo} input[name=nif]`, '123456780');
      const resp = page.waitForResponse(r => r.url().includes('/api/t/pacientes') && r.request().method() === 'POST');
      await page.locator(`${modalTopo} footer button.primary`).click();
      aceita400 = true; const st = (await resp).status(); await page.waitForTimeout(100); aceita400 = false;
      assert.equal(st, 400, 'esperava 400 do servidor');
      const t = await esperaToast(/./);
      assert.ok(t.err); assert.match(t.t, /NIF inválido/); assert.doesNotMatch(t.t, /undefined|Error|Erro \d{3}|Bad Request/);
      await page.keyboard.press('Escape'); return `"${t.t}"`;
    });

    await check('Eficiência: FR a partir de tratamentos ≤ 5 passos', async () => {
      await fecharModais(); await nav('#/paciente/1'); await toasts(); let n = 0;
      await page.click('.tabs a[href$="/tratamentos"]'); n++; await idle();
      await tratLinha('Restauração').check(); n++; await idle();
      await page.click('[data-act="faturar"]'); n++; await page.waitForSelector(modalTopo);
      await page.locator(`${modalTopo} footer button.primary`).click(); n++;
      await page.waitForFunction(() => document.querySelectorAll('.modal-bg').length >= 2);
      await page.locator(`${modalTopo} footer button.primary`).click(); n++; // confirmação
      await esperaToast(/Fatura-recibo .* emitid/i);
      await page.keyboard.press('Escape'); await fecharModais();
      assert.ok(n <= 5, `${n} passos`); return `${n} passos (separador, seleção, FR, Emitir, Confirmar)`;
    });

    await check('Eficiência: perio só com teclado (Enter avança)', async () => {
      await nav('#/paciente/3/perio'); await toasts();
      const ps = page.locator('#pe-grid input[data-k="ps"]');
      await ps.first().focus();
      const vals = ['3', '2', '4', '5', '3', '2']; let teclas = 0;
      for (let i = 0; i < vals.length; i++) {
        await page.keyboard.type(vals[i]); await page.keyboard.press('Enter'); teclas += 2;
        const a = await page.evaluate(() => document.activeElement.getAttribute('aria-label'));
        assert.equal(a, await ps.nth(i + 1).getAttribute('aria-label'), `Enter no local ${i + 1} não avançou para o seguinte`);
      }
      const nSave = await tabAte(a => a.id === 'pe-save', 200, 'Shift+Tab'); // de volta ao botão Guardar
      await page.keyboard.press('Enter');
      await esperaToast(/Exame guardado/);
      const gravados = await page.locator('#pe-grid input[data-k="ps"]').evaluateAll(l => l.slice(0, 6).map(i => i.value));
      assert.deepEqual(gravados, vals);
      return `6 locais em ${teclas} teclas; Guardar a ${nSave} Shift+Tab`;
    });

    // ---------- teclado ----------
    await check('Teclado: foco visível (outline/box-shadow)', async () => {
      await nav('#/inicio');
      await page.evaluate(() => { document.activeElement?.blur(); window.scrollTo(0, 0); });
      const maus = [];
      for (let i = 0; i < 18; i++) {
        await page.keyboard.press('Tab');
        const r = await page.evaluate(() => {
          const a = document.activeElement; if (!a || a === document.body) return null;
          const s = getComputedStyle(a);
          const vis = (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (s.boxShadow && s.boxShadow !== 'none');
          return vis ? null : (a.id || a.tagName + '.' + a.className);
        });
        if (r) maus.push(r);
      }
      assert.equal(maus.length, 0, 'sem indicador: ' + maus.join(', ')); return '18 paragens de Tab com indicador';
    });

    await check('Teclado: marcação só com teclado', async () => {
      await nav('#/inicio'); await toasts();
      await page.evaluate(() => document.activeElement?.blur());
      const n1 = await tabAte(a => a.id === 'btn-new-marc', 100);
      await page.keyboard.press('Enter'); await page.waitForSelector(`${modalTopo} [data-pac]`); await page.waitForTimeout(60);
      assert.ok((await ativo()).inModal, 'o foco não entrou no modal');
      await page.keyboard.type('Pedro'); await page.waitForSelector(`${modalTopo} .ac-list b`); await page.keyboard.press('Enter');
      const n2 = await tabAte(a => a.name === 'hora', 30);
      await page.keyboard.type('1930');
      const n3 = await tabAte(a => a.inModal && a.tag === 'BUTTON' && a.txt === 'Guardar', 40);
      await page.keyboard.press('Enter'); await idle();
      if (await page.locator('.modal-bg').count() > 1) { await tabAte(a => a.txt === 'Gravar mesmo assim', 10); await page.keyboard.press('Enter'); }
      await esperaToast(/Marcação guardada/);
      return `Tabs: ${n1} até "Nova marcação", ${n2} até Hora, ${n3} até Guardar`;
    });

    await check('Teclado: modal prende o foco (Tab)', async () => {
      await fecharModais(); await nav('#/inicio');
      await page.focus('#btn-new-marc'); await page.keyboard.press('Enter'); await page.waitForSelector(modalTopo); await page.waitForTimeout(60);
      for (let i = 0; i < 40; i++) { await page.keyboard.press('Tab'); const a = await ativo(); assert.ok(a.inModal, `ao ${i + 1}.º Tab o foco saiu do modal (${a.tag}#${a.id})`); }
      return '40 Tabs dentro do modal';
    });

    await check('Teclado: Escape fecha o modal', async () => {
      if (!await page.locator('.modal-bg').count()) { await page.focus('#btn-new-marc'); await page.keyboard.press('Enter'); await page.waitForSelector(modalTopo); }
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('.modal-bg').count(), 0, 'o modal continua aberto');
    });

    await check('Teclado: foco volta ao botão que abriu o modal', async () => {
      await page.focus('#btn-new-marc'); await page.keyboard.press('Enter'); await page.waitForSelector(modalTopo); await page.waitForTimeout(60);
      await page.keyboard.press('Escape');
      const a = await ativo(); await fecharModais();
      assert.equal(a.id, 'btn-new-marc', `foco em ${a.tag}#${a.id}`);
    });

    await check('Teclado: FR a partir de tratamentos', async () => {
      await nav('#/paciente/1/tratamentos'); await toasts();
      await page.focus('#tr-new');
      // vai até à caixa do tratamento ainda por faturar (Destartarização)
      const alvo = await tratLinha('Destartarização').getAttribute('data-sel');
      await tabAte(a => a.sel === alvo, 30);
      await page.keyboard.press('Space'); await idle();
      const depois = await ativo();
      assert.notEqual(depois.tag, 'BODY', 'depois de marcar a caixa o foco foi para <body> (tabela redesenhada)');
      await tabAte(a => a.act === 'faturar', 60); await page.keyboard.press('Enter'); await page.waitForSelector(modalTopo);
      await tabAte(a => a.inModal && a.txt === 'Emitir', 60); await page.keyboard.press('Enter');
      await page.waitForFunction(() => document.querySelectorAll('.modal-bg').length >= 2);
      await tabAte(a => a.inModal && a.txt === 'Emitir', 10); await page.keyboard.press('Enter');
      await esperaToast(/emitid/);
    });
    await fecharModais();

    // ---------- feedback: cada gravação mostra toast ----------
    await check('Feedback: cada gravação mostra toast', async () => {
      const falhas = [];
      const tenta = async (nome, fn, re) => { try { await toasts(); await fn(); await esperaToast(re); } catch (e) { falhas.push(`${nome}: ${e.message.slice(0, 80)}`); } await fecharModais(); };
      await tenta('paciente', async () => {
        await page.click('#btn-new-pac'); await page.fill(`${modalTopo} input[name=nome]`, 'Paciente Toast');
        await page.locator(`${modalTopo} footer button.primary`).click();
      }, /Paciente guardado/);
      await tenta('tratamento', async () => {
        await nav('#/paciente/2/tratamentos'); await page.click('#tr-new');
        await page.fill(`${modalTopo} input[name=descricao]`, 'Consulta de teste'); await page.fill(`${modalTopo} input[name=preco]`, '20');
        await page.locator(`${modalTopo} footer button.primary`).click();
      }, /Tratamento guardado/);
      await tenta('anamnese', async () => { await nav('#/paciente/2/anamnese'); await page.fill('textarea[name=alergias]', 'Látex'); await page.click('#an-save'); }, /Anamnese guardada/);
      await tenta('nota clínica', async () => { await nav('#/paciente/2/notas'); await page.fill('#nt-txt', 'Nota de teste'); await page.click('#nt-add'); }, /Nota adicionada/);
      await tenta('configuração', async () => { await nav('#/config'); await page.locator('#cf-body button.primary').first().click(); }, /guardad/i);
      assert.equal(falhas.length, 0, falhas.join(' | '));
      return 'marcação, FR, perio (acima) + paciente, tratamento, anamnese, nota, configuração';
    });

    // ---------- caminhos com guardas (duplo clique, prefill, Esc, feriado, menus, Ctrl+S) ----------
    // conta os pedidos método+URL até se chamar a função devolvida
    const conta = (metodo, re) => { let n = 0; const f = r => { if (r.method() === metodo && re.test(r.url())) n++; }; page.on('request', f); return () => { page.off('request', f); return n; }; };

    await check('Robustez: duplo clique em Guardar exame (perio) → 1 POST', async () => {
      await nav('#/paciente/3/perio'); await page.selectOption('#pe-sel', 'novo'); await idle();
      assert.match(await page.locator('#pe-save').innerText(), /Guardar exame/);
      await page.locator('#pe-grid input[data-k="ps"]').first().fill('4');
      const fim = conta('POST', /\/api\/pacientes\/3\/perio$/);
      await page.dblclick('#pe-save'); await esperaToast(/Exame guardado/); await idle();
      const n = fim(); assert.equal(n, 1, `${n} POST`); return '1 POST';
    });

    await check('Eficiência: Nova marcação na consulta já traz o paciente (botão e Alt+N)', async () => {
      const m = (await page.evaluate(() => GET(`agenda?de=${isoDate()}&ate=${addDays(isoDate(), 7)}`)))[0];
      assert.ok(m, 'sem marcações na semana'); await nav('#/consulta/' + m.id);
      const vistos = [];
      for (const [modo, abrir] of [['botão', () => page.click('#btn-new-marc')], ['Alt+N', () => page.keyboard.press('Alt+N')]]) {
        await fecharModais(); await abrir(); await page.waitForSelector(`${modalTopo} [data-pac="paciente_id"]`);
        const [nome, id] = await page.evaluate(s => [document.querySelector(s + ' [data-pac="paciente_id"]').value, document.querySelector(s + ' input[name="paciente_id"]').value], modalTopo);
        assert.equal(nome, m.paciente_nome, `${modo}: paciente "${nome}"`); assert.equal(Number(id), m.paciente_id, `${modo}: paciente_id ${id}`);
        vistos.push(modo); await page.keyboard.press('Escape');
      }
      await fecharModais(); return `${vistos.join(' e ')} com ${m.paciente_nome}`;
    });

    await check('Agenda: Esc durante o arrasto (foco fora da grelha) cancela', async () => {
      await nav('#/inicio'); await page.evaluate(() => { AG.mode = 'dia'; AG.date = isoDate(); }); await nav('#/agenda');
      const ev = page.locator('#ag-body .ev').first(); await ev.scrollIntoViewIfNeeded();
      const id = Number(await ev.getAttribute('data-id'));
      const antes = await page.evaluate(id => GET('marcacoes/' + id), id);
      const b = await ev.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 5); await page.mouse.down();
      for (let i = 1; i <= 4; i++) await page.mouse.move(b.x + b.width / 2, b.y + 5 + i * 15);
      await page.evaluate(() => document.activeElement?.blur());
      await page.keyboard.press('Escape'); await page.mouse.up(); await idle();
      const modais = await page.locator('.modal-bg').count(); await fecharModais();
      const depois = await page.evaluate(id => GET('marcacoes/' + id), id);
      assert.equal(modais, 0, 'abriu a confirmação de remarcar depois do Esc');
      assert.equal(depois.inicio, antes.inicio, 'a marcação mudou de hora');
      return 'sem modal, marcação na mesma hora';
    });

    await check('Agenda: vaga num feriado avisa antes de abrir Nova marcação', async () => {
      const dia = await page.evaluate(() => addDays(isoDate(), 30));
      const { id } = await page.evaluate(d => POST('t/feriados', { nome: 'Feriado e2e', data: d, fixo: 0, ativo: 1 }), dia);
      try {
        await nav('#/inicio'); await page.evaluate(d => { AG.feriados = {}; AG.mode = 'dia'; AG.date = d; }, dia); await nav('#/agenda');
        await page.locator('.col').first().locator('.slot[data-t="10:00"]').click(); await page.waitForSelector(modalTopo); await idle();
        const txt = await page.locator(modalTopo).innerText();
        assert.match(txt, /feriado \(Feriado e2e\)/, 'o 1.º modal não é o aviso de feriado');
        assert.equal(await page.locator('[data-pac="paciente_id"]').count(), 0, 'o formulário abriu antes do aviso');
        await page.locator(`${modalTopo} footer button.primary`).click(); await page.waitForSelector(`${modalTopo} [data-pac="paciente_id"]`);
        return '"Marcar mesmo assim?" e só depois o formulário';
      } finally {
        await fecharModais(); await page.evaluate(async id => { await DEL('t/feriados/' + id); AG.feriados = {}; AG.date = isoDate(); }, id);
      }
    });

    await check('Teclado: menu "Mais ⋯" abre, Esc fecha e devolve o foco, clique fora fecha', async () => {
      await nav('#/agenda');
      const sum = page.locator('#view details.mais > summary'), aberto = () => page.evaluate(() => document.querySelector('#view details.mais').open);
      await sum.click(); assert.ok(await aberto(), 'não abriu');
      await page.keyboard.press('Escape'); assert.ok(!await aberto(), 'Esc não fechou');
      assert.ok(await page.evaluate(() => document.activeElement === document.querySelector('#view details.mais > summary')), `foco em ${JSON.stringify(await ativo())}`);
      await sum.click(); assert.ok(await aberto(), 'não reabriu');
      await page.click('#ag-title'); assert.ok(!await aberto(), 'clique fora não fechou');
      return 'abre, Esc → summary, clique fora fecha';
    });

    await check('Teclado: Ctrl+S nas notas clínicas grava 1 nota', async () => {
      await nav('#/paciente/2/notas'); await toasts();
      const antes = (await page.evaluate(() => GET('pacientes/2/notas'))).length;
      await page.fill('#nt-txt', 'Nota por Ctrl+S');
      const fim = conta('POST', /\/api\/notas$/);
      await page.keyboard.press('Control+s'); await page.keyboard.press('Control+s');
      await esperaToast(/Nota adicionada/); await idle();
      const n = fim(), depois = (await page.evaluate(() => GET('pacientes/2/notas'))).length;
      assert.equal(n, 1, `${n} POST`); assert.equal(depois - antes, 1, `${depois - antes} notas novas`);
      return '1 POST, 1 nota';
    });
    await toasts();

    // ---------- varrimento de rotas ----------
    const extra = [];
    await nav('#/config'); extra.push(...(await page.$$eval('[data-s]', l => l.map(b => '#/config/' + b.dataset.s))).filter(h => h !== '#/config/clinica'));
    await nav('#/listagens'); extra.push(...(await page.$$eval('a[href^="#/listagens/"]', l => l.map(a => a.getAttribute('href')))));
    const marc = await page.evaluate(() => GET(`agenda?de=${isoDate()}&ate=${addDays(isoDate(), 7)}`));
    const consulta = marc[0] ? ['#/consulta/' + marc[0].id] : [];
    const fichas = FICHA_TABS.map(t => `#/paciente/1/${t}`);
    const todas = [...ROTAS, ...consulta, ...fichas, ...new Set(extra)];

    const sondas = { cru: [], ids: [], nomes: [], icones: [], imgs: [], contraste: [] };
    const sonda = () => page.evaluate(() => {
      const vis = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'; };
      const root = document.querySelector('#app');
      const texto = root.innerText + ' ' + [...document.querySelectorAll('.modal-bg')].map(m => m.innerText).join(' ')
        + ' ' + [...root.querySelectorAll('input:not([type=hidden]), textarea')].map(i => i.value).join(' ');
      const cru = (texto.match(/\b(undefined|null|NaN)\b|\[object Object\]/g) || []);
      const ids = {}; for (const e of document.querySelectorAll('[id]')) ids[e.id] = (ids[e.id] || 0) + 1;
      const dup = Object.entries(ids).filter(([, n]) => n > 1).map(([k]) => k);
      const desc = e => `${e.tagName.toLowerCase()}${e.name ? '[name=' + e.name + ']' : ''}${e.id ? '#' + e.id : ''}`;
      const nomes = [...document.querySelectorAll('#app input:not([type=hidden]), #app select, #app textarea, .modal-bg input:not([type=hidden]), .modal-bg select, .modal-bg textarea')]
        .filter(vis).filter(e => !(e.getAttribute('aria-label') || e.getAttribute('aria-labelledby') || (e.labels && e.labels.length) || e.title || e.placeholder)).map(desc);
      const icones = [...document.querySelectorAll('button, a.btn')].filter(vis).filter(b => !b.textContent.trim() && b.querySelector('svg') && !b.getAttribute('aria-label') && !b.getAttribute('aria-labelledby')).map(b => b.outerHTML.slice(0, 60));
      const imgs = [...document.querySelectorAll('img')].filter(i => !i.hasAttribute('alt')).map(i => i.src.slice(0, 40));
      // contraste
      const parse = c => {
        let m = c.match(/^rgba?\(([^)]+)\)/); if (m) { const p = m[1].split(/[\s,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; }
        m = c.match(/^color\(srgb ([^)]+)\)/); if (m) { const p = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p[3] ?? 1 }; }
        return null;
      };
      const mix = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
      const fundo = el => { const cam = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { cam.push(c); if (c.a >= 1) break; } } return cam.reverse().reduce((b, c) => mix(c, b), { r: 255, g: 255, b: 255, a: 1 }); };
      const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
      const razao = el => { const bg = fundo(el); const fg = mix(parse(getComputedStyle(el).color) || { r: 0, g: 0, b: 0, a: 1 }, bg); const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x); return (a + 0.05) / (b + 0.05); };
      const alvos = [document.body, ...[...document.querySelectorAll('#view td, #view p, button:not(:disabled), a.btn')].filter(vis).filter(e => e.innerText.trim()).slice(0, 300)];
      const contraste = alvos.map(e => ({ r: razao(e), d: (e === document.body ? 'body' : `${e.tagName.toLowerCase()}.${String(e.className).split(' ')[0]} "${e.innerText.trim().slice(0, 20)}"`) })).filter(x => x.r < 4.5).map(x => `${x.d} ${x.r.toFixed(2)}`);
      return { cru: cru.length ? [...new Set(cru)].join(',') : '', dup, nomes, icones, imgs, contraste };
    });

    const tempos = [], lentas = [];
    for (const h of todas) {
      await fecharModais(); rotaAtual = h;
      const t0 = Date.now(); await nav(h); const ms = Date.now() - t0;
      tempos.push(ms); if (ms >= 1000) lentas.push(`${h} ${ms}ms`);
      const s = await sonda();
      if (s.cru) sondas.cru.push(`${h}: ${s.cru}`);
      if (s.dup.length) sondas.ids.push(`${h}: ${s.dup.join(',')}`);
      if (s.nomes.length) sondas.nomes.push(`${h}: ${s.nomes.length} (${s.nomes.slice(0, 3).join(' ')})`);
      if (s.icones.length) sondas.icones.push(`${h}: ${s.icones[0]}`);
      if (s.imgs.length) sondas.imgs.push(`${h}: ${s.imgs.join(',')}`);
      for (const c of s.contraste) if (!sondas.contraste.some(x => x.split(' "')[0].endsWith(c.split(' "')[0]))) sondas.contraste.push(`${h}: ${c}`); // um exemplo por classe
    }
    // modais principais também
    for (const [nome, abrir] of [['modal Nova marcação', () => page.click('#btn-new-marc')], ['modal Novo paciente', () => page.click('#btn-new-pac')]]) {
      await fecharModais(); await nav('#/inicio'); await abrir(); await page.waitForSelector(modalTopo); await idle();
      const s = await sonda();
      if (s.cru) sondas.cru.push(`${nome}: ${s.cru}`);
      if (s.nomes.length) sondas.nomes.push(`${nome}: ${s.nomes.length} (${s.nomes.slice(0, 3).join(' ')})`);
      if (s.dup.length) sondas.ids.push(`${nome}: ${s.dup.join(',')}`);
    }
    await fecharModais();
    const n = todas.length;
    const totalNomes = sondas.nomes.reduce((s, x) => s + Number(x.split(': ')[1].split(' ')[0]), 0);
    await check(`Feedback: sem "undefined/null/NaN/[object Object]" (${n} ecrãs)`, () => { assert.equal(sondas.cru.length, 0, sondas.cru.join(' | ')); });
    await check('Acessibilidade: sem ids duplicados', () => { assert.equal(sondas.ids.length, 0, sondas.ids.join(' | ')); });
    await check('Acessibilidade: campos com nome acessível', () => { assert.equal(sondas.nomes.length, 0, `${totalNomes} campos sem nome em ${sondas.nomes.length} ecrãs: ${sondas.nomes.slice(0, 3).join(' | ')}`); });
    await check('Acessibilidade: botões só com ícone têm aria-label', () => { assert.equal(sondas.icones.length, 0, sondas.icones.slice(0, 3).join(' | ')); });
    await check('Acessibilidade: imagens com alt', () => { assert.equal(sondas.imgs.length, 0, sondas.imgs.join(' | ')); });
    await check('Acessibilidade: contraste ≥ 4,5:1', () => { assert.equal(sondas.contraste.length, 0, sondas.contraste.join(' | ')); });
    await check('Desempenho: cada rota principal < 1 s', () => { assert.equal(lentas.length, 0, lentas.join(', ')); return `máx. ${Math.max(...tempos)} ms em ${n} ecrãs`; });

    // ---------- responsivo ----------
    for (const [w, hh] of [[1024, 768], [1366, 768]]) {
      await check(`Responsivo: sem scroll horizontal a ${w}×${hh}`, async () => {
        await page.setViewportSize({ width: w, height: hh }); const maus = [];
        for (const h of [...ROTAS, '#/paciente/1/resumo', '#/paciente/1/perio', '#/paciente/1/odontograma']) {
          await nav(h);
          const r = await page.evaluate(() => [document.documentElement.scrollWidth - document.documentElement.clientWidth, document.querySelector('#main').scrollWidth - document.querySelector('#main').clientWidth]);
          if (Math.max(...r) > 1) maus.push(`${h} +${Math.max(...r)}px`);
        }
        assert.equal(maus.length, 0, maus.join(', '));
      });
    }
    await check('Responsivo: alvos de toque ≥ 32px (tablet)', async () => {
      // ecrã tátil (pointer: coarse), como num tablet: é aí que as regras de toque do app.css se aplicam
      const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
      assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches), 'emulação de toque ativa');
      await page.setViewportSize({ width: 1024, height: 768 }); const maus = []; let total = 0;
      for (const h of ['#/inicio', '#/agenda', '#/pacientes', '#/paciente/1/tratamentos', '#/faturacao']) {
        await nav(h);
        const r = await page.evaluate(() => [...document.querySelectorAll('#app button, #app a, #app input:not([type=hidden]):not([type=checkbox]), #app select')]
          .map(e => [e, e.getBoundingClientRect()]).filter(([, b]) => b.width > 0 && b.height > 0)
          .map(([e, b]) => ({ ok: b.height >= 32 && b.width >= 32, d: `${e.tagName.toLowerCase()} "${(e.innerText || e.name || '').trim().slice(0, 14)}" ${Math.round(b.width)}×${Math.round(b.height)}` })));
        total += r.length; maus.push(...r.filter(x => !x.ok).map(x => `${h} ${x.d}`));
      }
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: false }); await cdp.detach();
      assert.equal(maus.length, 0, `${maus.length}/${total} alvos pequenos, ex.: ${maus.slice(0, 3).join(' | ')}`);
    });
    await page.setViewportSize({ width: 1366, height: 768 });

    // ---------- robustez ----------
    await check('Robustez: voltar/avançar funciona', async () => {
      await nav('#/agenda'); await nav('#/pacientes'); await nav('#/paciente/1/tratamentos');
      await page.goBack(); await idle();
      assert.equal(await page.evaluate(() => location.hash), '#/pacientes'); await page.waitForSelector('#pl-q', { timeout: 2000 });
      await page.goBack(); await idle();
      assert.equal(await page.evaluate(() => location.hash), '#/agenda'); await page.waitForSelector('#ag-body', { timeout: 2000 });
      await page.goForward(); await page.goForward(); await idle();
      assert.equal(await page.evaluate(() => location.hash), '#/paciente/1/tratamentos'); await page.waitForSelector('#tr-new', { timeout: 2000 });
    });
    await check('Robustez: recarregar mantém a rota', async () => {
      await nav('#/paciente/1/perio'); await page.reload(); await page.waitForSelector('#pe-grid', { timeout: 3000 });
      assert.equal(await page.evaluate(() => location.hash), '#/paciente/1/perio');
    });
    await check('Robustez: sem erros na consola nem pageerror', () => { assert.equal(erros.length, 0, `${erros.length}: ${erros.slice(0, 3).join(' | ')}`); return `${todas.length} ecrãs + fluxos`; });
  } finally {
    await browser.close(); proc.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }

  // ---------- tabela ----------
  const linhas = resultados.map(r => {
    const conhecido = !r.ok && CONHECIDOS[r.nome];
    return { estado: r.ok ? (CONHECIDOS[r.nome] ? 'ok (retirar dos conhecidos)' : 'ok') : conhecido ? 'conhecido' : 'FALHA', nome: r.nome, det: r.det };
  });
  const w = Math.max(...linhas.map(l => l.nome.length));
  console.log('\nTestes de usabilidade\n' + '-'.repeat(w + 40));
  for (const l of linhas) console.log(`${l.estado.padEnd(10)} ${l.nome.padEnd(w)}  ${l.det}`);
  const conh = linhas.filter(l => l.estado === 'conhecido');
  if (conh.length) { console.log('\nProblemas conhecidos (não falham a execução):'); for (const l of conh) console.log(`- ${l.nome}: ${CONHECIDOS[l.nome]}`); }
  const falhas = linhas.filter(l => l.estado === 'FALHA').length;
  console.log(`\n${linhas.filter(l => l.estado.startsWith('ok')).length} ok · ${conh.length} conhecidos · ${falhas} falhas`);
  process.exitCode = falhas ? 1 : 0;
}

main().catch(e => { console.error(e); process.exitCode = 1; });
