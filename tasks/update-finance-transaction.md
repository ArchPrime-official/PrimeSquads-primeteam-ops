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
    - `cost_center_id`, `bank_account_id`, `credit_card_id`, `invoice_id`
    - `brand` (empresa — re-confirmar ao trocar conta; ver passo 3.5)
    - `transaction_date`, `status` (`'completed' | 'predicted' | 'delayed' | 'cancelled'`)
    - `notes`, `tags`
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
   - `status` ∈ `('completed','predicted','delayed','cancelled')` — vocabulário REAL de `finance_transactions` (checklist finance-triggers-hazard). NÃO 'confirmed' legacy; NÃO 'paid'/'pending' (esses vivem em `finance_pending_transactions`, tabela distinta).
   - `amount` ≠ 0 se passado
   - `currency` ISO 4217
   - `category_id`/`subcategory_id` existem (FK)
3.5. **Brand re-confirm ao trocar conta (`bank_account_id`/`credit_card_id`):** o trigger `set_finance_transaction_brand` só deriva a empresa quando `NEW.brand IS NULL` — em UPDATE o `brand` ANTIGO persiste, então mudar a conta para outra empresa deixa a TX com a **empresa errada**. Se `bank_account_id`/`credit_card_id` estão nos updates: resolver a empresa da nova conta (`finance_bank_accounts.company_id` / `finance_credit_cards.company_id` → `companies`) e **incluir `brand` explicitamente no UPDATE** (obrigatório no registry — `forbidden_defaults: [brand]`). Não confie na re-derivação automática.
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
6.5. **HAZARD — desabilitar pelo NOME (nunca `DISABLE TRIGGER USER`, que cega a auditoria) SÓ os triggers que os `updates` disparam.** Ver checklist `finance-triggers-hazard`. Os 3 perigosos de `finance_transactions`:

   | Se os `updates` tocam… | Desabilitar ANTES do UPDATE | Por quê |
   |---|---|---|
   | `amount` / `card_amount` / `currency` | `trg_recompute_converted_on_update` | recalcula `converted_amount` pela taxa e **SOBRESCREVE o `converted_amount` manual do passo 4** (corrupção — incidentes 30/06 e 02/07) |
   | `credit_card_id` / `bank_account_id` / `invoice_id` | `auto_link_transaction_to_invoice` (`BEFORE INSERT OR UPDATE OF credit_card_id, bank_account_id, invoice_id`) | **suga uma fatura órfã** compatível para a transação, criando vínculo errado (incidentes 30/06+02/07) |
   | `status` de uma linha de VENDA (tx com `opportunity_id`/`seller_user_id`/`sale_date`) | considerar `handle_commercial_sale_pending_transactions` | dispara/duplica a **previsão de entrada** (pending fantasma) |

   ```sql
   -- DDL — canal PRIVILEGIADO. ALTER TABLE ... DISABLE/ENABLE TRIGGER é DDL de owner;
   -- NÃO roda via PostgREST/JWT do usuário. Executar pelo runner SQL admin (não pela EF do user).
   ALTER TABLE finance_transactions DISABLE TRIGGER trg_recompute_converted_on_update;      -- se amount/card_amount/currency
   ALTER TABLE finance_transactions DISABLE TRIGGER auto_link_transaction_to_invoice;        -- se credit_card_id/bank_account_id/invoice_id
   -- ... o UPDATE do passo 7 (com converted_amount manual + brand explícito do passo 3.5) ...
   ALTER TABLE finance_transactions ENABLE TRIGGER auto_link_transaction_to_invoice;
   ALTER TABLE finance_transactions ENABLE TRIGGER trg_recompute_converted_on_update;
   ```
   Ao reverter um erro, corrigir **`amount` E `converted_amount`** (não só um). Fonte da reversão: `finance_audit_log` / snapshot pré-UPDATE.
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
8.5. **VERIFICAÇÃO PÓS-AÇÃO (obrigatória se algum hazard foi desabilitado):** re-SELECT da linha e confirmar:
   - `converted_amount` == o valor manual do passo 4 (NÃO foi recomputado pela taxa);
   - se trocou conta: `brand` == empresa da nova conta (passo 3.5), e `invoice_id`/`sales_invoice_id` NÃO foram alterados por link automático indesejado;
   - **os triggers foram RE-HABILITADOS** — checar `pg_trigger.tgenabled` (`SELECT tgname, tgenabled FROM pg_trigger WHERE tgrelid='finance_transactions'::regclass AND tgname IN ('trg_recompute_converted_on_update','auto_link_transaction_to_invoice')` → ambos `'O'`, habilitados). Deixar um trigger financeiro DESABILITADO é incidente. Se ainda `'D'`, RE-ENABLE e ESCALATE.
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
- **[A2] Status enum:** aceita `completed/predicted/delayed/cancelled` (inclui `delayed`); rejeita 'confirmed' legacy e 'paid'/'pending' (outra tabela).
- **[A3] Multi-currency:** converted_* mandatory se currency != native.
- **[A4] Parent recurrence guard:** tx parent com children = BLOCKED em amount/currency/category.
- **[A5] Hazard triggers pelo NOME (nunca `DISABLE TRIGGER USER`):** `trg_recompute_converted_on_update` se amount/card_amount/currency; `auto_link_transaction_to_invoice` se credit_card_id/bank_account_id/invoice_id; `handle_commercial_sale_pending_transactions` a considerar em status de linha de venda. DISABLE antes / ENABLE após. É DDL (canal admin, não PostgREST/JWT do user).
- **[A6] Brand re-confirm:** ao trocar `bank_account_id`/`credit_card_id`, `brand` re-resolvido e escrito explicitamente (trigger não re-deriva em UPDATE).
- **[A7] Verificação pós-ação:** re-query confirma `converted_amount` intacto E triggers RE-HABILITADOS (`pg_trigger.tgenabled='O'`).
- **[A8] Confirmation OBRIGATÓRIO** com diff visível.
- **[A9] Audit:** before/after diff em activity_logs.
- **[A10] Reason recomendado** em mudanças de amount/status (warn se ausente).

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
