# Task: import-csv

> Import CSV unificado (leads/opps/transactions). admin/owner. Dry-run obrigatório, batch async.

**✅ SCHEMA ADAPTED (2026-05-10):** Tabela `data_imports` NÃO existe — adaptado para usar `activity_logs` com `action='imports-specialist.import_csv.{target_table}'` + `details.batch_metadata` (parsed_rows, valid_rows, errors_count, imported_count, source_url, dedup_strategy). `import_batch_id` field é gerado UUID e propagado em todas rows inseridas (target tables como `leads`, `finance_transactions` já têm coluna `import_batch_id`).

**Tracking adaptado:**
```sql
INSERT INTO activity_logs
  (user_id, action, resource_type, resource_id, details, created_at)
VALUES
  (auth.uid(),
   'imports-specialist.import_csv.{table}',
   'csv_batch',
   {batch_uuid},
   jsonb_build_object(
     'parsed_rows', N,
     'valid_rows', V,
     'errors_count', E,
     'imported_count', I,
     'source_url', {csv_url},
     'dedup_strategy', {strategy},
     'target_table', {table}
   ),
   NOW());
```

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
