# Task: launch-vapi-call

> Disparar chamada AI via Vapi para lead (qualificação inicial, follow-up). Comercial usa para automatizar prospecção. Implementa F-11.2 do PRD.

**✅ SCHEMA ADAPTED (2026-06-12):** Tabela canonical de registros Vapi = `call_executions` (colunas reais: `id, vapi_call_id, strategy_id, lead_id, opportunity_id, status, outcome, started_at, ended_at, duration_seconds, transcript, recording_url, error_message, closer_id`). `telephony_calls` é para chamadas Ringover/PABX (sem colunas Vapi). Edge canonical = `vapi-start-call`.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name
`Launch Vapi AI Call`

### responsible_executor
`integration-specialist` (boundary externa — Vapi API)

### execution_type
`Agent` — confirmation OBRIGATÓRIO (chamada custa $ + impacto no lead).

### input

- **Cycle ID**, **User JWT**, **User role**
- **Request payload:**
  - `lead_id` (uuid, obrigatório — resolve phone)
  - `assistant_id` (string Vapi, obrigatório — qual assistant usar)
  - `purpose` (`'qualification' | 'followup' | 'recovery'`)
  - `context_overrides` (object opcional — variables para o assistant: `{lead_name, product_interest, etc.}`)
  - `schedule_at` (ISO timestamp opcional — se null, dispara já)

### output

- **`call_id`** (UUID Vapi externo + UUID interno)
- **`vapi_status`** (`queued | in-progress | completed | failed`)
- **`estimated_cost_usd`** (decimal — Vapi cobra por minuto)
- **`transcript_url`** (preenchido após completion via webhook, NULL inicialmente)
- **`verdict`** — `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role check:** comercial/admin/owner. cs/marketing/financeiro → BLOCKED:
   ```
   Launch Vapi call requer role comercial/admin/owner.
   Sua role: {role}. Vapi é ferramenta de prospecção comercial.
   ```
2. **Resolver lead:**
   ```sql
   SELECT id, name, phone, status, last_contact_at, opted_out
   FROM leads WHERE id={lead_id};
   ```
   - Sem phone → ESCALATE
   - `opted_out=true` → BLOCKED com explicação
   - `status='converted'` ou `'rejected'` → ESCALATE com warning (lead provavelmente não deveria receber call)
3. **Validar assistant_id existe** em `vapi_assistants` cache local (sync via cron).
4. **Cool-down check:** se `last_contact_at < 24h atrás` AND tipo prévio era também `vapi_call` → ESCALATE:
   ```
   Lead recebeu Vapi call há {hours}h. Cool-down 24h recomendado para
   evitar fadiga. Use send-whatsapp-message ou agendar via schedule_at.
   ```
5. **Estimate cost:** Vapi ~$0.05-0.30/min. Estimar 5min default = $0.30 worst case.
6. **Confirmation:**
   ```
   Vou disparar Vapi AI call:
     Lead: {name} ({phone})
     Status atual: {lead_status}
     Assistant: {assistant_name}
     Propósito: {purpose}
     Custo estimado: ~$0.30 (5min)
     {schedule_at ? 'Agendado: ' + schedule_at : 'Imediato'}

   Lead {has_consent ? 'tem consentimento' : '⚠️ SEM consentimento explícito'}
   Confirma?
   ```
7. **Aguardar "sim"** ou (se urgente sem consent) "CONFIRMO SEM CONSENT" uppercase.
8. **Invoke edge function:**
   ```typescript
   await supabase.functions.invoke('vapi-start-call', {
     body: { lead_id, assistant_id, purpose, context_overrides, schedule_at },
     headers: { Authorization: `Bearer ${jwt}` }
   });
   ```
9. **Tratar erros:**
   - 401 (Vapi token) → BLOCKED, admin renova
   - 402 (insufficient credits) → BLOCKED com instrução
   - 429 → ESCALATE com cooldown
   - 5xx → retry 1x
10. **Persist call record** (via EF `vapi-start-call` — ela insere automaticamente):
    ```sql
    -- A EF vapi-start-call insere em call_executions:
    INSERT INTO call_executions
      (lead_id, opportunity_id, strategy_id, vapi_call_id, status, started_at)
    VALUES (...);
    -- Nota: custo real é registrado pelo vapi-webhook após completion.
    -- Não há colunas assistant_id/purpose/estimated_cost_usd em call_executions.
    -- Para associar a uma strategy_id, passar no body da EF.
    ```
11. **Activity log:** `action='integration-specialist.launch_vapi_call'`, details com lead_id (sem PII completo).
12. **Echo:**
    ```
    ✓ Vapi call lançada
    Call ID: {vapi_call_id}
    Status: {queued | in-progress}
    Lead: {name}
    Custo estimado: ~${cost}

    Próximo: webhook chega quando call completa. Transcript em
    list-vapi-calls após ~1-2min de processamento.
    ```

### acceptance_criteria

- **[A1] Role gating:** comercial/admin/owner only.
- **[A2] Opt-out enforcement:** lead com `opted_out=true` = BLOCKED hard.
- **[A3] Cool-down check:** 24h entre Vapi calls ao mesmo lead.
- **[A4] Cost transparency:** estimate antes de confirmar.
- **[A5] Consent surfacing:** echo flagueia se lead não tem consent registrado (não bloqueia mas avisa).
- **[A6] Idempotency:** retry interno 1x; ESCALATE depois.
- **[A7] Persist record:** call_executions table tem row antes de echo final (inserido pela EF vapi-start-call).
- **[A8] Schedule support:** `schedule_at` futuro vai para queue.

---

## Exemplos

### Exemplo 1 — Daniel (comercial) lança qualification call

**Input:** `lead_id={novo_lead}`, `assistant_id='qualifier_pt_v3'`, `purpose='qualification'`

**Specialist:** Lead found, sem opt-out, primeiro contato → confirmation → invoke Vapi → DONE com call_id.

### Exemplo 2 — Lead opted-out → BLOCKED

**Input:** lead com `opted_out=true`

**Specialist:** BLOCKED:
```
Lead {name} optou-se OUT de contato AI (registrado em {when}).
Não é possível disparar Vapi call por compliance LGPD/GDPR.
Para contatar manualmente, use send-whatsapp-message com template approved.
```

### Exemplo 3 — Insufficient credits → BLOCKED

**Input:** Vapi retorna 402

**Specialist:** BLOCKED:
```
Vapi sem créditos suficientes (~$0.30 needed). Admin precisa recarregar
saldo no dashboard Vapi. URL: https://dashboard.vapi.ai/credits
Activity log registrou tentativa para visibility.
```

---

## Notas

- **Edge `vapi-start-call`:** já existe, faz call Vapi REST API + insere row em `call_executions`.
- **Webhook completion:** Vapi envia POST para `vapi-webhook` quando call termina; transcript + outcome persistidos em `call_executions` automaticamente.
- **Strategies:** configurações do assistant ficam em `call_strategies` (com `vapi_assistant_id`). Usar `strategy_id` no payload da EF.
- **Compliance:** `opted_out` flag em `leads` (coluna a ser criada via migration D2) é enforçado. Reset só via direct user action.
- **Concurrency:** Vapi limita ~5 concurrent calls per account. Queue automática se exceder.

---

**Mantido por:** integration-specialist
