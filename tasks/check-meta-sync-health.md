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
  - `account_name`, `last_sync_at`, `next_scheduled_at`, `last_error`, `queue_depth`
  - `health` (`'green' | 'yellow' | 'red'`)
- `cron_status`: `{enabled, schedule_expression, last_run, next_run}`
- `recommendations` (array — actionable items)
- `verdict`: `DONE`

### action_items

1. **Role:** marketing/comercial/admin/owner.
2. Query:
   ```sql
   SELECT a.id, a.account_name, c.last_sync_at, c.next_scheduled_at,
          c.last_error, c.last_error_at,
          c.is_active,
          (SELECT COUNT(*) FROM meta_ads_sync_status
           WHERE account_id=a.id AND status='pending') AS queue_depth
   FROM meta_ad_accounts a
   LEFT JOIN meta_ads_config c ON c.account_id=a.id
   WHERE a.is_active=true;
   ```
3. **Health classification:**
   - red: last_error em últimos 30min OR no sync em 24h
   - yellow: queue_depth > 0 OR last_sync > 2h
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
