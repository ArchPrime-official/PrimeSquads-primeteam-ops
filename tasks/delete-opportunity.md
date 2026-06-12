# Task: delete-opportunity

> Hard-delete opportunity (DELETE físico). Comercial/admin/owner. IRREVERSÍVEL — decisão Pablo D3 (2026-06-12): colunas `deleted_at/deleted_by/deletion_reason` NÃO existem em `opportunities`. Confirmação tripla obrigatória.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Delete Opportunity`

### responsible_executor
`sales-specialist`

### execution_type
`Agent` — DUPLA confirmation (impacto pipeline).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `opportunity_id` (uuid)
  - `reason` (string OBRIGATÓRIO — auditoria em activity_logs)

### output

- **`opportunity_id`**, **`customer_name`**, **`mode`**: `'hard'` (único modo)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:**
   - Comercial: só deleta opp com `sales_user_id = auth.uid()` (própria)
   - Admin/Owner: deleta qualquer
2. **Resolver opp:**
   ```sql
   SELECT id, lead_id, stage, sales_proposal_value, sales_proposal_currency,
          sales_user_id, closed_at, stripe_payment_intent_id
   FROM opportunities WHERE id = {opp_id};
   ```
3. **Pre-checks:**
   - **Não encontrada:** ESCALATE
   - **stage='SALE_DONE' AND stripe_payment_intent_id IS NOT NULL:** BLOCKED — não pode deletar opp com pagamento Stripe vinculado (compliance). Sugere mover para LOST com lost_reason em vez de deletar.
   - **stage='SALE_DONE' sem Stripe:** warning — proceed mas surface "perda de revenue history".
   - **Comercial sem ownership:** BLOCKED com:
     ```
     Apenas owner da opp (sales_user_id) ou admin/owner podem deletar.
     ```
4. **Reason obrigatório.**
5. **Tripla confirmation:**
   ```
   ⚠️ HARD DELETE opportunity — IRREVERSÍVEL:
     Opp ID: {opp_id}
     Stage: {stage}
     Valor: {currency} {sales_proposal_value or '—'}
     Reason: {reason}

   Esta operação é permanente. Audit preservado em activity_logs.
   Sem soft-delete disponível (colunas deleted_at não existem).

   Digite CONFIRMO DELETE OPP para continuar:
   ```
6. **Aguardar `CONFIRMO DELETE OPP`** literal (tripla check).
7. **DELETE:**
   ```sql
   DELETE FROM opportunities WHERE id = {opp_id};
   ```
8. **Side-effect:** FKs com ON DELETE SET NULL se aplicam automaticamente (campaign_attribution, etc.).
9. **Activity log STRICT:** action='sales-specialist.delete_opportunity', details com reason + stage + lead_id + valor.
10. **Echo:**
    ```
    ✓ Opp deletada (hard delete)
    Auditoria preservada em activity_logs.
    ```

### acceptance_criteria

- **[A1] Owner authority** — comercial só deleta próprias (sales_user_id); admin/owner deleta qualquer.
- **[A2] Hard delete only** — não há soft-delete (colunas deleted_at não existem, decisão D3).
- **[A3] SALE_DONE + Stripe = BLOCKED** (compliance pagamento).
- **[A4] Reason obrigatório.**
- **[A5] Tripla confirmation:** `CONFIRMO DELETE OPP` uppercase literal.
- **[A6] Audit STRICT:** activity_log preserva todos os dados antes do DELETE.

---

## Exemplos

### Exemplo 1 — Daniel hard-deleta opp própria duplicada

**Input:** `opp_id` (sua própria), reason='Duplicada de outra'

**Specialist:** auth ✓ (sales_user_id=Daniel), stage≠SALE_DONE → `CONFIRMO DELETE OPP` → DELETE → DONE.

### Exemplo 2 — Comercial tenta deletar opp de outro → BLOCKED

**Input:** Daniel tenta deletar opp de Miriam (sales_user_id=Miriam)

**Specialist:** BLOCKED com mensagem clara de ownership.

### Exemplo 3 — SALE_DONE + Stripe → BLOCKED

**Input:** opp SALE_DONE com stripe_payment_intent_id preenchido

**Specialist:** BLOCKED:
```
Opp SALE_DONE com pagamento Stripe vinculado.
Para cleanup: mover para LOST com lost_reason (preserva audit) em vez de deletar.
Delete removeria evidência de pagamento — compliance risk.
```

---

## Notas

- **Hard delete only (D3):** colunas `deleted_at/deleted_by/deletion_reason` NÃO existem em `opportunities`. Soft-delete não disponível.
- **LGPD direito ao esquecimento:** hard delete é o único mecanismo disponível.
- **opportunity_history:** trigger AFTER DELETE pode preservar history (verificar se trigger existe no banco antes de assumir).

---

**Mantido por:** sales-specialist
