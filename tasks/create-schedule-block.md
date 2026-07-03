# Task: create-schedule-block

> Criar block de agenda (focus_time, meeting, personal, unavailable). Implementa F-06 + F-08.

**Cumpre:** HO-TP-001

> ⚠️ **SCHEMA — leia `data/tasks-schedule-blocks-field-reference.md` antes.**
> NÃO existem colunas `start_at`/`end_at`/`linked_task_id` em `tasks`. Há DUAS coisas
> diferentes chamadas "block":
> - **Bloco de calendário** (reunião/focus/personal/unavailable) → tabela
>   **`calendar_blocks`** (`start_time`, `end_time`, `block_type`, `title`, `user_id` NOT NULL, `created_by`).
> - **Bloco de EXECUÇÃO de uma tarefa** (fatia) → tabela **`task_schedule_blocks`**
>   (`task_id`, `scheduled_start`, `duration_minutes`, `block_order`). Para ajustar a
>   fatia depois, use `adjust-schedule-block`.
> Esta task cria um BLOCO DE CALENDÁRIO em `calendar_blocks`.
>
> ⛔ **BUG CRÍTICO já corrigido aqui (2026-07-03):** o INSERT antigo omitia `user_id`
> (dona da agenda). `calendar_blocks.user_id` é `NOT NULL` — INSERT sem ele quebra com
> `23502`. `created_by` é uma coluna DIFERENTE (nullable, quem materialmente criou o
> bloco — pode divergir de `user_id` quando um admin cria bloco na agenda de outra
> pessoa). Ver `data/required-fields-registry.yaml` (entry `create-schedule-block`).

---

## Task anatomy

### task_name
`Create Schedule Block`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — confirmation + conflict detection.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `block_type` (`'meeting' | 'focus_time' | 'personal' | 'unavailable'`) — **NÃO** inclui
    `'task'` (esse valor só existe no CHECK de `tasks.block_type`, não no de `calendar_blocks.block_type`).
  - `start_time`, `end_time` (end > start, duration max 24h) → colunas reais de `calendar_blocks`
  - `title` (string)
  - `user_id` (uuid, **obrigatório** — default `auth.uid()` se omitido) — **dona da agenda**,
    grava em `calendar_blocks.user_id` (`NOT NULL`). Bloco na agenda de outro user requer
    admin/owner. `forbidden_defaults`: NÃO assumir silenciosamente um `user_id` diferente
    de `auth.uid()` sem confirmação explícita — se o request não deixar claro de quem é a
    agenda, ASK.
  - `created_by` (uuid, opcional — default `auth.uid()`) — quem está CRIANDO o bloco
    (audit trail, pode divergir de `user_id`).
  - `description` (string opcional)
  - `timezone_hint` (string opcional — ex: "Europe/Rome", "horário local do Pablo") — ver
    regra de timezone no action_item 2.5. Default `Europe/Rome` (TZ do time).
  - `force_conflict` (bool default false)

### output

- **`block_id`** (uuid)
- **`conflicts_detected`** (array, com a FONTE de cada conflito: `calendar_blocks | task_schedule_blocks | google_calendar_events_cache`)
- **`google_synced`** (bool — se Google Calendar integrado)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** any authenticated pode criar bloco na PRÓPRIA agenda (`user_id = auth.uid()`).
   Para `user_id` diferente do requisitante, exige role admin/owner — senão BLOCKED.
2. **Validar dates:**
   - `end > start`
   - duration ≤ 24h (sanity)
   - start não > 1 ano futuro
2.5. **Resolver timezone (regra obrigatória):** interpretar `start_time`/`end_time` em
   linguagem natural assumindo **Europe/Rome** (TZ do time) salvo se o request especificar
   outro fuso explícito (`timezone_hint`). Converter para UTC antes de qualquer query/INSERT
   (`calendar_blocks.start_time`/`end_time` são `timestamptz` — armazenam UTC internamente).
   Gravar a coluna `timezone` com o fuso resolvido (`'Europe/Rome'` por default — a própria
   coluna já tem esse default no schema, mas sempre populá-la explicitamente quando o
   request usar outro fuso, para a UI exibir corretamente).
3. **Validar block_type** ∈ `('meeting', 'focus_time', 'personal', 'unavailable')` — CHECK
   constraint real de `calendar_blocks`. Se vier `'task'` (confusão com `tasks.block_type`),
   ESCALATE explicando a diferença — NÃO tentar INSERT (violaria 23514).
4. **Conflict detection** (cruza com as **4 fontes** da agenda — colunas REAIS):
   ```sql
   -- 1. blocos de calendário existentes do dono da agenda
   SELECT id, title FROM calendar_blocks
    WHERE user_id = {user_id}
      AND tstzrange(start_time, end_time) && tstzrange({new_start}, {new_end});

   -- 2. blocos de execução de tarefas do dono da agenda
   SELECT b.id, t.title FROM task_schedule_blocks b JOIN tasks t ON t.id = b.task_id
    WHERE t.owner_id = {user_id}
      AND tstzrange(b.scheduled_start, b.scheduled_start + (b.duration_minutes||' min')::interval)
          && tstzrange({new_start}, {new_end});

   -- 3. tarefas SEM blocos, agendadas direto em scheduled_start_time
   SELECT id, title FROM tasks
    WHERE owner_id = {user_id}
      AND scheduled_start_time IS NOT NULL
      AND tstzrange(scheduled_start_time, scheduled_start_time + (estimated_duration_minutes||' min')::interval)
          && tstzrange({new_start}, {new_end});

   -- 4. eventos do Google Calendar já sincronizados (4ª fonte — cache local)
   SELECT id, title FROM google_calendar_events_cache
    WHERE user_id = {user_id}
      AND tstzrange(start_time, end_time) && tstzrange({new_start}, {new_end});
   ```
5. **Se conflicts AND NOT force_conflict** → ESCALATE com lista de conflitos (indicando a
   fonte de cada um) + flag retry.
6. **Confirmation:**
   ```
   Schedule block:
     Type: {block_type}
     Title: «{title}»
     Period: {start_local} → {end_local} (Europe/Rome, ou {timezone_hint}) — {duration}
     Agenda de: {user_name} (user_id={user_id})
     Criado por: {created_by_name}
     Conflicts: {N detected — listed com fonte}
   Confirma?
   ```
7. **INSERT em `calendar_blocks`** (colunas reais — `user_id` obrigatório):
   ```sql
   INSERT INTO calendar_blocks (title, block_type, start_time, end_time,
                                 user_id, created_by, description, timezone)
   VALUES ({title}, {block_type}, {new_start_utc}, {new_end_utc},
           {user_id}, {created_by}, {description}, {timezone})
   RETURNING id;
   ```
   > Para vincular uma fatia a uma tarefa existente, NÃO use esta task — crie em
   > `task_schedule_blocks` (`task_id`, `scheduled_start`, `duration_minutes`).
8. **Side-effect Google Calendar sync:** automático via trigger `enqueue_calendar_sync`
   (`AFTER INSERT/UPDATE/DELETE` em `calendar_blocks` → enfileira em `calendar_sync_outbox` →
   o worker `gcal-outbound-worker` cria/atualiza/apaga o evento). **NÃO** chamar edge à mão
   e **NÃO** existe uma edge function chamada `create-google-event` (nome legado incorreto —
   os workers reais são `gcal-outbound-worker`/`gcal-inbound-sync`).
9. **Activity log:** action='platform-specialist.create_schedule_block'.
10. **Echo:**
    ```
    ✓ Block agendado
    {block_type} «{title}»
    {start_local} → {end_local} ({duration}) — agenda de {user_name}
    {google_synced ? '✓ Google Calendar sincronizado' : 'Google sync: enfileirado (gcal-outbound-worker processa)'}
    ```

### acceptance_criteria

- **[A1] Self-block default; cross-user requer admin/owner.**
- **[A2] Date validation (end > start, max 24h).**
- **[A3] `user_id` sempre presente no INSERT** (nunca 23502 — o bug do INSERT sem `user_id` foi a causa raiz corrigida nesta versão).
- **[A4] Timezone resolvido e explícito:** `timezone` gravado, e `start_time`/`end_time` convertidos para UTC antes do INSERT, nunca gravados "cru" no fuso local.
- **[A5] Conflict detection cobre as 4 fontes** (`calendar_blocks`, `task_schedule_blocks`, `tasks.scheduled_start_time`, `google_calendar_events_cache`).
- **[A6] force_conflict opt-in.**
- **[A7] Google sync side-effect non-blocking**, via trigger real (`enqueue_calendar_sync`), nunca chamado à mão.
- **[A8] Audit.**

---

## Exemplos

### Exemplo 1 — Pablo cria focus_time na própria agenda

**Input:** type=focus_time, start=14:00, end=16:00, title='Deep work fiscal review', user_id=pablo (default auth.uid())

**Specialist:** timezone resolvido (Europe/Rome) → no conflicts nas 4 fontes → confirmation → INSERT com `user_id` preenchido → Google sync enfileirado → DONE.

### Exemplo 2 — Conflict detectado

**Input:** start sobrepõe meeting existente em `calendar_blocks`

**Specialist:** ESCALATE com lista + sugestão:
```
Conflito com meeting «{title}» às {time} (fonte: calendar_blocks).
Re-tente com horário diferente OU passe force_conflict=true (overrida).
```

### Exemplo 3 — Bloco em agenda alheia sem permissão (BLOCKED)

**Input:** user role=marketing pede bloco com `user_id` de outro colaborador

**Specialist:** role check falha (não é admin/owner) → BLOCKED: "Você não tem permissão para criar blocos na agenda de outra pessoa. Fale com um admin/owner."

---

## Notas

- **`block_type` values reais de `calendar_blocks`:** `'meeting' | 'focus_time' | 'personal' | 'unavailable'` (CHECK constraint — confirmado na migration que criou a tabela). O valor `'task'` só existe em `tasks.block_type`, NUNCA em `calendar_blocks.block_type` — não confundir os dois enums.
- **Google sync:** trigger `enqueue_calendar_sync` (em `tasks`, `task_schedule_blocks` E `calendar_blocks`) enfileira em `calendar_sync_outbox`; o worker `gcal-outbound-worker` materializa no Google. Não existe edge `create-google-event`.
- **`user_id` vs `created_by`:** `user_id` é a agenda onde o bloco aparece (NOT NULL, define de quem é o tempo bloqueado). `created_by` é só audit de quem operou o INSERT (nullable, pode ser um admin agindo em nome de outro user).

---

**Mantido por:** platform-specialist
