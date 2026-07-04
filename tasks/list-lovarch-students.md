# Task: list-lovarch-students

> Listar/consultar a base de usuários do app Lovarch (plataforma SaaS) + ver o progresso de aprendizagem de um usuário, via as read-ops da Fase 2 do `ops-gateway` (`list_users`, `user_progress`). **Read-only.** Preenche a lacuna: o pto só tinha lookup unitário (`lovarch-lookup-user`), sem listagem da base.

**Cumpre:** HO-TP-001 (anatomy). Read-only — sem HO-TP-002.

---

## Task anatomy

### task_name
`List Lovarch Students`

### responsible_executor
`lovarch-ops-specialist` — auth **owner/admin/cs** (read do gateway).

### execution_type
`Agent` — read-only.

### input
- **Cycle ID**, **User JWT**
- `view` — `list | progress` (default `list`)
- `search` (opcional — filtra por e-mail), `limit`/`offset` (paginação, para `list`)
- `email`/`user_id` (para `progress` — o aluno alvo)

### action_items
1. **Auth** — owner/admin/cs. Demais → BLOCKED (gateway).
2. **`list`** — `POST ops-gateway {operation:'list_users', params:{ limit, offset, search }}` → renderizar `| e-mail | plano | status | criado |` + total.
3. **`progress`** — `{operation:'user_progress', params:{ email|user_id }}` → `completed_count/total_tracked` + aulas.
4. Read-only — nenhuma mutação. NUNCA toca o banco Lovarch direto (só via gateway).

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** Via ops-gateway (`list_users`/`user_progress`) — não toca o banco direto.
- **[A3]** Read-only.

---

## Exemplos
### Exemplo 1 — "quantos usuários Lovarch temos?" → list_users (total).
### Exemplo 2 — "busca usuários com @studio" → list_users search.
### Exemplo 3 — "progresso do aluno X" → user_progress.

## Notas
- Complementa `lovarch-lookup-user` (1 usuário detalhado). Gestão (suspender/plano) = `manage-lovarch-user`; acesso = `manage-lovarch-access`.
- Lovarch = plataforma SaaS (empresa separada). Alunos da **Academy** (curso ArchPrime) = `list-academy-students`.
- Referências: `data/lovarch-ops-reference.md` (§Fase 2).

---

**Mantido por:** lovarch-ops-specialist
