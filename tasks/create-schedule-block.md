# Task: create-schedule-block

> Criar block de agenda (focus_time, meeting, personal, unavailable). Implementa F-06 + F-08.

**Cumpre:** HO-TP-001

> ⚠️ **SCHEMA — leia `data/tasks-schedule-blocks-field-reference.md` antes.**
> NÃO existem colunas `start_at`/`end_at`/`linked_task_id` em `tasks`. Há DUAS coisas
> diferentes chamadas "block":
> - **Bloco de calendário** (reunião/focus/personal/unavailable) → tabela
>   **`calendar_blocks`** (`start_time`, `end_time`, `block_type`, `title`, `created_by`).
> - **Bloco de EXECUÇÃO de uma tarefa** (fatia) → tabela **`task_schedule_blocks`**
>   (`task_id`, `scheduled_start`, `duration_minutes`, `block_order`). Para ajustar a
>   fatia depois, use `adjust-schedule-block`.
> Esta task cria um BLOCO DE CALENDÁRIO em `calendar_blocks`.

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
  - `block_type` (`'task' | 'meeting' | 'focus_time' | 'personal' | 'unavailable'`)
  - `start_at`, `end_at` (ISO UTC, end > start, duration max 24h)
  - `title` (string)
  - `assigned_to` (uuid, default auth.uid())
  - `task_id` (uuid opcional — link a task existente)
  - `description` (string opcional)
  - `force_conflict` (bool default false)

### output

- **`block_id`** (uuid — ou task_id se task block)
- **`conflicts_detected`** (array)
- **`google_synced`** (bool — se Google Calendar integrado)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** any authenticated (próprio assigned_to). Para block em outros user, requer admin/owner.
2. **Validar dates:**
   - `end > start`
   - duration ≤ 24h (sanity)
   - start não > 1 ano futuro
3. **Validar block_type** ∈ enum.
4. **Conflict detection** (cruza com as 3 fontes da agenda — colunas REAIS):
   ```sql
   -- blocos de calendário existentes
   SELECT id, title FROM calendar_blocks
    WHERE created_by={assigned_to}
      AND tstzrange(start_time, end_time) && tstzrange({new_start}, {new_end});
   -- blocos de execução de tarefas
   SELECT b.id, t.title FROM task_schedule_blocks b JOIN tasks t ON t.id=b.task_id
    WHERE t.owner_id={assigned_to}
      AND tstzrange(b.scheduled_start, b.scheduled_start + (b.duration_minutes||' min')::interval)
          && tstzrange({new_start}, {new_end});
   ```
5. **Se conflicts AND NOT force_conflict** → ESCALATE com lista de conflitos + flag retry.
6. **Confirmation:**
   ```
   Schedule block:
     Type: {block_type}
     Title: «{title}»
     Period: {start_local} → {end_local} (Europe/Rome) — {duration}
     Assigned: {assigned_name}
     {task_id ? 'Linked task: ' + task_title : ''}
     Conflicts: {N detected — listed}
   Confirma?
   ```
7. **INSERT em `calendar_blocks`** (colunas reais):
   ```sql
   INSERT INTO calendar_blocks (title, block_type, start_time, end_time,
                                created_by, description)
   VALUES ({title}, {block_type}, {new_start}, {new_end}, {assigned_to}, {description})
   RETURNING id;
   ```
   > Para vincular uma fatia a uma tarefa existente, NÃO use esta task — crie em
   > `task_schedule_blocks` (`task_id`, `scheduled_start`, `duration_minutes`).
8. **Side-effect Google Calendar sync:** automático via trigger `enqueue_calendar_sync`
   (`calendar_block` → `calendar_sync_outbox` → `gcal-outbound-worker` cria o evento).
   NÃO chamar edge à mão.
9. **Activity log:** action='platform-specialist.create_schedule_block'.
10. **Echo:**
    ```
    ✓ Block agendado
    {block_type} «{title}»
    {start_local} → {end_local} ({duration})
    {google_synced ? '✓ Google Calendar sincronizado' : 'Google sync: skip (user sem integração)'}
    ```

### acceptance_criteria

- **[A1] Self-block default; cross-user requer admin/owner.**
- **[A2] Date validation (end > start, max 24h).**
- **[A3] Conflict detection.**
- **[A4] force_conflict opt-in.**
- **[A5] Google sync side-effect non-blocking.**
- **[A6] Audit.**

---

## Exemplos

### Exemplo 1 — Pablo cria focus_time

**Input:** type=focus_time, start=14:00, end=16:00, title='Deep work fiscal review'

**Specialist:** no conflicts → confirmation → INSERT → Google sync → DONE.

### Exemplo 2 — Conflict detectado

**Input:** start sobrepõe meeting existente

**Specialist:** ESCALATE com lista + sugestão:
```
Conflito com meeting «{title}» às {time}.
Re-tente com horário diferente OU passe force_conflict=true (overrida).
```

---

## Notas

- **block_type='task' default** se task com due_date sem time block ainda — sistema usa CompactView.
- **Google sync:** edge `create-google-event` cria event externo + linka via google_event_id.
- **block_type values:** 'task' | 'meeting' | 'focus_time' | 'personal' | 'unavailable' (enum CHECK constraint).

---

**Mantido por:** platform-specialist
