# Task: manage-monthly-goals

> CRUD goals (`goals` + `goal_history`). Owner-only. Mensal. F-12.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Manage Monthly Goals`

### responsible_executor `admin-specialist` (owner gate)

### execution_type `Agent` — confirmation simples.

### input
- `action` (`'create' | 'update' | 'list'`)
- **`create`:** `{period (YYYY-MM), area, target_value, currency, type}`
- **`update`:** `goal_id, updates`
- **`list`:** `{period, area}` filters (read-only)

### output
- `goal_id` ou `goals` (array)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Owner-only** para create/update. Read pode ser owner+admin.
2. Validar period format YYYY-MM, target_value > 0.
3. Pre-check duplicate (mesma period+area).
4. Confirmation com summary + auto INSERT em `goal_history`.
5. INSERT/UPDATE atomic.
6. Activity log.

### acceptance_criteria
- A1 Owner gate (create/update)
- A2 Period unique per area
- A3 goal_history audit per change
- A4 Audit log

---

**Mantido por:** admin-specialist
