# CHECKLIST 100% — Campos e Operações de Tarefas, Blocos e Agenda

> Referência canônica e OBRIGATÓRIA do squad para ler e AJUSTAR tarefas e agenda.
> Toda task do squad que lê, cria ou ajusta tarefa/agenda DEVE usar exatamente os
> campos e tabelas abaixo. Schema confirmado no banco em 2026-06-09.
>
> ⚠️ Erros históricos eliminados por este doc: usar `scheduled_at`, `start_at`,
> `end_at`, `linked_task_id`, `calendar_events` no lugar das colunas reais; e tratar
> a tarefa como tendo UM horário, quando ela é fatiada em N BLOCOS.

## 0. Modelo mental: a agenda tem 3 fontes (não 1)

Uma "agenda" do PrimeTeam é a união de **três** tabelas. Para ajustar a agenda
corretamente é obrigatório saber em qual delas o item vive:

| Item na agenda | Tabela | É o quê |
|---|---|---|
| Fatia de execução de uma tarefa | **`task_schedule_blocks`** | a tarefa dividida em blocos (cada um com horário próprio) |
| Tarefa sem split (cabe num bloco só) | **`tasks`** (campo `scheduled_start_time`) | a própria tarefa agendada |
| Reunião / focus time / bloqueio | **`calendar_blocks`** | evento de calendário (não é fatia de tarefa) |
| Reunião importada do Google | **`tasks`** com `block_type='meeting'` (meeting_task) | evento externo virou entrega contável |

**Regra de ouro:** se a tarefa TEM blocos em `task_schedule_blocks`, o horário real
de execução está NOS BLOCOS — `tasks.scheduled_start_time` é secundário. Ajustar a
agenda dessa tarefa = ajustar os BLOCOS, não o `scheduled_start_time`.

---

## 1. CHECKLIST — campos de `tasks` (a tarefa)

| Campo | Tipo | Papel na agenda | Obrigatório |
|---|---|---|---|
| `id` | uuid | PK | — |
| `title` | text | título | sim |
| `status` | text | `'todo' \| 'doing' \| 'done' \| 'cancelled'` | sim |
| `priority` | int 1-10 | eixo RESULTADO do quadrante (≥6 = alto) | default 5 |
| `urgency` | int 1-10 | eixo ESFORÇO do quadrante (≥6 = alto) | default 5 |
| `due_date` | timestamptz | PRAZO da entrega (não é o horário de execução) | — |
| `scheduled_start_time` | timestamptz | horário agendado da tarefa **quando NÃO tem blocos** | — |
| `estimated_duration_minutes` | int | duração total estimada | — |
| `can_be_split` | bool | `false` = reunião/meeting, scheduler NUNCA move | default true |
| `block_type` | text | `'task'\|'meeting'\|'focus_time'\|'personal'\|'unavailable'` | default 'task' |
| `is_auto_scheduled` | bool | `false` quando o usuário moveu manualmente | default true |
| `completed_at` | timestamptz | dia/hora real da conclusão (posiciona concluídas na agenda) | — |
| `is_recurring` | bool | tarefa recorrente | — |
| `due_date` / `original_due_date` | timestamptz | prazo atual / prazo antes de adiamento | — |
| `owner_id` | uuid | dono (FK profiles) | — |
| `assigned_to` | uuid[] | atribuídos | — |
| `split_group_id` | uuid | LEGADO (split antigo) — **não usar**, use `task_schedule_blocks` | — |

NÃO EXISTEM (erros do squad antigo): `scheduled_at`, `start_at`, `end_at`,
`linked_task_id`, `scheduled_end`. Não referenciar.

---

## 2. CHECKLIST — campos de `task_schedule_blocks` (o BLOCO) ⭐

Esta é a tabela que o squad ignorava. É AQUI que está o horário real de cada fatia.

| Campo | Tipo | Significado |
|---|---|---|
| `id` | uuid | PK do bloco |
| `task_id` | uuid NOT NULL | FK → tasks(id) ON DELETE CASCADE |
| `scheduled_start` | timestamptz NOT NULL | **horário de início do bloco** (o que ajustar para mover na agenda) |
| `duration_minutes` | int NOT NULL | duração do bloco em minutos (start + duration = fim) |
| `block_order` | int NOT NULL (default 1) | ordem cronológica do bloco dentro da tarefa (1, 2, 3…) |
| `is_completed` | bool (default false) | se ESTE bloco foi concluído (independente da tarefa-mãe) |
| `notes` | text | anotações do bloco |
| `created_at` / `updated_at` | timestamptz | — |

Os blocos HERDAM `priority`, `urgency`, `block_type`, `title` da tarefa-mãe (via JOIN).
Um bloco não tem prioridade própria — para classificar/exibir, sempre faça JOIN com `tasks`.

---

## 3. LER uma tarefa 100% (tarefa + todos os blocos)

```sql
-- A tarefa com seus blocos (horários reais de execução)
SELECT t.id, t.title, t.status, t.priority, t.urgency, t.due_date,
       t.scheduled_start_time, t.estimated_duration_minutes, t.can_be_split,
       b.id   AS block_id,
       b.scheduled_start,
       b.duration_minutes,
       b.block_order,
       b.is_completed
  FROM tasks t
  LEFT JOIN task_schedule_blocks b ON b.task_id = t.id
 WHERE t.id = {task_id}
 ORDER BY b.block_order;
```

- Se vierem N linhas com `block_id` → a tarefa está fatiada em N blocos; os horários
  estão em `b.scheduled_start` (NÃO em `t.scheduled_start_time`).
- Se vier 1 linha com `block_id = NULL` → tarefa sem split; horário em `t.scheduled_start_time`.

`list-tasks` e `list-calendar-events` DEVEM trazer esses campos quando o objetivo é a agenda.

---

## 4. AJUSTAR a agenda — operações (com SQL real)

### 4.1 Mover um bloco (mudar dia E/OU horário)
```sql
UPDATE task_schedule_blocks
   SET scheduled_start = {novo_inicio_iso_utc}, updated_at = now()
 WHERE id = {block_id};
```
Regras de integridade ANTES do UPDATE:
- **Ordem cronológica:** o novo `scheduled_start` não pode passar do início do
  bloco `block_order + 1` da mesma tarefa, nem ser antes do fim do `block_order - 1`.
- **Não ultrapassar o prazo:** o fim do bloco (`scheduled_start + duration_minutes`)
  não deve passar de `tasks.due_date` (a menos que explicitamente autorizado).
- **Último bloco define o prazo:** se for o bloco de maior `block_order`, atualizar
  também `tasks.due_date` para o fim dele (mantém a coerência tarefa↔blocos).

### 4.2 Mudar a duração de um bloco
```sql
UPDATE task_schedule_blocks
   SET duration_minutes = {novos_minutos}, updated_at = now()
 WHERE id = {block_id};
```

### 4.3 Mover uma tarefa SEM blocos
```sql
UPDATE tasks
   SET scheduled_start_time = {novo_inicio_iso_utc}, is_auto_scheduled = false, updated_at = now()
 WHERE id = {task_id};
```

### 4.4 Reagendar/redistribuir todos os blocos de uma tarefa
Não recalcular à mão. A redistribuição respeita carga diária, reuniões fixas
(`can_be_split=false`) e a régua "de amanhã até o prazo, nunca pós-prazo". Disparar a
edge/serviço de auto-scheduling em vez de inventar horários. Se for ajuste pontual de
1 bloco, use 4.1.

### 4.5 Mudar só o PRAZO (due_date)
```sql
UPDATE tasks SET due_date = {novo_prazo} WHERE id = {task_id};
```
⚠️ Há trigger `reschedule_on_due_date_change`: mudar só a data desloca
`scheduled_start_time` e os blocos pelo mesmo delta de dias (não toca reuniões).

---

## 5. Propagação automática (não precisa fazer à mão)

Ao ajustar um bloco/tarefa, estes triggers cuidam do resto:

- **Google Calendar:** `enqueue_calendar_sync` enfileira a mudança em
  `calendar_sync_outbox`; o `gcal-outbound-worker` cria/atualiza o evento Google do
  bloco (cada bloco = 1 evento transparent 📋). Mover o bloco → muda no Google sozinho.
- **due_date change:** `reschedule_on_due_date_change` desloca os blocos pelo delta.
- **conclusão:** triggers setam `completed_at`/`is_completed`.

A volta (editar o bloco NO Google) também funciona: `gcal_apply_managed_edit` já
suporta `entity_type='task_schedule_block'` e atualiza `scheduled_start`+`duration_minutes`.

---

## 6. Conexão com o Google (mapeamento)

Não há `google_event_id` direto na tarefa/bloco. O elo é a tabela `calendar_sync_links`:
`entity_type ∈ {'task','task_schedule_block','calendar_block','meeting_task'}` +
`entity_id` + `google_event_id` + `sync_state`. Para saber se um bloco está espelhado
no Google: `SELECT google_event_id, sync_state FROM calendar_sync_links WHERE
entity_type='task_schedule_block' AND entity_id={block_id}`.

---

## 7. CHECKLIST de validação ANTES de ajustar a agenda (use sempre)

- [ ] Identifiquei se a tarefa TEM blocos (`task_schedule_blocks`) ou é horário único (`scheduled_start_time`)?
- [ ] Estou ajustando o BLOCO certo (`block_id`), não a tarefa inteira?
- [ ] O novo horário respeita a ordem cronológica dos blocos vizinhos (`block_order`)?
- [ ] O fim do bloco (`scheduled_start + duration_minutes`) não passa do `due_date`?
- [ ] Se é o último bloco, atualizei `tasks.due_date` para o fim dele?
- [ ] Reuniões (`can_be_split=false`) NÃO estão sendo movidas pelo ajuste?
- [ ] Deixei os triggers propagarem para o Google (não escrevi no Google à mão)?
- [ ] Usei só colunas REAIS (nunca `scheduled_at`/`start_at`/`end_at`/`linked_task_id`)?

Ver também: `tasks-agenda-google-model.md` (modelo + princípio espelho quadrante=agenda=google).
