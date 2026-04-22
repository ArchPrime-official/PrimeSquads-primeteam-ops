# CHANGELOG — primeteam-ops

Todas as mudanças notáveis deste squad ficam documentadas aqui. Cada ciclo executado pelo `ops-chief` gera uma entrada.

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/) e versionamento semântico [SemVer](https://semver.org/lang/pt-BR/).

---

## [0.1.0] — 2026-04-22

### Added — Scaffold estrutural (Fase 1.1)

- Estrutura de diretórios (`agents/`, `tasks/`, `workflows/`, `checklists/`, `data/`, `templates/`)
- `config.yaml` com `handoff_protocol` block (hub-and-spoke, V26 compliance)
- `README.md` em português — onboarding do time, fluxo de auth, setup
- `CHANGELOG.md` template

### Pending (próximas sub-fases)

- [ ] `data/primeteam-platform-rules.md` — Central reference (~900 linhas)
- [ ] `data/handoff-card-template.md` — V18 obrigatório
- [ ] `checklists/handoff-quality-gate.md` — V19 obrigatório
- [ ] `tasks/test-handoff-flow.md` — V20 obrigatório
- [ ] `agents/ops-chief.md` — Tier 0 orchestrator
- [ ] `agents/auth-specialist.md` — Tier 1

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
