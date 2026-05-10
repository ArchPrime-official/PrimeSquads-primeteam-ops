# Task: list-vapi-calls

> Read-only — listar chamadas Vapi com filtros (período, status, lead, custo). Comercial monitora outcomes; admin audita custos. Implementa F-11.2 leitura.

**⚠️ SCHEMA NOTE (2026-05-10):** Tabela canonical é `telephony_calls`. Pode incluir Vapi+Ringover+outras providers (filtrar por `provider`/`call_strategy_id`).

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`List Vapi Calls`

### responsible_executor
`integration-specialist`

### execution_type
`Agent` — read-only.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload (todos opcionais):**
  - `lead_id` (uuid, filtra por lead)
  - `status` (`'queued' | 'in_progress' | 'completed' | 'failed'`)
  - `purpose`, `assistant_id`
  - `date_from`, `date_to` (ISO; default últimos 7 dias)
  - `min_cost_usd`, `max_cost_usd`
  - `limit` (default 50, max 500)
  - `include_transcript` (bool, default false — payload pesado)

### output

- **`calls`** (array): `id, vapi_call_id, lead_id, lead_name, assistant_id, purpose, status, started_at, ended_at, duration_seconds, cost_usd, transcript_summary OR transcript_full, outcome_classification`
- **`stats`**: `{total_calls, total_cost_usd, avg_duration_min, success_rate, conversion_rate}`
- **`verdict`** — `DONE`

### action_items

1. **Role check:** comercial/cs/admin/owner. financeiro/marketing → BLOCKED (cs precisa para CS handoff context).
2. **Validar limit ≤ 500** + date range max 90 dias.
3. **Query principal:**
   ```sql
   SELECT
     vc.id, vc.vapi_call_id, vc.lead_id,
     l.name AS lead_name, l.phone AS lead_phone,
     vc.assistant_id, vc.purpose, vc.status,
     vc.started_at, vc.ended_at,
     EXTRACT(EPOCH FROM (vc.ended_at - vc.started_at))::int AS duration_seconds,
     vc.cost_usd,
     vc.transcript_summary,
     {include_transcript} ? vc.transcript_full : NULL AS transcript_full,
     vc.outcome_classification
   FROM telephony_calls vc
   LEFT JOIN leads l ON l.id = vc.lead_id
   WHERE
     ({lead_id} IS NULL OR vc.lead_id={lead_id})
     AND ({status} IS NULL OR vc.status={status})
     AND ({purpose} IS NULL OR vc.purpose={purpose})
     AND vc.started_at BETWEEN {date_from} AND {date_to}
     AND ({min_cost} IS NULL OR vc.cost_usd >= {min_cost})
     AND ({max_cost} IS NULL OR vc.cost_usd <= {max_cost})
   ORDER BY vc.started_at DESC
   LIMIT {limit};
   ```
4. **Stats query:**
   ```sql
   SELECT
     COUNT(*) AS total,
     SUM(cost_usd) AS total_cost,
     AVG(EXTRACT(EPOCH FROM (ended_at - started_at)) / 60) AS avg_duration_min,
     COUNT(*) FILTER (WHERE status='completed' AND outcome_classification IN ('qualified','interested')) * 100.0 / NULLIF(COUNT(*), 0) AS success_rate,
     COUNT(*) FILTER (WHERE outcome_classification='converted') * 100.0 / NULLIF(COUNT(*), 0) AS conversion_rate
   FROM telephony_calls
   WHERE started_at BETWEEN {date_from} AND {date_to};
   ```
5. **Activity log:** `action='integration-specialist.list_telephony_calls'`, details com filtros (não conteúdo).
6. **Echo tabular:**
   ```
   📞 Vapi Calls — {date_from} to {date_to}

   Total: {N} calls | Custo: ${total_cost} | Avg duration: {avg}min
   Success rate: {sr}% | Conversion rate: {cr}%

   [Top 20 com lead_name, phone (mascarado), status, duration, cost, outcome]
   ... ({N-20} mais)

   Tendências:
   - {top_assistants_by_cost}
   - {peak_hours}
   - {failed_calls_top_reason}

   Use --include_transcript para pegar full text (payload grande).
   ```

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/admin/owner.
- **[A2] Limit cap:** 500 + date range 90 dias.
- **[A3] Cost transparency:** total_cost sempre apresentado (admin audita).
- **[A4] Privacy:** phone mascarado em demo; full em payload.
- **[A5] Transcript opt-in:** `include_transcript=false` default — payload menor.
- **[A6] Read-only:** zero mutation.
- **[A7] Stats calculadas:** mesmo se zero rows, retornar zeros (não NaN).

---

## Exemplos

### Exemplo 1 — Daniel revisa calls da última semana

**Input:** sem filtros (default 7d)

**Output:** 87 calls, $34.50, 5.2min avg, 32% success, 12% conversion. Top 20 listados.

### Exemplo 2 — Admin audita custos do mês

**Input:** `date_from=2026-05-01`, `min_cost_usd=1.0` (calls longas)

**Output:** filtra calls > $1, identifica outliers, drill-down por assistant.

### Exemplo 3 — CS busca contexto pré-handoff

**Input:** `lead_id={x}`, `include_transcript=true`

**Output:** todas calls do lead com transcripts completos para CS entender histórico.

---

## Notas

- **Tabela `telephony_calls`:** populada por `vapi-launch-call` (insert) + `vapi-webhook` (update com transcript/cost).
- **Outcome classification:** auto-classificado pelo assistant via prompt + LLM. Valores: `qualified | interested | not_interested | callback_requested | wrong_number | converted | other`.
- **Cost reconciliation:** sync semanal `sync-vapi-billing` reconcilia custos com Vapi invoice (memory: vapi-billing-sync-broken-2026-05-07 — débito conhecido).

---

**Mantido por:** integration-specialist
