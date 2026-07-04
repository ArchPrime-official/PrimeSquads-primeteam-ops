# Task: manage-lovarch-tutorial

> Adicionar/editar um TUTORIAL do centro "Tutorial & Guide" do app Lovarch (`app.lovarch.com/?m=tutorials`). É o ÚNICO conteúdo de aprendizagem que a Lovarch mantém (a plataforma não tem mais aulas/cursos — isso é da Academy ArchPrime).

**Cumpre:** HO-TP-001 (anatomy). Runbook — sem HO-TP-002 (não é INSERT no banco PT).

> ⚠️ **Estado real (2026-07-04):** o catálogo de tutoriais é **hardcoded** em `src/components/new-home/panels/tutorials/tutorialsCatalog.ts` (o próprio arquivo declara "static mockup Phase 1 — replaced by DB-backed lessons in Phase 3"). O reader (Hub/Panel/Player) lê SÓ desse arquivo. Portanto, adicionar/editar tutorial HOJE = **PR de código no repo `ByPabloRuanL/lovarch`** editando esse arquivo. Reflete no app após o deploy Vercel. **B2b (evolução):** migrar o catálogo para DB (`tutorial_lessons`) + reader com fallback + ops `list_tutorials`/`upsert_tutorial` no `ops-gateway` — exige smoke visual autenticado no Lovarch antes de trocar o reader.

---

## Task anatomy

### task_name
`Manage Lovarch Tutorial`

### status
`pending`

### responsible_executor
`lovarch-ops-specialist` — executa via PR no repo Lovarch (owner/admin autoriza).

### execution_type
`Runbook` — edição de código + PR (não é mutação de banco).

### input
- **Cycle ID**, **User role** (owner/admin autoriza)
- `operation` — `add | edit` (inclui trocar thumbnail)
- `category_id` — **ELICITAR** (a qual categoria: primi/ai/studio/business)
- `title` (l10n it/en/pt/es) — **ELICITAR** (título nos 4 idiomas — o app é multi-idioma)
- `desc` (l10n), `duration` (`m:ss`), `level` (`base|intermediate|advanced`), `videoUrl` (YouTube embed), `badge` (opcional `new|beta|coming_soon`)
- `thumbnail` (URL de imagem, opcional) — capa da aula. Sem ela, o card usa o gradiente DS. Atalho pronto: a thumb do YouTube é `https://img.youtube.com/vi/<VIDEO_ID>/hqdefault.jpg`.
- `lesson_id` (para `edit`)

### action_items
1. **Autorização** — owner/admin.
2. **Elicitar** `category_id`, `title` (l10n) + `videoUrl`. Nunca defaultar o idioma (o catálogo tem it/en/pt/es).
3. **Editar** `src/components/new-home/panels/tutorials/tutorialsCatalog.ts` no repo `ByPabloRuanL/lovarch` (branch novo de `origin/main`): adicionar/editar o objeto `TutLesson` na categoria certa (shape `{ id, title:L10n, desc:L10n, duration, level, badge?, videoUrl?, thumbnail? }`). Para trocar SÓ a capa: setar/editar o campo `thumbnail`. O card já cai no gradiente DS se `thumbnail` for omitido.
4. **PR** no repo Lovarch (`gh pr create`), typecheck passa, merge → deploy Vercel.
5. **Smoke visual** (obrigatório): abrir `app.lovarch.com/?m=tutorials` (autenticado) e confirmar o tutorial renderizando no idioma. NÃO reportar DONE sem ver.

### acceptance_criteria
- **[A1]** owner/admin autoriza.
- **[A2]** `title` nos 4 idiomas + `videoUrl` elicitados.
- **[A3]** Segue o shape `TutLesson` do catálogo (não quebra o typecheck).
- **[A4]** Smoke visual no `?m=tutorials` após deploy.

---

## Exemplos
### Exemplo 1 — Novo tutorial "Come usare il Render Studio" na categoria studio → edita tutorialsCatalog.ts → PR → deploy → aparece em ?m=tutorials.
### Exemplo 2 — title só em italiano (ELICITAR os outros 3 idiomas).
### Exemplo 3 — "trocar a capa da aula p1" → editar só o campo `thumbnail` (URL/thumb YouTube) → PR → deploy → card mostra a imagem no lugar do gradiente.

## Notas
- **Lovarch = plataforma SaaS**; tutoriais são de USO da plataforma (não curso). Curso/aulas = Academy ArchPrime (`create-academy-lesson`).
- **B2b (DB-driven):** quando o catálogo migrar para `tutorial_lessons` (com reader+fallback), esta task passa a usar `ops-gateway` (`upsert_tutorial`) em vez de PR de código.
- Referências: `src/components/new-home/panels/tutorials/tutorialsCatalog.ts` (repo Lovarch), `data/lovarch-ops-reference.md`.

---

**Mantido por:** lovarch-ops-specialist
