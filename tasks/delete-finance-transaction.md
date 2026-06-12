# Task: delete-finance-transaction

> Delete finance_transaction (single ou bulk). Owner+financeiro via `has_finance_access()`. Hard delete (não soft) — operação destrutiva. Joyce/Larissa usam para limpar erros de entrada.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Delete Finance Transaction`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — DUPLA confirmation (destrutivo + irreversível).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `transaction_ids` (array uuid — single ou bulk, max 50)
  - `reason` (string OBRIGATÓRIO — auditoria)
  - `cascade_recurrence` (bool, default false — se tx é parent recorrência, deleta filhos também)
  - `cascade_installments` (bool, default false — se tx é parcela, deleta restantes)

### output

- **`deleted_ids`** (array)
- **`cascaded_ids`** (array — se cascade flags)
- **`total_amount_deleted`** (sum em currencies, info)
- **`verdict`** — `DONE | PARTIAL | BLOCKED`

### action_items

1. **Auth gate `has_finance_access()`** — owner+financeiro. Admin BLOCKED.
2. **Validar ids** array length 1..50.
3. **Reason obrigatório** — sem reason = ESCALATE.
4. **Buscar txs** + classificar:
   ```sql
   SELECT id, amount, currency, description, status, parent_transaction_id, is_recurring, installment_number, total_installments, transaction_date
   FROM finance_transactions
   WHERE id = ANY({ids});
   ```
5. **Identificar relacionamentos:**
   - Parent recurrence (is_recurring=true) com children
   - Parent installment com siblings restantes
   - Tx já completed AND date > 60 dias (warning de audit/compliance)
6. **Calcular cascade:**
   - Se `cascade_recurrence=true` AND parent: incluir filhos
   - Se `cascade_installments=true` AND tem siblings: incluir restantes
7. **Dry-run preview:**
   ```
   ⚠️ DELETE finance transactions

   Selecionadas: {N}
   Cascade adicionais: {M} ({recurrence + installments breakdown})
   Total a deletar: {N+M}

   Total amount: {currency} {sum}
   Período: {min_date} → {max_date}

   Sample (primeiras 10):
     [id, description, amount, status]
     ...

   {warnings_for_old_completed_txs}

   ⚠️ HARD DELETE — irreversível. Audit em activity_logs preserva metadata.
   Razão: {reason}

   Continua? (digite "DELETE TX" uppercase literal)
   ```
8. **Aguardar "DELETE TX"** literal.
9. **DELETE batch** (BEGIN/SAVEPOINT raw não funciona via PostgREST — executar DELETEs sequencialmente ou via EF se existir):
   ```typescript
   // Executar cada DELETE separadamente (máx 50):
   for (const id of transaction_ids) {
     const { error } = await supabase
       .from('finance_transactions')
       .delete()
       .eq('id', id);
     if (error) {
       // log warning, continuar (partial allowed)
       failed_ids.push(id);
     } else {
       deleted_ids.push(id);
     }
   }
   ```
10. **Tratar erros:**
    - 42501 (RLS) → BLOCKED
    - 23503 (FK violation — tx referenciada por opp/invoice) → ESCALATE com lista
11. **Activity log STRICT:** action='platform-specialist.delete_finance_transaction', details com IDs deletados + cascade + total_amount + reason. Single entry para batch.
12. **Echo:**
    ```
    ✓ {N} transactions deletadas
    Total amount: {currency} {sum}
    Cascade: {M} adicionais ({recurrence/installments)
    Reason: {reason}
    Audit log preserved.
    ```

### acceptance_criteria

- **[A1] Auth has_finance_access** — owner+financeiro.
- **[A2] Reason obrigatório.**
- **[A3] Max 50 per batch.**
- **[A4] Tripla confirmation:** "DELETE TX" uppercase.
- **[A5] Cascade opt-in:** flags explícitas.
- **[A6] Atomic per-tx:** SAVEPOINT permite partial.
- **[A7] FK awareness:** tx referenciada = ESCALATE não delete silent.
- **[A8] Audit STRICT:** todos IDs + reason em log único.

---

## Exemplos

### Exemplo 1 — Joyce delete 3 txs duplicadas

**Input:** 3 ids, reason='Duplicates de import Stripe'

**Specialist:** dry-run → "DELETE TX" → 3 deleted → DONE.

### Exemplo 2 — Cascade recorrência

**Input:** 1 parent recorrente, `cascade_recurrence=true`, 12 filhos

**Specialist:** dry-run mostra 1+12=13 → "DELETE TX" → 13 deleted → DONE.

### Exemplo 3 — Tx referenciada por opp → ESCALATE

**Input:** tx vinculada a opp won

**Specialist:** ESCALATE:
```
TX {id} é referenciada por opportunity {opp_id} (instalment Stripe).
Delete romperia linkagem. Para cleanup:
1. Update opp para remover linkagem (sales-specialist)
2. Re-tente delete
Ou marque tx como cancelled em vez de delete.
```

---

## Notas

- **Hard delete:** sem soft-delete trigger ativo em finance_transactions. Row removida fisicamente.
- **Activity log preserva metadata:** mesmo após DELETE, log mantém IDs + amount + description (audit compliance).
- **Cascade caution:** cascade=true sem reason específica = ESCALATE pra confirm.

---

**Mantido por:** platform-specialist
