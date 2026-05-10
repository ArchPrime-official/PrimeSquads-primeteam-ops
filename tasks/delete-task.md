# Task: delete-task

> Delete task (single ou bulk). Hard delete row em `tasks`. Implementa F-08.1.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Delete Task`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — DUPLA confirmation (destrutivo).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `task_ids` (array uuid, max 50)
  - `reason` (string opcional para batch >5)

### output

- **`deleted_count`**, **`deleted_ids`**, **`skipped`** (com causa)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Authority check** (per-task):
   - User pode deletar task SE: user.id = task.created_by OR user.role='owner' OR user é PM do project
   - Outros → BLOCKED com mensagem explicando authority.
2. **Resolver tasks:**
   ```sql
   SELECT id, title, created_by, project_id, status, due_date
   FROM tasks WHERE id = ANY({task_ids});
   ```
3. **Filtrar authorized vs unauthorized:**
   - SELECT só as que user pode tocar (RLS/authority)
   - Surface skipped count
4. **Reason** obrigatório se batch >5.
5. **Confirmation:**
   ```
   Delete tasks: {authorized_count} (de {total} solicitados)
     Skip: {unauthorized_count} (não criadas por você + não-owner)

     Sample (10): [title, status, due_date]

     ⚠️ Hard delete — task_history pode ser perdido se trigger não replicar.
     Reason: {reason or '(sem reason)'}

   Confirma? {batch_count > 5 ? '(digite "DELETE TASKS" uppercase)' : '(sim)'}
   ```
6. **Atomic batch:**
   ```sql
   DELETE FROM tasks WHERE id = ANY({authorized_ids}) RETURNING id;
   ```
7. **Activity log:** action='platform-specialist.delete_task', details com count + reason.
8. **Echo:** "✓ {N} tasks deletadas. {skipped > 0 ? skipped + ' não-autorizadas (não created_by você).' : ''}"

### acceptance_criteria

- **[A1] Authority creator/owner/PM.**
- **[A2] Filter authorized antes de confirmar.**
- **[A3] Tripla confirmation se batch >5.**
- **[A4] Audit count + reason.**
- **[A5] No silent failure** — surface skipped.

---

## Exemplos

### Exemplo 1 — Comercial deleta 3 próprias tasks

**Input:** 3 ids (todas dele)

**Specialist:** all authorized → confirmation → DELETE → DONE.

### Exemplo 2 — Tenta deletar tasks de outros

**Input:** 5 ids, 2 são de Sandra

**Specialist:** filter → 3 authorized + 2 skipped → confirmation com warning → DELETE 3.

---

**Mantido por:** platform-specialist
