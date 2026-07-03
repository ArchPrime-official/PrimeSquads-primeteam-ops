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
- `updates` — SÓ colunas REAIS de `finance_bank_accounts` (schema-verified 2026-07-03; 27 colunas). Editáveis relevantes: `name`, `bank_name`, `account_type`, `currency`, `is_active`, `company_id`, `initial_balance`, `due_day`, `closing_day`, `iban`/`bic`/`sort_code`/`routing_number`/`account_number`, `linked_credit_card_id`.
  - **NÃO existem** `color`, `sort_order`, `notes`, `version` — rejeitar se vierem no payload.

### output
- `account_id`, `updated_fields`
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth has_finance_access** (admin BLOCKED).
2. Resolver account (SELECT dos campos atuais para o diff — não há `version` para optimistic lock; se precisar concorrência, comparar `updated_at` do SELECT vs UPDATE).
3. Validar:
   - `currency` ISO 4217. Mudança raríssima e de alto impacto → warn: **recomputa `converted_amount` de TODAS as txs da conta** (via cron/recompute).
   - `company_id`: 1 conta = 1 empresa. Trocar `company_id` muda o **brand** derivado das txs futuras dessa conta → warn e confirmar empresa correta.
   - `is_active=false` se há txs recentes (last 30d) → warn "deactivate vai esconder da UI mas preserva history".
4. Confirmation com diff.
5. **UPDATE atomic** (`updated_by`=auth.uid() se a coluna existir, `updated_at`=NOW()). Sem version lock.
6. **Tratar erros:**
   - 42501 (RLS) → BLOCKED (has_finance_access)
   - 23514 (CHECK) / 23503 (FK company_id) → BLOCKED com o campo ofensor
7. **Verificação pós-ação:** re-SELECT confirmando os `updated_fields` persistidos (e, se mudou `currency`/`company_id`, registrar que o recompute de balances/brand roda em background).
8. Activity log com diff.
9. Echo: "✓ Account atualizada. {currency_change ? 'Recompute de converted_amount das txs via cron.' : ''}"

### acceptance_criteria
- A1 has_finance_access
- A2 Só colunas reais (rejeita color/sort_order/notes/version)
- A3 Currency change warning (recompute converted_amount) + company_id ⇒ brand warning
- A4 Tratamento de erro (42501/23514/23503) + verificação pós-ação
- A5 Audit diff

---

**Mantido por:** platform-specialist
