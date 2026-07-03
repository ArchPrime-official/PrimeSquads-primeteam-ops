# Task: manage-radar-meetings

> CRUD `radar_meetings` + `radar_meeting_sectors` + `radar_action_plans` linkados.
> admin/owner. F-14.

**Cumpre:** HO-TP-001

> ⚠️ **SCHEMA REAL (verificado em `types.ts` + migrations, 2026-07-03) — reescrita
> completa desta task.** As tabelas do Radar NÃO usam `setor`/`scheduled_at`/`agenda_template`
> como campos de `radar_meetings` (esses nomes nunca existiram). E `radar_action_plans`
> **NÃO** referencia `meeting_id` diretamente — o vínculo é via `meeting_sector_id`
> (FK para `radar_meeting_sectors`, uma linha por setor DENTRO de uma reunião).

---

## Modelo real (3 tabelas)

| Tabela | Papel | NOT NULL relevantes |
|---|---|---|
| `radar_meetings` | a reunião em si | `meeting_date` (DATE), `meeting_type` (CHECK `'committee'\|'general'`) |
| `radar_meeting_sectors` | 1 linha por setor DENTRO de uma reunião | `meeting_id`, `sector` (CHECK `'marketing'\|'comercial'\|'cs'\|'financeiro'`) |
| `radar_action_plans` | plano de ação, vinculado a um SETOR (não à reunião direto) | `meeting_sector_id`, `title` |

- `radar_meetings.status` — CHECK `'draft' \| 'finalized'`, default `'draft'`.
- `radar_meetings.period_type` — CHECK `'weekly' \| 'monthly'`, default `'weekly'`.
- `radar_meetings.sector_order` — JSONB, default `["marketing","comercial","cs","financeiro"]`.
- `radar_action_plans.status` — CHECK `'pending' \| 'in_progress' \| 'done' \| 'cancelled'`, default `'pending'`.
- `radar_action_plans.responsible_id` — uuid nullable (FK `profiles`). **Não existe** `assigned_to` nesta tabela — não confundir com `tasks.assigned_to`.
- `radar_action_plans.linked_task_id` — uuid nullable (FK `tasks`), usado quando o plano vira uma tarefa real via `create-task`.

Espelho de produção (`apps/v2/src/hooks/radar/useRadarMeetingMutations.ts`): ao criar uma
reunião, a UI real **sempre auto-cria as 4 linhas de setor** (`marketing`, `comercial`, `cs`,
`financeiro`) em `radar_meeting_sectors` no mesmo fluxo — sem isso, `create_action_plan`
não tem em qual `meeting_sector_id` se apoiar. Esta task replica esse comportamento.

> **Fora de escopo desta task:** `radar_action_plan_tasks` (sub-tarefas por plano, com
> approval_status próprio, usado no fluxo completo de aprovação do comitê). Se o pedido for
> "criar sub-tarefa dentro do plano X", delegar para `create-task` com
> `linked_task_id` apontando de volta ao plano (via `radar_action_plans.linked_task_id`),
> não inventar um INSERT em `radar_action_plan_tasks` aqui.

---

## Task anatomy

### task_name `Manage Radar Meetings`

### responsible_executor `platform-specialist` com gate admin/owner (RLS real: policies
`"Admin/Owner can manage action plans"` / `"Admin/Owner can manage sector leaders"` etc.
exigem `is_admin_or_owner(auth.uid())` — não é uma convenção do squad, é RLS de verdade.)

### execution_type `Agent` — confirmation per action.

### input
- `action` (`'create_meeting' | 'create_action_plan' | 'list_meetings'`)
- **`create_meeting`:**
  ```
  {
    meeting_date,           -- DATE (obrigatório, formato YYYY-MM-DD — sem hora)
    meeting_type,           -- 'committee' | 'general' (obrigatório)
    title?,                 -- opcional
    period_type?,           -- 'weekly' | 'monthly' (default 'weekly')
    sector_order?           -- array (default ['marketing','comercial','cs','financeiro'])
  }
  ```
- **`create_action_plan`:**
  ```
  {
    meeting_sector_id,      -- uuid (obrigatório) — OU {meeting_id + sector} para resolver
    title,                  -- obrigatório
    description?,
    responsible_id?,        -- uuid (NÃO 'assigned_to' — essa coluna não existe aqui)
    due_date?,               -- DATE
    target_kpi_key? / target_kpi_label? / target_kpi_value? / target_kpi_unit?,
    linked_task: boolean     -- se true, cria uma task via handoff a `create-task` e
                             -- grava o id retornado em linked_task_id
  }
  ```
- **`list_meetings`:** filter `status` (`'draft'|'finalized'`) / `period_type` (`'weekly'|'monthly'`) / range de `meeting_date`.

### output
- `meeting_id` (+ `sector_ids` criados) OU `action_plan_id` OU `meetings` array
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role admin/owner** — pré-check antes de qualquer mutation (RLS bloqueia de qualquer forma, mas falhar cedo evita round-trip).

2. **`create_meeting`:**
   ```sql
   INSERT INTO radar_meetings (meeting_date, meeting_type, title, period_type, sector_order, created_by)
   VALUES ({meeting_date}, {meeting_type}, {title}, {period_type or 'weekly'},
           {sector_order or '["marketing","comercial","cs","financeiro"]'::jsonb}, auth.uid())
   RETURNING id;
   ```
   Em seguida, **sempre** auto-criar as linhas de setor (paridade com a UI — sem isso não
   há `meeting_sector_id` para `create_action_plan` usar depois):
   ```sql
   INSERT INTO radar_meeting_sectors (meeting_id, sector, is_enabled, sort_order)
   VALUES
     ({meeting_id}, 'marketing', true, 0),
     ({meeting_id}, 'comercial', true, 1),
     ({meeting_id}, 'cs',        true, 2),
     ({meeting_id}, 'financeiro', true, 3);
   ```
   (usar a ordem de `sector_order` se vier customizado; validar que todo valor de
   `sector_order` está em `('marketing','comercial','cs','financeiro')` — CHECK real.)
   Geração de slides (`radar_meeting_slides`) fica de fora — EF `radar-generate-slides`
   NÃO existe (confirmado 2026-06-12, ainda válido em 2026-07-03).

3. **`create_action_plan`:**
   - **Resolver `meeting_sector_id`** — se o request veio com `meeting_id` + nome do
     setor em vez do uuid direto, resolver primeiro:
     ```sql
     SELECT id FROM radar_meeting_sectors WHERE meeting_id = {meeting_id} AND sector = {sector};
     ```
     0 matches (reunião sem esse setor habilitado) → ESCALATE.
   - **INSERT:**
     ```sql
     INSERT INTO radar_action_plans
       (meeting_sector_id, title, description, responsible_id, due_date,
        target_kpi_key, target_kpi_label, target_kpi_value, target_kpi_unit,
        created_by, status, sort_order)
     VALUES
       ({meeting_sector_id}, {title}, {description}, {responsible_id}, {due_date},
        {kpi_key}, {kpi_label}, {kpi_value}, {kpi_unit},
        auth.uid(), 'pending',
        (SELECT COALESCE(MAX(sort_order), -1) + 1 FROM radar_action_plans WHERE meeting_sector_id = {meeting_sector_id}))
     RETURNING id;
     ```
   - **Se `linked_task=true`:** handoff para `create-task` (respeitando os campos
     obrigatórios dessa task — due_date, scheduled_start_time, estimated_duration_minutes,
     assigned_to) usando `responsible_id` como `assigned_to`; ao retornar o `task_id`,
     `UPDATE radar_action_plans SET linked_task_id = {task_id} WHERE id = {action_plan_id}`.
4. **`list_meetings`:** SELECT com filtros por `status`/`period_type`/`meeting_date`, opcionalmente com JOIN em `radar_meeting_sectors` para contagem de planos por setor.
5. **Confirmation** com preview (campos resolvidos, incluindo `meeting_sector_id` resolvido no caso de `create_action_plan`).
6. **Activity log** — `action='platform-specialist.manage_radar_meetings.{action}'`.

### acceptance_criteria
- **[A1] Role admin/owner** — pré-check + RLS real como segunda camada.
- **[A2] `meeting_type` e `sector` sempre validados contra os CHECK reais** (`'committee'|'general'`; `'marketing'|'comercial'|'cs'|'financeiro'`) — nunca aceitar valor livre.
- **[A3] `create_meeting` sempre popula os 4 setores em `radar_meeting_sectors`** no mesmo fluxo (paridade com a UI) — nunca deixar uma reunião sem setores, o que travaria `create_action_plan` depois.
- **[A4] `create_action_plan` vincula por `meeting_sector_id`, nunca por `meeting_id` direto** — se o request só tiver `meeting_id`, resolver o setor primeiro (ASK se ambíguo).
- **[A5] `responsible_id`, não `assigned_to`** — `radar_action_plans` não tem coluna `assigned_to`; usar o nome de coluna real.
- **[A6] Linkagem a task opcional** via `linked_task_id`, delegando para `create-task` (que já exige seus próprios campos obrigatórios — não pular essa validação só porque veio de um action plan).
- **[A7] Audit.**

---

## Exemplos

### Exemplo 1 — Criar reunião semanal (DONE)

**Input:** `action=create_meeting`, `meeting_date=2026-07-06`, `meeting_type=committee`

**Specialist:**
1. INSERT em `radar_meetings` → `meeting_id=r1...`
2. INSERT 4 linhas em `radar_meeting_sectors` (marketing/comercial/cs/financeiro, `sort_order` 0-3)
3. Confirmation + DONE, retorna `meeting_id` + os 4 `sector_ids`.

### Exemplo 2 — Criar plano de ação vinculado a setor (DONE)

**Input:** `action=create_action_plan`, `meeting_id=r1...`, `sector=marketing`, `title="Aumentar CTR dos anúncios"`, `responsible_id=<uuid Sandra>`

**Specialist:**
1. Resolve `meeting_sector_id` via `meeting_id`+`sector` → encontra.
2. INSERT em `radar_action_plans` com `status='pending'`, `sort_order` calculado.
3. DONE, retorna `action_plan_id`.

### Exemplo 3 — Setor inexistente na reunião (ESCALATE)

**Input:** `action=create_action_plan`, `meeting_id=r1...`, `sector=juridico` (não está no CHECK)

**Specialist:** valor não está em `('marketing','comercial','cs','financeiro')` → ESCALATE: "Setor 'juridico' não existe no Radar. Setores válidos: marketing, comercial, cs, financeiro."

---

**Mantido por:** platform-specialist
