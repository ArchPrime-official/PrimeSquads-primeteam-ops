# Task: review-academy-sfida

> Revisar e avaliar as consegne (submissions) das sfide/challenges da Academy via a EF `challenge-admin-bridge` (proxy autenticado owner/admin/cs → admin de challenges do Lovarch). Preenche a lacuna [ALTO]: há UI (`AdminSfideReview`) e EF, mas nenhuma task pto para listar pendências e aprovar/pedir modifiche pelo terminal.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ A EF `challenge-admin-bridge` valida JWT do PrimeTeam + role **owner/admin/cs** e repassa ao Lovarch via shared secret. Ações relevantes: `list_submissions`, `evaluate_submission`. NÃO escrever `acad_submissions` direto.

---

## Task anatomy

### task_name
`Review Academy Sfida`

### status
`pending`

### responsible_executor
`platform-specialist` — auth **owner/admin/cs** (gate real da EF `challenge-admin-bridge`).

### execution_type
`Agent` — confirmação obrigatória ao avaliar (muda o status da consegna do aluno).

### input
- **Cycle ID**, **User JWT**, **User role**
- `operation` — `list | evaluate`
- `challenge_id` (uuid) — para `list` das submissions pendentes
- `submission_id` (uuid) — **ELICITAR** para `evaluate` (qual consegna)
- `verdict` (`approved | changes_requested`) — **ELICITAR sempre** para `evaluate`; nunca defaultar
- `feedback` (string) — comentário ao aluno (obrigatório se `changes_requested`)

### action_items
1. **Auth** — owner/admin/cs. Demais → BLOCKED (a EF devolve 403).
2. **`list`** — `invoke('challenge-admin-bridge', { action:'list_submissions', payload:{ challenge_id, status:'pending' } })` → renderizar pendências (`| aluno | enviado em | status |`).
3. **`evaluate`** — ELICITAR `submission_id` + `verdict` (+ `feedback` se `changes_requested`).
   - **Confirmação:** "avaliar consegna {submission_id} como {verdict}. Feedback: {feedback}. Confirma?".
   - `invoke('challenge-admin-bridge', { action:'evaluate_submission', payload:{ submission_id, verdict, feedback } })`.
   - Respostas: `403` → BLOCKED; `404 submission not found` → ESCALATE; erro do Lovarch → repassar.
4. **Verificação PÓS-AÇÃO** (obrigatória): re-`list_submissions` (ou `get`) confirmando que a submission saiu de `pending` para o `verdict` aplicado.
5. **Activity log**: `action='platform-specialist.review_academy_sfida'`, `details={cycle_id, operation, submission_id, verdict}`.

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** `submission_id` e `verdict` elicitados; verdict nunca defaultado.
- **[A3]** `feedback` obrigatório em `changes_requested`.
- **[A4]** Via EF `challenge-admin-bridge` (nunca escrever `acad_submissions` direto).
- **[A5]** Verificação pós-ação confirma a mudança de status.

---

## Exemplos
### Exemplo 1 — Listar pendências (list) → tabela de consegne pending.
### Exemplo 2 — Aprovar (evaluate/approved) → confirma → EF → status muda.
### Exemplo 3 — Pedir modifiche sem feedback → ELICITAR o feedback antes.

## Notas
- Par de `list-academy-students` (ver alunos). Gestão de MISSÕES/challenges (criar/editar/publicar) usa as outras ações do mesmo bridge (`create_mission`/`update_mission`/`publish_mission`) — task futura se necessário.
- Referências: `supabase/functions/challenge-admin-bridge` (ações), `apps/v2/src/academy/components/AdminSfideReview.tsx`.

---

**Mantido por:** platform-specialist
