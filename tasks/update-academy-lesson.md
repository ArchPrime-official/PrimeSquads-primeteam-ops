# Task: update-academy-lesson

> Atualizar os campos de uma aula da Academy (`acad_lessons`) que o PrimeTeam PODE escrever com segurança — `video_url` (trocar o vídeo) e `is_active` (publicar/despublicar a aula no portal). **Metadados de conteúdo (títulos/descrições/ordem/PDF) são AUTORIA no Lovarch** e voltam pelo cron `academy-sync-lovarch` — editá-los aqui seria sobrescrito.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ **Sync one-way (Lovarch → `acad_*`):** `academy-sync-lovarch` espelha lessons/moduli/fasi do Lovarch. Só `video_url` e `is_active` são escritos pelo PrimeTeam (runbook YouTube). Título/descrição/ordem/pillar/módulo = autoria no Lovarch (débito de authoring — ver Notas).

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
- `updates` (subset dos campos ESCRIVÍVEIS): `video_url` (string), `is_active` (bool). Outros campos → BLOCKED com aviso de autoria-Lovarch.

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **Resolver aula** — `lesson_id` (ou `slug`→id). Confirmar que existe em `acad_lessons`. Não encontrada → ESCALATE.
3. **Filtrar `updates`** — aceitar SÓ `video_url`/`is_active`. Se o pedido incluir título/descrição/ordem/PDF → **BLOCKED** explicando que são autoria no Lovarch (seriam sobrescritos pelo `academy-sync-lovarch`); orientar editar no Lovarch. Trocar o VÍDEO propriamente = runbook `publish-academy-lessons-youtube` (render→YouTube→`video_url`).
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
- **[A3]** Só `video_url`/`is_active` escritos; metadados de conteúdo → BLOCKED (autoria Lovarch).
- **[A4]** Verificação pós-ação (smoke visual se trocou vídeo).
- **[A5]** Colunas reais de `acad_lessons`.

---

## Exemplos
### Exemplo 1 — Despublicar aula (is_active=false) → UPDATE + verificação.
### Exemplo 2 — Trocar vídeo → encaminha para `publish-academy-lessons-youtube` (render→YouTube→video_url).
### Exemplo 3 — "muda o título da aula" → BLOCKED: título é autoria no Lovarch (sync sobrescreve).

## Notas
- **Débito de authoring:** criar aula nova / editar títulos-descrições-ordem exige o lado Lovarch (o `challenge-admin-bridge` cobre challenges/missions, NÃO lessons). Decisão de arquitetura (autoria fica no Lovarch com bridge de lessons, ou PrimeTeam passa a poder escrever `acad_lessons` sem ser sobrescrito) — pendente.
- Referências: `types.ts` (`acad_lessons`), `supabase/functions/academy-sync-lovarch`, `tasks/publish-academy-lessons-youtube.md`.

---

**Mantido por:** screen-motion-engineer
