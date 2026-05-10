# Task: update-bank-account

> UPDATE finance_bank_accounts (rename, currency link, active toggle). Setup-once mas existe na UI. has_finance_access.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Update Bank Account`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation simples.

### input
- `account_id` (uuid)
- `updates`: `{name, currency, is_active, color, sort_order, notes}`
- `version` (optimistic lock)

### output
- `account_id`, `updated_fields`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth has_finance_access** (admin BLOCKED).
2. Resolver account.
3. Validar:
   - `currency` ISO 4217 (mudança raríssima — warn que recomputa balances)
   - `is_active=false` se há txs recentes (last 30d) → warn "deactivate vai esconder da UI mas preserva history"
4. Confirmation com diff.
5. UPDATE atomic com version lock.
6. Activity log com diff.
7. Echo: "✓ Account atualizada. {currency_change ? Recompute balance via cron.}"

### acceptance_criteria
- A1 has_finance_access
- A2 Currency change warning
- A3 Optimistic lock
- A4 Audit diff

---

**Mantido por:** platform-specialist
