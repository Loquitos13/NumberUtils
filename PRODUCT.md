# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Receção e médicos dentistas da clínica OralSaúde (Vila Nova de Gaia), em partes iguais.
- Receção: atende telefone e balcão em simultâneo; marca, confirma e remarca consultas, recebe pagamentos, emite documentos. Vive na agenda.
- Médicos: entre pacientes, abrem a ficha clínica, odontograma, plano de tratamento e notas. Pouco tempo, mãos muitas vezes ocupadas.
A equipa vem de anos de NoviGest (Java/Swing) e está habituada a ecrãs densos.

## Product Purpose
Substituir o NoviGest na gestão diária da clínica: agenda, fichas clínicas, odontograma, conta corrente, orçamentos, próteses, stocks, listagens. Sucesso = a receção faz uma marcação em segundos e o médico encontra o histórico do dente sem procurar.

## Operating Context
- Portáteis Lenovo X260 (ecrã 12,5", ~1366×768) e telefone fixo ao lado; uso o dia inteiro.
- Servidor local (Node + SQLite) numa máquina da clínica, browsers nos postos da rede.
- Português de Portugal em toda a interface.

## Capabilities and Constraints
- Densidade alta, como no NoviGest: tabelas compactas, muitas marcações visíveis sem scroll.
- Faturação não certificada pela AT: documentos internos; SAF-T e comunicação à AT ficam no software certificado.
- Sem dependências externas (sem CDN, sem frameworks).

## Brand Commitments
Nome da clínica: OralSaúde — Clínica de Saúde Oral. Logótipo e cores ainda não fornecidos; não inventar.

## Evidence on Hand
Dados de demonstração fictícios. Não há logótipo, fotografias nem testemunhos — não fabricar.

## Product Principles
1. A agenda e a ficha são ferramentas de trabalho, não montras: informação primeiro.
2. Densidade com ordem: muita informação, hierarquia clara.
3. O estado das consultas lê-se pela cor de imediato.
4. Nada de decoração que não ajude a decidir ou a agir.
