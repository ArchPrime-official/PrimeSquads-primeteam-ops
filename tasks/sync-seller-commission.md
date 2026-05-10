# Task: sync-seller-commission

> Calcular + persistir comissões de vendedores para um período (mensal). Dispara edge cron `sync-seller-commission`. Admin/owner only. Implementa F-13.6.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Sync Seller Commission`

### responsible_executor
`platform-specialist` (orquestra cron edge) com gate admin/owner via has_invoice_access.

### execution_type
`Agent` — confirmation + dry-run de valores antes de persist.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `period` (string `'YYYY-MM'`, ex `'2026-04'`)
  - `seller_id` (uuid opcional, default todos active)
  - `dry_run` (bool, default true em primeira call — segurança)
  - `commission_rules_override` (object opcional — para A/B test policies)

### output

- **`commission_records`** (array): `{seller_id, seller_name, period, sales_count, gross_revenue, commission_amount, status}`
- **`total_commissions_eur`** (sum)
- **`status`** (`'preview' | 'persisted'`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate:** has_invoice_access (owner+admin). Outros → BLOCKED.
2. **Validar period** formato `YYYY-MM`, não no futuro, não > 12 meses atrás (sanity).
3. **Resolver sellers ativos:**
   ```sql
   SELECT id, name, commission_rate, role
   FROM sellers WHERE active=true
     AND ({seller_id} IS NULL OR id={seller_id});
   ```
4. **Pre-check duplicate run:**
   ```sql
   SELECT id, calculated_at, persisted_at
   FROM commission_calculations
   WHERE period={period} AND seller_id IN ({seller_ids})
     AND status='persisted';
   ```
   Se já persistido AND não dry_run → ESCALATE com `already_persisted`.
5. **Compute commissions** via call à edge function (não recompute em SQL aqui — logic complexa fica na edge):
   ```typescript
   const { data, error } = await supabase.functions.invoke('calculate-seller-commission', {
     body: { period, seller_ids, dry_run, commission_rules_override },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```
6. **Apresentar dry-run:**
   ```
   📊 Comissões {period}

   {N} sellers calculados
   Total comissões: €{total}

   Breakdown:
     [seller_name] {sales_count} vendas, gross €{rev}, comissão €{comm}
     ...

   Status: PREVIEW (dry_run=true)
   Para persistir: re-run com dry_run=false após review.
   ```
7. **Se `dry_run=false`:** confirmation literal "PERSISTE COMISSÃO" uppercase + INSERT em `commission_calculations` + `commission_payments` (status='pending'):
   ```sql
   INSERT INTO commission_calculations
     (seller_id, period, sales_count, gross_revenue, commission_amount,
      calculated_at, calculated_by, persisted_at, status)
   VALUES (..., NOW(), auth.uid(), NOW(), 'persisted')
   ON CONFLICT (seller_id, period) DO UPDATE
     SET ... (com warning + audit);
   ```
8. **Activity log STRICT:** action='platform-specialist.sync_seller_commission', details com period + total + count.
9. **Echo final:**
   - dry_run=true: preview shown, sugere re-run com `dry_run=false`
   - dry_run=false: "✓ {N} comissões persistidas, total €{total}. Pagamento pendente — admin processa via UI ou pause/process."

### acceptance_criteria

- **[A1] Auth gate:** has_invoice_access.
- **[A2] Period validation:** YYYY-MM, não-futuro, max 12 meses atrás.
- **[A3] Dry_run default true:** primeira invocação SEMPRE preview. Persist requer second call explícita.
- **[A4] Persist confirmation:** "PERSISTE COMISSÃO" uppercase literal.
- **[A5] Duplicate detection:** já persisted = ESCALATE (não re-calcula sem reason).
- **[A6] Audit STRICT:** activity_log obrigatório.
- **[A7] No payment trigger:** task SÓ calcula/persiste records. Pagamento real é separate flow.

---

## Exemplos

### Exemplo 1 — Joyce calcula comissões abril (dry_run primeiro)

**Input:** `period='2026-04'`, sem seller_id (todos)

**Specialist:** Auth ✓, dry_run=true default → calcula via edge → preview com 6 sellers, total €4200 → user revê → re-run com `dry_run=false` + "PERSISTE COMISSÃO" → DONE.

### Exemplo 2 — Already persisted → ESCALATE

**Input:** `period='2026-03'` com dry_run=false, mas já persistido

**Specialist:** ESCALATE:
```
Comissões 2026-03 já persistidas em 2026-04-01 14:32 por Joyce Carvalho.
Para recalcular (corrigir erro): use commission_rules_override + dry_run=true
para preview + admin decide se substitui (UPSERT trigger audit).
```

### Exemplo 3 — Marketing tenta sync → BLOCKED

**Input:** Sandra (marketing) → BLOCKED com mensagem clara.

---

## Notas

- **Edge `calculate-seller-commission`:** lógica complexa (commission_rate × revenue, splits, bonuses) ficou na edge para reuse. Esta task só orquestra.
- **Idempotency via UPSERT:** re-persist do mesmo period é detectado e flagueado em audit (não silencioso).
- **Payment flow:** records ficam status='pending' até admin marcar 'paid' (UI ou task separada).
- **CRITICAL HMRC:** comissões fazem parte da contabilidade UK. Dry_run obrigatório evita erros financeiros.

---

**Mantido por:** platform-specialist (com gate has_invoice_access)
