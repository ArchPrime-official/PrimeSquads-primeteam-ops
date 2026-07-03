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

- **`commission_records`** (array — colunas REAIS de `commission_history`): `{user_id, seller_name, month, year, level_id, total_entries, fixed_bonus, variable_commission, total_commission, status}`
- **`total_commissions_eur`** (sum de `total_commission`)
- **`run_status`** (`'preview' | 'persisted'`)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Auth gate:** has_invoice_access (owner+admin). Outros → BLOCKED.
2. **Validar period** formato `YYYY-MM`, não no futuro, não > 12 meses atrás (sanity). **Decompor em `month` (int 1-12) + `year` (int)** — `commission_history` NÃO tem coluna `period`; a chave é `user_id` + `month` + `year`.
3. **Resolver sellers ativos** (tabela `sellers` NÃO existe — usar `profiles` JOIN `seller_commission_levels`):
   ```sql
   -- TODO: confirmar campo de role/active em profiles (is_active=true + role em user_roles)
   SELECT p.id, p.full_name AS name,
          cl.level_name, cl.id AS level_id
   FROM profiles p
   JOIN seller_commission_levels scl ON scl.user_id = p.id
   JOIN commission_levels cl ON cl.id = scl.level_id
   WHERE p.is_active = true
     AND ({seller_id} IS NULL OR p.id = {seller_id});
   ```
4. **Pre-check duplicate run** (colunas REAIS — `commission_history` só tem `created_at`/`updated_at`, NÃO `calculated_at`/`persisted_at`):
   ```sql
   SELECT id, user_id, status, updated_at
   FROM commission_history
   WHERE month={month} AND year={year} AND user_id IN ({user_ids})
     AND status='persisted';
   ```
   Se já persistido AND não dry_run → ESCALATE com `already_persisted`.
5. **Compute commissions.** A EF `calculate-seller-commission` NÃO existe; a EF real é `sync-seller-commission` (cron que **calcula E persiste** em `commission_history`).
   ⚠️ **SEGURANÇA do dry_run:** se a EF `sync-seller-commission` **não** aceitar um parâmetro `dry_run`/`preview` no body, invocá-la **PERSISTE de verdade** — o "preview" não seria preview. Portanto:
   - **Passo A — confirmar suporte a dry_run.** Inspecionar o contrato da EF (body aceito). Se aceitar `dry_run` → invocar com `dry_run=true` para o preview.
   - **Passo B — se a EF NÃO aceitar dry_run:** NÃO invocar a EF para preview. Calcular o preview **inline read-only** (SELECT sobre as vendas do período × `commission_levels`/`seller_commission_levels`, sem escrever), e só invocar a EF (ou fazer o UPSERT do passo 7) na chamada `dry_run=false` já confirmada. Nunca chamar uma EF que persiste achando que é preview.
   ```typescript
   // Preferir dry_run nativo da EF quando existir; senão preview inline read-only.
   const { data, error } = await supabase.functions.invoke('sync-seller-commission', {
     body: { period, seller_ids, dry_run, commission_rules_override }, // dry_run só se a EF suportar
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```
6. **Apresentar dry-run:**
   ```
   📊 Comissões {period}

   {N} sellers calculados
   Total comissões: €{total}

   Breakdown (por vendedor — colunas reais de commission_history):
     [seller_name] level {level_id} · {total_entries} entries · fisso €{fixed_bonus} + variabile €{variable_commission} = €{total_commission}
     ...

   Status: PREVIEW (dry_run=true)
   Para persistir: re-run com dry_run=false após review.
   ```
7. **Se `dry_run=false`:** confirmation literal "PERSISTE COMISSÃO" uppercase. Persistir SÓ em `commission_history` (colunas REAIS). **NÃO existe tabela `commission_payments`** — não INSERIR nela.
   ```sql
   -- Preferir deixar a EF sync-seller-commission fazer o UPSERT (é a WRITE canônica);
   -- se persistir por SQL, usar apenas as colunas reais:
   INSERT INTO commission_history
     (user_id, month, year, level_id,
      total_entries, fixed_bonus, variable_commission, total_commission, status)
   VALUES ({user_id}, {month}, {year}, {level_id},
      {total_entries}, {fixed_bonus}, {variable_commission}, {total_commission}, 'persisted')
   ON CONFLICT (user_id, month, year) DO UPDATE   -- confirmar a UNIQUE real antes de assumir a chave
     SET total_entries=EXCLUDED.total_entries,
         fixed_bonus=EXCLUDED.fixed_bonus,
         variable_commission=EXCLUDED.variable_commission,
         total_commission=EXCLUDED.total_commission,
         status=EXCLUDED.status,
         updated_at=NOW();   -- com warning + audit
   ```
   O vocabulário de `status` (ex: `persisted`/`pending`) é da EF/UI, não um enum de schema — não inventar valores; espelhar o que a EF grava.
8. **Activity log STRICT:** action='platform-specialist.sync_seller_commission', details com month + year + total + count.
9. **Echo final:**
   - dry_run=true: preview shown, sugere re-run com `dry_run=false`
   - dry_run=false: "✓ {N} comissões persistidas em commission_history, total €{total}. Pagamento é fluxo separado (não há tabela commission_payments)."

### acceptance_criteria

- **[A1] Auth gate:** has_invoice_access.
- **[A2] Period validation:** YYYY-MM decomposto em `month`+`year` (chave real de `commission_history`), não-futuro, max 12 meses atrás.
- **[A3] Dry_run default true + SEGURO:** primeira invocação SEMPRE preview. Se a EF não aceitar `dry_run`, preview é inline read-only (nunca invocar a EF que persiste como se fosse preview). Persist requer second call explícita.
- **[A4] Persist confirmation:** "PERSISTE COMISSÃO" uppercase literal.
- **[A5] Duplicate detection:** já persisted (month+year+user_id) = ESCALATE (não re-calcula sem reason).
- **[A6] Audit STRICT:** activity_log obrigatório.
- **[A7] Colunas reais + sem `commission_payments`:** persiste SÓ em `commission_history` com `user_id/month/year/level_id/fixed_bonus/variable_commission/total_commission/total_entries/status` (NUNCA seller_id/period/gross_revenue/commission_amount/calculated_at/persisted_at). A tabela `commission_payments` NÃO existe — nunca INSERIR nela. Pagamento é fluxo separado.

---

## Exemplos

### Exemplo 1 — Joyce calcula comissões abril (dry_run primeiro)

**Input:** `period='2026-04'`, sem seller_id (todos)

**Specialist:** Auth ✓, dry_run=true default → calcula via edge `sync-seller-commission` → preview com N sellers (de `profiles` JOIN `seller_commission_levels`), total €4200 → user revê → re-run com `dry_run=false` + "PERSISTE COMISSÃO" → DONE.

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

- **Edge de cálculo:** `calculate-seller-commission` NÃO existe. A EF real é `sync-seller-commission` (cron que calcula + persiste). Esta task orquestra o disparo manual da mesma EF com parâmetro dry_run.
- **Idempotency via UPSERT:** re-persist do mesmo period é detectado e flagueado em audit (não silencioso).
- **Payment flow:** records ficam status='pending' até admin marcar 'paid' (UI ou task separada).
- **CRITICAL HMRC:** comissões fazem parte da contabilidade UK. Dry_run obrigatório evita erros financeiros.

---

**Mantido por:** platform-specialist (com gate has_invoice_access)
