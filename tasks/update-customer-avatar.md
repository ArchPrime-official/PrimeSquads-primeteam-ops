# Task: update-customer-avatar

> Atualizar perfil rico de customer (avatar, segment, health_score, tags, manager_id). CS mantém para alimentar Chat AI + dashboards. F-05.4.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Update Customer Avatar`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation simples.

### input
- `customer_id` (uuid OR `email`)
- `updates`: `{name, segment, health_score (1..10), tags, notes, manager_id, status, onboarding_status, last_contact_at}`

### output
- `customer_id`, `updated_fields`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** cs/admin/owner.
2. Resolver customer.
3. Validar:
   - `health_score` 1..10
   - `manager_id` existe AND has cs role
   - `segment` ∈ enum (warn se valor novo, sugere registrar)
4. Confirmation:
   ```
   Update customer {name}:
     Diff: ...
     {health_change ? 'Score: ' + old + ' → ' + new + ' (' + (delta) + ')' : ''}
     {manager_change ? 'Novo manager: ' + manager_name : ''}
   ```
5. UPDATE atomic.
6. Side-effect: se `last_contact_at` updated, trigger calcula health_score automatic.
7. Activity log diff.
8. Echo: "✓ Customer atualizado. Chat AI ingestion no próximo cron."

### acceptance_criteria
- A1 cs/admin/owner
- A2 Health 1..10
- A3 Manager has cs role
- A4 Audit diff
- A5 Tag preservation (add/remove modes)

---

**Mantido por:** platform-specialist
