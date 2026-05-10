# Task: verify-opportunity

> Marcar opportunity como verificada/duplicada/suspeita. Admin valida data quality. Implementa F-02.6.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Verify Opportunity`

### responsible_executor
`sales-specialist` (com gate admin/owner)

### execution_type
`Agent` — confirmation simples.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `opportunity_id` (uuid)
  - `verdict` (`'verified' | 'duplicate' | 'suspicious' | 'unverify'`)
  - `merged_into_id` (uuid, obrigatório se verdict='duplicate')
  - `notes` (string opcional)

### output

- **`opportunity_id`**, **`verdict_applied`**
- **`merged_into_id`** (se duplicate)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** admin/owner. Outros → BLOCKED:
   ```
   Verify opportunity é admin-only (data quality assurance).
   Sua role: {role}.
   ```
2. **Resolver opp:** SELECT id, customer_name, current verification_status, total_amount.
3. **Validar verdict** ∈ enum. `duplicate` exige `merged_into_id`.
4. **Se duplicate:** validar merged_into_id existe + não é o mesmo opp.
5. **Confirmation:**
   ```
   Verify opportunity:
     ID: {opp_id}
     Customer: {customer_name}
     Valor: {currency} {amount}
     Status atual: {current_status}
     Novo verdict: {verdict}
     {duplicate ? 'Merged into: ' + merged_into_id : ''}
     Notes: {notes or '(sem notas)'}
   Confirma?
   ```
6. **UPDATE atomic:**
   ```sql
   UPDATE opportunities
   SET verification_status={verdict},
       merged_into_opportunity_id=COALESCE({merged_into_id}, merged_into_opportunity_id),
       verified_by=auth.uid(),
       verified_at=NOW(),
       verification_notes=COALESCE({notes}, verification_notes)
   WHERE id={opp_id}
   RETURNING id, verification_status;
   ```
7. **Side-effect duplicate:** se verdict='duplicate', edge function pode merger contatos/histórico do duplicate para `merged_into_id` (Sprint atual já tem isso).
8. **Activity log:** action='sales-specialist.verify_opportunity', details com verdict + diff.
9. **Echo:** "✓ Opp marcada como {verdict}. {duplicate ? 'Merge em background...' : ''}"

### acceptance_criteria

- **[A1] Role admin/owner.**
- **[A2] Duplicate exige merged_into_id.**
- **[A3] Self-merge BLOCKED:** opp não pode ser duplicate de si mesma.
- **[A4] Audit:** verified_by + verified_at + diff.
- **[A5] Reversible:** verdict='unverify' limpa status.

---

## Exemplos

### Exemplo 1 — Joyce marca opp duplicada

**Input:** `opp_id=A`, `verdict='duplicate'`, `merged_into_id=B`

**Specialist:** confirmation → UPDATE → echo "Marcada como duplicada de {B_customer}".

### Exemplo 2 — Comercial → BLOCKED

**Input:** Daniel (comercial) → BLOCKED.

---

## Notas

- **Edge `opportunities-verification-update`:** lógica complexa de merge (history, contacts, payments) fica na edge.
- **Reversible:** verdict='unverify' permite correção (UPDATE back to NULL).

---

**Mantido por:** sales-specialist
