# Task: create-editorial-post

> Criar editorial post em `editorial_calendar_posts`. Sandra planeja conteúdo mensal por conta/plano editorial. F-04.6.

**Cumpre:** HO-TP-001

---

## Task anatomy

### task_name `Create Editorial Post`

### responsible_executor `content-builder`

### execution_type `Agent` — confirmation simples.

### input
- `account_id` (uuid, **obrigatório** — FK `editorial_accounts`)
- `plan_id` (uuid, **obrigatório**)
- `theme` (string, **obrigatório**)
- `format` (enum `content_format`, **obrigatório**: `'carousel' | 'video' | 'stories' | 'influencer' | 'meme' | 'live' | 'reels' | 'qna_stories'`)
- `objective` (enum `content_objective`, **obrigatório**: `'viralita' | 'consapevolezza' | 'conversione'`)
- `scheduled_date` (date, **obrigatório**)
- `scheduled_time` (time, opcional)
- `status` (enum `content_status`, opcional — default de negócio `'planned'`: `'planned' | 'created' | 'scheduled' | 'published' | 'cancelled'`)
- `title`, `description`, `caption`, `question`, `narrative_structure`, `material_description`, `drive_link` (string, opcionais)
- `avatar_id`, `line_id`, `theme_id`, `source_pain_id` (uuid, opcionais)

### output
- `post_id` (uuid)
- `verdict`: `DONE | BLOCKED | ESCALATE`

### action_items

1. **Role:** marketing/admin/owner.
2. Validar:
   - `account_id` existe em `editorial_accounts`
   - `plan_id` existe
   - `format` ∈ enum `content_format`
   - `objective` ∈ enum `content_objective`
   - `scheduled_date` presente (warn se no passado — backdated post = explicação necessária)
   - `status` (se passado) ∈ enum `content_status`
3. Confirmation: theme + account + format + objective + scheduled_date/time.
4. INSERT em `editorial_calendar_posts` com `created_by=auth.uid()`:
   ```sql
   INSERT INTO editorial_calendar_posts
     (account_id, plan_id, theme, format, objective, scheduled_date, scheduled_time,
      status, title, description, caption, question, narrative_structure,
      material_description, drive_link, avatar_id, line_id, theme_id, source_pain_id,
      created_by)
   VALUES (..., COALESCE({status}, 'planned'), ..., auth.uid())
   RETURNING id;
   ```
5. Activity log: action='content-builder.create_editorial_post', details com post_id + account_id + format + objective.
6. Echo: "✓ Post criado. Scheduled {scheduled_date} {scheduled_time}. Format: {format}. Objective: {objective}."

### acceptance_criteria
- A1 marketing/admin/owner
- A2 `account_id`/`plan_id` existem (FK válida)
- A3 `format`/`objective` ∈ enums reais (`content_format`/`content_objective`)
- A4 `scheduled_date` NOT NULL, warn se passado
- A5 Audit em activity_log

---

## Notas

- **Sem `channel`/`content_brief`/`assigned_to`/`tags`/`scheduled_for`/`linked_campaign_id`:** essas colunas não existem em `editorial_calendar_posts`. O canal/plataforma vive implícito em `plan_id`/`account_id`; atribuição de responsável e tags não são suportadas nesta tabela hoje.
- **`status` real é o enum `content_status`:** `planned | created | scheduled | published | cancelled`. Não existem os valores `idea`, `draft`, `in_review` usados na versão anterior desta task — mapear para `planned` (ideia/rascunho) ou `created` conforme o estágio mais próximo.
- **NOT NULL reais (schema):** `account_id`, `format`, `objective`, `plan_id`, `scheduled_date`, `theme`.

---

**Mantido por:** content-builder
