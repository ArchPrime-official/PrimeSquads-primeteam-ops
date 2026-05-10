# Task: create-schedule-block

> Criar block de agenda no calendar (focus_time, meeting, personal, unavailable). Implementa F-06 + F-08.

**Cumpre:** HO-TP-001

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
4. **Conflict detection:**
   ```sql
   SELECT id, title, start_at, end_at FROM tasks
   WHERE assigned_to={assigned_to}
     AND block_type IS NOT NULL
     AND tstzrange(start_at, end_at) && tstzrange({new_start}, {new_end});
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
7. **INSERT:**
   ```sql
   INSERT INTO tasks (title, block_type, start_at, end_at, assigned_to,
                       linked_task_id, created_by, description, status)
   VALUES (..., 'todo')
   RETURNING id;
   ```
8. **Side-effect Google Calendar sync:** se user tem Google integrado, edge `google-calendar-sync` cria event correspondente (não-blocking).
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
