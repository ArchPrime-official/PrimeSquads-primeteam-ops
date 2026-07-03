# Task: list-event-registrants

> Read-only — listar inscritos de um evento com filtros (status, presença, conversão). CS usa diariamente durante eventos ativos. Implementa F-17.5 do PRD.

**✅ SCHEMA GROUNDED (2026-07-03):** Tabela dedicada `event_registrations` NÃO existe em prod. Um "evento" **É uma `campaigns` row** (`campaigns.id`); o inscrito é uma `opportunities` linkada por `opportunities.campaign_id = campaigns.id` (mesmo modelo já confirmado em `update-event-status.md`). Colunas fantasma removidas: `o.metadata` (não existe — usar `o.qualification_data` jsonb), `o.status` (não existe em opportunities — o campo de pipeline é `o.stage`, e não há valor `'won'`; o stage terminal de venda é `SALE_DONE`), `o.last_email_sent_at` (não existe em opportunities), `l.name`/`l.email`/`l.phone` (leads usa `full_name`/`primary_email`/`primary_phone`). Os status `'confirmed'`/`'no_show'` do filtro NÃO são valores livres — são mapeados para o enum real de 25 valores de `opportunity_stage` (ver `move-opportunity-stage.md`): `confirmed→STRATEGIC_SESSION`, `attended→SALES_SESSION` (mais `qualification_data->>'attended_at'`), `no_show→SALES_NO_SHOW`/`NO_SHOW`, `converted→SALE_DONE`.

**Query adaptada (colunas reais):**
```sql
SELECT
  l.id AS lead_id, l.full_name, l.primary_email, l.primary_phone,
  o.stage AS status,
  o.qualification_data->>'attended_at' AS attended_at,
  o.id AS converted_opportunity_id,
  o.created_at
FROM opportunities o
JOIN leads l ON l.id = o.lead_id
WHERE o.campaign_id = {campaign_id}  -- campaigns.id do evento (não existe tabela `events`)
ORDER BY o.created_at DESC;
```

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`List Event Registrants`

### responsible_executor
`sales-specialist` (escopo CRM/leads/opportunities) — leitura cross-table

### execution_type
`Agent` — read-only, sem confirmation.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `campaign_id` (uuid — `campaigns.id` do evento) OU `campaign_slug` (text `campaigns.campaign_id`, resolvido para o uuid)
  - `filter_status` (opcional): `'all' | 'confirmed' | 'no_show' | 'attended' | 'converted'` (mapeado para o enum real de `opportunity_stage`, ver cabeçalho)
  - `filter_attended` (bool opcional)
  - `limit` (int default 100, max 500)
  - `sort_by` (default `'created_at DESC'`)

### output

- **`registrants`** (array): cada item com:
  - `lead_id`, `full_name`, `primary_email`, `primary_phone`
  - `status` (stage real do enum de 25 valores — ver `move-opportunity-stage.md`)
  - `attended_at` (timestamp opcional, de `qualification_data->>'attended_at'`)
  - `converted_to_opportunity_id` (uuid opcional)
  - `created_at`
- **`stats`**: `{total, confirmed, attended, no_show, converted, conversion_rate}`
- **`event_meta`**: `{name, status, start_date}` (campos de `campaigns`; `campaigns` NÃO tem `capacity`/`fill_rate` — se precisar de capacidade, é um campo de negócio a confirmar antes de assumir que existe)
- **`verdict`** — `DONE`

### action_items

1. **Role check:** comercial/cs/admin/owner. `marketing`/`financeiro` → BLOCKED com mensagem clara (ver `data/role-permissions-map.md`: comercial/admin/cs têm acesso a `opportunities`; marketing/financeiro não).
2. **Resolver campaign_id** se passado `campaign_slug` (`SELECT id FROM campaigns WHERE campaign_id = {campaign_slug}`). 0 match → ESCALATE.
3. **Validar limit** ≤ 500.
4. **Query principal** (tabela `event_registrations` NÃO existe — usar `opportunities` join `leads`):
   ```sql
   -- Schema real: opportunities JOIN leads, filtrado por campaign_id (= campaigns.id) do evento.
   -- Mapeamento filter_status → stage: confirmed→STRATEGIC_SESSION, attended→SALES_SESSION,
   -- no_show→SALES_NO_SHOW/NO_SHOW, converted→SALE_DONE (ver cabeçalho).
   SELECT
     l.id AS lead_id, l.full_name, l.primary_email, l.primary_phone,
     o.stage AS status,
     o.qualification_data->>'attended_at' AS attended_at,
     o.id AS converted_opportunity_id,
     o.created_at
   FROM opportunities o
   JOIN leads l ON l.id = o.lead_id
   WHERE o.campaign_id = {campaign_id}  -- evento identificado por campaigns.id (nao existe tabela events)
     AND ({filter_status} IS NULL OR {filter_status} = 'all' OR o.stage = {mapped_stage})
     AND ({filter_attended} IS NULL OR (o.qualification_data->>'attended_at' IS NOT NULL) = {filter_attended}::boolean)
   ORDER BY {sort_by}
   LIMIT {limit};
   ```

5. **Stats query** (tabela `event_registrations` NÃO existe — usar `opportunities`):
   ```sql
   SELECT
     COUNT(*) AS total,
     COUNT(*) FILTER (WHERE o.stage = 'STRATEGIC_SESSION') AS confirmed,
     COUNT(*) FILTER (WHERE o.qualification_data->>'attended_at' IS NOT NULL) AS attended,
     COUNT(*) FILTER (WHERE o.stage IN ('SALES_NO_SHOW', 'NO_SHOW')) AS no_show,
     COUNT(*) FILTER (WHERE o.stage = 'SALE_DONE') AS converted
   FROM opportunities o
   WHERE o.campaign_id = {campaign_id};  -- evento identificado por campaigns.id (nao existe tabela events)
   ```
   `conversion_rate = converted / total * 100`.

6. **Event meta:** SELECT de `campaigns` (`name`, `status`, `start_date`) — sem `capacity`/`fill_rate` (colunas não existem em `campaigns`; se o negócio precisa de capacidade, confirmar onde é modelada antes de expor no output).

7. **Activity log:** `action='sales-specialist.list_event_registrants'`, details com filtros usados (auditável).

8. **Echo:** apresentação tabular condensada (top 20 + stats) + sugestões:
   ```
   📊 Evento: {name} ({status})
   {start_date}

   Total: {N} inscritos
     ✓ Confirmados: {X}
     👍 Compareceram: {Y} ({attendance_rate}%)
     ❌ No-show: {Z}
     💰 Converteram: {C} ({conversion_rate}%)

   [Top 20 inscritos com nome, email, status, conversão]
   ... ({N-20} mais — use limit maior pra ver tudo)

   Próximos passos sugeridos:
   - Marcar presença: update-event-status
   - Email para no-show: enviar via send-whatsapp ou email manual
   - Contatar converted leads: opportunities pipeline
   ```

### acceptance_criteria

- **[A1] Role gating:** comercial/cs/admin/owner. marketing/financeiro = BLOCKED.
- **[A2] Limit cap:** max 500 — evita response payload gigante.
- **[A3] Stats sempre:** mesmo se zero inscritos, retornar stats `{total: 0, ...}`.
- **[A4] Conversion rate:** calculado; se total=0, conversion_rate=0 (evita NaN).
- **[A5] Audit:** activity_log com filtros (não retornar dados sensíveis em log, só metadata).
- **[A6] Read-only:** zero mutation. Se task tentar UPDATE, abort.

---

## Exemplos

### Exemplo 1 — Andrea (cs) lista presentes do evento ativo

**Input:** `campaign_id={uuid}`, `filter_attended=true`

**Output:** 47 attended out of 80 confirmed (58.75% attendance), 12 converted (25.5% conversion). Lista ordenada por nome.

### Exemplo 2 — marketing tenta listar (BLOCKED)

**Input:** Sandra (marketing) → BLOCKED:
```
Lista de inscritos de evento requer role comercial/cs/admin/owner.
Sua role: marketing. Peça à Daniel (comercial) ou Andrea/Jessica (CS).
```

### Exemplo 3 — Filtro por status converted

**Input:** `filter_status='converted'` → retorna só os 12 que converteram (stage=SALE_DONE), com `converted_opportunity_id` para drill-down.

---

## Notas

- **Tabela real:** `event_registrations` NÃO existe em prod. Usar `opportunities` filtrado por `campaign_id` (= `campaigns.id`) linkado ao evento — não existe tabela `events`. Schema discovery obrigatório antes de executar.
- **Role gating (verificado 2026-07-03 contra `data/role-permissions-map.md`):** comercial/admin/cs têm acesso a `opportunities`; marketing/financeiro não. **Ressalva:** as migrations mais recentes de RLS em `opportunities` (`20260423060000_opportunities_select_role_based.sql`, `20260525150000_opportunities_update_policy_include_cs.sql`, reafirmadas em `20261005120000_rls_initplan_optimization.sql`) mostram, na prática, políticas que também incluem `marketing` no SELECT e no UPDATE/ALL de `opportunities` — aparentemente um efeito colateral de um fix emergencial de abril/2026 (bug de "0 resultados para todos os roles") que nunca foi apertado de volta ao estado documentado em `role-permissions-map.md` (pós PR #951). Ou seja: o **RLS técnico atual é mais permissivo** do que a política pretendida aqui. Esta task mantém o bloqueio de `marketing` como CAMADA DE NEGÓCIO acima do RLS (mais restritiva) — mas se alguém depender só do RLS do banco para bloquear marketing, hoje isso NÃO acontece. Recomenda-se abrir uma migration de tightening se o bloqueio a `marketing` for realmente desejado no banco.
- **Privacy:** echo NUNCA imprime telefones completos em demo (mascarar últimos 4 dígitos se sample > 5 rows). Full data fica no payload retornado.
- **Conversion rate:** definição = (lead virou opportunity `SALE_DONE`) / total inscritos. Considerar cohort temporal (eventos antigos têm taxa diferente de eventos ativos).

---

**Mantido por:** sales-specialist
