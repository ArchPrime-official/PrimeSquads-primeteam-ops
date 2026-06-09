# Task: reschedule-task

> Atualizar `due_date` (PRAZO) de task com conflict resolution. Implementa F-08.1 + F-08.3 (date change workflow integrado).

**Cumpre:** HO-TP-001

> ⚠️ **SCHEMA — leia `data/tasks-schedule-blocks-field-reference.md` antes.**
> A coluna real do horário da tarefa é `scheduled_start_time` (NÃO existe `scheduled_at`).
> E o horário REAL de execução de uma tarefa fatiada está nos BLOCOS
> (`task_schedule_blocks.scheduled_start`), não num campo único da tarefa.
> **Para mover o horário/dia de um BLOCO específico, use a task `adjust-schedule-block`.**
> Esta task cuida do PRAZO (`due_date`); ao mudar o due_date, o trigger
> `reschedule_on_due_date_change` desloca os blocos pelo mesmo delta automaticamente.

---

## Task anatomy

### task_name
`Reschedule Task`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — confirmation + integrated F-08.3 workflow se não-creator.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `task_id` (uuid)
  - `new_due_date` (ISO timestamp UTC) — o PRAZO. Ao mudar, o trigger
    `reschedule_on_due_date_change` desloca `scheduled_start_time` e os blocos pelo delta.
  - `reason` (string)
  - `force_conflict` (bool default false — overrida conflitos calendar)
  > Para mover o horário/dia de um BLOCO específico (não o prazo), use `adjust-schedule-block`.

### output

- **`task_id`**, **`new_due_date`**
- **`f_08_3_request_id`** (uuid, se workflow disparado)
- **`conflicts_detected`** (array opcional)
- **`verdict`** — `DONE | REQUEST_CREATED | BLOCKED | ESCALATE`

### action_items

1. **Resolver task** + creator + assigned_to.
2. **Authorization (F-08.3 integration):**
   - User é created_by OR owner: UPDATE direto + audit
   - Outros: cria F-08.3 request (`task_date_change_requests`) — **delega para `request-task-date-change`** task
3. **Conflict detection** (se UPDATE direto autorizado) — colunas/tabelas REAIS:
   ```sql
   -- outras tarefas com prazo próximo
   SELECT id, title FROM tasks
    WHERE owner_id={task.owner_id}
      AND due_date BETWEEN {new_due} - interval '30 min' AND {new_due} + interval '30 min'
      AND id != {task_id};
   -- blocos de execução no horário (agenda real)
   SELECT b.id, t.title FROM task_schedule_blocks b JOIN tasks t ON t.id=b.task_id
    WHERE t.owner_id={task.owner_id}
      AND b.scheduled_start BETWEEN {new_due} - interval '30 min' AND {new_due} + interval '30 min';
   -- reuniões/blocos internos (calendar_blocks usa start_time)
   SELECT id, title FROM calendar_blocks
    WHERE created_by={task.owner_id}
      AND start_time BETWEEN {new_due} - interval '30 min' AND {new_due} + interval '30 min';
   ```
4. **Se conflicts AND NOT force_conflict** → ESCALATE com lista + flag para retry.
5. **Confirmation:**
   ```
   Reschedule task «{title}»:
     Due date (prazo): {old} → {new}
     (os blocos serão deslocados pelo mesmo delta automaticamente)
     Conflicts: {N detected}
       [list]
     Reason: {reason}
   {f_08_3_path ? 'Você não é creator nem owner — vai como REQUEST.' : 'Update direto.'}
   Confirma?
   ```
6. **UPDATE atomic** (se autorizado) + INSERT `task_date_changes` audit.
7. **OR delega para `request-task-date-change`** se não-creator.
8. **Activity log:** action='platform-specialist.reschedule_task'.
9. **Echo:** depende do path (DONE com new dates OR REQUEST_CREATED com pending_request_id).

### acceptance_criteria

- **[A1] F-08.3 integration:** non-creator/non-owner → REQUEST_CREATED.
- **[A2] Conflict detection** com calendar events.
- **[A3] force_conflict opt-in.**
- **[A4] Audit em task_date_changes** se UPDATE direto.
- **[A5] Echo educacional** explica path tomado (direct vs request).

---

## Notas

- Reuso de `update-task` + `request-task-date-change` (delegação).
- **Horário da tarefa = `scheduled_start_time`** (NÃO `scheduled_at`). Conflitos de
  calendário: cruzar com `task_schedule_blocks.scheduled_start`, `calendar_blocks.start_time`
  e `google_calendar_events_cache.start_time` — não com colunas inexistentes.
- **Mover bloco individual:** `adjust-schedule-block`. **Redistribuir todos os blocos:**
  auto-scheduling. Ver `data/tasks-schedule-blocks-field-reference.md`.

---

**Mantido por:** platform-specialist
