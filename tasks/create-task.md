# Task: create-task

> Task atômica para criar uma nova linha na tabela `tasks` do Supabase, respeitando a identidade do usuário (JWT) e retornando ID + Eisenhower quadrant classification.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Task`

### status
`pending` *(default até execução pelo platform-specialist dentro de um cycle)*

### responsible_executor
`platform-specialist` (Sprint 2 scope: Tasks module only)

### execution_type
`Agent` — execução 100% via LLM + Supabase client. Human intervention apenas na etapa de CONFIRMAÇÃO (message shown, user replies "sim/não").

### input

Entregue pelo `ops-chief` via `*handoff` ceremony:

- **Cycle ID** (obrigatório): `cyc-YYYY-MM-DD-NNN`
- **User JWT**: presente em `~/.primeteam/session.json` (auth já verificada pelo chief no step_1_receive)
- **User role**: extraída da session (informativa — RLS valida no Supabase)
- **Request payload** (variável, mas normalmente inclui):
  - `title` (string, obrigatório — se ausente, task FAIL com ESCALATE `ask_user_for_title`)
  - `description` (string, opcional)
  - `due_date` (string — pode ser natural like "amanhã 15h" ou ISO)
  - `priority` (int 1..4, opcional — se ausente, ASK ou inferir)
  - `urgency` (int 1..4, opcional — se ausente, ASK ou inferir)
  - `estimated_duration_minutes` (int, opcional)
  - `project_id` (uuid, opcional)

### output

Retornado ao `ops-chief` via announcement V10 + handoff card V18:

- **`task_id`** — uuid da linha criada (Supabase auto-gen)
- **`eisenhower_quadrant`** — Q1 | Q2 | Q3 | Q4 (derivado de priority+urgency)
- **`due_date_utc`** — ISO 8601 UTC da data resolvida (se fornecida)
- **`due_date_local`** — mesma data em Europe/Rome (team TZ)
- **`row_snapshot`** — objeto com os campos inseridos (para audit trail)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - UTC timestamp: ✓
  - RLS respected: ✓ (mutation usou JWT do user, não service_role)
  - Session read-only: ✓ (não modificou ~/.primeteam/session.json)
  - i18n: N/A (operação de DB, sem UI string)

### action_items

1. **Parse input** — extrair title + optional fields da request payload
2. **Validar title** — não pode ser string vazia nem só whitespace. Se falhar, ESCALATE com `suggested_user_message: "Qual o título da tarefa?"`
3. **Resolver timestamps** — se `due_date` vier em linguagem natural (ex: "amanhã 15h"), converter para Europe/Rome local e depois UTC. ECHOAR ambos no confirmation message.
4. **Inferir Eisenhower** — se priority/urgency ausentes:
   - Se contexto claro (ex: "urgente e importante"): inferir Q1, priority=4 urgency=4
   - Se ambíguo: ASK via ESCALATE rather than invent
5. **Classificar quadrante** — aplicar matriz Eisenhower:
   - priority >=3 + urgency >=3 → Q1 (fazer agora)
   - priority >=3 + urgency <3 → Q2 (planejar)
   - priority <3 + urgency >=3 → Q3 (delegar)
   - priority <3 + urgency <3 → Q4 (deletar/adiar)
6. **Confirmation message** — apresentar ao user (via chief echo) com:
   ```
   Vou criar: «{title}»
   priority={p} urgency={u} (Eisenhower Q{q} — {interpretação})
   due_date={due_iso_utc} ({due_local Europe/Rome})
   description: {desc or "—"}
   Confirma?
   ```
7. **Aguardar confirmação** — se user replies "sim"/"confirma"/"ok", prosseguir. Se "não", ESCALATE with `ask_user_for_correction`.
8. **Executar INSERT** via Supabase client (JWT user):
   ```sql
   INSERT INTO tasks
     (title, description, due_date, priority, urgency,
      estimated_duration_minutes, project_id,
      created_by, owner_id, status, block_type)
   VALUES
     ({title}, {desc}, {due_utc}, {p}, {u},
      {est_min}, {proj_id},
      auth.uid(), auth.uid(), 'pending', 'work');
   ```
9. **Capturar response** — Supabase retorna `data.id` (uuid) + row inserted.
10. **Tratar erros**:
    - PGRST301 / 42501 (RLS denial) → BLOCKED, reportar role + policy
    - 23502 (not null violation) → BLOCKED, reportar campo
    - 5xx / timeout → retry 1x; se persistir, ESCALATE
11. **Retornar ao chief** — announcement V10 + handoff card V18 com `task_id`, `quadrant`, `row_snapshot`.

### acceptance_criteria

- **[A1] Title validation:** se request vem sem title não-vazio, task TERMINA com ESCALATE (verdict ≠ DONE). Zero Supabase calls.
- **[A2] Confirmation shown:** user vê mensagem de confirmação com title + priority/urgency + due_date em UTC+local antes de qualquer INSERT. Audit trail mostra o `confirmation_echo` em handoff card.
- **[A3] UTC timestamps:** se `due_date` foi fornecido, o INSERT grava em UTC. O handoff card mostra ambas as representações (UTC + Europe/Rome).
- **[A4] JWT scoping:** a chamada para Supabase usa o access_token do user (HTTP header `Authorization: Bearer {jwt}`). `created_by` e `owner_id` são ambos `auth.uid()` do user (verificável no row_snapshot).
- **[A5] Eisenhower classification:** handoff card retorna o quadrant (Q1-Q4) com reasoning explícito baseado em priority/urgency.
- **[A6] Error clarity:** se RLS ou constraint violation acontece, o handoff card tem `verdict = BLOCKED`, error code, e a mensagem original do Supabase (não mascarada).
- **[A7] Idempotency note:** a task NÃO é idempotente por design (cada execução cria uma nova row). Mas o handoff card AVISA se o title/due_date match com uma row recente (últimas 24h) para detecção de duplicata acidental.
- **[A8] No scope creep:** mesmo que request mencione finance/cs/etc., esta task SOMENTE cria linha em `tasks`. Outros módulos = ESCALATE.

---

## Exemplos de execução

### Exemplo 1 — Happy path (DONE)

**Input do chief:**
```
*handoff @platform-specialist --cycle cyc-2026-04-23-001
Request: "criar tarefa: revisar PRD fiscal engine até sexta, alta prioridade"
Task: create-task
```

**Specialist executa:**

1. Title = "revisar PRD fiscal engine"
2. "sexta" (hoje = qua 2026-04-23) → 2026-04-25 18:00 Europe/Rome → 2026-04-25T16:00Z UTC
3. "alta prioridade" → priority=4. Urgency não explícita, 2 dias de prazo → urgency=3 (inferência ecoada).
4. Quadrant: priority=4 + urgency=3 → Q1 (fazer agora, há prazo curto)
5. Confirmation:
   ```
   Vou criar: «revisar PRD fiscal engine»
   priority=4 urgency=3 (Eisenhower Q1 — fazer agora, prazo curto)
   due_date=2026-04-25T16:00Z (sexta 18h Europe/Rome)
   description: —
   Confirma?
   ```
6. User: "sim"
7. INSERT → retorna id `8a3f1c2b-...`
8. Return:
   ```
   [platform-specialist → ops-chief] Cycle cyc-2026-04-23-001 — DONE.

   task_id: 8a3f1c2b-...
   eisenhower_quadrant: Q1
   due_date_utc: 2026-04-25T16:00:00Z
   due_date_local: 2026-04-25 18:00 Europe/Rome
   row_snapshot: { title, priority, urgency, due_date, created_by, owner_id, status: pending }
   convention_check: UTC ✓ | RLS ✓ | session RO ✓ | i18n N/A
   ```

### Exemplo 2 — Title ausente (ESCALATE)

**Input:** `"criar tarefa pra amanhã"`

**Specialist:** nota title ausente (só "pra amanhã" que seria due_date).

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: "Qual o título da tarefa pra amanhã?"
convention_check: N/A (nenhuma mutation tentada)
```

### Exemplo 3 — RLS denial hipotético (BLOCKED)

(Policies atuais são permissivas, mas se fossem restritas:)

**Input:** user role=cs pedindo criar tarefa em project_id de outro team

**Specialist:** tenta INSERT, Supabase retorna PGRST code 42501 (insufficient privilege) por policy `tasks_insert_team_check`.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — BLOCKED.

verdict: BLOCKED
error: { code: 42501, hint: "row-level security policy violation" }
warnings: |
  Sua role (cs) não permite criar tarefas no project_id={uuid}. Policy
  `tasks_insert_team_check` exige que o user seja membro do project via
  task_project_members.
suggested_next: escalate_to_user
suggested_user_message: "Você precisa ser adicionado ao projeto X antes de criar tarefas nele. Fale com o owner do projeto."
```

---

## Notas de implementação

- **Dependência da CLI auth (Fase 2 Sprint 1):** esta task presume que o user tem session válida em `~/.primeteam/session.json`. Se ausente/expirada, o `ops-chief` nunca chega a chamar esta task (pre-check no step_1_receive).
- **Trigger BEFORE INSERT** existe em `tasks`: `set_original_estimated_duration_trigger` — se `estimated_duration_minutes` for fornecido, o trigger grava também em `original_estimated_duration_minutes`. Não preciso setar esse campo manualmente.
- **Recorrência:** esta task NÃO cria padrão de recorrência (`is_recurring`, `recurrence_*`). Recurrence creation fica para Sprint 2.5 ou Sprint 3.

---

**Mantido por:** platform-specialist (self-reference) + ops-chief (orchestration updates em CHANGELOG).
