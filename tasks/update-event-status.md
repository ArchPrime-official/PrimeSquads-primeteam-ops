# Task: update-event-status

> Atualizar status de inscrito em evento (presença, no-show, conversão). CS usa durante e pós-evento. Implementa F-17.5 do PRD.

**✅ SCHEMA ADAPTED (2026-05-10):** Tabela `event_registrations` NÃO existe — adaptado para usar `opportunities` (linkado via campaign_id). Status de inscrito mantido em `opportunities.stage` (enum existente: `lead_opportunity, qualified, sale_done, lost`); presença/conversão mantidos em `opportunities.metadata` JSONB para flexibilidade.

**Mapping:**
- `confirmed` → `opportunities.stage='qualified'`
- `attended` → `opportunities.metadata.attended_at = NOW()`
- `no_show` → `opportunities.metadata.no_show=true`
- `converted` → `opportunities.stage='sale_done'`

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Update Event Registrant Status`

### responsible_executor
`sales-specialist` (escopo CRM/leads) — modifica status do inscrito

### execution_type
`Agent` — confirmation simples, mutation single-row.

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `event_id` (uuid)
  - `lead_id` (uuid OU `email` para resolver)
  - `new_status` (`'confirmed' | 'attended' | 'no_show' | 'converted'`)
  - `notes` (string opcional)
  - `attended_at` (ISO timestamp opcional, default NOW se status='attended')
  - `converted_opportunity_id` (uuid opcional, requerido se status='converted')

### output

- **`registration_id`** (uuid)
- **`old_status`** + **`new_status`**
- **`verdict`** — `DONE | BLOCKED | ESCALATE`
- **`convention_check`** — RLS ✓ / status_transition ✓ / audit ✓

### action_items

1. **Role check:** cs/marketing/admin/owner. Outros → BLOCKED.
2. **Resolver lead_id** (se passou email).
3. **Validar `new_status`** ∈ enum válido. Outros → ESCALATE.
4. **Buscar registration atual:**
   ```sql
   SELECT id, status AS old_status, attended_at, converted_opportunity_id
   FROM event_registrations
   WHERE event_id={event_id} AND lead_id={lead_id};
   ```
   0 match → ESCALATE com `not_registered`.
5. **Validar transição:**
   - `confirmed → attended`: OK (precisa `attended_at`)
   - `confirmed → no_show`: OK
   - `attended → converted`: OK (precisa `converted_opportunity_id`)
   - `no_show → confirmed`: OK (correção)
   - `converted → *`: BLOCKED (estado terminal)
   - Outros: ESCALATE
6. **Confirmation:**
   ```
   Inscrito: {name} ({email})
   Evento: {event_name}
   Status atual: {old_status}
   Novo status: {new_status}
   {attended_at ? 'Presença em: ' + attended_at : ''}
   {converted_opportunity_id ? 'Vinculado a opp: ' + converted_opportunity_id : ''}
   {notes ? 'Notas: ' + notes : ''}
   Confirma?
   ```
7. **UPDATE:**
   ```sql
   UPDATE event_registrations
   SET status={new_status},
       attended_at=COALESCE({attended_at}, attended_at),
       converted_opportunity_id=COALESCE({converted_opportunity_id}, converted_opportunity_id),
       notes=COALESCE({notes}, notes),
       updated_by=auth.uid(),
       updated_at=NOW()
   WHERE id={registration_id};
   ```
8. **Activity log:** `action='sales-specialist.update_event_status'`, details com diff.
9. **Echo:**
   ```
   ✓ Status atualizado
   {name}: {old_status} → {new_status}
   {converted ? 'Opportunity vinculada — pipeline atualizado.' : ''}
   ```

### acceptance_criteria

- **[A1] Role gating:** cs/marketing/admin/owner.
- **[A2] Status enum:** rejeita valores fora do enum.
- **[A3] Transition validation:** estados terminais (converted) bloqueiam volta.
- **[A4] Conditional fields:** attended_at obrigatório se status=attended; opportunity_id obrigatório se status=converted.
- **[A5] Audit log:** diff before/after.
- **[A6] Idempotency:** se status atual = novo status, ESCALATE com `no_op` (não re-marca).

---

## Exemplos

### Exemplo 1 — Andrea marca presença

**Input:** `event_id={x}`, `lead_id={y}`, `new_status='attended'`, `attended_at=2026-05-15T19:30:00Z`

**Specialist:** valida transição confirmed→attended ✓, UPDATE, echo "Presença marcada".

### Exemplo 2 — Marca conversão sem opp_id (ESCALATE)

**Input:** `new_status='converted'` sem `converted_opportunity_id`

**Specialist:** ESCALATE:
```
Status 'converted' requer converted_opportunity_id. Crie a opportunity
primeiro via create-lead/move-opportunity-stage e passe o UUID.
```

### Exemplo 3 — Tentativa de regredir converted (BLOCKED)

**Input:** registrant já converted, tentativa de voltar para attended

**Specialist:** BLOCKED com:
```
Inscrito já está em estado 'converted' (terminal). Para reverter, contate
admin para correção manual via SQL (raro — significa erro de classificação).
```

---

## Notas

- **Schema dependency:** assume tabela `event_registrations` com colunas listadas. Se schema usa `opportunities` com `campaign_id` linked, adaptar.
- **Bulk update:** task é single-row. Para batch (ex: marcar 50 attended de uma vez), usar `bulk-update-opportunities` com filter.
- **Notification side-effect:** se status='converted', integration-specialist pode disparar email de boas-vindas (Sprint futuro).

---

**Mantido por:** sales-specialist
