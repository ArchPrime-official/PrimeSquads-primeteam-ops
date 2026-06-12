# Task: update-commission-level

> Atualizar parâmetros de commission_levels (fixed_bonus, target_acceptable, target_ok, target_meta, months_to_next_level, promotion_requirement). Quarterly/annual review. has_invoice_access (owner+admin).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Commission Level`

### responsible_executor
`admin-specialist` (gate has_invoice_access)

### execution_type
`Agent` — confirmation com diff visível.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `level_id` (uuid) OR `level_name` (string)
  - `updates` (object subset):
    - `fixed_bonus` (numeric)
    - `target_acceptable`, `target_ok`, `target_meta` (numeric thresholds)
    - `months_to_next_level` (int)
    - `promotion_requirement` (string description)
    - `commission_rate_pct` (decimal 0..100)
  - `reason` (string OBRIGATÓRIO — quarterly review explanation)
  - `effective_from` (ISO date — default NOW; permite agendar mudança futura)

### output

- **`level_id`**, **`updated_fields`**
- **`row_before`** + **`row_after`**
- **`affected_sellers_count`** (int — quantos sellers usam este level)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate has_invoice_access** — owner+admin only.
2. **Resolver level:**
   ```sql
   -- Tabela 'sellers' NÃO existe — contagem via seller_commission_levels JOIN profiles
   SELECT cl.id, cl.level_name AS name, cl.fixed_bonus,
          cl.target_acceptable, cl.target_ok, cl.target_meta,
          cl.months_to_next_level, cl.promotion_requirement,
          (SELECT COUNT(*) FROM seller_commission_levels scl
           JOIN profiles p ON p.id = scl.user_id
           WHERE scl.level_id = cl.id AND p.is_active = true) AS affected_count
   FROM commission_levels cl WHERE cl.id = {id} OR cl.level_name = {level_name};
   ```
   0 ou >1 → ESCALATE.
3. **Validar updates:**
   - Targets em ordem ascendente: `target_acceptable < target_ok < target_meta`
   - `commission_rate_pct` entre 0..100
   - `fixed_bonus` >= 0
   - `months_to_next_level` >= 0
4. **Reason obrigatório** — sem reason = ESCALATE com sugestões:
   ```
   Update commission level requer reason explícito (audit trail HMRC).
   Exemplos: "Q3 review — meta aumentada", "Promoção level junior".
   ```
5. **Confirmation:**
   ```
   Update commission level «{name}»:
     Diff:
       fixed_bonus: {old} → {new}
       target_acceptable: {old} → {new}
       target_ok: {old} → {new}
       target_meta: {old} → {new}
       commission_rate_pct: {old}% → {new}%
       months_to_next_level: {old} → {new}
       promotion_requirement: {old} → {new}

     Sellers afetados: {N}
       [list 5 names + count]

     Effective from: {effective_from}
     Reason: {reason}

   Confirma? (digite "CONFIRMO UPDATE LEVEL" uppercase literal)
   ```
6. **Aguardar "CONFIRMO UPDATE LEVEL"** literal.
7. **UPDATE atomic:**
   ```sql
   UPDATE commission_levels
   SET {fields}, updated_by=auth.uid(), updated_at=NOW(),
       effective_from={effective_from}, last_change_reason={reason}
   WHERE id={level_id}
   RETURNING id, ...;
   ```
8. **Side-effect:** se há comissões mensais já calculadas para período futuro, surface warning de recalculation needed:
   ```
   ⚠️ Há {N} commission_history já persistidas para period >= effective_from.
   Recálculo recomendado via sync-seller-commission para refletir novos params.
   ```
9. **Activity log STRICT:** action='admin-specialist.update_commission_level', details com diff + affected_sellers + reason.
10. **Echo:**
    ```
    ✓ Level «{name}» atualizado
    Effective from: {date}
    Sellers afetados: {N}
    {recalc_warning ? 'Recálculo recomendado: sync-seller-commission' : ''}
    Audit logged.
    ```

### acceptance_criteria

- **[A1] Auth has_invoice_access** — owner+admin.
- **[A2] Reason obrigatório.**
- **[A3] Targets ascendentes** validados.
- **[A4] Tripla confirmation:** "CONFIRMO UPDATE LEVEL" literal.
- **[A5] Affected sellers count:** preview impacto.
- **[A6] Recalc warning** se há calculations futuros já persistidos.
- **[A7] Audit STRICT** com diff + reason.
- **[A8] Effective_from suporta agendamento** (mudança futura).

---

## Exemplos

### Exemplo 1 — Pablo aumenta meta level "Senior"

**Input:** `level_id`, `updates={target_meta=20000}`, reason='Q3 review meta increase 18k→20k'

**Specialist:** auth ✓, validation ✓, 4 sellers afetados → "CONFIRMO UPDATE LEVEL" → DONE com warning recalc.

### Exemplo 2 — Targets em ordem errada → BLOCKED

**Input:** `target_acceptable=10000, target_ok=8000` (acceptable > ok)

**Specialist:** BLOCKED:
```
Targets devem ser ascendentes: acceptable < ok < meta.
Recebido: acceptable=10000, ok=8000 (invertido).
```

### Exemplo 3 — Sem reason → ESCALATE

---

## Notas

- **commission_levels schema:** verificar via Supabase Management API se columns batem com payload (foi inferido de UI).
- **Effective_from:** permite agendar mudança (ex: efetivo a partir de Q4). Trigger ou cron pode promover automaticamente.
- **Recalc cascading:** mudança em level ativos = recalcular commissions já persistidas? Decisão de produto:
  - Default: não recalcula (preserva história)
  - Manual: admin roda sync-seller-commission com `commission_rules_override`

---

**Mantido por:** admin-specialist
