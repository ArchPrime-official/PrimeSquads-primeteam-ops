# Platform Modules Inventory — PrimeTeam

> Inventário resumido dos 18 módulos da plataforma. Para dados completos (rotas, hooks, Edge Functions), consultar a auditoria CLI feasibility no repo PrimeTeam.

**Source:** auditoria `docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` (Seção 3).

---

## Lista dos 18 módulos

| # | Módulo | Rota principal | Guard | Agent primary | Status CLI (Go/No-Go) |
|---|--------|----------------|-------|---------------|------------------------|
| 1 | CRM/Vendas | `/comercial` | AuthGuard | sales-specialist | 🟡 (após Fase 0) |
| 2 | Finanças | `/finance/*` | FinanceGuard | platform-specialist (finance part) | ✅ |
| 3 | Marketing | `/marketing` | AuthGuard | marketing-specialist | 🟡 |
| 4 | Customer Success | `/cs-hub` | AuthGuard | cs-specialist | ✅ |
| 5 | Agendamento | `/calendly` | AuthGuard | calendar-specialist | 🟡 |
| 6 | Comunicação | `/comunicacao` | AuthGuard | — | 🔴 (bloqueado Fase 0 até 2026-04-22: ok agora) |
| 7 | Telefonia | `/chiamate` | AuthGuard | integration-specialist (parcial) | 🟡 |
| 8 | Tarefas | `/tarefas` | AuthGuard | platform-specialist (tasks part) | ✅ |
| 9 | Automação | `/automation` | AuthGuard + Desktop | automation-specialist | 🟡 |
| 10 | Landing Pages | `/landing-pages/*` | AuthGuard + Desktop (editor) | content-builder | 🟡 (requer Fase 1.5) |
| 11 | Radar | `/radar` | AuthGuard | radar-specialist | 🟡 |
| 12 | Metas | `/goals` | AuthGuard + Owner (planning) | platform-specialist | 🟡 |
| 13 | Comissões | `/gestao/comissoes` | AdminGuard | platform-specialist (adm part) | ✅ |
| 14 | Gestão | `/gestao` | AdminGuard | — | N/A (só navegação) |
| 15 | Configurações | `/settings` | AuthGuard | platform-specialist (profile) | 🟡 |
| 16 | Import CSV | `/import-csv` | AuthGuard | platform-specialist | ✅ |
| 17 | AI Assistant | `/a-archprime` | AuthGuard | ai-chat-agent (Fase 3) | ✅ (após Fase 0 concluída) |
| 18 | Profile | `/profile` | AuthGuard | platform-specialist | ✅ |

---

## Legenda de status

- ✅ **Verde:** squad resolve com qualidade direto (70% das ops)
- 🟡 **Amarelo:** multi-agent workflow ou wrapper OAuth necessário (20% das ops)
- 🔴 **Vermelho:** bloqueado por gap de RLS/Edge Function — resolvido ou pendente
- N/A: não é caso para CLI (só navegação, apresentação ao vivo, OAuth inicial)

---

## Referência externa

**Auditoria completa com tabelas de ações por módulo** (hooks, Edge Functions, tabelas):
`docs/platform-analysis/PRIMETEAM-CLI-FEASIBILITY-AUDIT-2026-04-22.md` — Seção 3 (18 módulos com ~459 ações catalogadas).

**Atalhos úteis:**
- Schemas das tabelas: `src/integrations/supabase/types.ts` (auto-gerado)
- Componentes por módulo: `src/components/{domain}/`
- Hooks por módulo: `src/hooks/{domain}/`
- Páginas: `src/pages/`
- Edge Functions: `supabase/functions/`

---

## Atualização

Este inventário é snapshot de 2026-04-22. Toda mudança estrutural (novo módulo, renomeação de rota) exige:

1. Atualização desta tabela
2. Update no auditoria CLI (se impactar feasibility)
3. CHANGELOG.md do squad
