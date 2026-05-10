# Task: manage-channel-members

> Add/remove members + change role em canal. channel_admin OR owner.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Manage Channel Members`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation.

### input
- `channel_id` (uuid)
- `action` (`'add' | 'remove' | 'change_role'`)
- **Para `add`:** `member_ids` (array uuid)
- **Para `remove`:** `member_ids` (array)
- **Para `change_role`:** `member_id` + `new_role` (`'admin' | 'member'`)

### output
- `channel_id`, `action`, `affected_count`
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Authority:**
   - Channel admin (verifica `channel_members.role='admin'`)
   - OR Platform owner
2. Resolver channel + members atuais.
3. Action validation:

   **`add`:**
   - Members existem + active
   - Não-duplicate (já members → skip ou warn)

   **`remove`:**
   - Não remover último admin (ESCALATE)
   - Não remover creator do canal (BLOCKED)
   - Members existem no canal

   **`change_role`:**
   - new_role ∈ ('admin', 'member')
   - Não rebaixar último admin

4. Confirmation:
   ```
   {action} em #{channel_name}:
     {add ? 'Add ' + N + ' members: [list]' : ''}
     {remove ? 'Remove ' + N + ' members: [list]' : ''}
     {change_role ? member_name + ': ' + old + ' → ' + new : ''}
   Confirma?
   ```
5. **Atomic batch DB ops** (INSERT/DELETE/UPDATE).
6. Activity log: action='platform-specialist.manage_channel_members_{action}'.
7. Echo: "✓ {affected_count} affected. {summary}"

### acceptance_criteria
- A1 Authority channel admin/owner
- A2 Last admin protection
- A3 Creator can't be removed
- A4 Atomic batch
- A5 Audit per action
- A6 Member existence check

---

**Mantido por:** platform-specialist
