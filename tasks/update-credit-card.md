# Task: update-credit-card

> UPDATE finance_credit_cards (limit, due_day, active, accepts_new). has_finance_access.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Update Credit Card`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation com impacto preview.

### input
- `card_id` (uuid)
- `updates`: `{name, credit_limit, due_day (1..31), active, accepts_new, color, sort_order, notes}`
- `version` (optimistic lock)

### output
- `card_id`, `updated_fields`
- `affected_invoices_count`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth has_finance_access** (admin BLOCKED).
2. Resolver card + open invoices.
3. Validar:
   - `due_day` ∈ 1..31
   - `credit_limit` >= 0
   - `accepts_new=false` AND open invoice → warn "fatura aberta continua receber TXs até fechar"
4. Confirmation com:
   - Diff
   - Open invoices count
5. UPDATE atomic version lock.
6. Activity log com diff.
7. Echo: "✓ Card atualizado. {accepts_new_change ? Reflete em pagamento de novas TXs.}"

### acceptance_criteria
- A1 has_finance_access
- A2 due_day range 1..31
- A3 accepts_new vs open invoice warn
- A4 Optimistic lock
- A5 Audit

---

**Mantido por:** platform-specialist
