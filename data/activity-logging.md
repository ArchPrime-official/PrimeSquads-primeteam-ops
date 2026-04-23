# Activity Logging — Squad Observability Pattern

> Toda operação do squad (cycle lifecycle + mutations) grava entry em `activity_logs` do Supabase. Permite página Log no primeteam mostrar histórico completo + audit trail.

---

## Schema usado

Tabela **`activity_logs`** (já existe no Supabase, não requires migration):

```typescript
{
  id: uuid,
  user_id: uuid,                    // auth.uid() do user logado
  action: string,                   // "{specialist}.{playbook}" OR "cycle_{event}"
  resource_type: string,            // "squad_cycle" | "squad_mutation"
  resource_id: string,              // cycle_id OR target_row_id
  details: jsonb,                   // payload estruturado (ver schemas abaixo)
  ip_address: string | null,        // preenchido se edge function no meio
  user_agent: string | null,
  created_at: timestamp
}
```

---

## Padrões de entry por tipo

### 1. Cycle lifecycle (gravado por ops-chief)

Todo cycle gera **2 entries** (abertura + fechamento):

```typescript
// No step_1_receive do orchestration protocol
{
  user_id: auth.uid(),
  action: "cycle_opened",
  resource_type: "squad_cycle",
  resource_id: "cyc-2026-04-23-001",
  details: {
    request: "<user's original utterance>",
    normalized_request: "<chief's internal representation>",
    routing_plan: null,              // TBD após triage
    cycle_status: "Received"
  }
}

// No step_5_next_or_complete (close)
{
  user_id: auth.uid(),
  action: "cycle_closed",
  resource_type: "squad_cycle",
  resource_id: "cyc-2026-04-23-001",
  details: {
    cycle_status: "Done" | "Escalated" | "BlockedOnAuth",
    specialists_involved: ["platform-specialist"],
    total_duration_seconds: 45,
    gate_verdict: "PASS" | "REJECT" | "ESCALATE",
    suggested_next: "close" | "route_to @X" | "escalate_to_user"
  }
}
```

### 2. Specialist mutation (gravado por cada specialist que muta DB)

Após execute a mutation, specialist faz INSERT:

```typescript
// Exemplo: platform-specialist.create_task
{
  user_id: auth.uid(),
  action: "platform-specialist.create_task",
  resource_type: "squad_mutation",
  resource_id: "<task_id gerado>",   // ID da row criada/atualizada
  details: {
    cycle_id: "cyc-2026-04-23-001",  // correlation com cycle
    specialist: "platform-specialist",
    playbook: "create_task",
    verdict: "DONE",
    before: null,                     // null em INSERT
    after: {
      title: "revisar PRD fiscal",
      priority: 4,
      urgency: 3,
      due_date: "2026-04-25T16:00:00Z"
    },
    convention_check: {
      rls_respected: true,
      session_read_only: true,
      utc_timestamps: true
    }
  }
}

// Exemplo: content-builder.activate_lp (mutation mais sensível)
{
  action: "content-builder.activate_lp",
  resource_type: "squad_mutation",
  resource_id: "<lp_id>",
  details: {
    cycle_id: "cyc-2026-04-23-X",
    specialist: "content-builder",
    playbook: "activate_lp",
    verdict: "DONE",
    before: { active: false },
    after: { active: true, public_url: "lp.archprime.io/immersione-roma" },
    side_effects_warned: ["publishes to public traffic"],
    confirmation_logged: true          // user said "sim"
  }
}
```

### 3. Handoff between specialists (gravado por ops-chief)

Cada vez que chief delega:

```typescript
{
  action: "handoff",
  resource_type: "squad_cycle",
  resource_id: "cyc-2026-04-23-001",
  details: {
    cycle_id: "cyc-2026-04-23-001",
    from: "ops-chief",
    to: "platform-specialist",
    briefing_summary: "create_task with 3 inferred fields",
    phase: "route"
  }
}
```

### 4. Quality-guardian audit (gravado quando invocado)

```typescript
{
  action: "quality-guardian.audit",
  resource_type: "squad_cycle",
  resource_id: "cyc-2026-04-23-001",
  details: {
    cycle_id: "cyc-2026-04-23-001",
    audit_mode: "full",              // "quick" OR "full"
    sections_run: 10,
    verdict: "PASS",                 // PASS | REJECT | ESCALATE | WAIVE
    findings: [],                    // array if REJECT
    how_to_fix: null
  }
}
```

---

## Queries comuns

### Ver últimos 20 cycles

```sql
SELECT id, created_at, action, resource_id, details->>'cycle_status' as status
FROM activity_logs
WHERE resource_type = 'squad_cycle'
  AND action = 'cycle_closed'
ORDER BY created_at DESC
LIMIT 20;
```

### Ver todas as mutations de um user

```sql
SELECT action, resource_id, details->>'playbook' as playbook,
       details->>'verdict' as verdict, created_at
FROM activity_logs
WHERE user_id = auth.uid()
  AND resource_type = 'squad_mutation'
ORDER BY created_at DESC
LIMIT 50;
```

### Reconstruir um cycle completo (todos entries correlacionados)

```sql
SELECT action, created_at, details
FROM activity_logs
WHERE (resource_type = 'squad_cycle' AND resource_id = 'cyc-2026-04-23-001')
   OR (resource_type = 'squad_mutation' AND details->>'cycle_id' = 'cyc-2026-04-23-001')
ORDER BY created_at ASC;
```

Retorna trace ordenado: cycle_opened → handoff → mutation(s) → cycle_closed.

### Flows ativos no último cycle de um user

```sql
SELECT resource_id, details->>'routing_plan' as agents, created_at
FROM activity_logs
WHERE user_id = auth.uid()
  AND action = 'cycle_opened'
ORDER BY created_at DESC
LIMIT 1;
```

---

## RLS considerations

`activity_logs` já tem RLS policy. Convenção:

- User vê suas próprias entries (`user_id = auth.uid()`)
- Owner/admin vê todas (via policy owner-can-view-all OR similar)
- CS/financeiro/comercial/marketing vê apenas as próprias

Para a página Log mostrar *todas* as atividades do squad, a query deve ser feita por role=owner (ou admin). Outros roles veem apenas seus cycles.

---

## Failure modes

### INSERT em activity_logs falha

Se o INSERT no log table falha (ex: RLS issue transitional, network), specialist **NÃO aborta a operação principal**. Mutation original já foi commitada; log é best-effort.

Log falhando → surface warning no handoff card (`activity_log_write_failed: true`) + continue.

### Privacy no details field

NUNCA inserir em `details`:
- `access_token` / `refresh_token` / `api_key`
- Email addresses não relacionadas ao user (privacy)
- Recordings URLs (VAPI calls) — usar só `recording_uploaded: true/false`
- Conteúdo HTML completo de templates (só `template_id` reference)

---

## Exemplos de trace visual (página Log no primeteam)

Esperado que a página `/owner/activity-log` (ou nova `/log`) mostre:

```
─── cyc-2026-04-23-001 (Pablo, 10:32:15) ───
▸ cycle_opened
  request: "criar tarefa revisar PRD até sexta"
▸ handoff: ops-chief → platform-specialist
  phase: route
▸ platform-specialist.create_task
  resource: 8a3f1c2b-... (task criada)
  verdict: DONE
  after: { title: "revisar PRD", priority: 4, urgency: 3 }
▸ cycle_closed
  status: Done
  duration: 45s
  gate_verdict: PASS
```

Página UI detail descrita em `data/migrations-required.md` (Sprint 21 primeteam-side).

---

## Checklist de implementação

Para cada agent que faz mutation, garantir:

- [ ] Core_principle ACTIVITY_LOG_OBLIGATORY listado
- [ ] Após cada mutation bem-sucedida, INSERT em activity_logs
- [ ] details JSON segue schema por tipo (cycle_opened | mutation | handoff | audit)
- [ ] Handoff card V18 inclui `activity_log_id`
- [ ] Failure mode (log write fail) documented, não aborta main op

---

**Mantido por:** squad primeteam-ops. Atualizar quando novos agents/playbooks forem adicionados.
