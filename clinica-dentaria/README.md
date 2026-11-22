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
| Utilizador | Palavra-passe | Perfil |
|---|---|---|
| `admin` | `admin` | Administrador |
| `rececao` | `rececao` | Receção |
| `ana` | `ana` | Médica (exemplo) |

**Altere as palavras-passe logo no primeiro acesso** (botão 🔑 no canto inferior esquerdo) e, em *Configuração → Utilizadores*, crie os utilizadores reais e desative os de exemplo. A base de dados nova vem com dados fictícios de demonstração (médicos, pacientes, marcações): pode editá-los ou apagá-los.

## Módulos

| Módulo | Funcionalidades |
|---|---|
| **Início** | Consultas do dia, recebimentos, próteses em atraso, alertas de stock, aniversários, atalhos |
| **Agenda** | Vista diária por médico, semanal, por gabinete e lista; marcação com um clique; cores por estado; deteção de sobreposições (médico e gabinete) e feriados; procurar próxima vaga; presença/falta rápida; lembretes SMS; impressão |
| **Pacientes** | Ficha completa (NIF validado, SNS, CC, entidade/seguro, RGPD, consentimento SMS/e-mail), pesquisa rápida global (Ctrl+K), exportação |
| **Ficha clínica** | Resumo, **odontograma** interativo (dentição permanente e decídua, faces, condições: cárie, restauração, ausente, endodontia, coroa, implante, etc.), plano de tratamentos, anamnese com alertas (alergias, anticoagulantes…), notas clínicas, histórico de marcações, impressão da ficha |
| **Faturação** | Fatura, fatura-recibo, recibo e nota de crédito com numeração por série/ano; faturar tratamentos realizados; conta corrente e extrato do paciente; saldos/devedores; fecho de caixa diário; anulação com motivo |
| **Orçamentos** | Criação a partir do plano de tratamento, impressão com espaço para assinatura, aceitar (gera/associa o plano), recusar, validade |
| **Próteses** | Trabalhos de laboratório com fases (pedido → enviado → prova → recebido → entregue), atrasos, guia para o laboratório |
| **Stocks** | Produtos, armazéns, entradas/saídas/ajustes/transferências, lotes e validades, alertas de stock mínimo/ideal e validade, quantidade a encomendar |
| **Estatísticas** | Marcações por estado e médico, taxa de faltas, faturação mensal, faturação e comissões por médico, recebimentos por método, tratamentos mais realizados, razões da 1.ª visita |
| **Comunicação** | Modelos de SMS com variáveis, lembretes de consultas, aniversários, faltas recentes, pacientes sem consulta há um ano, histórico |
| **Configuração** | Dados da clínica, horário e dias da agenda, feriados (Páscoa, Sexta-feira Santa, Corpo de Deus e Carnaval calculados automaticamente), médicos (cor, comissão), tabela de tratamentos e preços, especialidades, gabinetes, estados das consultas, razões da 1.ª visita, entidades/seguros com desconto, laboratórios, armazéns, utilizadores e perfis, registo de atividade, cópia de segurança |

## Notas importantes

- **Faturação certificada:** em Portugal, as faturas com validade fiscal têm de ser emitidas por software certificado pela AT (com assinatura/hash, QR code, ATCUD e exportação SAF-T). Esta aplicação **não é certificada**: os documentos levam essa indicação no rodapé. Use-a para gestão interna e controlo de conta corrente, e emita as faturas oficiais no seu programa certificado (ou integre um serviço de faturação certificado).
- **SMS:** as mensagens são preparadas e registadas no histórico; sem um fornecedor de SMS configurado, podem ser copiadas ou abertas no telemóvel (link `sms:`). A integração com um gateway (ex.: o seu fornecedor atual) pode ser adicionada em `server.js` → `prepararSms`.
- **Cópias de segurança:** em *Configuração → Cópia de segurança* descarrega uma cópia completa. Faça-o diariamente e guarde fora do computador. Para restaurar, pare o servidor e substitua `data/clinica.db`.
- **Rede e segurança:** o servidor aceita ligações da rede local (porta 3000). Não o exponha diretamente à Internet; para acesso remoto use uma VPN. Os dados de saúde são dados sensíveis (RGPD): mantenha o computador servidor protegido por palavra-passe e com o disco cifrado (BitLocker).
- **Migração de dados:** para importar pacientes de outro sistema, exporte-os para CSV e peça a criação de um importador (a estrutura das tabelas está em `db.js`).

## Estrutura

```
clinica-dentaria/
├── server.js        API HTTP + regras de negócio (agenda, faturação, stocks, estatísticas…)
├── db.js            Esquema da base de dados, dados iniciais e utilitários
├── iniciar.bat      Arranque no Windows
├── data/            Base de dados (criada automaticamente, fora do git)
└── public/          Interface (HTML/CSS/JS sem frameworks)
    ├── index.html
    ├── app.css
    └── js/  core · agenda · pacientes · financeiro · modulos · config · main
```
