# Task: manage-task-projects

> CRUD task_projects + project_members. Setup ocasional de novos projetos team. F-08.2.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Manage Task Projects`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation per action.

### input
- `action` (`'create' | 'update' | 'archive' | 'add_member' | 'remove_member'`)
- **`create`:** `{name, description, color, owner_id, member_ids}`
- **`update`:** `project_id, updates`
- **`archive`:** `project_id`
- **`add_member`:** `project_id, member_ids`
- **`remove_member`:** `project_id, member_ids`

### output
- `project_id`, `action_result`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Authority:**
   - `create`: any authenticated user (próprio project), admin/owner para team projects
   - `update/archive`: project owner OR admin/owner
   - `add/remove member`: project owner OR PM role no project OR admin/owner
2. Action-specific validation.
3. Confirmation com summary.
4. Atomic INSERT/UPDATE/DELETE.
5. Activity log per action.

### acceptance_criteria
- A1 Authority per action
- A2 Last admin protection em remove_member
- A3 Atomic batch
- A4 Audit
- A5 Archive ≠ Delete (preserva history)

---

**Mantido por:** platform-specialist
