# Task: import-csv

> Import CSV unificado (leads/opps/transactions). admin/owner. Dry-run obrigatório, batch async.

**⚠️ SCHEMA NOTE (2026-05-10):** Tabela `data_imports` NÃO existe em prod. Tracking pode usar:
- `activity_logs` com `action='import-csv.{table}'` + `details.batch_metadata` (preferido — sem nova table)
- OU criar tabela `data_imports` via migration nova.

`import_batch_id` field exists em alguns target tables (leads, finance_transactions per agent docs) — usar como GROUP key.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Import CSV`

### responsible_executor `imports-specialist` com gate admin/owner

### execution_type `Agent` — DUPLA confirmation + dry-run.

### input
- `csv_url` (signed URL bucket OR base64 inline para small files)
- `target_table` (`'leads' | 'opportunities' | 'finance_transactions' | 'customers'`)
- `mapping` (object — column name → field)
- `dedup_strategy` (`'skip' | 'update' | 'duplicate'`)
- `dry_run` (default true)

### output
- `import_id` (uuid — `data_imports` table)
- `parsed_rows`, `valid_rows`, `errors_count`, `imported_count`
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth gate:** admin/owner.
2. Download CSV + parse.
3. **Dry-run default:** validate rows + dedup analysis + show sample (first 10 + last 10) + counts.
4. Confirmation tripla "IMPORT CSV" + `dry_run=false`.
5. Async job em background (large imports).
6. Activity log STRICT com import_id + counts.

### acceptance_criteria
- A1 admin/owner
- A2 Dry-run default
- A3 Tripla "IMPORT CSV"
- A4 Dedup strategy explicit
- A5 Async job + status polling
- A6 Audit STRICT
- A7 Email notification on completion

---

**Mantido por:** imports-specialist
