# Task: reschedule-task

> Atualizar `due_date` ou `scheduled_at` de task com conflict resolution. Implementa F-08.1 + F-08.3 (date change workflow integrado).

**Cumpre:** HO-TP-001

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
  - `new_due_date` (ISO timestamp UTC)
  - `new_scheduled_at` (ISO opcional — se task tem time block)
  - `reason` (string)
  - `force_conflict` (bool default false — overrida conflitos calendar)

### output

- **`task_id`**, **`new_due_date`**, **`new_scheduled_at`**
- **`f_08_3_request_id`** (uuid, se workflow disparado)
- **`conflicts_detected`** (array opcional)
- **`verdict`** — `DONE | REQUEST_CREATED | BLOCKED | ESCALATE`

### action_items

1. **Resolver task** + creator + assigned_to.
2. **Authorization (F-08.3 integration):**
   - User é created_by OR owner: UPDATE direto + audit
   - Outros: cria F-08.3 request (`task_date_change_requests`) — **delega para `request-task-date-change`** task
3. **Conflict detection** (se UPDATE direto autorizado):
   ```sql
   SELECT id, title FROM tasks
   WHERE assigned_to={task.assigned_to}
     AND (due_date BETWEEN {new_due} - 30min AND {new_due} + 30min
          OR scheduled_at BETWEEN ...)
     AND id != {task_id};

   SELECT id, summary FROM calendar_events
   WHERE assigned_to={task.assigned_to}
     AND start_at BETWEEN {new_scheduled_at} AND {new_scheduled_at} + duration;
   ```
4. **Se conflicts AND NOT force_conflict** → ESCALATE com lista + flag para retry.
5. **Confirmation:**
   ```
   Reschedule task «{title}»:
     Due date: {old} → {new}
     {new_scheduled_at ? 'Scheduled at: ' + old + ' → ' + new : ''}
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
- `scheduled_at` é coluna opcional para tasks que têm time block visual no calendário.

---

**Mantido por:** platform-specialist
