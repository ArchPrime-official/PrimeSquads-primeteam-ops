# Task: check-meta-sync-health

> Diagnóstico read-only de cron meta-sync (status, queue depth, last errors). Troubleshooting marketing/admin.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Check Meta Sync Health`

### responsible_executor `integration-specialist`

### execution_type `Agent` — read-only.

### input
- `account_id` (uuid opcional, default todos active)
- `include_history` (bool default false — últimos 50 sync runs)

### output
- `accounts_status` (array per account):
  - `account_name`, `last_full_sync_at`, `last_fast_sync_at`, `last_error`, `sync_status`, `pending_queue_count`
  - `health` (`'green' | 'yellow' | 'red'`)
- `cron_status`: `{enabled, schedule_expression, last_run, next_run}`
- `recommendations` (array — actionable items)
- `verdict`: `DONE`

### action_items

1. **Role:** marketing/comercial/admin/owner.
2. Query (colunas reais de `meta_ads_sync_status`):
   ```sql
   SELECT
     s.id, s.account_name, s.account_id,
     s.sync_status, s.last_full_sync_at, s.last_fast_sync_at,
     s.last_incremental_sync_at, s.last_error,
     s.total_campaigns, s.total_adsets, s.total_ads,
     s.sync_progress,
     -- queue_depth via subquery (meta_ads_sync_status não tem coluna direta):
     (SELECT COUNT(*)
      FROM meta_campaigns mc
      WHERE mc.account_id = s.account_id
        AND mc.updated_at > COALESCE(s.last_fast_sync_at, '1970-01-01')
        AND mc.id NOT IN (SELECT id FROM meta_campaigns WHERE synced_at IS NOT NULL)
     ) AS pending_queue_count
   FROM meta_ads_sync_status s;
   -- Nota: meta_ad_accounts e meta_ads_config podem não existir; usar meta_ads_sync_status como fonte
   ```
3. **Health classification:**
   - red: last_error preenchido E `last_fast_sync_at < NOW() - interval '30 min'` OR nenhum sync em 24h
   - yellow: `pending_queue_count > 0` OR `last_fast_sync_at < NOW() - interval '2h'`
   - green: tudo OK
4. **Cron status:** SELECT pg_cron jobs filter por nome 'meta-sync*'.
5. **Recommendations:**
   - red → "Token health check + run-meta-sync ou update-meta-sync-config rotation"
   - yellow → "queue draining; aguardar próximo cron OR run-meta-sync manual"
   - green → "Sistema saudável"
6. Activity log filter only.
7. Echo:
   ```
   🩺 Meta Sync Health
   {N} accounts: {green_count} green | {yellow_count} yellow | {red_count} red

   [account: status, last_sync, queue, error]

   Cron: {enabled} schedule={cron}, next run {next}

   Recommendations:
     [list]
   ```

### acceptance_criteria
- A1 marketing/comercial/admin/owner
- A2 Health categorization (green/yellow/red)
- A3 Cron status from pg_cron
- A4 Recommendations actionable
- A5 Read-only

---

**Mantido por:** integration-specialist
