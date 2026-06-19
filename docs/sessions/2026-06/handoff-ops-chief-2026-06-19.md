# Handoff — Sessão ops-chief 2026-06-19

> Auditoria de handoffs (17/06 + 18/06) em todos os repos do computador, mapeamento
> do trabalho executado e não-registrado, splits, reagendamentos e reorganização do
> board do Pablo (owner). Todo o trabalho foi via REST do Supabase (dados) — sem código.

## Contexto

Pablo pediu, em sequência: (1) levantar tarefas pendentes de "ontem" + cruzar com
handoffs de todos os projetos; (2) mapear no board o trabalho executado que não estava
registrado; (3) ajustar dias/horários/durações com splits; (4) fechar pendências.

Fonte da agenda = 3 tabelas: `tasks` (`scheduled_start_time` + `block_type`),
`task_schedule_blocks` (blocos, `is_completed`) e `task_completion_history` (histórico de
concluídas). Fuso espelhado das linhas existentes (`+00:00`). Tarefa concluída só aparece
no histórico se tiver as 3 coisas: `status=done`, bloco com `is_completed=true` e linha em
`task_completion_history`.

## O que foi feito

### Auditoria de handoffs (read-only, via subagentes)
- **17/06:** 8 handoff docs PrimeTeam (`docs/sessions/2026-06/`) + 2 Lovarch + migração v2
  gap-audit. PrimeTeam ~129 commits, Lovarch 36 PRs.
- **18/06:** 9 handoff docs PrimeTeam + Lovarch ~60 commits (portal/v2, content-studio,
  crm/proposte). PrimeTeam ~70 commits.

### Board — 17/06 (adicionadas como concluídas, com history)
8 tarefas de trabalho que não estavam no board: Lezione 02 montagem (55:50) + publicação
`/lezioni`; Render Studio; Content Studio v2; Curso "Render & Video con l'IA"; fluxo único
de emails do evento; auditoria financeira Lovarch (#3720-3745); PrimeTeam v2 CRUD nativi.
- **CPL 03 copy** → split parte 1/2 (4h, done) + parte 2/2 (7h).
- **Riattivare Meta** → split parte 2/3 (campanhas 432-437, done ontem) + parte 3/3.
- **#1 CPL 02 copy** → marcada done (não estava atrasada, foi feita 17/06).
- **#18 Montare CPL 1** → movida para segunda 15/06 (concluída no dia certo).

### Board — 18/06 (adicionadas como concluídas, com history)
10 frentes executadas e não-mapeadas: Reembolsos; Épico LTV/recorrência/churn (Fases 1-5,
#3750-3764); Manuale Strumenti IA Officina Invisibile; CRM/Proposte (#1387-1394);
Re-inscrição perpétuo (bloco Renata) + demográfico; v2 UI (calendar_blocks, strategia
campagna, ricorrenza); Dashboard Lancio Pagato (#3776-3783); Obiettivi finanziari + fix CAC
3x; Lovarch Portal/v2 (F1-F7, #1395-1415); Lovarch Content Studio (Shotstack, #1402-1414).

### Fechamento das pendências de 18/06
- **CPL 03 copy** → concluída (terminada ontem).
- **CPL 03 vídeo** → split: parte 1/2 done ontem (19:00→meia-noite); parte 2/2 hoje
  **00:00-04:00** (4h) para finalizar.
- Resultado: **0 tarefas de trabalho pendentes em 18/06**.

### Reorganização de dias
- Sexta 19/06, sábado 20/06 (9 tarefas "estacionadas"), domingo 21/06 (4 tarefas).
- Checkout €47 + LP captura + Riattivare Meta 3/3 → distribuídas em 19-20/06.
- Linha editorial → sábado 20/06.

## Achado: Radar Semanal duplicado (causa raiz)
Dois `📊 Radar Semanal` em 19/06 (11:30 e 14:00), ambos `block_type=meeting`,
`is_recurring=true`, mesmos 6 participantes, criados com **29s de diferença** (18/06
19:29 e 19:30). A cópia das 11:30 foi **editada às 20:06** (horário alterado). **A tabela
`tasks` não possui coluna `google_event_id`** → a sincronização com o Google Calendar não
tem chave para deduplicar e cria cópia nova a cada execução/reimport. É duplicata real, não
duas reuniões. **Pendente:** confirmar com Pablo qual horário é o correto (11:30 vs 14:00)
para deletar a outra. (Relaciona-se ao bug conhecido de duplicação de recorrentes.)

## Pendências em aberto
- **Radar Semanal:** deletar a duplicata após Pablo confirmar o horário certo.
- **2 reuniões de 18/06 sem baixa:** Pablo + Totti (13:00) e Alinhamento Financeiro (14:00).
- **LP captura (19/06 14:00)** encosta na Radar das 14:00 — mover para 16:00 se a Radar real
  for 14:00.
- **#8 "LANCIOMAG26 Scrivere copy CPL 2"** com 10h de duração — Pablo confirmou que não é
  erro, mas é muito tempo; não ajustado.
- **Rotação de chaves Stripe** (vinda do handoff de 17/06): `sk_live` das 2 contas + webhook
  secret ArchPrime expostos no chat — rotacionar.

## Aprendizados técnicos (registrados em memória)
- `tasks.assigned_to` é `uuid[]` (array). INSERT com UUID escalar → erro `22P02`. Usar
  `[user_id]`. Tarefas pré-existentes do Pablo têm `assigned_to=[]` → filtrar por `owner_id`.
- Concluir = `status=done` + bloco `is_completed=true` + linha em `task_completion_history`.
- Split = linhas irmãs em `tasks` com mesmo `split_group_id` + `split_index`, cada uma com
  seu bloco. Título "… (parte N/M …)".
- Sessão expira em ~1h; se o refresh_token já foi consumido, `pto refresh` falha → exige
  `npm run login` (browser). O endpoint de refresh direto serve quando o token está fresco.
- Cuidado: `UID` é variável reservada do shell (usar PUID).
