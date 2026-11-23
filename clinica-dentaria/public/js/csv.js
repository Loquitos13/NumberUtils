'use strict';
// Leitor de CSV partilhado: servidor (importar.js) e browser (pré-visualização da importação).

// Lê CSV para uma lista de linhas (listas de campos). Separador ';' ou ',' pelo que aparece mais na 1.ª linha (fora de aspas).
// As aspas só abrem um campo no início dele; a meio são texto. Aspas por fechar no fim → erro.
function parseCsv(texto) {
  texto = texto.replace(/^﻿/, '');
  const cab = texto.replace(/"(?:[^"]|"")*"/g, '').split(/\r?\n/, 1)[0];
  const sep = (cab.match(/;/g) || []).length >= (cab.match(/,/g) || []).length ? ';' : ',';
  const linhas = []; let linha = [], campo = '', aspas = false, inicio = true;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c !== '"') campo += c;
      else if (texto[i + 1] === '"') { campo += '"'; i++; }
      else aspas = false;
    } else if (c === '"' && inicio) { aspas = true; inicio = false; continue; }
    else if (c === sep) { linha.push(campo); campo = ''; inicio = true; continue; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = ''; inicio = true; continue;
    } else campo += c;
    inicio = false;
  }
  if (aspas) throw new Error('CSV inválido: aspas por fechar');
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  return linhas;
}

if (typeof module !== 'undefined') module.exports = { parseCsv };
