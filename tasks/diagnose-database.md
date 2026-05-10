# Task: diagnose-database

> Read-only table introspection (schema, row counts, last writes). Owner-only emergency diagnostics.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Diagnose Database`

### responsible_executor `admin-specialist` (owner-only)

### execution_type `Agent` — read-only.

### input
- `tables` (array — list of table names, max 20)
- `include_schema` (bool default true)
- `include_row_counts` (bool default true)
- `include_recent_writes` (bool default false — pode ser pesado)
- `include_rls_policies` (bool default true)

### output
- `table_diagnostics` (array per table):
  - `name`, `row_count`, `columns`, `indexes`, `rls_policies`, `last_write_at`
- `verdict`: `DONE`

### action_items

1. **Owner-only gate** (sensível — schema info).
2. Validar table names existem em information_schema.
3. Query metadata via:
   ```sql
   SELECT column_name, data_type, is_nullable
   FROM information_schema.columns WHERE table_name=...;

   SELECT * FROM pg_indexes WHERE tablename=...;

   SELECT * FROM pg_policies WHERE tablename=...;
   ```
4. Row count via `SELECT COUNT(*)` (para small tables) OR pg_stat_user_tables (estimate para large).
5. Activity log: action='admin-specialist.diagnose_database', details com tables (não dados).
6. Echo: tabular per table.

### acceptance_criteria
- A1 Owner-only
- A2 Max 20 tables per call
- A3 Read-only (zero mutations)
- A4 Audit log filter only
- A5 No PII em output (apenas schema, não dados)

---

**Mantido por:** admin-specialist
