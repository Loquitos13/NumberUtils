'use strict';
// Escritor ZIP mínimo (sem dependências) para a cópia de segurança: abre no Explorador do Windows.
// Cada ficheiro é lido duas vezes do disco (CRC e depois dados), por isso nada fica todo em memória.
// shortcut: sem compressão (método 0) e sem ZIP64: total < 4 GB e < 65535 ficheiros; acima disso, passar a ZIP64.
const fs = require('node:fs');
const zlib = require('node:zlib');
const { pipeline } = require('node:stream/promises');

const LIMITE = 0xffffffff;

async function crcDe(fh, tam) { let c = 0; for await (const b of fh.createReadStream({ start: 0, end: tam - 1, autoClose: false })) c = zlib.crc32(b, c); return c; }

function dataDos(d = new Date()) {
  return { hora: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), dia: ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

// entradas: [{ nome: 'pasta/ficheiro', ficheiro: caminho no disco }]. Lança antes de escrever se exceder os limites.
function verificar(entradas) {
  const total = entradas.reduce((s, e) => s + fs.statSync(e.ficheiro).size + 100 + 2 * Buffer.byteLength(e.nome), 0);
  if (total >= LIMITE || entradas.length >= 0xffff) throw new Error('Cópia de segurança demasiado grande para ZIP sem ZIP64 (4 GB / 65535 ficheiros)');
}

// Cada ficheiro é aberto uma vez (tamanho, CRC e dados vêm do mesmo descritor); um ficheiro apagado entretanto é ignorado.
// Devolve o número de ficheiros escritos.
async function escrever(out, entradas) {
  const { hora, dia } = dataDos(), central = [];
  let off = 0, n = 0;
  async function* partes() {
    for (const e of entradas) {
      let fh;
      try { fh = await fs.promises.open(e.ficheiro); } catch (x) { if (x.code === 'ENOENT') continue; throw x; }
      try {
        const nome = Buffer.from(e.nome), tam = (await fh.stat()).size, crc = tam ? await crcDe(fh, tam) : 0;
        const h = Buffer.alloc(30);
        h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); // UTF-8
        h.writeUInt16LE(0, 8); h.writeUInt16LE(hora, 10); h.writeUInt16LE(dia, 12);
        h.writeUInt32LE(crc, 14); h.writeUInt32LE(tam, 18); h.writeUInt32LE(tam, 22); h.writeUInt16LE(nome.length, 26);
        yield Buffer.concat([h, nome]);
        if (tam) yield* fh.createReadStream({ start: 0, end: tam - 1, autoClose: false });
        const c = Buffer.alloc(46);
        c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8);
        c.writeUInt16LE(0, 10); c.writeUInt16LE(hora, 12); c.writeUInt16LE(dia, 14);
        c.writeUInt32LE(crc, 16); c.writeUInt32LE(tam, 20); c.writeUInt32LE(tam, 24); c.writeUInt16LE(nome.length, 28);
        c.writeUInt32LE(off, 42);
        central.push(c, nome); off += 30 + nome.length + tam; n++;
      } finally { await fh.close(); }
    }
    const cd = Buffer.concat(central), fim = Buffer.alloc(22);
    fim.writeUInt32LE(0x06054b50, 0); fim.writeUInt16LE(n, 8); fim.writeUInt16LE(n, 10);
    fim.writeUInt32LE(cd.length, 12); fim.writeUInt32LE(off, 16);
    yield Buffer.concat([cd, fim]);
  }
  await pipeline(partes, out);
  return n;
}

module.exports = { verificar, escrever };
