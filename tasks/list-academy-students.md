# Task: list-academy-students

> Ver os alunos da Academy ArchPrime + progresso + feedback via RPC `acad_admin_overview()` (SECURITY DEFINER, a mesma que alimenta o painel admin do portal: Dashboard/Utenti/Feedback/Caosometro). **Read-only.** Preenche a lacuna [ALTO]: o pto não tinha como ver a base de alunos (o `list-customers` lê `customers` do CS, não os alunos).

**Cumpre:** HO-TP-001 (anatomy). Read-only — sem HO-TP-002.

---

## Task anatomy

### task_name
`List Academy Students`

### responsible_executor
`platform-specialist` — auth **owner/admin/cs** (a RPC é SECURITY DEFINER e valida staff academy = e-mail `@archprime.io`).

### execution_type
`Agent` — read-only.

### input
- **Cycle ID**, **User JWT**, **User role**
- `view` (opcional) — `students | progress | feedback | overview` (default `overview`)
- `search_term` (opcional — filtra por nome/e-mail do aluno no resultado)

### action_items
1. **Auth** — owner/admin/cs (a RPC recusa quem não é staff academy).
2. **Consultar** a RPC única:
   ```
   supabase.rpc('acad_admin_overview')   // retorna KPIs + utenti + progresso + feedback + caosometro
   ```
   Para média de feedback por aula: `acad_lesson_feedback_avg`. NÃO recontar `acad_user_progress`/`acad_lesson_feedback` na mão — a RPC já agrega.
3. **Renderizar** conforme `view`: lista de alunos (`| Nome | E-mail | Progresso% | Última atividade |`), ou feedback por aula, ou o overview de KPIs. Filtrar por `search_term` no cliente se houver.
4. Read-only — nenhuma mutação.

### acceptance_criteria
- **[A1]** Auth owner/admin/cs (staff academy).
- **[A2]** Fonte é a RPC `acad_admin_overview()` (não query solta em `acad_*`).
- **[A3]** Read-only.

---

## Exemplos
### Exemplo 1 — "quantos alunos e o progresso médio?" → overview (KPIs).
### Exemplo 2 — "feedback da aula X" → view=feedback (via acad_lesson_feedback_avg).
### Exemplo 3 — role sem acesso academy → BLOCKED pela RPC.

## Notas
- Complementa `manage-academy-access` (conceder/revogar) e `review-academy-sfida`. Progresso/feedback são gravados pelo próprio aluno (auto-writes) — aqui só se LÊ.
- Referências: RPC `acad_admin_overview`, `acad_lesson_feedback_avg`; `apps/v2/src/academy/screens/Admin.tsx`.

---

**Mantido por:** platform-specialist
