# Task: delete-opportunity

> Soft-delete opportunity (mark deleted_at). Comercial/admin/owner. Reversível dentro de 30 dias.

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
  - `reason` (string OBRIGATÓRIO)
  - `hard_delete` (bool, default false — admin/owner only)

### output

- **`opportunity_id`**, **`deleted_at`**, **`mode`** (`'soft' | 'hard'`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:**
   - Soft delete: comercial (próprio owner_id) OR admin/owner
   - Hard delete: admin/owner only
2. **Resolver opp:**
   ```sql
   SELECT id, customer_name, total_amount, status, owner_id, won_at, sales_invoice_id
   FROM opportunities WHERE id={opp_id};
   ```
3. **Pre-checks:**
   - **Já deletada** (deleted_at IS NOT NULL): ESCALATE
   - **Status='won' AND has invoice:** BLOCKED — não pode deletar opp com NF emitida (compliance HMRC). Sugere cancelar NF primeiro via admin.
   - **Status='won' WITHOUT invoice:** warning — proceed mas surface "perda de revenue history".
   - **Comercial não-owner:** se user.role='comercial' AND user.id != opp.owner_id, BLOCKED com:
     ```
     Apenas owner da opp ou admin/owner podem deletar.
     Owner atual: {owner_name}.
     ```
4. **Reason obrigatório.**
5. **Confirmation:**
   ```
   Delete opportunity:
     Customer: {customer_name}
     Value: {currency} {amount}
     Status: {status}
     Owner: {owner_name}
     Mode: {soft | hard}

     {soft ? 'Soft delete — reversível 30 dias via undelete (admin)' : '⚠️ HARD DELETE — irreversível, sem audit recovery'}

     Reason: {reason}

   Confirma? {hard ? '(digite "DELETE OPP" uppercase)' : '(sim/não)'}
   ```
6. **UPDATE/DELETE:**
   - Soft: `UPDATE opportunities SET deleted_at=NOW(), deleted_by=auth.uid(), deletion_reason={reason}`
   - Hard: `DELETE FROM opportunities WHERE id={opp_id}` (após confirmação tripla)
7. **Side-effect:** se opp tinha campaign_attribution, history preserva referência (FK ON DELETE SET NULL).
8. **Activity log STRICT:** action='sales-specialist.delete_opportunity', details com mode + reason + customer_name + amount.
9. **Echo:**
   ```
   ✓ Opp deletada (mode={soft|hard})
   {soft ? 'Restore via admin antes de 30d' : 'Hard delete — auditoria preservada apenas em activity_logs'}
   ```

### acceptance_criteria

- **[A1] Owner authority** — comercial só deleta próprias; admin/owner deleta qualquer.
- **[A2] Hard delete admin/owner only.**
- **[A3] Won + invoice = BLOCKED** (compliance).
- **[A4] Reason obrigatório.**
- **[A5] Tripla confirmation hard delete:** "DELETE OPP" uppercase.
- **[A6] Soft default:** menos destrutivo é o padrão.
- **[A7] 30-day undelete window** (separate task).
- **[A8] Audit:** activity_log com modo/reason.

---

## Exemplos

### Exemplo 1 — Daniel soft-deleta opp própria duplicada

**Input:** `opp_id` (sua própria), reason='Duplicada de outra'

**Specialist:** auth ✓ (owner), soft default → confirmation → UPDATE deleted_at → DONE.

### Exemplo 2 — Comercial tenta deletar opp de outro → BLOCKED

**Input:** Daniel tenta deletar opp de Miriam

**Specialist:** BLOCKED com mensagem clara.

### Exemplo 3 — Won + invoice → BLOCKED

**Input:** opp won com NF 2026-0042

**Specialist:** BLOCKED:
```
Opp won com nota fiscal 2026-0042 emitida.
Para cancelar: cancele NF primeiro (admin via bulk-reissue ou cancel manual).
Soft delete de won s/ NF é permitido mas perde revenue history.
```

---

## Notas

- **Soft default:** `deleted_at` flag preserva auditoria + permite undelete.
- **Hard delete** apenas para casos extremos (LGPD direito ao esquecimento).
- **opportunity_history:** trigger preserva history mesmo em DELETE.

---

**Mantido por:** sales-specialist
