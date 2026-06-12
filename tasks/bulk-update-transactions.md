# Task: bulk-update-transactions

> Atualizar batch de finance_transactions (categoria/status/cost_center). Joyce/Larissa pós-import. has_finance_access (owner+financeiro).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Bulk Update Transactions`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — DUPLA confirmation + dry-run.

### input

- `transaction_ids` (array uuid OR `filter`)
- `filter`: `{date_from, date_to, status, category_id, bank_account_id, has_no_category}`
- `updates`: `{category_id, subcategory_id, status, cost_center_id, tags_add, notes_append}`
- `reason` (string OBRIGATÓRIO)
- `max_count` (default 100, hard cap 500)

### output

- `batch_id`, `updated_count`, `skipped_count`, `failed_count`
- `verdict`: `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth has_finance_access** (admin BLOCKED).
2. Resolver IDs via lista direta OR filter (limit max).
3. Reason obrigatório.
4. Validar updates (FK category/subcategory, status enum 'predicted/completed/cancelled').
5. Dry-run preview com sample 10 + counts + total amount afetado.
6. Tripla confirmation "CONFIRMO BULK UPDATE TX" uppercase.
7. Atomic batch SAVEPOINT per-tx.
8. Activity log batch entry com IDs+reason.
9. Echo: counts + cleanup info se PARTIAL.

### acceptance_criteria

- A1 has_finance_access (admin EXCLUDED)
- A2 Reason obrigatório
- A3 Max 500 batch
- A4 Tripla "CONFIRMO BULK UPDATE TX"
- A5 Atomic per-tx via SAVEPOINT
- A6 Audit single batch entry
- A7 Multi-currency check em filter (warn se mistura currencies)

---

**Mantido por:** platform-specialist
