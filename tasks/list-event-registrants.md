# Task: list-event-registrants

> Read-only — listar inscritos de um evento com filtros (status, presença, conversão). CS usa diariamente durante eventos ativos. Implementa F-17.5 do PRD.

**✅ SCHEMA ADAPTED (2026-05-10):** Tabela dedicada `event_registrations` NÃO existe em prod — adaptado para usar `opportunities` filtered by `campaign_id` linkado ao evento. Adicionalmente: `onboarding_submissions` ou `strategic_session_forms` para inscritos em pré-qualificação que ainda não viraram opportunity. Specialist faz UNION das duas fontes se necessário (default = opportunities only).

**Query adaptada:**
```sql
SELECT
  l.id AS lead_id, l.name, l.email, l.phone,
  o.stage AS status,
  o.metadata->>'attended_at' AS attended_at,
  o.id AS converted_opportunity_id,
  o.created_at, o.last_email_sent_at
FROM opportunities o
JOIN leads l ON l.id = o.lead_id
WHERE o.campaign_id = {event.campaign_id}
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
  - `event_id` (uuid OU `event_slug` → resolve)
  - `filter_status` (opcional): `'all' | 'confirmed' | 'no_show' | 'attended' | 'converted'`
  - `filter_attended` (bool opcional)
  - `limit` (int default 100, max 500)
  - `sort_by` (default `'created_at DESC'`)

### output

- **`registrants`** (array): cada item com:
  - `lead_id`, `name`, `email`, `phone`
  - `status` (`confirmed | no_show | attended | converted`)
  - `attended_at` (timestamp opcional)
  - `converted_to_opportunity_id` (uuid opcional)
  - `created_at`, `last_email_sent_at`
- **`stats`**: `{total, confirmed, attended, no_show, converted, conversion_rate}`
- **`event_meta`**: `{name, status, start_date, capacity, fill_rate}`
- **`verdict`** — `DONE`

### action_items

1. **Role check:** marketing/cs/admin/owner. Outros (financeiro, comercial) → BLOCKED com mensagem clara.
2. **Resolver event_id** se passado slug. 0 match → ESCALATE.
3. **Validar limit** ≤ 500.
4. **Query principal:**
   ```sql
   SELECT
     l.id AS lead_id, l.name, l.email, l.phone,
     er.status, er.attended_at,
     er.converted_opportunity_id,
     er.created_at, er.last_email_sent_at
   FROM event_registrations er
   JOIN leads l ON l.id = er.lead_id
   WHERE er.event_id = {event_id}
     AND ({filter_status} IS NULL OR er.status = {filter_status})
     AND ({filter_attended} IS NULL OR (er.attended_at IS NOT NULL) = {filter_attended})
   ORDER BY {sort_by}
   LIMIT {limit};
   ```
   *Nota: tabela `event_registrations` pode estar em forma alternativa (ex: opportunities filtered by campaign_id linked to event). Adaptar query ao schema real.*

5. **Stats query:**
   ```sql
   SELECT
     COUNT(*) AS total,
     COUNT(*) FILTER (WHERE status='confirmed') AS confirmed,
     COUNT(*) FILTER (WHERE status='attended') AS attended,
     COUNT(*) FILTER (WHERE status='no_show') AS no_show,
     COUNT(*) FILTER (WHERE converted_opportunity_id IS NOT NULL) AS converted
   FROM event_registrations
   WHERE event_id = {event_id};
   ```
   `conversion_rate = converted / total * 100`.

6. **Event meta:** SELECT do evento + capacidade + fill_rate.

7. **Activity log:** `action='sales-specialist.list_event_registrants'`, details com filtros usados (auditável).

8. **Echo:** apresentação tabular condensada (top 20 + stats) + sugestões:
   ```
   📊 Evento: {name} ({status})
   {start_date} • Capacidade {filled}/{capacity}

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

- **[A1] Role gating:** marketing/cs/admin/owner. financeiro/comercial puro = BLOCKED.
- **[A2] Limit cap:** max 500 — evita response payload gigante.
- **[A3] Stats sempre:** mesmo se zero inscritos, retornar stats `{total: 0, ...}`.
- **[A4] Conversion rate:** calculado; se total=0, conversion_rate=0 (evita NaN).
- **[A5] Audit:** activity_log com filtros (não retornar dados sensíveis em log, só metadata).
- **[A6] Read-only:** zero mutation. Se task tentar UPDATE, abort.

---

## Exemplos

### Exemplo 1 — Andrea (cs) lista presentes do evento ativo

**Input:** `event_id={uuid}`, `filter_attended=true`

**Output:** 47 attended out of 80 confirmed (58.75% attendance), 12 converted (25.5% conversion). Lista ordenada por nome.

### Exemplo 2 — financeiro tenta listar (BLOCKED)

**Input:** Larissa (financeiro) → BLOCKED:
```
Lista de inscritos de evento requer role marketing/cs/admin/owner.
Sua role: financeiro. Peça à Sandra (Marketing) ou Andrea/Jessica (CS).
```

### Exemplo 3 — Filtro por status converted

**Input:** `filter_status='converted'` → retorna só os 12 que converteram, com `converted_opportunity_id` para drill-down.

---

## Notas

- **Tabela exata:** se `event_registrations` não existir ainda, usar `opportunities` filtered by `campaign_id` linked to event. Schema discovery primeiro.
- **Privacy:** echo NUNCA imprime telefones completos em demo (mascarar últimos 4 dígitos se sample > 5 rows). Full data fica no payload retornado.
- **Conversion rate:** definição = (lead virou opportunity won) / total inscritos. Considerar cohort temporal (eventos antigos têm taxa diferente de eventos ativos).

---

**Mantido por:** sales-specialist
