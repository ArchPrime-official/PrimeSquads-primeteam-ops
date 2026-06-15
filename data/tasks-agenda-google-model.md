# Tarefas ↔ Agenda ↔ Google Calendar — Modelo de Dados e Princípio Espelho

> Fonte: auditoria forense 2026-06-09 (squad primeteam-improve / pt-chief).
> Este documento é a referência canônica do squad sobre como tarefas, blocos de
> execução, a agenda e o Google Calendar se conectam na plataforma PrimeTeam.

## Princípio fundamental: 3 lentes, 1 fonte de verdade

**Quadrante de prioridade = Agenda (/calendar) = Google Calendar.** São três modos de
visualizar exatamente os MESMOS dados. Um é espelho do outro:

- **Quadrante** (aba Quadrante em /tarefas): agrupa por prioridade (Resultado × Esforço).
- **Agenda** (/calendar, ou aba Calendário): posiciona por horário no grid de tempo.
- **Google Calendar**: os mesmos itens, sincronizados como eventos transparent.

A fonte única são as tabelas `tasks` + `task_schedule_blocks`. Nenhuma lente inventa
dados; todas expandem a mesma lista via `createCalendarItems()` / `createQuadrantItems()`
(`src/types/calendarTypes.ts`).

## Modelo de dados

```
tasks
 ├─ priority (1-10)  → eixo RESULTADO/Impacto   (>=6 = alto)   ┐ quadrante Eisenhower
 ├─ urgency  (1-10)  → eixo ESFORÇO             (>=6 = alto)   ┘ (THRESHOLD = 6, não 7)
 ├─ scheduled_start_time, due_date, status (todo|doing|done|cancelled)
 ├─ can_be_split (false = reunião/meeting_task, nunca movida pelo scheduler)
 ├─ block_type (task|meeting|focus_time|personal|unavailable)
 │
 ├──> task_schedule_blocks (N por tarefa) — as FATIAS de execução
 │     • scheduled_start + duration_minutes  ← cada bloco TEM data/hora de execução
 │     • block_order, is_completed
 │     • NÃO tem priority/urgency próprios → HERDA da tarefa via JOIN
 │
 └──> calendar_sync_links — mapeamento 1:1 com o Google (não há google_event_id na task)
       • entity_type: 'task' | 'task_schedule_block' | 'calendar_block' | 'meeting_task'
       • google_event_id, google_etag, local_content_hash, sync_source, sync_state
```

Três conceitos distintos de "bloco" — não confundir:
- `task_schedule_blocks` — fatias de execução de uma tarefa (o que o quadrante expande).
- `calendar_blocks` — reuniões / focus time (têm `google_event_id` direto).
- `meeting_task` — evento externo do Google importado como entrega contável.

## Quadrante: cada bloco é um card (desde 2026-06-09)

A aba Quadrante expande cada `task_schedule_block` em um card próprio, com seu horário
e posição (Parte N/M), classificado pela priority/urgency da tarefa-mãe. Tarefas sem
split ou já terminais (done/cancelled) = 1 card.

- Frontend: `createQuadrantItems()` → `EisenhowerMatrix` consome `CalendarItem[]`.
- Contagem do header: `count_tasks_by_quadrant` conta CARDS (blocos p/ ativas, 1 p/
  terminais), batendo com o que é renderizado.

## Sincronização com o Google Calendar (ATIVA e bidirecional)

Não é mais "futuro / Sprint 7". Está ligada (`calendar_sync_settings.sync_enabled=true`,
`outbox_capture_enabled=true`, `shadow_mode=false`) e funcionando.

### Outbound (PrimeTeam → Google) — `gcal-outbound-worker`
- Trigger `enqueue_calendar_sync()` enfileira mudanças em `calendar_sync_outbox`.
- Cron processa a fila (batch 50).
- **Tarefa agendada** → evento transparent 📋 (scheduled_start_time + estimated_duration).
- **Bloco** (`task_schedule_block`) → evento transparent 📋 (scheduled_start + duration).
- **Regra de ouro:** se a tarefa TEM blocos, só os BLOCOS vão ao Google (a tarefa em si
  é pulada) — evita duplicar tarefa + fatias.
- `meeting_task` (veio do Google) nunca é re-empurrado.

### Inbound (Google → PrimeTeam) — `gcal-inbound-sync` + `google-calendar-webhook`
- Webhook push → atualiza `google_calendar_events_cache` → dispara inbound sync.
- Eventos externos opacos viram `meeting_task` (entrega contável).
- Gate por `calendar_sync_optin.enabled` (rollout por usuário).

### 4 barreiras anti-loop
1. `sync_source` (origem: primeteam vs google) — google nunca é re-empurrado.
2. `google_etag` (eco: detecta o próprio write voltando).
3. `local_content_hash` (djb2: conteúdo idêntico = no-op).
4. GUC `app.calendar_sync_suppress` (RPCs inbound não re-enfileiram).

### Pré-requisito operacional: token Google válido
O sync só funciona para usuários com `oauth_tokens` (provider=google) com refresh_token
válido. Se o usuário desconectou/revogou, o refresh falha — erro **irrecuperável por
retry**. Desde 2026-06-09 o worker marca esses casos como `skipped` com
`last_error=reauth_required` (não acumula `error`). **Ação:** o usuário precisa
reconectar a conta Google em /settings.

## Armadilhas conhecidas (gotchas)

- **Threshold é 6, não 7.** Documentação antiga do squad dizia ≥7 — estava errada.
- **Os eixos foram renomeados:** priority=Resultado, urgency=Esforço. NÃO é a matriz
  urgência×importância clássica. priority-max (alto resultado + baixo esforço) é
  "quick win", não "crise".
- **Concluída na agenda** é posicionada por `completed_at` (camada separada
  `task_completion_history`), não por `scheduled_start_time`.
- **Reuniões** (`can_be_split=false`) são congeladas: o scheduler nunca as move.
- **Blocos herdam tudo** (priority, urgency, block_type) da tarefa — sempre fazer JOIN.
- **Mudar data = mudar TAREFA + EXECUÇÃO (os dois).** Alterar `scheduled_start_time`/
  `due_date` sem mover os `task_schedule_blocks` deixa o evento 📋 do Google e o card do
  Quadrante no horário antigo. O trigger `trg_reschedule_on_due_date_change` só cobre "só
  due_date + delta de dias" — nos demais caminhos, mova os blocos à mão e verifique; se a
  redistribuição for ambígua, pergunte ao responsável. Regra de ouro completa em
  `tasks-schedule-blocks-field-reference.md` §4.
