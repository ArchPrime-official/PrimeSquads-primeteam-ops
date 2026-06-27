# Coverage Status — mapeamento das funções Lovarch (motion-engine)

> Atualizado 2026-06-27 (rumo a 100%). **Infra 100%**. Cobertura de conteúdo abaixo.
> Duas formas de animar a tela (modalidade A):
> - **preset rico** = HTML desenhado, elementos animando individualmente (stagger, loader, typing)
> - **screen-anim** = ground-truth REAL animado (fade + Ken Burns determinístico) via `screen-anim.html`
>   — cobre qualquer tela na hora; fidelidade total (é a tela real).
> Modalidade B (flow completo / jornada de cliques) = `flow-runner` + `flow.json`.

Legenda: ✅ feito · 🟡 parcial · ⬜ falta · 🈳 tela em **empty-state** (precisa popular dados na conta antes da versão final)

| Módulo | GT | Anim A | tipo A | Flow B | nota |
|---|---|---|---|---|---|
| render | ✅ | ✅ | preset rico | ✅ img+video | hero |
| moodboard | ✅ | ✅ | preset rico | ⬜ | |
| branding | ✅ | ✅ | preset rico | ⬜ | |
| content_studio | ✅ | ✅ | preset rico | ⬜ | |
| crm | ✅ | ✅ | preset rico | ⬜ | sticky |
| projects | ✅ | ✅ | preset rico | ⬜ | |
| portal | ✅ | ✅ | preset rico | ⬜ | sticky |
| finance | ✅ | ✅ | preset rico | ⬜ | sticky |
| planning | ✅ | ✅ | preset rico | ⬜ | sticky |
| caosometro | ✅ | ✅ | preset rico | ⬜ | |
| disc (+swot) | ✅ | ✅ | preset rico | ⬜ | |
| site_builder | ✅ | ✅ | screen-anim | ⬜ | conteúdo rico |
| formazione | ✅ | ✅ | screen-anim | ⬜ | conteúdo rico |
| sfide | ✅ | ✅ | screen-anim | ⬜ | conteúdo rico |
| contracts | ✅ | ✅ | screen-anim | ⬜ | tem dados (1 contrato) |
| kpi | ✅ | ✅ | screen-anim | ⬜ | dependente: leads+tx+projects (populados) |
| social | ✅ | ✅ | screen-anim | ⬜ | ✅ populado (conta IG + 5 posts) |
| audiences | ✅ | ✅ | screen-anim | ⬜ | ✅ populado (4 audiences) · sticky |
| campaigns | ✅ | ✅ | screen-anim | ⬜ | ✅ populado (3 campaigns + metrics) |
| editorial | ✅ | ✅ | screen-anim | ⬜ | tem dados (2-7 linhas) |
| brochure | ✅ | ✅ | screen-anim | ⬜ | ✅ populado (2 brochures) |
| results | ✅ | ✅ | screen-anim | ⬜ | dependente: campaigns.metrics (populado) |
| settings | ✅ | ✅ | screen-anim | ⬜ | utilitária |
| referral | ✅ | ✅ | screen-anim | ⬜ | utilitária |
| bonus | ✅ | ✅ | screen-anim | ⬜ | utilitária |
| feedback | ✅ | ✅ | screen-anim | ⬜ | utilitária |

(+ `archchat` e `video` têm GT+preset; video tem flow B e animação dedicada.)

## Resumo
- **Ground-truth: 26/26 (100%)** — todas as telas capturadas de produção.
- **Animação de tela (modalidade A): 26/26 (100%)** — 11 preset rico + 15 screen-anim.
- **Flow completo (modalidade B): motor 100% pronto + 2 fluxos provados** (render imagem, render vídeo, este último também como animação). Os demais são gerados sob demanda com `flow-runner` (jornada de navegação = sem custo; geração = créditos).

## Dados das 7 contas — POPULADOS (2026-06-27)
Os módulos que estavam vazios foram populados com dados de DEMO realistas (italiano)
via `scripts/seed-demo-data.mjs` (idempotente, Management API): audiences (4),
campaigns (3 + metrics → alimenta results), brochures (2), instagram_posts (5) — nas
7 contas. `editorial/contracts/kpi/leads/projects/transactions` já tinham dados.
Re-rodar o seed quando as contas forem recriadas/resetadas. **Nenhuma tela fica vazia.**

## O que resta (opcional — não é refazer)
1. **Upgrade screen-anim → preset rico** para módulos que entrarem como hero de uma aula.
2. **Flows B sob demanda** por função quando uma aula precisar da jornada de cliques.

Tudo incremental sobre a infra pronta; nada precisa ser refeito.
