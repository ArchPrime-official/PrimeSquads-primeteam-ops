# Task: review-academy-sfida

> Revisar e avaliar as consegne (submissions) das sfide da Academy (ArchPrime) — leitura e UPDATE **direto em `acad_submissions`** (PT). Desde A3b (2026-07-04) as sfide são 100% PrimeTeam (o `challenge-admin-bridge` → Lovarch foi aposentado). A RLS de escrita já existe (`acad_submissions_admin_upd`, migration 20261127000000).

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ **PT-nativo (A3b):** o sync de `challenge_submissions` foi desligado — `acad_submissions` é o SSoT (submissões de aluno logado E de ex-aluno por token nascem no PT). Avaliar = UPDATE direto, sem risco de reversão pelo cron. A UI `AdminSfideReview` já escreve assim.

---

## Task anatomy

### task_name
`Review Academy Sfida`

### status
`pending`

### responsible_executor
`platform-specialist` — auth **owner/admin/cs** (RLS `acad_submissions_admin_upd` = staff academy).

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
1. **Auth** — owner/admin/cs. Demais → BLOCKED (RLS nega).
2. **`list`** — `SELECT id, mission_id, user_id, token_participant_id, status, submitted_at FROM acad_submissions WHERE challenge_id={challenge_id} AND status='pending' ORDER BY submitted_at` → renderizar pendências. (aluno logado tem `user_id`; ex-aluno tem `token_participant_id`).
3. **`evaluate`** — ELICITAR `submission_id` + `verdict` (+ `feedback` se `changes_requested`).
   - **Confirmação:** "avaliar consegna {submission_id} como {verdict}. Feedback: {feedback}. Confirma?".
   - `UPDATE acad_submissions SET status={verdict=='approved'?'approved':'changes_requested'}, admin_feedback={feedback}, evaluated_by=auth.uid(), evaluated_at=now() WHERE id={submission_id}` (via JWT do user, RLS admin).
   - `42501` → BLOCKED (sem staff academy); 0 linhas → ESCALATE (submission inexistente).
4. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT status FROM acad_submissions WHERE id={submission_id}` confirmando o novo status.
5. **Activity log**: `action='platform-specialist.review_academy_sfida'`, `details={cycle_id, operation, submission_id, verdict}`.

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** `submission_id` e `verdict` elicitados; verdict nunca defaultado.
- **[A3]** `feedback` obrigatório em `changes_requested`.
- **[A4]** UPDATE direto em `acad_submissions` (PT) — NÃO usa mais o bridge Lovarch.
- **[A5]** Verificação pós-ação confirma a mudança de status.

---

## Exemplos
### Exemplo 1 — Listar pendências (SELECT acad_submissions status=pending) → tabela.
### Exemplo 2 — Aprovar (UPDATE status=approved) → confirma → status muda.
### Exemplo 3 — Pedir modifiche sem feedback → ELICITAR o feedback antes.

## Notas
- Par de `list-academy-students`. CRUD de sfide/missões = `manage-academy-sfida`. Fluxo de ex-aluno (submissão por token) = EFs `challenge-token-*` PT-nativas (A3b) — gravam em `acad_submissions`.
- Referências: `acad_submissions` (RLS `acad_submissions_admin_upd`), `apps/v2/src/academy/components/AdminSfideReview.tsx`.

---

**Mantido por:** platform-specialist
