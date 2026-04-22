# CHANGELOG — primeteam-ops

Todas as mudanças notáveis deste squad ficam documentadas aqui. Cada ciclo executado pelo `ops-chief` gera uma entrada.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico [SemVer](https://semver.org/lang/pt-BR/).

---

## [0.2.0] — 2026-04-22

### Added — CLI de autenticação (Fase 2 Sprint 1)

- `cli/index.ts` — entry point com roteamento de subcomandos
- `cli/config.ts` — Supabase URL + anon key + callback port
- `cli/session.ts` — load/save/clear de `~/.primeteam/session.json` (chmod 600)
- `cli/supabase.ts` — factories de client PKCE e authenticated
- `cli/login.ts` — OAuth Google via PKCE + servidor HTTP local + página de sucesso/erro
- `cli/whoami.ts` — valida session + busca roles da tabela `user_roles` via Supabase
- `cli/logout.ts` — invalida no Supabase + remove session local
- `package.json` — scripts `npm run login/whoami/logout`, deps `@supabase/supabase-js` + `open`
- `tsconfig.json` — strict mode, ES2022, módulo bundler
- `ops-chief.md` — adicionado **Auth Verification Protocol** (decision tree) e step_1_receive com pre-check de session

### Setup necessário (admin)

Ver [`SETUP-ADMIN.md`](./SETUP-ADMIN.md) — configuração de Redirect URLs no dashboard do Supabase (bloqueante para o login funcionar).

---

## [0.1.0] — 2026-04-22

### Added — Scaffold estrutural (Fase 1.1)

- Estrutura de diretórios (`agents/`, `tasks/`, `workflows/`, `checklists/`, `data/`, `templates/`)
- `config.yaml` com `handoff_protocol` block (hub-and-spoke, V26 compliance)
- `README.md` em português — onboarding do time, fluxo de auth, setup
- `CHANGELOG.md` template
- `data/primeteam-platform-rules.md` (870L) — Central reference
- `data/handoff-card-template.md` — V18
- `checklists/handoff-quality-gate.md` — V19
- `tasks/test-handoff-flow.md` — V20
- `agents/ops-chief.md` (725L) — Tier 0 orchestrator
- `agents/auth-specialist.md` (521L) — Tier 1

### [0.1.1] — 2026-04-22 (standalone workspace)

- `.claude/commands/PrimeteamOps/` — symlinks (120000) para `agents/`, `tasks/`, `checklists/` — repo auto-suficiente como workspace Claude Code

---

## Template de entry (para cycles futuros)

```markdown
## [X.Y.Z] — YYYY-MM-DD

### Cycle ID: cyc-YYYY-MM-DD-NNN

**Request:** {descrição da demanda do usuário}
**Triaged by:** ops-chief
**Routed to:** {specialist} → {specialist} → ... (ordem)
**Status:** Done | InReview | Blocked

### Files changed
- `path/to/file.ts` (created | modified | deleted)

### Convention Verification Report
- [x] i18n IT+PT-BR
- [x] @/ alias
- [x] RLS compliance
- [x] ArchPrime DS tokens
- [x] Mobile-first

### Deploy flag
safe-to-deploy: yes | no | with-caveats

### Suggested next
{próximo specialist ou close}
```

---

**Mantido por:** ops-chief (updates automáticas em cada cycle) + manual (em releases).
