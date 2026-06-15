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

### ⛔ REGRA DE OURO — mudar a DATA = mudar a TAREFA **e** a EXECUÇÃO (os dois, sempre)

> Decisão do Pablo (2026-06-15), vale para SEMPRE e para TODA task do squad que
> mexe em data/horário de tarefa (`update-task`, `reschedule-task`,
> `approve-task-date-change`, `adjust-schedule-block`).

A tarefa tem DUAS representações de tempo que precisam andar JUNTAS:
- **a TAREFA** — `tasks.scheduled_start_time` e/ou `tasks.due_date`;
- **a EXECUÇÃO** — as fatias em `task_schedule_blocks.scheduled_start` (o horário
  real na agenda e no Google Calendar).

**NUNCA mexa em uma sem a outra.** Mudar só o campo da tarefa deixa o bloco (logo, o
evento 📋 no Google e o card do Quadrante) parado no horário antigo → agenda mentindo.

#### Por que NÃO basta confiar no trigger (provado no banco, 2026-06-15)

Existe o trigger `trg_reschedule_on_due_date_change`
(`supabase/migrations/20260811120000_reajuste_horario_ao_mudar_due_date.sql`), mas ele
cobre **um caminho só**. Reprodução real numa tarefa com 1 bloco:

| Mudança feita na `tasks` | O bloco seguiu? | Por quê |
|---|---|---|
| só `scheduled_start_time` (sem mexer em `due_date`) | ❌ **NÃO** | o trigger é `BEFORE UPDATE OF due_date` — nem dispara |
| `due_date` **+** `scheduled_start_time` no mesmo UPDATE | ❌ **NÃO** | guard interno desliga (`scheduled_start_time IS NOT DISTINCT`) |
| `due_date` mudando só a **hora** (mesmo dia) | ❌ **NÃO** | desloca por **delta de DIAS** (`::date - ::date` = 0) |
| só `due_date`, mudando o **DIA** | ✅ sim | único caminho que o trigger cobre |
| qualquer bloco com `is_completed = true` | ❌ nunca move | trigger ignora blocos concluídos (correto) |

Ou seja: em 3 dos 4 caminhos de edição, e em todo ajuste de horário intradiário, o
bloco fica para trás se você não mexer nele à mão. É exatamente o sintoma reportado
("alterou a data da tarefa mas não a da execução").

#### Protocolo obrigatório (faça SEMPRE, nesta ordem)

1. **LER a tarefa com os blocos** (query da §3). Quantos blocos pendentes (`is_completed=false`) ela tem?
2. **Calcular o DELTA exato** = `novo_inicio − antigo_inicio` (em ms, não em dias) do
   campo que você está movendo (`scheduled_start_time`; se só o `due_date` muda, use o delta do `due_date`).
3. **Aplicar o MESMO delta aos blocos pendentes** no MESMO fluxo da mudança da tarefa
   (não deixar para o trigger):
   ```sql
   UPDATE task_schedule_blocks
      SET scheduled_start = scheduled_start + ({novo_inicio}::timestamptz - {antigo_inicio}::timestamptz),
          updated_at = now()
    WHERE task_id = {task_id} AND COALESCE(is_completed,false) = false;
   ```
4. **VERIFICAR (re-ler) tarefa + blocos** depois do update. Tarefa e blocos têm de
   bater. Se não bateram → corrigir antes de reportar DONE (smoke test, regra do Pablo).
5. **Se NÃO souber como redistribuir, NÃO adivinhe — pergunte ao responsável.** Casos
   ambíguos que EXIGEM perguntar (creator/owner — ver `request-task-date-change`):
   - tarefa com **2+ blocos** e a nova data **não** é um deslocamento uniforme (ex:
     mudou só o horário do dia, ou os blocos não cabem mais antes do novo `due_date`);
   - há **blocos `is_completed`** e a tarefa toda foi remarcada (o que fazer com o já-feito?);
   - o novo horário **colide** com reunião/bloco fixo (`can_be_split=false`) e não dá pra resolver sozinho;
   - qualquer dúvida sobre QUAL bloco mover. Deslocamento uniforme de tudo é seguro;
     redistribuição "inteligente" não é — para isso, dispare o auto-scheduling (§4.4) ou pergunte.

> **Caminho inverso (mover o BLOCO):** ao mover/ajustar um bloco via
> `adjust-schedule-block`, se for o último bloco sincronize `tasks.due_date`. Mesma
> regra dos dois lados: bloco e tarefa nunca divergem.

---

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
⚠️ Só vale para tarefa que **não tem** `task_schedule_blocks`. Se a tarefa TEM blocos,
este UPDATE **não** move a execução (o trigger nem dispara nesse caso) — siga a REGRA
DE OURO acima e mova os blocos pelo mesmo delta no mesmo fluxo.

### 4.4 Reagendar/redistribuir todos os blocos de uma tarefa
Não recalcular à mão. A redistribuição respeita carga diária, reuniões fixas
(`can_be_split=false`) e a régua "de amanhã até o prazo, nunca pós-prazo". Disparar a
edge/serviço de auto-scheduling em vez de inventar horários. Se for ajuste pontual de
1 bloco, use 4.1.

### 4.5 Mudar só o PRAZO (due_date)
```sql
UPDATE tasks SET due_date = {novo_prazo} WHERE id = {task_id};
```
⚠️ O trigger `trg_reschedule_on_due_date_change` SÓ propaga aos blocos quando: (a) você
mexe **apenas** no `due_date` (não no `scheduled_start_time` no mesmo update), **e** (b)
a mudança é de **DIA inteiro** (`delta de dias ≠ 0`) — mudança só de horário no mesmo dia
NÃO move bloco nenhum. Blocos `is_completed` nunca se movem. Em qualquer outro caminho,
mova os blocos você mesmo (REGRA DE OURO). NUNCA assuma que o trigger cobriu — **verifique**.

---

## 5. Propagação automática (não precisa fazer à mão)

Ao ajustar um bloco/tarefa, estes triggers cuidam do resto:

- **Google Calendar:** `enqueue_calendar_sync` enfileira a mudança em
  `calendar_sync_outbox`; o `gcal-outbound-worker` cria/atualiza o evento Google do
  bloco (cada bloco = 1 evento transparent 📋). Mover o bloco → muda no Google sozinho.
- **due_date change:** `reschedule_on_due_date_change` desloca os blocos — **mas só**
  no caminho estreito da §4.5 (só `due_date`, delta de DIAS, blocos pendentes). NÃO é
  rede de segurança: nos demais caminhos você move os blocos à mão (REGRA DE OURO §4).
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
- [ ] **Vou mudar data/horário? Então vou ajustar a TAREFA E os BLOCOS no mesmo fluxo (REGRA DE OURO §4) — nunca um só?**
- [ ] **Calculei o delta exato (ms) e apliquei aos blocos pendentes — sem contar com o trigger?**
- [ ] **Re-li tarefa + blocos depois e confirmei que batem?**
- [ ] **Se a redistribuição é ambígua (2+ blocos não-uniforme, blocos concluídos, colisão), perguntei ao responsável em vez de adivinhar?**
- [ ] Estou ajustando o BLOCO certo (`block_id`), não a tarefa inteira?
- [ ] O novo horário respeita a ordem cronológica dos blocos vizinhos (`block_order`)?
- [ ] O fim do bloco (`scheduled_start + duration_minutes`) não passa do `due_date`?
- [ ] Se é o último bloco, atualizei `tasks.due_date` para o fim dele?
- [ ] Reuniões (`can_be_split=false`) NÃO estão sendo movidas pelo ajuste?
- [ ] Deixei os triggers propagarem para o Google (não escrevi no Google à mão)?
- [ ] Usei só colunas REAIS (nunca `scheduled_at`/`start_at`/`end_at`/`linked_task_id`)?

Ver também: `tasks-agenda-google-model.md` (modelo + princípio espelho quadrante=agenda=google).
