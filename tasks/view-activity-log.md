# Task: view-activity-log

> Read-only consulta `activity_logs` com filtros (período/user/resource/action). Audit trail completo. F-16.3.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `View Activity Log`

### responsible_executor `platform-specialist`

### execution_type `Agent` — read-only.

### input
- `filter` (object opcional):
  - `user_id`, `action`, `resource_type`, `resource_id`
  - `date_from`, `date_to` (default últimas 24h)
  - `cycle_id` (squad-specific)
- `limit` (default 100, max 1000)

### output
- `entries` (array): `{id, user_name, action, resource_type, resource_id, details, created_at}`
- `stats`: `{total, top_actions, top_users, top_resources}`
- `verdict`: `DONE`

### action_items

1. **Role:** owner only (audit log é compliance-sensible).
2. Validar limit ≤ 1000 + date range max 1 ano.
3. Query:
   ```sql
   SELECT a.id, a.action, a.resource_type, a.resource_id,
          a.details, a.created_at,
          p.full_name AS user_name
   FROM activity_logs a
   LEFT JOIN profiles p ON p.id = a.user_id
   WHERE ({user_id} IS NULL OR a.user_id={user_id})
     AND ({action} IS NULL OR a.action LIKE {action} || '%')
     AND ({resource_type} IS NULL OR a.resource_type={resource_type})
     AND ({resource_id} IS NULL OR a.resource_id={resource_id})
     AND ({cycle_id} IS NULL OR a.details->>'cycle_id' = {cycle_id})
     AND a.created_at BETWEEN {date_from} AND {date_to}
   ORDER BY a.created_at DESC
   LIMIT {limit};
   ```
4. Stats agregadas (top 5 per dimension).
5. Activity log RECURSIVE (próprio view-activity-log também loga, sutilmente).
6. Echo tabular condensado:
   ```
   📜 Activity Log {date_from} → {date_to}
   Total: {N} entries
   Top actions: {actions list with counts}
   Top users: {users list}
   [Top 20 entries: timestamp, user, action, resource]
   ```

### acceptance_criteria
- A1 Owner only (compliance)
- A2 Limit cap 1000 + date range max 1 ano
- A3 Stats agregadas
- A4 Self-log RECURSIVE (audit acessou audit)
- A5 PII em details: respeitar redaction rules das tasks origem
- A6 Squad cycle_id filter support

---

**Mantido por:** platform-specialist
