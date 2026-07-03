# Task: update-academy-lesson

> Atualizar QUALQUER campo de uma aula da Academy (`acad_lessons`) — título/descrição (l10n), `video_url`, `order_index`, `pdf_url`, `thumbnail_url`, `is_active`, `is_free`. A Academy (ArchPrime) é autônoma: `acad_*` é o SSoT do conteúdo desde 2026-07-04, e o sync de aula foi DESLIGADO — o PT edita sem ser revertido.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ **Metadados agora são editáveis (2026-07-04):** o bloco de conteúdo do `academy-sync-lovarch` foi desligado, então título/descrição/ordem/PDF NÃO são mais sobrescritos pelo cron. Trocar o VÍDEO propriamente (render→YouTube) segue no runbook `publish-academy-lessons-youtube`; aqui você aponta o `video_url`.

---

## Task anatomy

### task_name
`Update Academy Lesson`

### status
`pending`

### responsible_executor
`screen-motion-engineer` — dono do vídeo das aulas. Auth **owner/admin**.

### execution_type
`Agent` — confirmação (muda o que o aluno vê no portal).

### input
- **Cycle ID**, **User JWT**, **User role**
- `lesson_id` (uuid) **ou** `slug` (`cac-<code>`) — **ELICITAR** (aula-alvo)
- `updates` (subset dos campos de `acad_lessons`): `title_it`/`title_pt`/`title_en`/`title_es`, `description_*`, `video_url`, `order_index`, `pdf_url`, `thumbnail_url`, `is_active`, `is_free`.

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **Resolver aula** — `lesson_id` (ou `slug`→id). Confirmar que existe em `acad_lessons`. Não encontrada → ESCALATE.
3. **Validar `updates`** — todos os campos de `acad_lessons` são editáveis (PT é dono). Trocar o VÍDEO propriamente (render→YouTube) = runbook `publish-academy-lessons-youtube`; aqui só o `video_url`. Campo fora do schema → ignorar/avisar.
4. **Confirmação:** "aula {slug} · {campo}: {antes}→{depois} · visível ao aluno em ~cache. Confirma?".
5. **Write** (JWT, RLS):
   ```sql
   UPDATE acad_lessons SET {video_url|is_active}, updated_at=now() WHERE id={lesson_id}
   RETURNING id, is_active, video_url;
   ```
   `42501` → BLOCKED; 0 linhas → ESCALATE.
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT id, is_active, video_url` confirmando a mudança; se mexeu no vídeo, smoke visual (o player carrega o novo vídeo, `is_active=true`).
7. **Activity log**: `action='screen-motion-engineer.update_academy_lesson'`, `details={cycle_id, lesson_id, changed_fields, before, after}`.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `lesson_id`/`slug` elicitado.
- **[A3]** Qualquer campo de `acad_lessons` editável (PT é dono; sync de aula desligado).
- **[A4]** Verificação pós-ação (smoke visual se trocou vídeo).
- **[A5]** Colunas reais de `acad_lessons`.

---

## Exemplos
### Exemplo 1 — Despublicar aula (is_active=false) → UPDATE + verificação.
### Exemplo 2 — Trocar vídeo → encaminha para `publish-academy-lessons-youtube` (render→YouTube→video_url).
### Exemplo 3 — "muda o título da aula" → UPDATE `title_it` (PT é dono; smoke visual confirma no portal).

## Notas
- **Autoria PT-nativa (resolvido 2026-07-04):** criar aula = `create-academy-lesson`; estrutura (módulo/fase/curso) = `manage-academy-module`; gravação de mentoria = `publish-academy-incontro`. O sync de aula do `academy-sync-lovarch` foi desligado (Academy = empresa própria, `acad_*` = SSoT).
- Referências: `types.ts` (`acad_lessons`), `supabase/functions/academy-sync-lovarch`, `tasks/publish-academy-lessons-youtube.md`.

---

**Mantido por:** screen-motion-engineer
