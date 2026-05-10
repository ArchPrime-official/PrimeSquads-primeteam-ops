# Task: run-meta-sync

> Task atômica para invocar edge function `sync-meta-billing` (ou variantes) e re-sync `meta_ads_*_cache` + `meta_ads_insights_daily`. **Open op** — qualquer role autorizada (`marketing`, `comercial`, `admin`, `owner`) pode rodar. NÃO altera config nem credenciais.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Run Meta Sync`

### status
`pending`

### responsible_executor
`integration-specialist`

### execution_type
`Agent` — confirmation step OBRIGATÓRIO (consome quota Graph API + tempo).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `sync_type` (`'fast' | 'incremental' | 'full'`, default `'incremental'`)
  - `account_id` (uuid, opcional — UUID PK de `meta_ad_accounts`. Default = todas as accounts ativas)

### output

- **`sync_status_id`** — uuid da row em `meta_ads_sync_status`
- **`sync_type`**, **`account_ids_processed`** (array)
- **`stats`** — `{campaigns_updated, ads_updated, insights_rows_updated, duration_ms}`
- **`last_synced_at`**
- **`verdict`** — `DONE` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — RLS ✓ / quota_respected ✓ / audit_logged ✓

### action_items

1. **Validar role autorizada** — checar via session que user tem ao menos uma de: `owner`, `admin`, `marketing`, `comercial`. Caso contrário → BLOCKED com:
   ```
   Run meta-sync requer role marketing/comercial/admin/owner.
   Sua role atual: {role}. Peça acesso ao admin do seu setor.
   ```

2. **Validar `sync_type`** ∈ `{'fast', 'incremental', 'full'}`. Outros → ESCALATE com lista válida.

3. **Resolver `account_id`** — se omitido:
   ```sql
   SELECT id, account_name, last_sync_at, sync_status
   FROM meta_ad_accounts
   WHERE is_active = true
   ORDER BY account_name;
   ```
   Se `is_active=true` accounts = 0 → BLOCKED com `no_active_accounts`.

4. **Verificar token health** — antes de invocar, checar se há erro recente registrado:
   ```sql
   SELECT id, last_error, last_error_at
   FROM meta_ads_sync_status
   WHERE account_id = {account_id}
     AND last_error IS NOT NULL
     AND last_error_at > NOW() - INTERVAL '1 hour'
   ORDER BY created_at DESC LIMIT 1;
   ```
   Se há erro recente AND `last_error LIKE '%token%'` → ESCALATE com:
   ```
   Token Meta API expirou ou inválido (último erro: {last_error_at}).
   Esta task NÃO renova token (config é admin-only). Peça ao admin para
   rodar update-meta-sync-config com action='rotate_token'.
   ```

5. **Confirmation message:**
   ```
   Vou disparar sync Meta Ads:
     - Tipo: {sync_type}
     - Account: {account_name or 'todas as ativas'}
     - Tempo estimado: fast ~30s, incremental ~1-3min, full ~5-15min
     - Atualiza: meta_ads_*_cache + meta_ads_insights_daily
     - Quota: consome rate limit Graph API (~50-200 calls)

   Último sync: {last_sync_at} ({minutes_ago} min atrás)
   Confirma?
   ```

6. **Aguardar "sim"** — se "não", ESCALATE com `cancelled_by_user`.

7. **Quota guard** — se `last_sync_at < 30 segundos atrás` AND `sync_type != 'fast'`:
   ```
   Sync rodou há {seconds_ago}s. Aguarde 30s entre syncs ou use sync_type='fast'.
   ```
   ESCALATE com `quota_too_recent`.

8. **Invoke edge function:**
   ```typescript
   const { data, error } = await supabase.functions.invoke('sync-meta-billing', {
     body: { sync_type, account_id },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```

9. **Tratar erros da edge:**
   - HTTP 401 / `auth_token_invalid` → BLOCKED com mesma orientação do step 4
   - HTTP 429 / `rate_limit` → ESCALATE com `meta_quota_exhausted` + tempo de cooldown
   - HTTP 500 → retry 1x → ESCALATE
   - HTTP 200 → continuar

10. **Refetch sync_status** — após sucesso:
    ```sql
    SELECT id, last_synced_at, last_error,
           campaigns_count, ads_count, insights_rows_updated
    FROM meta_ads_sync_status
    WHERE account_id = {account_id}
    ORDER BY created_at DESC LIMIT 1;
    ```

11. **Activity log:**
    - `action='integration-specialist.run_meta_sync'`
    - `resource_type='meta_ads_sync_status'`
    - `resource_id={sync_status_id}`
    - `details={sync_type, account_ids, stats, duration_ms}`

12. **Echo final:**
    ```
    ✓ Sync completa
    Tipo: {sync_type}
    Accounts processadas: {N}
    Campaigns atualizadas: {M}
    Ads atualizados: {P}
    Insights rows: {Q}
    Duração: {duration_ms}ms

    Próximo sync recomendado: incremental em ~30min, full diário (cron)
    ```

### acceptance_criteria

- **[A1] Role gating mínimo:** task SÓ roda se user tem marketing/comercial/admin/owner. Outros (cs/financeiro) → BLOCKED.
- **[A2] No config mutation:** task NUNCA toca `meta_ads_config` (credenciais/tokens). Apenas dispara sync. Config é Admin-only via task separada.
- **[A3] Token failure surfaced:** se token expirou, task NÃO tenta renovar — ESCALATE explicando que update-meta-sync-config (Admin-only) é o caminho.
- **[A4] Quota guard:** evita storm de syncs com cooldown de 30s entre non-fast syncs.
- **[A5] Confirmation OBRIGATÓRIO:** user vê tipo + account + tempo + quota antes de disparar.
- **[A6] Audit completo:** activity_logs com cycle_id + stats por account.
- **[A7] Stats refetch:** retorna nº de campaigns/ads/insights atualizados (não só "OK").
- **[A8] Idempotency note:** sync é idempotente (re-rodar não duplica), mas consome quota — task warn se rodado <30s antes.

---

## Exemplos

### Exemplo 1 — Marketing user roda incremental sync (DONE)

**Input:** Sandra (marketing) pede sync incremental, account default

**Specialist:**
1. Role marketing ✓
2. sync_type='incremental' ✓
3. Resolve accounts → 2 ativas (Sales + Brand)
4. Token health OK (sem erro recente)
5. Confirmation:
   ```
   Vou disparar sync Meta Ads:
     - Tipo: incremental
     - Account: todas as ativas (2)
     - Tempo estimado: ~1-3min
     - Quota: ~100-200 calls
   Último sync: 2026-05-10 14:23 (47min atrás)
   Confirma?
   ```
6. User: "sim"
7. Quota guard: 47min > 30s ✓
8. Invoke edge → 200 OK em 92s
9. Refetch stats: 18 campaigns, 84 ads, 312 insights rows
10. Activity log INSERT
11. Echo:
    ```
    ✓ Sync completa
    Tipo: incremental
    Accounts: 2 (Sales, Brand)
    Campaigns: 18 atualizadas
    Ads: 84 atualizados
    Insights rows: 312
    Duração: 92341ms
    ```

### Exemplo 2 — CS user (não autorizado) tenta rodar (BLOCKED)

**Input:** Jessica (cs) pede sync

**Specialist:** Role check → BLOCKED:
```
Run meta-sync requer role marketing/comercial/admin/owner.
Sua role atual: cs. Peça acesso ao admin do seu setor.
```

### Exemplo 3 — Token expirou (ESCALATE)

**Input:** sync incremental, mas último sync teve erro `oauth_token_expired`

**Specialist:** Step 4 detecta erro recente → ESCALATE:
```
Token Meta API expirou ou inválido (último erro: 2026-05-10 13:10).
Esta task NÃO renova token (config é admin-only). Peça ao admin para
rodar update-meta-sync-config com action='rotate_token'.
```

### Exemplo 4 — Quota cooldown (ESCALATE)

**Input:** sync incremental rodado 12s atrás

**Specialist:** Quota guard → ESCALATE:
```
Sync rodou há 12s. Aguarde 30s entre syncs ou use sync_type='fast'.
```

---

## Notas

- **Open op intencional:** marketing/comercial frequentemente precisam validar dados frescos antes de decisões (ex: pausar campanha underperforming). Restringir a admin causaria gargalo operacional.
- **Config separada:** `update-meta-sync-config.md` é a task Admin-only que muda credenciais/tokens. Esta task SÓ dispara o sync.
- **Edge function `sync-meta-billing`:** invoca Meta Graph API com refresh token automático server-side. Se refresh falha, escreve `last_error` em `meta_ads_sync_status`.
- **`meta_ads_insights_daily.account_id` convention** (memory:meta-ads-insights-account-id-convention): armazena UUID PK (`meta_ad_accounts.id`), NUNCA Meta API ID. Edge function respeita esta convenção.
- **`level='campaign'` filter:** ao agregar spend, sempre filtrar `level='campaign'` para evitar contagem dupla com level=ad/adset.

---

**Mantido por:** integration-specialist
