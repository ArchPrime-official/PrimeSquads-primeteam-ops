# Task: manage-academy-sfida

> Criar/editar/publicar SFIDE e MISSÕES da Academy (ArchPrime) — `acad_challenges` + `acad_missions`, **escrita DIRETA no PT** (RLS `is_admin_or_owner`, migration `20270704140000`). Desde A3b (2026-07-04) as sfide são 100% PrimeTeam.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ✅ **PT-nativo (A3b):** o sync de `challenges`/`challenge_missions` foi DESLIGADO — `acad_challenges`/`acad_missions` são o SSoT. Escrita direta não é mais revertida pelo cron. O `challenge-admin-bridge` (→ Lovarch) foi aposentado.

---

## Task anatomy

### task_name
`Manage Academy Sfida`

### status
`pending`

### responsible_executor
`platform-specialist` — auth **owner/admin** (RLS de escrita `is_admin_or_owner` em acad_challenges/acad_missions).

### execution_type
`Agent` — confirmação (muda o desafio visto pelo aluno).

### input
- **Cycle ID**, **User JWT**, **User role**
- `entity` — `challenge | mission`
- `operation` — `create | update | publish`
- `challenge_id` (uuid) — **ELICITAR** para mission/update (a qual desafio)
- `title` — **ELICITAR** no create (título da sfida/missão)
- `mission_id` (uuid) — para update/publish de missão
- campos por entity: challenge (`description`, `registration_*`/`challenge_*_date`, `access_products`, `rules`); mission (`instructions`, `order_index`, `submission_deadline`, `submission_types`, `materials`)

### action_items
1. **Auth** — owner/admin (RLS `is_admin_or_owner`). Demais → BLOCKED (42501).
2. **Elicitar** `title` (create) + `challenge_id` (mission). Nunca defaultar.
3. **Confirmação** (echo dos valores).
4. **Write DIRETO no PT** (JWT do user, RLS `is_admin_or_owner` — migration 20270704140000):
   - challenge: `INSERT/UPDATE acad_challenges (title, subtitle, description, banner_url, registration_*/challenge_*_date, access_products, rules, is_active)`.
   - mission: `INSERT/UPDATE acad_missions (challenge_id, title, description, instructions, order_index, release_date, submission_deadline, submission_types, materials, video_url, status)`.
   - `id` gerado no cliente se `acad_missions.id`/`acad_challenges.id` não tiver default (mesma nota das outras tasks de conteúdo).
   `42501` → BLOCKED.
5. **Verificação PÓS-AÇÃO** (obrigatória): re-`SELECT` do challenge/mission + smoke visual na aba Sfide do portal.
6. **Activity log**: `action='platform-specialist.manage_academy_sfida'`, `details={cycle_id, entity, operation, challenge_id/mission_id}`.

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** `title`/`challenge_id` elicitados; nada defaultado.
- **[A3]** Escrita DIRETA em `acad_challenges`/`acad_missions` (PT, RLS is_admin_or_owner) — não usa mais o bridge Lovarch.
- **[A4]** Verificação pós-ação + smoke visual.
- **[A5]** Colunas reais (`acad_challenges`/`acad_missions`).

---

## Exemplos
### Exemplo 1 — Nova missão num desafio (INSERT acad_missions) → aparece na aba Sfide.
### Exemplo 2 — Editar título da sfida (UPDATE acad_challenges.title).
### Exemplo 3 — Sem challenge_id numa missão (ELICITAR).

## Notas
- **Avaliar consegne** = `review-academy-sfida` (par desta). **Fluxo ex-aluno por token** (submissão) = EFs `challenge-token-*` PT-nativas (A3b) — gravam em `acad_submissions` (bucket `academy-submissions`).
- Academy = ArchPrime; sfide 100% PT (A3b) e fora da superfície do app Lovarch (B4).
- Referências: migration `20270704140000` (RLS escrita), `types.ts` (`acad_challenges/acad_missions`).

---

**Mantido por:** platform-specialist
