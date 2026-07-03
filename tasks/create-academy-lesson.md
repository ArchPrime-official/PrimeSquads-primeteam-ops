# Task: create-academy-lesson

> Criar uma AULA nova da Academy (ArchPrime) direto em `acad_lessons` (SSoT do conteúdo desde a separação de empresas 2026-07-04). A Academy é autônoma — a autoria NÃO passa mais pela Lovarch. Vídeo = YouTube (runbook `publish-academy-lessons-youtube`). RLS de escrita = `is_admin_or_owner` (já existe).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ Só funciona porque o sync de conteúdo de aula foi DESLIGADO (`academy-sync-lovarch`, 2026-07-04) — antes o cron das 03:30 revertia a inserção. Confirme colunas em `types.ts` (`acad_lessons`).

---

## Task anatomy

### task_name
`Create Academy Lesson`

### status
`pending`

### responsible_executor
`screen-motion-engineer` — dono do vídeo/aula. Auth **owner/admin** (`is_admin_or_owner`).

### execution_type
`Agent` — confirmação (aparece no portal do aluno).

### input
- **Cycle ID**, **User JWT**, **User role**
- `module_id` (uuid) — **ELICITAR** (a qual módulo a aula pertence; FK `acad_moduli`)
- `title_it` (string) — **ELICITAR sempre** (título em italiano — idioma primário do portal; +`title_pt/en/es` opcionais)
- `video_url` (string, YouTube) — **ELICITAR** (a aula sem vídeo não vai ao ar; ou criar como `is_active=false` e preencher via `publish-academy-lessons-youtube`)
- `order_index` (int) — **ELICITAR** (posição no módulo)
- `slug` (string, kebab-case, único), `is_free` (bool, default false), `description_it`/`pdf_url`/`thumbnail_url`/`duration_seconds` (opcionais)

### output
- `lesson_id` (uuid), `slug`, `module_id`, `is_active`, `verdict: DONE | BLOCKED | ESCALATE`

### action_items
1. **Auth** — owner/admin (`is_admin_or_owner`). Demais → BLOCKED (42501).
2. **Elicitar obrigatórios** — `module_id`, `title_it`, `order_index`, `video_url` (ou explicitar que nasce `is_active=false`). Nunca defaultar. Validar `module_id` existe em `acad_moduli`.
3. **Validar** `slug` kebab-case + uniqueness; `video_url` é YouTube; `order_index` não colide (avisar se colidir).
4. **Confirmação** (echo): "aula «{title_it}» no módulo {module_id}, ordem {order_index}, vídeo {video_url}, {is_free ? 'grátis' : 'gated'} — aparece no portal. Confirma?".
5. **Write** (JWT, RLS is_admin_or_owner). **`id` gerado no cliente** (`crypto.randomUUID()`) — `acad_lessons.id` NÃO tem default (era populado pelos ids do sync Lovarch); INSERT sem `id` → erro `23502`:
   ```sql
   INSERT INTO acad_lessons
     (id, module_id, slug, title_it, title_pt, title_en, title_es,
      description_it, video_url, thumbnail_url, pdf_url,
      duration_seconds, order_index, is_active, is_free)
   VALUES ({gen_uuid}, {module_id}, {slug}, {title_it}, {title_pt}, {title_en}, {title_es},
      {description_it}, {video_url}, {thumbnail_url}, {pdf_url},
      {duration_seconds}, {order_index}, {video_url IS NOT NULL}, {is_free})
   RETURNING id, slug, module_id, is_active;
   ```
   (Smoke live 2026-07-04: INSERT+UPDATE+DELETE de aula-teste com token owner = 201/204/204 ✅.)
   `42501` → BLOCKED; `23503` (FK module_id) → BLOCKED; `23505` (slug) → ESCALATE.
6. **Verificação PÓS-AÇÃO** (obrigatória): `SELECT id, is_active FROM acad_lessons WHERE id={lesson_id}` + **smoke visual**: abrir `academy.archprime.io` no módulo (Playwright autenticado) e confirmar que a aula renderiza. **NÃO reportar DONE sem ver a aula no portal.**
7. **Activity log**: `action='screen-motion-engineer.create_academy_lesson'`, `details={cycle_id, lesson_id, module_id, title_it}`.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `module_id`, `title_it`, `order_index` elicitados; nada defaultado.
- **[A3]** `video_url` YouTube (ou aula nasce inativa até publicar o vídeo).
- **[A4]** Verificação pós-ação + **smoke visual no portal**.
- **[A5]** Colunas reais de `acad_lessons`.

---

## Exemplos
### Exemplo 1 — Nova aula num módulo (DONE)
title_it + module_id + video YouTube + order → INSERT → aula visível no portal (Playwright) → DONE.
### Exemplo 2 — Sem module_id (ELICITAR)
"cria uma aula sobre X" → pergunta o módulo antes de inserir.
### Exemplo 3 — Sem vídeo ainda → cria is_active=false e encaminha para publish-academy-lessons-youtube.

## Notas
- **Academy = ArchPrime, empresa própria**; NÃO confundir com a Lovarch (plataforma SaaS, só tutoriais). Conteúdo da Academy é 100% PT desde 2026-07-04.
- Editar aula existente = `update-academy-lesson` (agora escreve metadados, o sync não reverte mais). Módulo/fase = `manage-academy-module`. Gravação de mentoria/incontro = `publish-academy-incontro`.
- Referências: `types.ts` (`acad_lessons`), migration `20270704120000` (RLS), `tasks/publish-academy-lessons-youtube.md`.

---

**Mantido por:** screen-motion-engineer
