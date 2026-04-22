# Task: list-revolut-balances

> Task read-only para listar saldo atual de cada conta Revolut do user (latest `revolut_balance_checks` por conta), com sync_status pre-check e flagging de discrepâncias (is_matching=false). Requer role `financeiro` ou `owner` (RLS `has_finance_access()`). Zero external API calls — cache apenas.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Revolut Balances`

### status
`pending`

### responsible_executor
`integration-specialist` (Sprint 9, Revolut module)

### execution_type
`Agent` — LLM + Supabase. Read-only. Zero chamadas à Revolut API (edge function territory).

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `currency_filter` (opcional — filtrar por uma ou mais currencies: EUR, USD, GBP, etc.)
  - `include_discrepancies_only` (bool opcional — só rows com is_matching=false)
  - `account_name_filter` (string opcional — ILIKE em account_name, ex: "EUR" filter "Revolut EUR")
  - `limit` (int opcional, default 20)

### output

- **`total_rows`** — número de contas retornadas
- **`rows`** — array com campos: id, account_name, external_account_id, currency, revolut_balance, calculated_balance, difference, is_matching, checked_at, account_id (FK finance_bank_accounts)
- **`table_compact`** — markdown em Europe/Rome
- **`sync_status`** — { last_sync_at, last_sync_status, last_sync_error, staleness_minutes, status: FRESH | STALE | VERY_STALE | DISCONNECTED }
- **`discrepancy_count`** — int (total de rows com is_matching=false)
- **`filters_applied`** — echo
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`next_step_suggestion`** — se STALE/discrepancies: sugerir trigger_revolut_sync ou trigger_revolut_balance_check
- **`convention_check`**:
  - Read-only: ✓
  - user_id scoped: ✓
  - has_finance_access validated by RLS: ✓
  - access_token/refresh_token NEVER selected: ✓
  - No external API call: ✓
  - Staleness reported: ✓
  - Discrepancies flagged: ✓

### action_items

1. **RLS pre-check awareness**: task usa `has_finance_access()` via Supabase RLS. Se user role não é owner/financeiro, a query falha com 42501. Task SURFACE isso como BLOCKED — zero retry com credentials diferentes.

2. **Check Revolut connection**:
   ```sql
   SELECT id, expires_at,
          (expires_at > now()) as is_valid
   FROM revolut_credentials
   WHERE user_id = auth.uid()
   LIMIT 1;
   ```
   - 0 rows → `sync_status.status = DISCONNECTED`, BLOCKED com msg "conectar Revolut em /finance/settings"
   - `is_valid=false` → WARN (refresh automático pode estar em progresso)
   - `is_valid=true` → prosseguir
   - **PRIVACY STRICT**: NUNCA incluir `access_token` ou `refresh_token` no SELECT.

3. **Check sync status**:
   ```sql
   SELECT id, sync_type, status, started_at, completed_at, error_message
   FROM revolut_sync_logs
   WHERE user_id = auth.uid()
     AND status IN ('success', 'running', 'failed')
   ORDER BY started_at DESC
   LIMIT 1;
   ```
   - 0 rows → `sync_status.status = DISCONNECTED` (nunca sincronizou)
   - `status=running` → WARN "sync em progresso — aguarde antes de re-trigger"
   - `status=failed` → WARN com error_message
   - `status=success`: calcular staleness de `completed_at`:
     - <15 min → FRESH
     - 15 min-2h → STALE (warning)
     - >2h → VERY_STALE (warning forte + sugestão forte de re-sync)

4. **Query balances** com DISTINCT ON por account (latest check por conta):
   ```sql
   SELECT DISTINCT ON (external_account_id)
          id, account_name, external_account_id, currency,
          revolut_balance, calculated_balance, difference,
          is_matching, checked_at, account_id
   FROM revolut_balance_checks
   WHERE user_id = auth.uid()
     {AND currency IN ({list}) if currency_filter}
     {AND account_name ILIKE '%{term}%' if account_name_filter}
     {AND is_matching = false if include_discrepancies_only}
   ORDER BY external_account_id, checked_at DESC
   LIMIT {limit};
   ```
   - **PRIVACY**: user_id = auth.uid() strict (mesmo role=owner filter por self).

5. **Count discrepancies**:
   - Separadamente: `COUNT(*) WHERE is_matching = false` no mesmo período.
   - Ou: contar rows em `rows` array onde `is_matching=false`.

6. **Format output**:
   - `rows` raw: todos os campos numeric como são (não round).
   - `table_compact`: timestamps em Europe/Rome, diff formatted com sinal (+/-).
   - Discrepancies destacadas com ⚠.

7. **Populate next_step_suggestion**:
   - Se DISCONNECTED → ask user conectar
   - Se VERY_STALE OR discrepancies → sugerir `trigger_revolut_balance_check` (se só balance) OU `trigger_revolut_sync` (se transactions podem estar defasadas)
   - Se FRESH e sem discrepâncias → `close`

8. **Tratar erros**:
   - 42501 (RLS) → BLOCKED com role explanation (has_finance_access)
   - 5xx → retry 1x → ESCALATE

9. **Return** — V10 + V11 + V18.

### acceptance_criteria

- **[A1] Access_token never selected:** query em `revolut_credentials` SEMPRE exclui access_token/refresh_token. Enforcement via código, não confiança no RLS.
- **[A2] user_id scoped:** todas as queries têm `WHERE user_id = auth.uid()`. Role=owner também filtra por self (privacy).
- **[A3] Connection pre-check:** antes de retornar balances, task verifica credentials presentes + válidos. DISCONNECTED → BLOCKED com msg clara.
- **[A4] Sync status pre-check:** task sempre consulta `revolut_sync_logs` antes de retornar balances. Staleness incluído no output.
- **[A5] Staleness threshold Revolut:** <15min FRESH, 15min-2h STALE, >2h VERY_STALE. Financeiro exige fresh mais estrita que Calendar.
- **[A6] Discrepancy flagging:** rows com is_matching=false marcadas ⚠ no table_compact. discrepancy_count populado.
- **[A7] No external API:** query apenas tabelas cache. trigger_revolut_balance_check é TASK SEPARADA.
- **[A8] RLS denial honest:** se role inadequada, BLOCKED com has_finance_access explanation. Zero bypass.

---

## Exemplos de execução

### Exemplo 1 — Happy path FRESH (DONE)

**Input:** `"saldo Revolut"`, user=financeiro (Joyce). Credentials valid. Sync 8min atrás. 3 contas, 0 discrepâncias.

**Specialist:**
1. Connection: credentials present, expires_at=+6d → OK
2. Sync status: last success 8min atrás → FRESH
3. Query balances: 3 rows (EUR, USD, GBP)
4. Discrepancy count: 0

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 3
table_compact: |
  | # | Conta | Currency | Revolut | Calculated | Δ | Match? | Checked |
  |---|-------|----------|---------|------------|---|--------|---------|
  | 1 | Revolut EUR | EUR | 15,240.00 | 15,240.00 | 0 | ✓ | 2026-04-24 09:52 Rome |
  | 2 | Revolut USD | USD | 3,120.00 | 3,120.00 | 0 | ✓ | 2026-04-24 09:52 Rome |
  | 3 | Revolut GBP | GBP | 850.50 | 850.50 | 0 | ✓ | 2026-04-24 09:52 Rome |
sync_status: { last_sync_at: 2026-04-24T07:52:00Z, status: FRESH, staleness_minutes: 8 }
discrepancy_count: 0
filters_applied: {}
next_step_suggestion: close
convention_check: read-only ✓ | user scoped ✓ | access_token NEVER selected ✓ | RLS has_finance_access ✓
```

### Exemplo 2 — STALE + discrepancy (DONE com warnings)

**Input:** `"saldo Revolut"`, sync 2h15min atrás, conta EUR com Δ=+€2.30.

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 3
table_compact: |
  | # | Conta | Currency | Revolut | Calculated | Δ | Match? | Checked |
  |---|-------|----------|---------|------------|---|--------|---------|
  | 1 | Revolut EUR | EUR | 15,242.30 | 15,240.00 | +2.30 | ⚠ NO | 2026-04-24 07:45 Rome |
  | 2 | Revolut USD | USD | 3,120.00 | 3,120.00 | 0 | ✓ | 2026-04-24 07:45 Rome |
  | 3 | Revolut GBP | GBP | 850.50 | 850.50 | 0 | ✓ | 2026-04-24 07:45 Rome |
sync_status: { last_sync_at: 2026-04-24T05:45:00Z, status: VERY_STALE, staleness_minutes: 135 }
discrepancy_count: 1
warnings: |
  ⚠ Sync Revolut foi há 2h15min (VERY_STALE — threshold 2h). Pode
  conter transações ainda não importadas.
  ⚠ Discrepância de +€2.30 na conta EUR. Provavelmente transação não
  sincronizada OU lançamento manual sem bank_transaction_id.
next_step_suggestion: escalate_to_user
suggested_user_message: |
  "Balances com 2h15min de idade + discrepância EUR. Duas ações
   recomendadas (em ordem):
   1. Disparar sync transactions (trigger_revolut_sync) — ~10-30s,
      importa TX novas em finance_transactions
   2. Após sync, disparar balance check (trigger_revolut_balance_check)
      para confirmar matching
   Deseja executar as duas?"
```

### Exemplo 3 — DISCONNECTED (BLOCKED)

**Input:** `"saldo Revolut"`, user nunca conectou.

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
sync_status: { status: DISCONNECTED }
suggested_user_message: |
  "Você não tem Revolut conectado.
   Para conectar:
   1. Abra primeteam.archprime.io
   2. Finance → Settings → Integrações → Revolut → Conectar
   3. Complete OAuth flow na tela da Revolut
   Depois volte aqui. Conexão via CLI não está disponível ainda
   (Sprint 10+ pode adicionar)."
```

### Exemplo 4 — RLS denial role cs (BLOCKED)

**Input:** `"saldo Revolut"`, user role=cs.

**Specialist:** tenta SELECT em revolut_balance_checks → 42501 (RLS has_finance_access nega).

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 42501, detail: "row-level security policy denied" }
warnings: |
  Sua role (cs) não tem has_finance_access(). Policy restringe leitura
  de tabelas Revolut a roles owner e financeiro.
suggested_user_message: |
  "Acesso a balances Revolut é restrito a owner/financeiro. Sua role é cs.
   Se você precisa dessa info, peça a Joyce/Larissa/Adriana/Pablo, ou
   solicite ajuste de role (via admin-specialist em Sprint 10+)."
```

### Exemplo 5 — Filter só discrepancies

**Input:** `"só as discrepâncias Revolut"`

**Specialist:** filter `include_discrepancies_only=true`. Retorna 2 rows com is_matching=false em 5 contas totais.

**Return:** DONE com 2 rows + warning "2 discrepâncias detectadas em 5 contas".

---

## Notas de implementação

- **Read-only, zero confirmation:** SELECT não precisa echo.
- **Privacy strict:** access_token/refresh_token NUNCA selecionados, mesmo que schema permita. Enforçar via query explícita, não confiança no RLS.
- **Staleness stricter than Calendar:** Revolut 15min vs Calendar 30min. Balances variam mais rápido e têm impacto financeiro direto.
- **Discrepancy não-blocking:** row com is_matching=false é WARNING, não BLOCKED. User decide investigar.
- **DISTINCT ON por account:** evita duplicates de history (mesma conta pode ter vários balance_checks; queremos o mais recente).
- **Currency formatting:** NÃO converter moedas; respeitar a currency original do row.

---

**Mantido por:** integration-specialist.
