# Task: list-calendar-events

> Task read-only para listar eventos Google Calendar do user a partir do cache (`google_calendar_events_cache`). SEMPRE checa staleness de sync antes de retornar e reporta via warning se > 30min. Zero external API calls — usa apenas o cache Supabase.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`List Calendar Events`

### status
`pending`

### responsible_executor
`integration-specialist` (Sprint 8, Google Calendar module)

### execution_type
`Agent` — LLM + Supabase. Read-only no cache. Zero chamadas externas à Google Calendar API.

### input

Entregue pelo `ops-chief`:

- **Cycle ID**: `cyc-YYYY-MM-DD-NNN`
- **User JWT**: `~/.primeteam/session.json`
- **Request payload**:
  - `date_range` (opcional):
    - keyword: "today" | "tomorrow" | "this_week" | "next_week" | "this_month"
    - OR custom `{from, to}` (ISO dates or timestamps)
    - default: today (Europe/Rome 00:00 → 23:59 UTC)
  - `is_all_day` (bool opcional — filter all-day events)
  - `has_meet_link` (bool opcional — só reuniões com Google Meet)
  - `search_term` (string opcional — ILIKE em title + description)
  - `location_filter` (string opcional — ILIKE em location)
  - `organizer_email` (string opcional — filter by organizer)
  - `include_overrides` (bool opcional, default false — merge local overrides se true)

### output

- **`total_rows`** — número de eventos retornados
- **`rows`** — array com campos restritos: id, google_event_id, title, start_time (UTC), end_time (UTC), is_all_day, location, meet_link, organizer_email, recurring_event_id
- **`table_compact`** — markdown com start/end em Europe/Rome + UTC
- **`filters_applied`** — echo
- **`sync_status`** — { last_synced_at, event_count, status: FRESH | STALE | DISCONNECTED, staleness_minutes }
- **`truncated`** — bool (true se total == limit)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - Read-only: ✓
  - user_id scoped: ✓
  - No external API call: ✓
  - Staleness reported: ✓
  - UTC raw + Rome format: ✓
  - Privacy: meet_link só do user próprio: ✓

### action_items

1. **Parse filters** — aplicar defaults:
   - date_range default: hoje Europe/Rome (start 00:00 → end 23:59:59 → converter para UTC bounds)
   - keyword resolution: "tomorrow" → +1d; "this_week" → segunda 00:00 → domingo 23:59; "next_week" → próxima semana; "this_month" → dia 1 → último dia
   - Sem filtros explícitos = default today
2. **Check connection status** (pre-flight):
   - `SELECT expires_at FROM user_oauth_tokens WHERE user_id = auth.uid() AND provider = 'google' LIMIT 1`
   - Se row não existe → BLOCKED com msg "user não conectado ao Google Calendar" + instruções
   - Se `expires_at < now()` → WARN (token provavelmente sendo refreshado via edge function; cache ainda pode estar válido)
3. **Check sync_status**:
   - `SELECT last_synced_at, event_count, range_start, range_end FROM google_calendar_sync_status WHERE user_id = auth.uid()`
   - Se nenhuma row → status = DISCONNECTED, BLOCKED com msg "nunca sincronizou. Abra primeteam.archprime.io/agenda para triggerar sync inicial"
   - Se `last_synced_at == null` → DISCONNECTED, mesmo handling
   - Se delta `now - last_synced_at`:
     - < 30 min → FRESH
     - 30 min ≤ delta < 24h → STALE (add warning)
     - >= 24h → VERY_STALE (warning mais forte + sugestão forte de re-sync)
4. **Query cache** com filters:
   ```sql
   SELECT id, google_event_id, title, start_time, end_time,
          is_all_day, location, meet_link, organizer_email,
          recurring_event_id
   FROM google_calendar_events_cache
   WHERE user_id = auth.uid()
     AND start_time >= {range_start_utc}
     AND start_time <= {range_end_utc}
     {AND is_all_day = {bool} if filter}
     {AND meet_link IS NOT NULL if has_meet_link}
     {AND (title ILIKE ... OR description ILIKE ...) if search_term}
     {AND location ILIKE ... if location_filter}
     {AND organizer_email = ... if organizer_email}
   ORDER BY start_time ASC
   LIMIT 100;
   ```
5. **Merge overrides** (se include_overrides=true):
   - Para cada event row, check `google_event_overrides` WHERE google_event_id = {id} AND user_id = auth.uid()
   - Aplicar overrides nos campos correspondentes (ex: user renomeou título localmente)
   - Marcar em output: `has_override: true` nos rows com customização
6. **Format output**:
   - `rows` raw: timestamps em ISO UTC
   - `table_compact`: timestamps em Europe/Rome (formato: YYYY-MM-DD HH:mm)
   - Truncation flag se total == 100
7. **Privacy check**:
   - `meet_link` só incluído em rows do próprio user (já coberto pelo WHERE user_id = auth.uid())
   - Se role=owner está vendo events de outro user (não deveria, mas defensive), zerar meet_link no output
8. **Tratar erros**:
   - 0 rows → DONE com `rows=[]` (NÃO é BLOCKED). Se STALE, warning sugere re-sync.
   - 5xx → retry 1x → ESCALATE
9. **Return** — V10 + V11 + V18 com sync_status inline.

### acceptance_criteria

- **[A1] User_id scoped:** query SEMPRE tem `WHERE user_id = auth.uid()`. Privacy garantida.
- **[A2] No external API call:** task lê apenas `google_calendar_events_cache`. Nunca invoca Google Calendar API (isso é edge function job).
- **[A3] Sync status pre-check:** antes de retornar rows, check `google_calendar_sync_status`. Se DISCONNECTED → BLOCKED. Se STALE/VERY_STALE → warning.
- **[A4] Staleness threshold:** 30 min = FRESH/STALE boundary. 24h = VERY_STALE escalation.
- **[A5] Date range keywords:** today/tomorrow/this_week/next_week/this_month reconhecidos, convertidos para UTC bounds a partir de Europe/Rome.
- **[A6] Empty result OK:** 0 rows retornados com cache FRESH = DONE com mensagem "nenhum evento no período". NÃO é BLOCKED.
- **[A7] Timestamps dual:** `rows` raw em UTC ISO; `table_compact` em Europe/Rome formatted.
- **[A8] No mutation:** verdict DONE com `convention_check.read_only = true`. Zero INSERT/UPDATE/DELETE. Zero edge function invoke (trigger_resync é task diferente).

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE, cache FRESH)

**Input:** `"meus eventos de hoje"`

**Specialist:**
1. date_range = today Europe/Rome → 2026-04-24 00:00 Rome → 23:59 Rome → UTC bounds
2. Connection: token presente, expires_at futuro ✓
3. sync_status: last_synced_at = 2026-04-24T08:15Z (15min atrás) → FRESH
4. Query cache → 3 rows

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 3
table_compact: |
  | # | Título | Start (Rome) | End (Rome) | Local/Meet | Organizer |
  |---|--------|--------------|------------|------------|-----------|
  | 1 | Session Miriam Rossi | 10:00 | 11:00 | meet.google.com/xyz | daniel@archprime.io |
  | 2 | Almoço cliente Verde SA | 13:00 | 14:30 | Ristorante da Sergio | — |
  | 3 | Review semanal | 16:00 | 17:00 | meet.google.com/abc | pablo@archprime.io |
sync_status: { last_synced_at: 2026-04-24T08:15Z, event_count: 47, status: FRESH, staleness_minutes: 15 }
filters_applied: { date_range: today }
warnings: nenhum
convention_check: read-only ✓ | user scoped ✓ | no external API ✓ | staleness FRESH ✓
```

### Exemplo 2 — Cache STALE (DONE com warning)

**Input:** `"eventos dessa semana"`, cache last_synced_at = 2h atrás.

**Specialist:**
1. date_range = this_week
2. sync_status: 2h atrás → STALE
3. Query → 12 rows
4. Warning adicionado

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 12
table_compact: (12 rows)
sync_status: { last_synced_at: 2026-04-24T06:30Z, status: STALE, staleness_minutes: 128 }
filters_applied: { date_range: this_week }
warnings: |
  ⚠ Cache tem 2h8min de idade. Eventos criados/movidos após 06:30Z
  podem não estar aqui. Para sync fresh: pedir "sincronizar calendar"
  (dispara re-sync ~3-5s).
convention_check: read-only ✓ | staleness STALE reported ✓
```

### Exemplo 3 — User desconectado (BLOCKED)

**Input:** `"meus eventos de hoje"`, user novo, nunca conectou Google Calendar.

**Specialist:**
1. Connection check: nenhuma row em `user_oauth_tokens` para provider=google → DISCONNECTED.
2. BLOCKED antes de chegar em sync_status ou query.

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: "user não conectado ao Google Calendar"
sync_status: { status: DISCONNECTED }
suggested_next: escalate_to_user
suggested_user_message: |
  "Você ainda não conectou o Google Calendar. Para conectar:
   1. Abra https://primeteam.archprime.io/settings
   2. Vá em 'Integrações' → 'Google Calendar' → 'Conectar'
   3. Complete o OAuth flow (aceitar permissões)
   Depois volte aqui e peça 'meus eventos' novamente.
   Nota: conexão via CLI não está disponível ainda (Sprint 9+)."
```

### Exemplo 4 — Search por título

**Input:** `"qual meu evento com o Rossi?"`

**Specialist:**
1. search_term = "rossi"
2. date_range default today? Ou should query broader? Default today, MAS se 0 matches hoje, expand para this_week com warning. Sprint 8 mantém conservador: today only, user pode pedir range maior.
3. Query WHERE title ILIKE '%rossi%'.
4. 1 match: "Session Miriam Rossi" às 10:00.

**Return:** DONE com 1 row + filters_applied: { search_term: "rossi", date_range: today }

### Exemplo 5 — Empty result (DONE, not BLOCKED)

**Input:** `"eventos de segunda que vem"` em semana onde user tem nenhum evento.

**Specialist:** date_range = next_week day 1 (monday). Query retorna 0 rows. Cache FRESH.

**Return:**
```
[integration-specialist → ops-chief] Cycle cyc-... — DONE.

total_rows: 0
table_compact: "(nenhum evento nesse período)"
sync_status: { status: FRESH, staleness_minutes: 8 }
filters_applied: { date_range: { from: 2026-04-27, to: 2026-04-27 } }
warnings: nenhum
convention_check: read-only ✓ (empty result OK)
```

---

## Notas de implementação

- **Read-only, zero confirmation:** SELECT não precisa echo.
- **Staleness threshold calibrável:** 30 min é default; se webhook rates Google mudarem, ajustar. future_notes do agent considera tunable.
- **Date ranges em Europe/Rome:** keywords interpretados em TZ do time (Rome), convertidos para UTC nas queries. Output UTC + Rome para clareza.
- **Overrides opcional:** include_overrides=false por default (show canonical Google data). User pode pedir true para ver customizações locais.
- **Privacy:** query sempre scoped por user_id. Mesmo owner não vê eventos de outros users via esta task (feature, not bug).
- **No trigger_resync auto:** se STALE, task NÃO dispara sync silenciosamente. User decide via request explícita.

---

**Mantido por:** integration-specialist.
