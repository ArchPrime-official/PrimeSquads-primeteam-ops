# Task: publish-academy-incontro

> Publicar uma GRAVAÇÃO de mentoria/incontro de grupo da Academy (ArchPrime) — cria a aula da gravação (`acad_lessons`, vídeo YouTube) e a organiza numa **collection** de incontri (`acad_collections` → `acad_collection_folders` (mês) → `acad_collection_items`). É a parte "mentoria" da Academy. SSoT PT desde 2026-07-04; RLS `is_admin_or_owner` (collections em migration `20270704120000`; folders/items já tinham).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

---

## Task anatomy

### task_name
`Publish Academy Incontro`

### status
`pending`

### responsible_executor
`screen-motion-engineer` — auth **owner/admin** (`is_admin_or_owner`).

### execution_type
`Agent` — confirmação (aparece na aba Incontri do aluno).

### input
- **Cycle ID**, **User JWT**, **User role**
- `collection_id` (uuid) — **ELICITAR** (qual coleção de incontri; ex.: "Incontri di gruppo")
- `folder_id` (uuid, opcional) — pasta do mês; se ausente e for necessário, criar via `manage-academy-module`-like ou informar
- `title_it` (string) — **ELICITAR** (título da gravação, ex.: "Incontro 04/07 — Q&A")
- `video_url` (string, YouTube) — **ELICITAR** (a gravação)
- `order_index` (int) — **ELICITAR** (ordem no folder/collection)
- `access_products` — herda da collection; `duration_seconds`/`thumbnail_url` opcionais

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **Elicitar** `collection_id`, `title_it`, `video_url`, `order_index`. Validar `collection_id` existe em `acad_collections`.
3. **Confirmação** (echo).
4. **Write** (JWT, RLS is_admin_or_owner) — 2 passos atômicos. **`id` gerado no cliente** (`acad_lessons.id` e `acad_collection_items.id` sem default):
   ```sql
   -- 1) a aula da gravação (id gerado no cliente — crypto.randomUUID)
   INSERT INTO acad_lessons (id, title_it, video_url, order_index, is_active)
   VALUES ({gen_uuid}, {title_it}, {video_url}, {order_index}, true) RETURNING id;  -- lesson_id
   -- 2) o item da collection apontando para a lesson
   INSERT INTO acad_collection_items (collection_id, lesson_id, folder_id, order_index, is_active)
   VALUES ({collection_id}, {lesson_id}, {folder_id}, {order_index}, true) RETURNING id;
   ```
   `42501` → BLOCKED; `23503` → BLOCKED (collection/folder inexistente).
5. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT` do item + **smoke visual** na aba Incontri do portal (`academy.archprime.io`) confirmando a gravação. NÃO reportar DONE sem ver.
6. **Activity log**: `action='screen-motion-engineer.publish_academy_incontro'`, `details={cycle_id, collection_id, lesson_id}`.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `collection_id`, `title_it`, `video_url`, `order_index` elicitados.
- **[A3]** A aula E o item da collection criados (os 2 passos).
- **[A4]** Verificação pós-ação + smoke visual na aba Incontri.
- **[A5]** Colunas reais (`acad_lessons`, `acad_collection_items`).

---

## Exemplos
### Exemplo 1 — Publicar Q&A do dia (lesson + item na collection "Incontri di gruppo") → visível na aba Incontri.
### Exemplo 2 — collection_id ausente (ELICITAR qual coleção).
### Exemplo 3 — CS tenta (BLOCKED, owner/admin).

## Notas
- Mentoria 1:1 (notas, agenda) = `create-session-note` + `/calendly`. Esta task é para as GRAVAÇÕES de grupo (Prime Pro/Elite).
- Aula regular = `create-academy-lesson`. Estrutura de curso = `manage-academy-module`.
- Referências: `types.ts` (`acad_collections/folders/items`, `acad_lessons`), `apps/v2/src/academy` (aba Incontri).

---

**Mantido por:** screen-motion-engineer
