# Task: export-opportunities-csv

> Exportar opportunities como CSV (filtros + custom columns). Comercial análise externa Google Sheets. Read-only.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Export Opportunities CSV`

### responsible_executor `sales-specialist`

### execution_type `Agent` — read-only, async job.

### input
- `filter` (object): `{stage, owner_id, campaign_id, period_from, period_to, status, value_min, value_max}`
- `columns` (array, default standard set)
- `format` (`'csv' | 'xlsx'`, default csv)
- `delivery` (`'inline' | 'email_link'`, default inline se < 1k rows)

### output
- `export_id` (uuid — `data_exports` table)
- `download_url` (signed URL bucket — 24h expiry)
- `row_count`, `file_size_kb`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** comercial/admin/owner.
2. Resolver filter → preview count:
   ```sql
   SELECT COUNT(*) FROM opportunities WHERE {filter} AND deleted_at IS NULL;
   ```
3. **Sanity:** count > 50000 → ESCALATE (sugere refinar filter ou usar diagnose-database).
4. Confirmation:
   ```
   Export {N} opportunities → {format}
     Columns: {N selecionadas}
     Filter: {summary}
     Delivery: {inline/email}
   Confirma?
   ```
5. **Generate via edge** `generate-opportunities-export`:
   ```typescript
   await supabase.functions.invoke('generate-opportunities-export', {
     body: { filter, columns, format, delivery },
   });
   ```
6. **Persist em `data_exports`** com signed URL (bucket privado, 24h expiry).
7. Activity log: action='sales-specialist.export_opportunities_csv', details com filter+count.
8. Echo:
   ```
   ✓ Export pronto
   Rows: {N} | Size: {KB}
   Download: {url} (expira em 24h)
   {delivery=email ? 'Link enviado por email também' : ''}
   ```

### acceptance_criteria
- A1 comercial/admin/owner
- A2 Count cap 50k (refine filter)
- A3 Signed URL 24h expiry
- A4 PII em CSV: phone last 4 OR full (admin/owner only)
- A5 Audit log com filter
- A6 Format support: csv + xlsx

---

**Mantido por:** sales-specialist
