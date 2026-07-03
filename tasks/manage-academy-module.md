# Task: manage-academy-module

> Gerir a ESTRUTURA de conteúdo da Academy (ArchPrime) — criar/editar/reordenar **módulo** (`acad_moduli`), **fase** (`acad_fasi`) e **curso** (`acad_corsi`). SSoT no PT desde a separação de empresas (2026-07-04); RLS de escrita `is_admin_or_owner` adicionada em migration `20270704120000`.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

---

## Task anatomy

### task_name
`Manage Academy Module`

### status
`pending`

### responsible_executor
`screen-motion-engineer` — auth **owner/admin** (`is_admin_or_owner`).

### execution_type
`Agent` — confirmação (muda a estrutura vista pelo aluno).

### input
- **Cycle ID**, **User JWT**, **User role**
- `entity` — `module | fase | corso`
- `operation` — `create | update | reorder`
- `parent_id` — **ELICITAR** no create: `fase_id` (módulo), `corso_id` (fase); curso é raiz
- `titolo`/`nome` — **ELICITAR** no create (título do módulo/curso; `nome` na fase)
- `position` (int) — **ELICITAR** (ordem entre irmãos)
- `slug`, `sottotitolo`/`promessa`/`descrizione`, `thumbnail_url`, `product_key` (corso) — opcionais conforme entity
- `id` (uuid) — para update/reorder

### action_items
1. **Auth** — owner/admin. Demais → BLOCKED.
2. **Resolver a tabela** pela `entity`: `module→acad_moduli` (FK `fase_id`), `fase→acad_fasi` (FK `corso_id`), `corso→acad_corsi`.
3. **Elicitar** no create: `parent_id` (exceto corso), `titolo`/`nome`, `position`. Nunca defaultar. Validar o `parent_id` existe.
4. **Confirmação** (echo dos valores).
5. **Write** (JWT, RLS is_admin_or_owner):
   - create: `INSERT INTO {tabela} (...) RETURNING id;`
   - update: `UPDATE {tabela} SET {campos}, updated_at=now() WHERE id={id};`
   - reorder: `UPDATE {tabela} SET position={n} WHERE id={id};` (confirmar a nova ordem completa antes).
   `42501` → BLOCKED; `23503` (FK parent) → BLOCKED.
6. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT` confirmando + smoke visual no portal (`academy.archprime.io`) na estrutura afetada.
7. **Activity log**: `action='screen-motion-engineer.manage_academy_module'`, `details={cycle_id, entity, operation, id}`.

### acceptance_criteria
- **[A1]** Auth owner/admin.
- **[A2]** `parent_id`/`titolo`/`position` elicitados no create; nada defaultado.
- **[A3]** Tabela resolvida corretamente pela `entity`.
- **[A4]** Verificação pós-ação + smoke visual.
- **[A5]** Colunas reais (`acad_moduli`/`acad_fasi`/`acad_corsi`).

---

## Exemplos
### Exemplo 1 — Novo módulo numa fase (create module + fase_id + titolo + position).
### Exemplo 2 — Reordenar módulos (reorder, confirma ordem completa antes).
### Exemplo 3 — Sem parent_id (ELICITAR a fase/curso).

## Notas
- Aula individual = `create-academy-lesson`/`update-academy-lesson`. Gravação de incontro/mentoria = `publish-academy-incontro`.
- Academy = ArchPrime (empresa própria); não é a Lovarch.
- Referências: `types.ts` (`acad_moduli/acad_fasi/acad_corsi`), migration `20270704120000`.

---

**Mantido por:** screen-motion-engineer
