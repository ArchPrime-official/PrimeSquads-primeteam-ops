# Task: manage-academy-sfida

> Criar/editar/publicar SFIDE e MISSÕES da Academy (ArchPrime) — `acad_challenges` + `acad_missions`. Gestão do time. Hoje o caminho vivo é a EF `challenge-admin-bridge` (CRUD de challenges/missions, já em produção); com a RLS de escrita (migration `20270704140000`) a escrita direta em `acad_*` também é possível para os campos PT-owned.

**Cumpre:** HO-TP-001 (anatomy) · **HO-TP-002 (required fields)** — ver `data/primeteam-platform-rules.md` §12.

> ⚠️ **Transição em curso (A3):** challenges/missions ainda sincronizam do Lovarch (o fluxo de ex-aluno por token submete lá). Por isso, para campos que o sync AINDA espelha, autorar via `challenge-admin-bridge` (grava no Lovarch, volta pelo sync) evita reversão. Título/subtítulo/banner de `acad_challenges` já são PT-owned (fora da whitelist do sync) → editáveis direto no PT. O fluxo ex-aluno 100% PT é a sub-fase A3b.

---

## Task anatomy

### task_name
`Manage Academy Sfida`

### status
`pending`

### responsible_executor
`platform-specialist` — auth **owner/admin/cs** (gate do `challenge-admin-bridge`).

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
1. **Auth** — owner/admin/cs. Demais → BLOCKED (a EF devolve 403).
2. **Elicitar** `title` (create) + `challenge_id` (mission). Nunca defaultar.
3. **Confirmação** (echo dos valores).
4. **Write via `challenge-admin-bridge`** (caminho vivo, grava no Lovarch e volta pelo sync):
   ```
   invoke('challenge-admin-bridge', { action: 'create_mission'|'update_mission'|'publish_mission'|'update_challenge', payload: {...} })
   ```
   `403` → BLOCKED; erro do Lovarch → repassar.
   - **Campos PT-owned** (`acad_challenges.title/subtitle/banner_url`): podem ser UPDATE direto em `acad_challenges` (RLS `is_admin_or_owner`) — não voltam pelo sync.
5. **Verificação PÓS-AÇÃO** (obrigatória): re-`get_challenge`/`list_missions` (ou `SELECT` para campos PT-owned) confirmando + smoke visual na aba Sfide do portal.
6. **Activity log**: `action='platform-specialist.manage_academy_sfida'`, `details={cycle_id, entity, operation, challenge_id/mission_id}`.

### acceptance_criteria
- **[A1]** Auth owner/admin/cs.
- **[A2]** `title`/`challenge_id` elicitados; nada defaultado.
- **[A3]** Via `challenge-admin-bridge` (ou UPDATE direto em campos PT-owned).
- **[A4]** Verificação pós-ação + smoke visual.
- **[A5]** Colunas reais (`acad_challenges`/`acad_missions`).

---

## Exemplos
### Exemplo 1 — Nova missão num desafio (create_mission via bridge) → aparece na aba Sfide.
### Exemplo 2 — Editar título da sfida (UPDATE direto acad_challenges.title, PT-owned).
### Exemplo 3 — Sem challenge_id numa missão (ELICITAR).

## Notas
- **Avaliar consegne** = `review-academy-sfida` (par desta). **Fluxo ex-aluno por token** (submissão) = runtime do produto (challenge-token-*), sub-fase A3b (migração PT-nativa com cuidado a usuário ativo).
- Academy = ArchPrime; sfide NÃO ficam mais na superfície do app Lovarch (trilha B4).
- Referências: `supabase/functions/challenge-admin-bridge`, migration `20270704140000`, `types.ts` (`acad_challenges/acad_missions`).

---

**Mantido por:** platform-specialist
