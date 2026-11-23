# Gestão de Clínica de Medicina Dentária

Aplicação web completa para gerir uma clínica dentária: corre num computador da clínica (servidor) e é usada no browser de qualquer posto da rede local, incluindo tablets.

**Sem dependências externas:** só precisa do [Node.js](https://nodejs.org) 22.13 ou superior. A base de dados (SQLite) é um único ficheiro em `data/clinica.db`.

## Instalar e iniciar

### Windows
1. Instale o Node.js LTS (versão 22 ou superior) a partir de https://nodejs.org.
2. Copie a pasta `clinica-dentaria` para o computador que vai funcionar como servidor (ex.: `C:\ClinicaDentaria`).
3. Faça duplo clique em **`iniciar.bat`**. O browser abre em `http://localhost:3000`.
4. Nos outros postos, abra o endereço que aparece na janela do servidor (ex.: `http://192.168.1.20:3000`).

### Linux / macOS
```bash
cd clinica-dentaria
npm start            # ou: node server.js
```
Variáveis opcionais: `PORT=8080` (porta) e `DATA_DIR=/caminho` (pasta da base de dados).

### Primeiro acesso
No primeiro arranque a app cria o utilizador **`admin`** com uma **palavra-passe aleatória**, que aparece na janela do servidor e fica guardada em `data/PRIMEIRO-ACESSO.txt`. No primeiro login é obrigatório escolher uma palavra-passe nova (mínimo 8 caracteres); o ficheiro é apagado nesse momento. Depois, em *Configuração → Utilizadores*, crie as contas da equipa — cada pessoa define a sua palavra-passe no primeiro acesso.

Segurança: 5 tentativas falhadas bloqueiam esse posto durante 10 minutos; as sessões expiram ao fim de 12 horas.

A base de dados nova começa **vazia** (só com a tabela de tratamentos/preços, estados, feriados, IVA e modelos de mensagem). Para experimentar com dados fictícios, arranque com `DEMO=1 node server.js` numa pasta de dados separada (`DATA_DIR=...`).

### Testes
`npm test` corre os testes automáticos da faturação, recibos, saldos e permissões (numa base de dados temporária).

## Módulos

| Módulo | Funcionalidades |
|---|---|
| **Início** | Consultas do dia, recebimentos, próteses em atraso, alertas de stock, aniversários, atalhos |
| **Agenda** | Vista diária por médico, semanal, por gabinete e lista; marcação com um clique; cores por estado; deteção de sobreposições (médico e gabinete), feriados e bloqueios; **bloqueios de agenda** (férias, congressos, ausências, clínica fechada); **pesquisa de vagas** (1 ou 2 médicos em simultâneo, manhã/tarde/noite, horas mín./máx., dias da semana, feriados); **lista de espera**; mensagem global; presença/falta rápida; lembretes SMS; impressão |
| **Pacientes** | Ficha completa (título, NIF validado, SNS, CC, nacionalidade, idioma, contacto de emergência, entidade/seguro, RGPD, consentimento SMS/e-mail), **foto**, **agregado familiar**, assiduidade (realizadas/faltas/desmarcadas), saldo/crédito/por realizar, registo de quem alterou e quando, pesquisa rápida global (Ctrl+K), exportação |
| **Consulta** | Ecrã próprio para cada marcação: odontograma com **todos os tratamentos visíveis** (lista por especialidade com pesquisa) e **atalhos** para os mais usados (definidos em Configuração ou aprendidos pelo uso); seleção de dentes e faces; **Necessário** fica registado no plano do paciente sem obrigar a marcação; **Feito nesta consulta** fica ligado à consulta; plano com "Feito" ou **"Agendar"** (cria a marcação já com duração e notas); previsto para a consulta; notas; estados; faturar o que foi feito |
| **Ficha clínica** | Resumo, **odontograma** interativo (dentição permanente e decídua, faces, condições: cárie, restauração, ausente, endodontia, coroa, implante, etc.), plano de tratamentos, anamnese com alertas (alergias, anticoagulantes…), notas clínicas, histórico de marcações, impressão da ficha |
| **Anamnese** (na ficha) | Perguntas definidas pelo administrador (*Configuração → Anamnese*): sim/não, texto ou escolha; as marcadas como alerta aparecem destacadas na ficha |
| **Periodontograma** (na ficha) | Exames periodontais com 6 locais por dente (profundidade de sondagem, recessão, hemorragia, placa, mobilidade, furca, dente ausente); índices calculados (% placa, % hemorragia, profundidade média, locais ≥ 4 mm) |
| **Anexos** (na ficha) | RX, fotografias, consentimentos e relatórios do paciente (categoria, dente, descrição), guardados em `data/anexos/` |
| **Faturação** | Documentos do SAF-T aplicáveis à clínica: **Fatura-Recibo (FR)**, **Fatura (FT)**, **Fatura Simplificada (FS**, até 100 € em serviços — art. 40.º CIVA), **Nota de Débito (ND)** e **Nota de Crédito (NC)** sempre com referência ao documento de origem, **Recibo (RC)** que liquida uma ou várias faturas, **Fatura Pró-forma (PF)** convertível em fatura-recibo; numeração por série/ano; motivo de isenção de IVA; conta corrente e extrato; saldos; fecho de caixa; anulação com motivo. Na lista de tratamentos do paciente cada linha tem a cor do seu estado — **necessário, orçamentado, feito por faturar, faturado por pagar, pago** — e os documentos emitem-se diretamente a partir da seleção |
| **Orçamentos** (em Faturação) | Criação a partir do plano de tratamento, impressão com espaço para assinatura, aceitar (gera/associa o plano), recusar, validade |
| **Próteses** | Trabalhos de laboratório com fases (pedido → enviado → prova → recebido → entregue), atrasos, guia para o laboratório |
| **Stocks** | Produtos, armazéns, entradas/saídas/ajustes/transferências, lotes e validades, alertas de stock mínimo/ideal e validade, quantidade a encomendar |
| **Relatórios → Listagens** | Agenda: marcações por médico, entidade, utilizador ou paciente; por confirmar; remarcações/desmarcações; faltas; ocupação da agenda; férias e ausências; lista de espera. Conta corrente: mapa de caixa (por meio de pagamento, utilizador, médico), movimentos globais, comissões, produção, pendentes. Orçamentos: pendentes, aprovados, recusados, sem efeito. Tudo com subtotais, exportação para Excel (CSV) e impressão |
| **Relatórios → Estatísticas** | Marcações por estado e médico, taxa de faltas, faturação mensal, faturação e comissões por médico, recebimentos por método, tratamentos mais realizados, razões da 1.ª visita |
| **Comunicação** | **Envio real de SMS e e-mail**: confirmação automática ao criar a marcação, **lembretes automáticos** X horas antes da consulta, avisos manuais a partir da marcação ou da agenda, aniversários, faltas, revisões; envio de faturas e recibos por e-mail; modelos com assunto e variáveis; histórico com canal, estado e erro. E-mail por SMTP (Microsoft 365, Gmail, servidor próprio); SMS pela Twilio ou por qualquer fornecedor com API HTTP. Só envia a pacientes com consentimento na ficha |
| **Configuração** | Dados da empresa (NIF, capital social, CRC, ERS, IBAN, representante legal, região fiscal), **tabela de IVA** (taxas PT, Açores e Madeira, códigos ISE/RED/INT/NOR e motivos de isenção M01–M99, impressos nos documentos), dados da clínica, horário e dias da agenda, feriados (Páscoa, Sexta-feira Santa, Corpo de Deus e Carnaval calculados automaticamente), médicos (cor, comissão), tabela de tratamentos e preços, especialidades, gabinetes, estados das consultas, razões da 1.ª visita, entidades/seguros com desconto, laboratórios, armazéns, utilizadores e perfis, registo de atividade, cópia de segurança, **importação de pacientes (CSV)** |

## Notas importantes

- **Faturação certificada:** em Portugal, as faturas com validade fiscal têm de ser emitidas por software certificado pela AT (com assinatura/hash, QR code, ATCUD e exportação SAF-T). Esta aplicação **não é certificada**: os documentos levam essa indicação no rodapé. Use-a para gestão interna e controlo de conta corrente, e emita as faturas oficiais no seu programa certificado (ou integre um serviço de faturação certificado).
- **SAF-T (PT) e comunicação de documentos à AT:** só são válidos quando produzidos por software certificado (os documentos têm de ter assinatura digital/hash, ATCUD e séries comunicadas). Por isso esta aplicação **não gera SAF-T nem comunica faturas à AT** — fazê-lo a partir de um programa não certificado seria ilegal e induziria em erro. Se pretender, a aplicação pode ser integrada com um serviço de faturação certificado (via API), que trata da emissão legal, SAF-T e comunicação.
- **SMS:** as mensagens são preparadas e registadas no histórico; sem um fornecedor de SMS configurado, podem ser copiadas ou abertas no telemóvel (link `sms:`). A integração com um gateway (ex.: o seu fornecedor atual) pode ser adicionada em `server.js` → `prepararSms`.
- **Cópias de segurança:** em *Configuração → Cópia de segurança* descarrega uma cópia da base de dados (`clinica.db`), **sem os anexos** (RX, fotos, documentos), que ficam em `data/anexos/`. Para uma cópia completa, copie a pasta `data/` inteira (com o servidor parado, ou junte a cópia descarregada à pasta `data/anexos/`). Faça-o diariamente e guarde fora do computador. Para restaurar, pare o servidor e reponha a pasta `data/`.
- **Rede e segurança:** o servidor aceita ligações da rede local (porta 3000). Não o exponha diretamente à Internet; para acesso remoto use uma VPN. Os dados de saúde são dados sensíveis (RGPD): mantenha o computador servidor protegido por palavra-passe e com o disco cifrado (BitLocker).
- **Migração de dados:** para importar pacientes de outro sistema, exporte-os para CSV (separador `;` ou `,`, 1.ª linha com os cabeçalhos) e use *Configuração → Importar pacientes*: associe cada coluna a um campo da ficha, faça uma simulação para ver os erros por linha e depois importe. Linhas de pacientes que já existem (mesmo n.º de processo ou NIF) são ignoradas.

## Estrutura

```
clinica-dentaria/
├── server.js        API HTTP + regras de negócio (agenda, faturação, stocks, estatísticas…)
├── db.js            Esquema da base de dados, dados iniciais e utilitários
├── comunicacao.js   Envio de e-mail (SMTP) e SMS
├── anamnese.js      Perguntas e respostas da anamnese configurável
├── perio.js         Periodontograma (exames e índices)
├── anexos.js        Ficheiros do paciente (upload, download, apagar)
├── importar.js      Importação de pacientes a partir de CSV
├── iniciar.bat      Arranque no Windows
├── data/            Base de dados e anexos (criada automaticamente, fora do git)
└── public/          Interface (HTML/CSS/JS sem frameworks)
    ├── index.html
    ├── app.css
    └── js/  core · agenda · pacientes · odonto · dentes · anamnese · perio · anexos · financeiro · listagens · modulos · config · importar · main
```

## Créditos

- **Modelos dentários do odontograma:** imagens renderizadas a partir de [BodyParts3D](https://dbarchive.biosciencedbc.jp/en/bodyparts3d/), © The Database Center for Life Science, licença CC BY 4.0 (os ficheiros OBJ originais indicam CC BY-SA 2.1 JP). Ver `public/img/dentes/LICENCA.txt`.
- **Tipografia:** IBM Plex Sans e IBM Plex Mono (SIL Open Font License).
