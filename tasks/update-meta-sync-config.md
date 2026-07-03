# Task: update-meta-sync-config

> Task atômica para alterar credenciais ou config de `meta_ads_config` (token rotation, account_id swap, sync interval, etc.). **Admin-only** — token Meta API é credential sensível, vazamento permite scrape completo de campaigns/billing/audiences.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy

### task_name
`Update Meta Sync Config`

### status
`pending`

### responsible_executor
`admin-specialist` (gate primário do agent — admin/owner only)

### execution_type
`Agent` — DUPLA confirmation (padrão admin-specialist em mutations sensíveis).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `config_id` (uuid, obrigatório — OU resolver via `account_id`)
  - `action` (`'rotate_token' | 'update_account_id' | 'update_sync_interval' | 'toggle_active'`, obrigatório)
  - `payload` (object, action-specific):
    - `rotate_token`: `{ new_access_token, new_refresh_token? }` — sensitive
    - `update_account_id`: `{ new_meta_account_id }` (Meta API external ID, ex: `act_123456`)
    - `update_sync_interval`: `{ new_interval_minutes (15..1440) }`
    - `toggle_active`: `{ active: bool }`

### output

- **`config_id`**, **`account_id`**, **`action`** (echoed)
- **`row_snapshot_before`** + **`row_snapshot_after`** (com tokens REDACTED em logs)
- **`verdict`** — `DONE` | `BLOCKED` | `ESCALATE`
- **`convention_check`** — owner/admin gate ✓ / dupla_confirmation ✓ / token_redacted_in_logs ✓ / audit_strict ✓

### action_items

0. **`reason` OBRIGATÓRIO** (config sensível — token/frequência de sync Meta): elicitar o motivo da mudança e gravá-lo no `activity_log` (HO-TP-002). Sem `reason` → perguntar antes de mutar.

1. **ADMIN-OR-OWNER GATE** — primário:
   ```sql
   SELECT (is_owner(auth.uid()) OR is_admin(auth.uid())) AS authorized;
   ```
   Se FALSE → BLOCKED:
   ```
   Update meta-sync-config é Admin/Owner-only. Sua role atual: {role}.
   Tokens Meta API são credenciais sensíveis (acesso completo a campaigns
   + billing + audiences). Não há workflow de escalation — apenas owner ou
   admin pode rotacionar.
   ```

2. **Resolver config:**
   ```sql
   SELECT c.id, c.account_id, c.is_active, c.sync_interval_minutes,
          c.last_sync_at, c.last_error, c.last_error_at,
          a.account_name, a.meta_account_id AS current_meta_account_id
   FROM meta_ads_config c
   JOIN meta_ad_accounts a ON a.id = c.account_id
   WHERE c.id = {config_id};
   ```
   0 ou >1 match → ESCALATE.

3. **Validar action** ∈ enum lista. Outros → ESCALATE.

4. **Validar payload por action:**

   - **`rotate_token`:**
     - `new_access_token` é string não-vazia
     - `new_access_token` length entre 100..500 chars (sanity check)
     - NÃO logar token completo em activity_logs — apenas hash SHA-256 dos primeiros 8 chars + length
     - Se `new_refresh_token` ausente, warn mas continuar (alguns flows não têm refresh)

   - **`update_account_id`:**
     - `new_meta_account_id` deve match regex `^act_\d{8,18}$` (Meta API ad account format)
     - Verificar que NÃO existe outra config ativa pra esta `meta_account_id` (UNIQUE-ish):
       ```sql
       SELECT 1 FROM meta_ad_accounts WHERE meta_account_id = {new_meta_account_id};
       ```
       Se já existe → ESCALATE com `account_id_already_managed`.

   - **`update_sync_interval`:**
     - Inteiro entre 15..1440 (15min mínimo a 24h máximo)
     - Outros → ESCALATE com range.

   - **`toggle_active`:**
     - Bool. Se desativando AND último sync OK <1h atrás, warn que dados ficarão stale.

5. **Confirmation message** (DUPLA, padrão admin-specialist):

   **Step 1 preview:**
   ```
   Vou alterar config Meta Ads:
     Account: {account_name} ({current_meta_account_id})
     Action: {action}

   {action-specific summary, ex:}
     - rotate_token: novo token de {length}c (hash: {sha256_8chars})
     - update_account_id: {old} → {new}
     - update_sync_interval: {old}min → {new}min
     - toggle_active: {old} → {new}

   ⚠️ IMPACTO:
     - rotate_token: syncs futuros usam novo token; antigo invalidado
     - update_account_id: syncs apontam para conta diferente — campaigns_cache fica stale
     - update_sync_interval: cron próximo respeitará novo intervalo
     - toggle_active=false: para syncs automáticos até reativar

   Quem alterou: {user.full_name} ({role})
   Continuar?
   ```

   **Step 2 confirmation literal:**
   - `rotate_token`: digite "CONFIRMO ROTACIONA" (uppercase)
   - `update_account_id`: digite "CONFIRMO TROCA CONTA" (uppercase)
   - `update_sync_interval` ou `toggle_active`: digite "confirma"

   Qualquer outro input → ESCALATE com `cancelled_by_user`.

6. **Mutation por action:**

   - **`rotate_token`:**
     ```sql
     UPDATE meta_ads_config
     SET access_token = {new_access_token},
         refresh_token = COALESCE({new_refresh_token}, refresh_token),
         token_rotated_at = NOW(),
         last_error = NULL,
         last_error_at = NULL,
         updated_by = auth.uid(),
         updated_at = NOW()
     WHERE id = {config_id};
     ```

   - **`update_account_id`:**
     ```sql
     UPDATE meta_ad_accounts
     SET meta_account_id = {new_meta_account_id},
         updated_at = NOW()
     WHERE id = (SELECT account_id FROM meta_ads_config WHERE id = {config_id});
     ```

   - **`update_sync_interval`:**
     ```sql
     UPDATE meta_ads_config
     SET sync_interval_minutes = {new_interval_minutes},
         updated_by = auth.uid(),
         updated_at = NOW()
     WHERE id = {config_id};
     ```

   - **`toggle_active`:**
     ```sql
     UPDATE meta_ads_config
     SET is_active = {active},
         updated_by = auth.uid(),
         updated_at = NOW()
     WHERE id = {config_id};
     ```

7. **Smoke test pós-rotation** (apenas para `rotate_token`):
   - Invocar edge `sync-meta-billing` com `sync_type='fast'` para validar token novo
   - Se HTTP 401 → ROLLBACK token (revert para old via second UPDATE — admin-specialist mantém old token em variável local) + ESCALATE com `token_invalid_post_rotation`
   - Se HTTP 200 → DONE

8. **Tratar erros:**
   - 42501 (RLS) → BLOCKED
   - 23502 (NOT NULL) → BLOCKED com campo
   - 5xx → retry 1x → ESCALATE

9. **Activity log STRICT:**
   - `action='admin-specialist.update_meta_sync_config'`
   - `resource_type='meta_ads_config'`
   - `resource_id={config_id}`
   - `details={action, before, after}` — **TOKENS REDACTED** (apenas hash + length)

   **STRICT failure:** se activity_logs INSERT falhar, ROLLBACK mutation + ESCALATE com `audit_failure_rollback`. Mutation sem audit é proibida em admin ops.

10. **FLAG quality-guardian audit** — admin op sensível, mandatory audit (INV-07 ext).

11. **Echo final:**
    ```
    ✓ Config atualizada
    Action: {action}
    Account: {account_name}
    {action-specific result}

    Próximo sync respeitará nova config: {next_sync_at}
    Activity log registrado (tokens redacted).

    Recomende rodar run-meta-sync para validar imediatamente (sync_type='fast').
    ```

### acceptance_criteria

- **[A1] Admin/owner gate primário:** task ABORT imediatamente se user.role != admin && != owner. Zero queries.
- **[A2] Token redaction obrigatório:** activity_logs e handoff card NUNCA contêm token completo. Apenas hash SHA-256 dos primeiros 8 chars + length total.
- **[A3] Dupla confirmation diferenciada:** rotate_token e update_account_id exigem texto literal uppercase ("CONFIRMO ROTACIONA", "CONFIRMO TROCA CONTA") — não "confirma" comum.
- **[A4] Smoke test pós-rotation:** após rotate_token, invocar fast sync para validar. 401 → rollback automático.
- **[A5] Audit STRICT:** falha em activity_logs INSERT = rollback mutation + ESCALATE. Sem audit, sem mutation.
- **[A6] No bypass:** task NUNCA promove user a admin para autorizar — gate é primário e read-only.
- **[A7] Quality-guardian flag:** SEMPRE marca audit em retorno ao chief.
- **[A8] Validation strict:** ranges de intervalo (15..1440) + Meta account_id regex + token length sanity check.

---

## Exemplos

### Exemplo 1 — Pablo (owner) rotaciona token (DONE)

**Input:** action=rotate_token, new_access_token (450 chars)

**Specialist:**
1. Owner gate ✓
2. Resolve config → token_rotated_at=2026-04-15 (~25 dias atrás, idade OK)
3. Validate token length 450c ✓ (within 100..500)
4. Confirmation Step 1 preview shown (com token hash redacted)
5. Step 2: user digita "CONFIRMO ROTACIONA" ✓
6. UPDATE mutation
7. Smoke test: invoke sync-meta-billing fast → 200 OK em 18s
8. Activity log: details com `new_token_hash='a3f9b2c1' new_token_length=450 old_token_hash_was='1d4e7c89'`
9. Echo:
   ```
   ✓ Config atualizada
   Action: rotate_token
   Account: Archprime Sales
   Token novo (hash a3f9b2c1) ativo. Smoke test fast sync passou em 18s.
   Próximo cron sync: 2026-05-10 16:00.
   ```

### Exemplo 2 — Marketing tenta rotacionar (BLOCKED)

**Input:** Sandra (marketing) chama action=rotate_token

**Specialist:** Admin/owner gate → BLOCKED:
```
Update meta-sync-config é Admin/Owner-only. Sua role atual: marketing.
Tokens Meta API são credenciais sensíveis. Não há workflow de escalation —
apenas owner ou admin pode rotacionar.
```

### Exemplo 3 — Token novo inválido (ROLLBACK)

**Input:** Pablo rotaciona, novo token está malformado

**Specialist:** UPDATE OK → smoke test 401 → ROLLBACK (UPDATE de volta) → ESCALATE:
```
Novo token Meta API rejeitado pela Graph API (401 unauthorized).
Token antigo restaurado automaticamente.
Verifique copy/paste do token e tente novamente.
Activity log registrou tentativa + rollback.
```

### Exemplo 4 — Sync interval inválido (ESCALATE)

**Input:** action=update_sync_interval, new_interval_minutes=5

**Specialist:** Range check → ESCALATE:
```
Intervalo de sync deve estar entre 15..1440 minutos (15min a 24h).
Recebido: 5. Mínimo é 15 para evitar throttling Meta API.
```

---

## Notas

- **Por que admin-only:** tokens Meta API têm scope `ads_management + ads_read + business_management` — comprometimento permite scrape completo de billing, criativos, audiences, e modificação de campaigns. Risco financeiro direto.
- **Refresh token:** se ausente no payload, refresh existente é mantido (`COALESCE`). Edge function tenta refresh em 401 server-side; user só vê token expirado quando refresh também falhou.
- **Smoke test após rotation:** prevenção contra typo no copy/paste — paste errado seria detectado no próximo cron mas com lag. Smoke fast valida em <30s.
- **Sync interval:** afeta apenas cron automático (`pg_cron` job). Sync manual via run-meta-sync ignora este interval.
- **Multi-account:** se há múltiplas accounts (`meta_ad_accounts.is_active=true`), task afeta APENAS a config do `account_id` resolvido. Outras accounts não tocam.

---

**Mantido por:** admin-specialist
