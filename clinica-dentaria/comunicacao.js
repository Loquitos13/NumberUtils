'use strict';
// Envio de e-mail (SMTP) e SMS (Twilio ou API HTTP genérica), sem dependências externas.
const net = require('node:net');
const tls = require('node:tls');
const os = require('node:os');
const crypto = require('node:crypto');

// ---------- SMTP ----------
function smtpSessao(sock) {
  let buf = ''; const fila = [];
  const onData = d => {
    buf += d.toString('utf8');
    let m;
    // resposta completa: última linha "NNN texto"
    while ((m = buf.match(/^(?:\d{3}-[^\r\n]*\r?\n)*\d{3}(?: [^\r\n]*)?\r?\n/))) {
      const bloco = m[0]; buf = buf.slice(bloco.length);
      const linhas = bloco.trim().split(/\r?\n/);
      const r = { code: Number(linhas[linhas.length - 1].slice(0, 3)), text: linhas.join('\n') };
      const w = fila.shift(); if (w) w(r);
    }
  };
  sock.on('data', onData);
  const ler = () => new Promise(res => fila.push(res));
  return {
    ler,
    async cmd(linha, esperado) {
      const p = ler();
      sock.write(linha + '\r\n');
      const r = await p;
      if (esperado && !esperado.includes(r.code)) throw new Error(`SMTP: "${linha.split(' ')[0]}" recusado — ${r.text}`);
      return r;
    },
    desligar() { sock.removeListener('data', onData); },
  };
}

const b64 = s => Buffer.from(String(s), 'utf8').toString('base64');
const hdr = s => /^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${b64(s)}?=`;
function quebra76(s) { return s.replace(/.{1,76}/g, '$&\r\n'); }

async function enviarEmail(cfg, { para, assunto, html, texto, anexos = [] }) {
  if (!cfg.smtp_host || !cfg.smtp_de) throw new Error('E-mail não configurado (Configuração → E-mail e SMS)');
  if (!para || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) throw new Error('Endereço de e-mail inválido');
  const port = Number(cfg.smtp_porta) || (cfg.smtp_seguranca === 'ssl' ? 465 : 587);
  const seg = cfg.smtp_seguranca || 'starttls';
  const host = cfg.smtp_host;
  let sock = await new Promise((res, rej) => {
    const s = seg === 'ssl' ? tls.connect({ host, port, servername: host }, () => res(s)) : net.connect({ host, port }, () => res(s));
    s.setTimeout(20000, () => { s.destroy(new Error('SMTP: tempo de espera esgotado')); });
    s.once('error', rej);
  });
  let ses = smtpSessao(sock);
  try {
    let r = await ses.ler(); if (r.code !== 220) throw new Error('SMTP: ' + r.text);
    const ehlo = 'EHLO ' + (os.hostname().replace(/[^a-zA-Z0-9.-]/g, '') || 'clinica');
    r = await ses.cmd(ehlo, [250]);
    if (seg === 'starttls') {
      if (!/STARTTLS/i.test(r.text)) throw new Error('O servidor SMTP não suporta STARTTLS. Escolha SSL ou "sem cifra".');
      await ses.cmd('STARTTLS', [220]);
      ses.desligar();
      sock = await new Promise((res, rej) => { const s = tls.connect({ socket: sock, servername: host }, () => res(s)); s.once('error', rej); });
      ses = smtpSessao(sock);
      r = await ses.cmd(ehlo, [250]);
    }
    if (cfg.smtp_utilizador) {
      await ses.cmd('AUTH LOGIN', [334]);
      await ses.cmd(b64(cfg.smtp_utilizador), [334]);
      await ses.cmd(b64(cfg.smtp_password || ''), [235]);
    }
    const de = cfg.smtp_de;
    await ses.cmd(`MAIL FROM:<${de}>`, [250]);
    await ses.cmd(`RCPT TO:<${para}>`, [250, 251]);
    await ses.cmd('DATA', [354]);
    const fronteira = 'b' + crypto.randomBytes(12).toString('hex');
    const alt = 'a' + crypto.randomBytes(12).toString('hex');
    const nome = cfg.smtp_nome || cfg.clinica_nome || '';
    const corpoTexto = texto || String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ');
    let msg = [
      `From: ${nome ? `${hdr(nome)} <${de}>` : de}`, `To: <${para}>`, `Subject: ${hdr(assunto || '')}`,
      `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`, `Message-ID: <${crypto.randomUUID()}@${de.split('@')[1]}>`,
      'MIME-Version: 1.0', `Content-Type: multipart/mixed; boundary="${fronteira}"`, '',
      `--${fronteira}`, `Content-Type: multipart/alternative; boundary="${alt}"`, '',
      `--${alt}`, 'Content-Type: text/plain; charset=utf-8', 'Content-Transfer-Encoding: base64', '', quebra76(b64(corpoTexto)),
      `--${alt}`, 'Content-Type: text/html; charset=utf-8', 'Content-Transfer-Encoding: base64', '', quebra76(b64(html || corpoTexto.replace(/\n/g, '<br>'))),
      `--${alt}--`,
    ].join('\r\n');
    for (const a of anexos) {
      msg += `\r\n--${fronteira}\r\nContent-Type: ${a.tipo || 'application/octet-stream'}; name="${hdr(a.nome)}"\r\nContent-Disposition: attachment; filename="${hdr(a.nome)}"\r\nContent-Transfer-Encoding: base64\r\n\r\n${quebra76(Buffer.from(a.conteudo).toString('base64'))}`;
    }
    msg += `\r\n--${fronteira}--\r\n`;
    // "dot-stuffing": linhas começadas por "." passam a ".."
    msg = msg.replace(/\r\n\./g, '\r\n..');
    await ses.cmd(msg + '\r\n.', [250]);
    await ses.cmd('QUIT').catch(() => {});
  } finally { sock.end(); }
}

// ---------- SMS ----------
function normalizarTelefone(t, indicativo = '351') {
  let s = String(t || '').replace(/[^\d+]/g, '');
  if (!s) return '';
  if (s.startsWith('00')) s = '+' + s.slice(2);
  if (!s.startsWith('+')) s = (s.length === 9 ? '+' + indicativo : '+') + s;
  return s;
}

async function enviarSMS(cfg, { para, texto }) {
  const prov = cfg.sms_fornecedor || '';
  const to = normalizarTelefone(para, cfg.sms_indicativo || '351');
  if (!prov) throw new Error('SMS não configurado (Configuração → E-mail e SMS)');
  if (!/^\+\d{8,15}$/.test(to)) throw new Error('Número de telemóvel inválido');
  let r;
  if (prov === 'twilio') {
    if (!cfg.sms_conta || !cfg.sms_token || !cfg.sms_remetente) throw new Error('Twilio: falta conta, token ou remetente');
    r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(cfg.sms_conta)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${cfg.sms_conta}:${cfg.sms_token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: cfg.sms_remetente, Body: texto }),
    });
  } else if (prov === 'http') {
    if (!cfg.sms_url) throw new Error('Indique o URL da API de SMS');
    const sub = (tpl, enc) => String(tpl || '').replace(/\{(para|numero|texto|remetente|token)\}/g, (m, k) => {
      const v = String({ para: to, numero: to.replace(/^\+/, ''), texto, remetente: cfg.sms_remetente || '', token: cfg.sms_token || '' }[k]);
      return enc === 'json' ? JSON.stringify(v).slice(1, -1) : encodeURIComponent(v);
    });
    const metodo = (cfg.sms_metodo || 'POST').toUpperCase();
    const headers = {};
    if (cfg.sms_token && cfg.sms_auth_header) headers[cfg.sms_auth_header] = (cfg.sms_auth_prefixo ? cfg.sms_auth_prefixo + ' ' : '') + cfg.sms_token;
    let body;
    if (metodo !== 'GET' && cfg.sms_corpo) {
      // modelo JSON: valores escapados para JSON; senão form-urlencoded: valores codificados (& e = não injetam parâmetros)
      body = sub(cfg.sms_corpo, 'json');
      try { JSON.parse(body); headers['Content-Type'] = 'application/json'; } catch { body = sub(cfg.sms_corpo); headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
    }
    r = await fetch(sub(cfg.sms_url), { method: metodo, headers, body });
  } else throw new Error('Fornecedor de SMS desconhecido');
  const txt = await r.text();
  if (!r.ok) throw new Error(`SMS recusado (${r.status}): ${txt.slice(0, 200)}`);
  return txt.slice(0, 200);
}

function renderModelo(texto, ctx) {
  return String(texto || '').replace(/\{(\w+)\}/g, (m, k) => (ctx[k] !== undefined && ctx[k] !== null ? ctx[k] : m));
}

module.exports = { enviarEmail, enviarSMS, renderModelo };
