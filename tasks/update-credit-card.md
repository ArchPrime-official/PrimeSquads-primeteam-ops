# Task: update-credit-card

> UPDATE finance_credit_cards (limit, due_day, closing_day, status). has_finance_access.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Update Credit Card`

### responsible_executor `platform-specialist`

### execution_type `Agent` — confirmation com impacto preview.

### input
- `card_id` (uuid)
- `updates` — SÓ colunas REAIS de `finance_credit_cards` (schema-verified 2026-07-03; 15 colunas). Editáveis: `name`, `credit_limit`, `due_day` (1..31), `closing_day` (1..31), `status`, `currency`, `company_id`, `card_type`, `last_four_digits`, `adjustment_amount`, `bank_name`.
  - **NÃO existem** `active`, `accepts_new`, `color`, `sort_order`, `notes`, `version` — rejeitar se vierem no payload. O toggle real é **`status`** (não `active`).

### output
- `card_id`, `updated_fields`
- `affected_invoices_count`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth has_finance_access** (admin BLOCKED).
2. Resolver card + faturas abertas do cartão (não há `version` para optimistic lock; comparar `updated_at` se precisar detectar concorrência).
3. Validar:
   - `due_day` ∈ 1..31 (dia de vencimento da fatura)
   - `closing_day` ∈ 1..31 — **crítico p/ o ciclo da fatura** (define quando a fatura fecha e as TXs migram para a próxima). Warn se `closing_day`/`due_day` mudam com fatura aberta: afeta o fechamento em curso.
   - `credit_limit` >= 0
   - `status`: mudar para inativo/bloqueado → warn "fatura aberta continua a receber TXs até fechar" (é `status`, não `accepts_new`).
   - `company_id`: 1 cartão = 1 empresa → trocar muda o **brand** das TXs futuras do cartão; confirmar.
4. Confirmation com: Diff + contagem de faturas abertas.
5. **UPDATE atomic** (`updated_at`=NOW()). Sem version lock.
6. **Tratar erros:**
   - 42501 (RLS) → BLOCKED (has_finance_access)
   - 23514 (CHECK due_day/closing_day/credit_limit) / 23503 (FK company_id) → BLOCKED com o campo ofensor
7. **Verificação pós-ação:** re-SELECT confirmando os `updated_fields` persistidos (em especial `status`/`closing_day`/`due_day`).
8. Activity log com diff.
9. Echo: "✓ Card atualizado. {status_change ? 'Novo status reflete no recebimento de novas TXs.' : ''} {closing_day_change ? 'Ciclo de fatura ajustado.' : ''}"

### acceptance_criteria
- A1 has_finance_access
- A2 Só colunas reais (rejeita active/accepts_new/color/sort_order/notes/version); toggle via `status`
- A3 due_day E closing_day range 1..31 (closing_day exposto — ciclo da fatura)
- A4 Tratamento de erro (42501/23514/23503) + verificação pós-ação
- A5 Audit

---

**Mantido por:** platform-specialist
