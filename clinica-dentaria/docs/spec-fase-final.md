# Spec — fase final (o que faltava face ao NoviGest)

## Problema
A OralSaúde vai deixar o NoviGest. A app já tem a agenda, a ficha, o odontograma, a faturação e as mensagens. Faltam quatro coisas que a equipa usa no dia a dia ou de que precisa para mudar de programa: o periodontograma, os ficheiros do paciente (RX, fotos, consentimentos assinados), uma anamnese que a clínica possa configurar, e a importação dos pacientes que já tem.

## Regras para todas as partes
- Node ≥22.13, **sem dependências**. node:sqlite, vanilla JS, sem CDN.
- Estilo do código existente: CRUD em `server.js`, esquema e migrações em `db.js` (`CREATE TABLE IF NOT EXISTS` + `MIGRACOES`), UI com `route()`, `fld`, `inp`, `table`, `modal`, `act`, `toast`, de `public/js/core.js`. Interface em pt-PT, densa, tokens de cor de `app.css`. Não inventar cores nem logótipo.
- Pôr a lógica nova num **ficheiro próprio** (servidor e cliente). Em `server.js`, `db.js`, `index.html`, `pacientes.js` e `config.js` só se mexe nos pontos de ligação: um `case` no router, uma tabela, uma tag `<script>`, um separador, uma secção. Assim as quatro partes juntam-se sem conflitos.
- Toda a entrada do utilizador é validada no servidor. Toda a alteração fica registada com `D.log`.
- Testes com `node:test`, na superfície HTTP (`/api/...`) e numa base de dados temporária, como em `test/financeiro.test.js`. Esta é a superfície de teste combinada para as quatro partes.

## 1. Periodontograma
**Histórias.** O médico regista, para cada dente, 6 locais (MV, V, DV, ML, L, DL): profundidade de sondagem, recessão (o nível de inserção é calculado), hemorragia e placa. Regista também, por dente, a mobilidade (0–3), a furca (0–3) e se o dente está ausente. Guarda cada exame com a data e o médico e compara-o com o anterior. Vê o índice de placa, o índice de hemorragia, a profundidade média e o número de locais com 4 mm ou mais, e imprime o exame.
**Decisões.**
- Tabela `perio_exames` (id, paciente_id, data, medico_id, dados TEXT com o JSON por dente FDI, notas, criado_em).
- API: `GET/POST /api/pacientes/:id/perio`, `GET/PUT/DELETE /api/perio/:id`.
- Os índices são calculados no servidor e devolvidos com o exame: `{placa_pct, hemorragia_pct, ps_media, locais_4mm}`. Os dentes ausentes não contam.
- Valores aceites: profundidade de sondagem 0–15, recessão −5 a 15, os restantes como acima. Um valor fora destes limites dá 400.
- No cliente: separador "Periodontograma" na ficha, em `public/js/perio.js`. A grelha mostra o maxilar e a mandíbula, vestibular e lingual, com entrada rápida por teclado (Tab/Enter avança para o local seguinte) e cores para valores ≥4 e ≥6. Há um seletor para escolher o exame com que se compara.

## 2. Ficheiros do paciente (RX, fotos, documentos)
**Histórias.** A receção e o médico carregam ficheiros para a ficha (JPG, PNG, WebP, PDF, até 20 MB), escolhem uma categoria (RX, Foto intraoral, Consentimento, Relatório, Outro), escrevem uma descrição, e opcionalmente o dente e a data. Os ficheiros aparecem numa grelha de miniaturas com filtro por categoria. Abrem-se num visualizador com zoom (as imagens) ou num separador novo (os PDF). Um ficheiro pode ser apagado, com confirmação, e isso fica registado.
**Decisões.**
- Os ficheiros ficam em `DATA_DIR/anexos/<paciente_id>/<id aleatório>.<ext>`, fora de `public/`. A base de dados só guarda os metadados: tabela `anexos` (id, paciente_id, nome_original, ficheiro, mime, tamanho, categoria, descricao, dente, data, criado_por, criado_em).
- Upload: `POST /api/pacientes/:id/anexos` com o corpo **binário** e os metadados na query ou nos cabeçalhos. É uma exceção ao `readBody` JSON de 5 MB e tem o seu próprio limite de 20 MB.
- O tipo é confirmado pela assinatura (os primeiros bytes) e não pela extensão. O nome guardado é aleatório, nunca o nome que veio do utilizador.
- Download: `GET /api/anexos/:id/ficheiro`, só com sessão iniciada, com `Content-Type` correto e `Content-Disposition`. Nunca serve caminhos fora de `anexos/`.
- A lista e a edição dos metadados passam pelo CRUD. O DELETE apaga também o ficheiro do disco.
- A cópia de segurança passa a avisar que os anexos estão em `data/anexos` e têm de ser copiados à parte. Mudar o backup para incluir os anexos fica para depois.

## 3. Anamnese configurável
**Histórias.** O administrador define as perguntas da anamnese em Configuração → Anamnese: o texto, o tipo (sim/não, texto, escolha), as opções, se a pergunta é um alerta clínico, a ordem e se está ativa. Na ficha, o médico responde a essas perguntas, além dos campos que já existem. As respostas "sim" às perguntas de alerta aparecem na faixa vermelha de alertas da ficha e da consulta. Desativar uma pergunta não apaga as respostas que já foram dadas.
**Decisões.**
- Tabelas `anamnese_perguntas` (id, texto, tipo `sn|texto|escolha`, opcoes, alerta, ordem, ativo) e `anamnese_respostas` (paciente_id, pergunta_id, valor, PK composta).
- Os campos fixos da tabela `anamnese` continuam como estão. O sistema já está em produção e isto mantém a compatibilidade.
- API: CRUD de perguntas (só o administrador pode criar, alterar e apagar). `GET/PUT /api/pacientes/:id/anamnese-extra` devolve e grava as respostas.
- O resumo do paciente (`/pacientes/:id/resumo`) passa a incluir `alertas_extra: [texto]`.
- Seed: 4 perguntas úteis que ainda não existem nos campos fixos (Bifosfonatos, Problemas de coagulação, Próteses articulares, Epilepsia), todas sim/não e todas alerta.

## 4. Importação de pacientes (CSV) — migração do NoviGest
**Histórias.** O administrador escolhe um CSV exportado do NoviGest ou do Excel (separado por `;` ou `,`, em UTF-8 ou Windows-1252, com ou sem aspas). Vê as primeiras linhas, associa cada coluna a um campo da ficha (com sugestão automática pelo nome do cabeçalho) e corre primeiro uma simulação. A simulação diz quantos pacientes vão ser criados, quantos já existem e serão ignorados (pelo NIF ou pelo n.º de processo) e quais as linhas com erro, e porquê. Depois importa, e a importação é tudo ou nada.
**Decisões.**
- Parser de CSV próprio (`importar.js`) com aspas, aspas duplicadas, quebras de linha dentro de aspas, BOM e deteção do separador. Deteção do encoding: se o texto não for UTF-8 válido, é tratado como latin1/cp1252.
- Campos que podem ser associados: os da tabela `pacientes`. As datas são aceites em `dd/mm/aaaa` e `aaaa-mm-dd`. O NIF é validado com `validarNif` e um NIF inválido é erro da linha, não da importação.
- API (só o administrador): `POST /api/importar/pacientes` com `{csv (texto ou base64), mapa, simular: true|false}`. Devolve `{criados, ignorados, erros:[{linha, motivo}]}`. A importação real corre numa transação.
- Os n.º de processo do ficheiro são mantidos. Os pacientes sem número recebem o número seguinte.
- No cliente: Configuração → Importar pacientes, em `public/js/importar.js`.

## Fora de âmbito
- A faturação certificada pela AT e o SAF-T: continuam a precisar de um fornecedor certificado.
- Importar do PostgreSQL do NoviGest diretamente: espera-se uma cópia da base de dados.
- Os anexos dentro da cópia de segurança.
