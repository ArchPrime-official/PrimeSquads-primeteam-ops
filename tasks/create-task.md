# Task: create-task

> Task atômica para criar uma nova linha na tabela `tasks` do Supabase, respeitando a identidade do usuário (JWT) e retornando ID + Eisenhower quadrant classification.

**Cumpre:** HO-TP-001 (Task Anatomy — 8 campos)

> ⚠️ **REGRA DO PABLO (2026-07-03), vale para SEMPRE:** esta task NUNCA cria uma tarefa
> "vaga". `due_date` (prazo), `scheduled_start_time` (quando será EXECUTADA — distinto
> do prazo), `estimated_duration_minutes` e `assigned_to` (responsável) são **sempre**
> resolvidos antes do INSERT — perguntando ao usuário quando ausentes, nunca defaultando
> silenciosamente. Ver `data/required-fields-registry.yaml` (entry `create-task`) e
> `data/tasks-schedule-blocks-field-reference.md` §1/§4.

---

## Task anatomy (HO-TP-001 — 8 campos obrigatórios)

### task_name
`Create Task`

### status
`pending` *(default da própria task anatomy até execução pelo platform-specialist dentro de um cycle — não confundir com o campo `status` da tabela `tasks`, cujos valores válidos são `'todo' | 'doing' | 'done' | 'cancelled'`)*

### responsible_executor
`platform-specialist` (Sprint 2 scope: Tasks module only)

### execution_type
`Agent` — execução 100% via LLM + Supabase client. Human intervention na etapa de CONFIRMAÇÃO (message shown, user replies "sim/não") e sempre que um dos 4 campos obrigatórios de tempo/responsável estiver ausente.

### input

Entregue pelo `ops-chief` via `*handoff` ceremony:

- **Cycle ID** (obrigatório): `cyc-YYYY-MM-DD-NNN`
- **User JWT**: presente em `~/.primeteam/session.json` (auth já verificada pelo chief no step_1_receive)
- **User role**: extraída da session (informativa — RLS valida no Supabase)
- **Request payload** (variável, mas normalmente inclui):
  - `title` (string, **obrigatório** — se ausente, task FAIL com ESCALATE `ask_user_for_title`)
  - `description` (string, opcional)
  - `due_date` (string, **obrigatório** — PRAZO de entrega, com HORA. Pode ser natural like "amanhã 15h" ou ISO. Se ausente → ESCALATE `ask: "Prazo de entrega? (data + hora, Europe/Rome)"`. NUNCA inventar prazo.)
  - `scheduled_start_time` (string, **obrigatório OU auto-agendado** — data+HORA de EXECUÇÃO, quando a tarefa será DE FATO feita — distinto do `due_date`. Se ausente, dispara auto-scheduling — ver action_items §4A. NUNCA confundir com `due_date`.)
  - `estimated_duration_minutes` (int, **obrigatório** — sem duração não há bloco de agenda. Se ausente → ESCALATE `ask: "Duração estimada (min)?"`. NUNCA assumir 60min silenciosamente.)
  - `assigned_to` (uuid[], **obrigatório** — responsável(is) pela execução. Se ausente → ESCALATE `ask: "Responsável? (nunca assumir quem criou)"`. Pode ser diferente de quem está pedindo a criação — `created_by`/`owner_id` seguem sendo `auth.uid()` do requisitante; `assigned_to` é quem EXECUTA.)
  - `priority` (int 1..10, opcional — se ausente, ASK ou inferir; `5` = neutro)
  - `urgency` (int 1..10, opcional — se ausente, ASK ou inferir; `5` = neutro)
  - `project_id` (uuid, opcional)

**forbidden_defaults:** `due_date`, `scheduled_start_time` (auto-scheduling é o único caminho aceito quando ausente — nunca outro default silencioso), `estimated_duration_minutes`, `assigned_to`. Nenhum destes é inventado ou herdado silenciosamente — ou vêm explícitos, ou disparam ASK/ESCALATE/auto-scheduling conforme action_items.

### output

Retornado ao `ops-chief` via announcement V10 + handoff card V18:

- **`task_id`** — uuid da linha criada (Supabase auto-gen)
- **`eisenhower_quadrant`** — Q1 | Q2 | Q3 | Q4 (derivado de priority+urgency)
- **`due_date_utc`** / **`due_date_local`** — ISO 8601 UTC + Europe/Rome
- **`scheduled_start_time_utc`** / **`scheduled_start_time_local`** — horário de EXECUÇÃO resolvido (explícito ou auto-agendado), UTC + Europe/Rome
- **`auto_scheduled`** — bool (true se o horário veio do auto-scheduling, não do usuário)
- **`schedule_blocks_created`** — int (0 se a tarefa não foi fatiada; N se `task_schedule_blocks` recebeu N linhas)
- **`assigned_to`** — uuid[] eco dos responsáveis
- **`row_snapshot`** — objeto com os campos inseridos (para audit trail)
- **`verdict`** — DONE | BLOCKED | ESCALATE
- **`convention_check`**:
  - UTC timestamp: ✓
  - RLS respected: ✓ (mutation usou JWT do user, não service_role)
  - Session read-only: ✓ (não modificou ~/.primeteam/session.json)
  - i18n: N/A (operação de DB, sem UI string)

### action_items

1. **Parse input** — extrair title + optional fields da request payload.
2. **Validar title** — não pode ser string vazia nem só whitespace. Se falhar, ESCALATE com `suggested_user_message: "Qual o título da tarefa?"`.
3. **Resolver timestamps** — `due_date` em linguagem natural (ex: "amanhã 15h") converter para Europe/Rome local e depois UTC. Se `scheduled_start_time` vier explícito, mesma conversão. ECHOAR ambos (UTC + local) no confirmation message.
4. **⛔ CAMPOS OBRIGATÓRIOS — nunca criar tarefa vaga.** Antes de qualquer INSERT, confirmar que os 4 campos abaixo estão resolvidos (explícitos ou resolvidos pelas etapas seguintes). Qualquer um ausente e não resolvível → ESCALATE, ZERO Supabase calls:
   - `due_date` — se ausente, ESCALATE `"Qual o prazo de entrega dessa tarefa? (data + hora)"`.
   - `estimated_duration_minutes` — se ausente, ESCALATE `"Quantos minutos você estima que essa tarefa vai levar?"`.
   - `assigned_to` — se ausente, ESCALATE `"Quem é o responsável por essa tarefa?"` (nunca assumir `created_by`/quem pediu).
   - `scheduled_start_time` — se ausente, NÃO é bloqueante: dispara auto-scheduling (§4A) em vez de ESCALATE, exceto se o auto-scheduling falhar (sem slot disponível), aí sim ESCALATE.

4A. **Auto-scheduling (quando `scheduled_start_time` não veio explícito)** — espelha
   `apps/v2/src/hooks/useCreateTask.ts` (a UI faz exatamente isso; **não** é
   `apps/v2/src/academy/...`, esse path não existe — o hook real vive em `src/hooks/`).
   - **Resolver o dono da agenda a agendar:** se `assigned_to` tem exatamente 1 uuid, use-o.
     Se tem 2+ uuids → **ESCALATE** perguntando de qual responsável usar a agenda para
     auto-agendar (nunca escolher sozinho — múltiplos responsáveis com auto-scheduling
     ambíguo é exatamente o tipo de "adivinhação" proibida neste squad).
   - Buscar `user_work_schedules` do agendado (fallback se não existir linha: 08:00–18:00,
     almoço 12:00 por 90min, dias úteis {1,2,3,4,5}, capacidade 80% — mesmos defaults do
     `DEFAULT_WORK_SCHEDULE` do hook) + `profiles.timezone` (fallback `Europe/Rome`).
   - Buscar tarefas ATIVAS do agendado (`status IN ('todo','doing')`, exclui `done` e
     `cancelled`) + seus `task_schedule_blocks` existentes (agenda atual, para não colidir).
   - Calcular o(s) slot(s) de hoje até o `due_date`, dentro do expediente, respeitando
     blocos/reuniões fixas (`can_be_split=false`) já ocupando a agenda, e paralelizando no
     dia do prazo em vez de vazar pro futuro (mesma política `adaptive` +
     `distributeThenOverlap` do hook — não reorganiza as OUTRAS tarefas do agendado).
   - Se **não achar nenhum slot** antes do `due_date` → **ESCALATE**: "Impossível agendar
     automaticamente — nenhum horário livre antes do prazo. Ajuste o due_date ou informe
     `scheduled_start_time` manualmente."
   - Se achar: `scheduled_start_time` = início do 1º slot calculado, `is_auto_scheduled=true`.
     Se o resultado tiver **mais de 1 bloco** (tarefa dividida), `can_be_split=true` e os
     blocos serão inseridos em `task_schedule_blocks` no passo 8A.
5. **Inferir Eisenhower** — se priority/urgency ausentes:
   - Se contexto claro (ex: "urgente e importante"): inferir Q1, priority=9 urgency=9
   - Se ambíguo: ASK via ESCALATE rather than invent
   - Convenção verbal → numérica (escala 1..10):
     - "baixa" → 2-3
     - "média" → 5-6
     - "alta" → 7-8
     - "crítica" / "máxima" → 9-10
6. **Classificar quadrante** — aplicar matriz Eisenhower com threshold 6 (escala 1..10).
   Semântica: `priority` = Resultado/Importância (impacto estratégico); `urgency` = Esforço/Prazo (pressão temporal).
   - priority ≥6 + urgency ≥6 → Q1 (fazer agora — importante e urgente)
   - priority ≥6 + urgency <6 → Q2 (planejar — importante, não urgente)
   - priority <6 + urgency ≥6 → Q3 (delegar — urgente, não importante)
   - priority <6 + urgency <6 → Q4 (deletar/adiar)
7. **Confirmation message** — apresentar ao user (via chief echo) com:
   ```
   Vou criar: «{title}»
   priority={p} urgency={u} (Eisenhower Q{q} — {interpretação})
   due_date (prazo)={due_iso_utc} ({due_local Europe/Rome})
   scheduled_start_time (execução)={sched_iso_utc ou 'auto-agendado: ' + sched_local} ({sched_local Europe/Rome})
   estimated_duration_minutes={dur}
   assigned_to={nomes resolvidos}
   description: {desc or "—"}
   Confirma?
   ```
8. **Aguardar confirmação** — se user replies "sim"/"confirma"/"ok", prosseguir. Se "não", ESCALATE with `ask_user_for_correction`.
9. **Executar INSERT** via Supabase client (JWT user):
   ```sql
   INSERT INTO tasks
     (title, description, due_date, priority, urgency,
      estimated_duration_minutes, project_id, assigned_to,
      scheduled_start_time, is_auto_scheduled, can_be_split,
      created_by, owner_id, status, block_type)
   VALUES
     ({title}, {desc}, {due_utc}, {p}, {u},
      {est_min}, {proj_id}, {assigned_to_uuids},
      {sched_start_utc}, {is_auto_scheduled}, {can_be_split_or_null},
      auth.uid(), auth.uid(), 'todo', 'task')
   RETURNING id;
   ```
   **Valores válidos enforced pelo schema (CHECK constraint):**
   - `status` ∈ `'todo' | 'doing' | 'done' | 'cancelled'` (default `'todo'` — pode omitir)
   - `block_type` ∈ `'task' | 'meeting' | 'focus_time' | 'personal' | 'unavailable'` (default `'task'`)
   - `priority`, `urgency` ∈ `1..10` (CHECK constraint, default `5`)
   - `created_by`/`owner_id` = `auth.uid()` do requisitante (quem pediu a criação) — **não**
     necessariamente igual a `assigned_to` (quem executa).
8A. **Se auto-scheduling gerou N>1 blocos** (passo 4A): após o INSERT acima retornar `task_id`,
   inserir os blocos:
   ```sql
   INSERT INTO task_schedule_blocks (task_id, scheduled_start, duration_minutes, block_order, is_completed)
   VALUES
     ({task_id}, {slot_1_start}, {slot_1_dur}, 1, false),
     ({task_id}, {slot_2_start}, {slot_2_dur}, 2, false),
     ...;
   ```
   Falha aqui é best-effort: a tarefa já existe (não desfazer o INSERT principal); logar o erro e reportar no handoff card que os blocos não foram criados (usuário pode rodar `adjust-schedule-block` depois).
10. **Capturar response** — Supabase retorna `data.id` (uuid) + row inserted.
11. **Tratar erros**:
    - PGRST301 / 42501 (RLS denial) → BLOCKED, reportar role + policy
    - 23502 (not null violation) → BLOCKED, reportar campo
    - 23514 (CHECK constraint) → BLOCKED, reportar campo violado (status/block_type/priority/urgency fora do enum/range)
    - 5xx / timeout → retry 1x; se persistir, ESCALATE
12. **Retornar ao chief** — announcement V10 + handoff card V18 com `task_id`, `quadrant`, `row_snapshot`, `auto_scheduled`, `schedule_blocks_created`.

### acceptance_criteria

- **[A1] Title validation:** se request vem sem title não-vazio, task TERMINA com ESCALATE (verdict ≠ DONE). Zero Supabase calls.
- **[A2] Confirmation shown:** user vê mensagem de confirmação com title + priority/urgency + due_date + scheduled_start_time + estimated_duration_minutes + assigned_to em UTC+local antes de qualquer INSERT. Audit trail mostra o `confirmation_echo` em handoff card.
- **[A3] UTC timestamps:** `due_date` e `scheduled_start_time` são gravados em UTC. O handoff card mostra ambas as representações (UTC + Europe/Rome) para os dois campos.
- **[A4] JWT scoping:** a chamada para Supabase usa o access_token do user (HTTP header `Authorization: Bearer {jwt}`). `created_by` e `owner_id` são ambos `auth.uid()` do user (verificável no row_snapshot) — independente de quem está em `assigned_to`.
- **[A5] Eisenhower classification:** handoff card retorna o quadrant (Q1-Q4) com reasoning explícito baseado em priority/urgency.
- **[A6] Error clarity:** se RLS ou constraint violation acontece, o handoff card tem `verdict = BLOCKED`, error code, e a mensagem original do Supabase (não mascarada).
- **[A7] Idempotency note:** a task NÃO é idempotente por design (cada execução cria uma nova row). Mas o handoff card AVISA se o title/due_date match com uma row recente (últimas 24h) para detecção de duplicata acidental.
- **[A8] No scope creep:** mesmo que request mencione finance/cs/etc., esta task SOMENTE cria linha em `tasks`. Outros módulos = ESCALATE.
- **[A9] Schema enums respected:** o INSERT NUNCA envia valores fora dos enums do schema. `status` ∈ `('todo','doing','done','cancelled')`, `block_type` ∈ `('task','meeting','focus_time','personal','unavailable')`, `priority` e `urgency` ∈ `1..10`. Se request do user pedir valor fora do enum, ESCALATE com tradução para o valor mais próximo válido.
- **[A10] Nunca task vaga:** `due_date`, `scheduled_start_time` (explícito ou auto-agendado), `estimated_duration_minutes` e `assigned_to` estão TODOS populados no `row_snapshot` final. Se qualquer um faltar e não puder ser resolvido, o verdict é ESCALATE — jamais DONE com o campo nulo.
- **[A11] Auto-scheduling honesto:** se `scheduled_start_time` veio do auto-scheduling (não do usuário), `auto_scheduled=true` no output e o handoff card deixa isso explícito (não finge que o usuário escolheu o horário).
- **[A12] Múltiplos responsáveis + sem horário explícito → pergunta, não adivinha:** auto-scheduling nunca escolhe sozinho de qual dos N `assigned_to` usar a agenda — ESCALATE pedindo a decisão.

---

## Exemplos de execução

### Exemplo 1 — Happy path com auto-scheduling (DONE)

**Input do chief:**
```
*handoff @platform-specialist --cycle cyc-2026-04-23-001
Request: "criar tarefa: revisar PRD fiscal engine até sexta, alta prioridade, responsável Sandra, 90 minutos"
Task: create-task
```

**Specialist executa:**

1. Title = "revisar PRD fiscal engine"
2. "sexta" (hoje = qua 2026-04-23) → due_date=2026-04-25 18:00 Europe/Rome → 2026-04-25T16:00Z UTC
3. "alta prioridade" → priority=8. Urgency não explícita, 2 dias de prazo → urgency=7 (inferência ecoada).
4. `estimated_duration_minutes=90` (explícito). `assigned_to=[sandra_uuid]` (1 responsável, resolvido por nome).
5. `scheduled_start_time` NÃO veio → auto-scheduling roda contra a agenda da Sandra (1 responsável, sem ambiguidade): acha slot livre amanhã 09:00–10:30 Europe/Rome.
6. Quadrant: priority=8 + urgency=7 → Q1
7. Confirmation:
   ```
   Vou criar: «revisar PRD fiscal engine»
   priority=8 urgency=7 (Eisenhower Q1 — fazer agora, importante e urgente)
   due_date (prazo)=2026-04-25T16:00Z (sexta 18h Europe/Rome)
   scheduled_start_time (execução)=auto-agendado: 2026-04-24 09:00 Europe/Rome
   estimated_duration_minutes=90
   assigned_to=Sandra Carvalho
   description: —
   Confirma?
   ```
8. User: "sim"
9. INSERT com `scheduled_start_time`, `is_auto_scheduled=true` → retorna id `8a3f1c2b-...`
10. Return:
    ```
    [platform-specialist → ops-chief] Cycle cyc-2026-04-23-001 — DONE.

    task_id: 8a3f1c2b-...
    eisenhower_quadrant: Q1
    due_date_utc: 2026-04-25T16:00:00Z
    due_date_local: 2026-04-25 18:00 Europe/Rome
    scheduled_start_time_utc: 2026-04-24T07:00:00Z
    scheduled_start_time_local: 2026-04-24 09:00 Europe/Rome
    auto_scheduled: true
    schedule_blocks_created: 0
    assigned_to: [Sandra Carvalho]
    row_snapshot: { title, priority: 8, urgency: 7, due_date, estimated_duration_minutes: 90, assigned_to, created_by, owner_id, status: 'todo', block_type: 'task' }
    convention_check: UTC ✓ | RLS ✓ | session RO ✓ | i18n N/A | enums ✓
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

### Exemplo 3 — Faltam campos obrigatórios (ESCALATE)

**Input:** `"criar tarefa: revisar contrato"`

**Specialist:** title OK, mas due_date, estimated_duration_minutes e assigned_to ausentes.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: |
  Antes de criar «revisar contrato», preciso de 3 coisas:
  1. Qual o prazo de entrega? (data + hora)
  2. Quantos minutos você estima que leva?
  3. Quem é o responsável?
convention_check: N/A (nenhuma mutation tentada)
```

### Exemplo 4 — Auto-scheduling ambíguo (ESCALATE)

**Input:** `"criar tarefa: preparar apresentação, prazo sexta, responsáveis Sandra e Pablo, 120 min"` (sem scheduled_start_time)

**Specialist:** `assigned_to` tem 2 uuids → não pode auto-agendar sem saber de quem é a agenda.

**Return:**
```
[platform-specialist → ops-chief] Cycle cyc-... — ESCALATE.

verdict: ESCALATE
suggested_user_message: "Essa tarefa tem 2 responsáveis (Sandra e Pablo). De qual dos dois devo usar a agenda para agendar automaticamente? Ou me diga o horário exato de execução."
convention_check: N/A (nenhuma mutation tentada)
```

### Exemplo 5 — RLS denial hipotético (BLOCKED)

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
- **Auto-scheduling — fonte da verdade:** o algoritmo (capacidade adaptativa, `distributeThenOverlap`, não reorganiza outras tarefas) vive em `apps/v2/src/lib/autoScheduler.ts`, chamado por `apps/v2/src/hooks/useCreateTask.ts` (o caminho real — **não** `apps/v2/src/academy/...`, que não existe). Esta task replica o MESMO efeito (mesmas queries de entrada, mesma regra de saída) sem executar o TS diretamente — se o agente não conseguir reproduzir com confiança o resultado do scheduler (ex: falta de acesso a `user_work_schedules`), prefira ESCALATE a inventar um horário.
- **Campos de tempo — nunca confundir:** ver `data/tasks-schedule-blocks-field-reference.md` §1. `due_date` = PRAZO. `scheduled_start_time` = EXECUÇÃO. Tarefa fatiada em blocos tem o horário real em `task_schedule_blocks.scheduled_start`, não em `tasks.scheduled_start_time` (que passa a refletir só o 1º bloco).

---

**Mantido por:** platform-specialist (self-reference) + ops-chief (orchestration updates em CHANGELOG).
