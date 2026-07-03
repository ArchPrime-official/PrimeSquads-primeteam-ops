# Task: update-finance-transaction

> Atualizar finance_transaction (description, amount, category, status, cost center, etc.). Joyce/Larissa usam DIARIAMENTE para correções. Owner+financeiro via `has_finance_access()` (admin EXCLUDED).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Finance Transaction`

### responsible_executor
`platform-specialist`

### execution_type
`Agent` — confirmation OBRIGATÓRIO.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `transaction_id` (uuid)
  - `updates` (object — qualquer subset):
    - `description`, `amount` (numeric), `currency`, `category_id`, `subcategory_id`
    - `cost_center_id`, `bank_account_id`, `credit_card_id`
    - `transaction_date`, `status` (`'predicted' | 'completed' | 'cancelled'`)
    - `is_paid` (bool), `notes`, `tags`
  - `reason` (string, recomendado se mudou amount ou status)

### output

- **`transaction_id`**, **`updated_fields`**
- **`row_snapshot_before`** + **`row_snapshot_after`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate `has_finance_access()`** — owner+financeiro. **Admin BLOCKED** (segregation: módulo Finance ≠ Invoices):
   ```
   Update finance transaction requer role owner ou financeiro.
   Sua role: {role}. Admin não tem acesso ao Finance (segregação HMRC).
   Para invoices/comissões: admin tem acesso via has_invoice_access().
   ```
2. **Resolver tx:** SELECT id, amount, currency, status, category_id, transaction_date, parent_transaction_id, recurrence_number, installment_number, FROM finance_transactions.
3. **Validar updates:**
   - `status` ∈ `('predicted','completed','cancelled')` (canonical — NÃO 'confirmed' legacy)
   - `amount` ≠ 0 se passado
   - `currency` ISO 4217
   - `category_id`/`subcategory_id` existem (FK)
4. **Multi-currency check:** se `currency` mudou OU `amount` mudou em currency != native, exigir `converted_amount`, `converted_currency`, `exchange_rate`, `conversion_date` no payload (memory:multi-currency-hybrid-cards-2026-04-30).
5. **Pre-check parent recurrence:** se tx é parent (`is_recurring=true`) AND children já gerados, BLOCK changes em amount/currency/category (INV-FR-03 wf-finance-recurrence). ESCALATE com:
   ```
   Esta TX é parent de recorrência com filhos gerados.
   Não posso alterar amount/currency/category (quebra consistência histórica).
   Para alterar série inteira: criar novo parent.
   ```
6. **Confirmation:**
   ```
   Update finance transaction:
     ID: {tx_id}
     Description: {description}
     Diff:
       {field}: {old} → {new}
       ...
     {amount_change ? '⚠️ Mudança em amount: ' + old + ' → ' + new : ''}
     {status_change ? 'Status: ' + old + ' → ' + new : ''}
     Reason: {reason or '(sem reason — recomendado documentar)'}
   Confirma?
   ```
6.5. **HAZARD — se `amount`/`card_amount`/`currency` nos updates (obrigatório):** desabilitar o recompute ANTES do UPDATE, senão o trigger `trg_recompute_converted_on_update` recalcula `converted_amount` pela taxa e **SOBRESCREVE o `converted_amount` manual exigido no passo 4** (corrupção — incidentes 30/06 e 02/07):
   ```sql
   ALTER TABLE finance_transactions DISABLE TRIGGER trg_recompute_converted_on_update;
   -- ... o UPDATE do passo 7 (com converted_amount manual) ...
   ALTER TABLE finance_transactions ENABLE TRIGGER trg_recompute_converted_on_update;
   ```
   NUNCA `DISABLE TRIGGER USER` (cega a auditoria). Ao reverter um erro, corrigir **`amount` E `converted_amount`**. Ver checklist `finance-triggers-hazard`.
7. **UPDATE atomic:**
   ```sql
   UPDATE finance_transactions
   SET {fields}, updated_by=auth.uid(), updated_at=NOW()
   WHERE id={tx_id}
   RETURNING id, ...;
   ```
8. **Tratar erros:**
   - 42501 (RLS) → BLOCKED com explicação has_finance_access
   - 23514 (CHECK status enum) → BLOCKED
   - 23503 (FK category/account) → BLOCKED
9. **Activity log:** action='platform-specialist.update_finance_transaction', details com diff (sem amount completo se >€10k, mascarar para evitar PII em logs).
10. **Echo:**
    ```
    ✓ Transaction atualizada
    Diff aplicado: {N fields}
    {amount_change ? 'Saldo recalculado em background.' : ''}
    Activity log registrado.
    ```

### acceptance_criteria

- **[A1] Auth has_finance_access** — owner+financeiro only. Admin BLOCKED.
- **[A2] Status enum:** rejeita 'confirmed' legacy.
- **[A3] Multi-currency:** converted_* mandatory se currency != native.
- **[A4] Parent recurrence guard:** tx parent com children = BLOCKED em amount/currency/category.
- **[A5] Hazard trigger:** se amount/card_amount/currency mudam, `trg_recompute_converted_on_update` DISABLE pelo nome antes do UPDATE + ENABLE após (protege o `converted_amount` manual). Nunca `DISABLE TRIGGER USER`.
- **[A5] Confirmation OBRIGATÓRIO** com diff visível.
- **[A6] Audit:** before/after diff em activity_logs.
- **[A7] Reason recomendado** em mudanças de amount/status (warn se ausente).

---

## Exemplos

### Exemplo 1 — Joyce corrige category de tx (DONE)

**Input:** `tx_id`, `updates={category_id=novo}`, reason='Reclassificação Salário→Pro-labore'

**Specialist:** auth ✓, FK ✓, confirmation → UPDATE → DONE.

### Exemplo 2 — Admin tenta update → BLOCKED

**Input:** Joyce (admin) → BLOCKED imediato com explicação segregation.

### Exemplo 3 — Tentativa de mudar amount em parent recorrente → BLOCKED

**Input:** tx is_recurring=true com 12 children gerados, mudança amount

**Specialist:** BLOCKED:
```
Esta TX é parent de recorrência (12 children gerados).
Não posso alterar amount sem quebrar consistência histórica.
Para alterar série: cancelar (status=cancelled) + criar novo parent
com novo amount + gerar nova série.
```

---

## Notas

- **Trigger recompute_converted:** AFTER UPDATE em finance_transactions recompute saldo se amount/currency mudou (memory:multi-currency-hybrid-cards).
- **Status canonical:** 'completed' é o valor canonical (não 'confirmed' legacy — memory:audit-2026-finance-patterns).
- **Receipt attachment:** anexar recibo é op separada (Tier 2 backlog `attach-receipt`).

---

**Mantido por:** platform-specialist
