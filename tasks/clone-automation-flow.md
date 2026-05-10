# Task: clone-automation-flow

> Clonar automation_flow (deep copy nodes/edges) para variar sem mexer no original. Status reset para draft.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Clone Automation Flow`

### responsible_executor `automation-specialist`

### execution_type `Agent` — confirmation simples.

### input
- `source_flow_id` (uuid)
- `new_name` (string OR auto: source.name + ' (copy)')
- `clone_trigger` (bool default true)

### output
- `cloned_flow_id` (uuid)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** marketing/comercial/admin/owner.
2. Resolver source flow.
3. Validar new_name uniqueness.
4. Confirmation: source name → new name + clone trigger.
5. INSERT atomic deep copy:
   ```sql
   INSERT INTO automation_flows (name, description, nodes, edges,
                                 trigger_type, trigger_config, status,
                                 created_by, cloned_from_id)
   SELECT {new_name}, description || ' (cloned)', nodes, edges,
          CASE WHEN {clone_trigger} THEN trigger_type ELSE 'manual' END,
          CASE WHEN {clone_trigger} THEN trigger_config ELSE NULL END,
          'draft', auth.uid(), id
   FROM automation_flows WHERE id={source_flow_id}
   RETURNING id;
   ```
6. Activity log com source+new IDs.
7. Echo: "✓ Flow clonado (draft). Edit + activate when ready."

### acceptance_criteria
- A1 Role check
- A2 Name uniqueness
- A3 Status starts draft
- A4 cloned_from_id audit/lineage
- A5 Trigger clone opt-in (default sim)

---

**Mantido por:** automation-specialist
