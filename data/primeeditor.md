# PrimeEditor — o editor de vídeo do time (guia de entrada)

> **TODO vídeo do time (aula, anúncio, demo, apresentação, misto) é feito no
> PrimeEditor** — o editor híbrido IA+humano da ArchPrime que substituiu o
> Remotion. Local, gratuito, sem API paga. Este é o doc de ENTRADA; o guia
> completo vive no repo do editor.

## Instalar (1x por máquina)

```bash
git clone https://github.com/ArchPrime-official/PrimeEditor ~/PrimeEditor
bash ~/PrimeEditor/editor/install.sh   # pnpm install + instala a skill `primeeditor` no Claude Code
```

Atualizar depois: `bash ~/PrimeEditor/editor/install.sh` (git pull + re-instala a skill).

## Usar

- **Humano**: `http://localhost:3000/edit` — timeline estilo Premiere (atalhos
  J/K/L, razor, source monitor com inserir/sobrepor, keyframes com bezier).
- **IA (Claude Code)**: peça um vídeo — a skill `primeeditor` sobe o servidor e
  edita pelo terminal (54 verbos). Humano e IA editam o MESMO projeto ao vivo.
- **Docs canônicos** (no repo do editor):
  - `docs/PRD-PRIMEEDITOR.md` — TODAS as funções, receitas, gaps (fonte da verdade)
  - `docs/AI-TOOLS.md` — referência de verbos da CLI
  - `docs/LOVARCH-MOTION-KIT.md` — UI sintética da Lovarch (15 widgets + 17 templates)

## Os 3 sabores de vídeo Lovarch

| Sabor | Quando | Como |
|---|---|---|
| **Real** | mostrar a plataforma de verdade | `PrimeTeam/scripts/grava-lovarch.mjs --login` (grava autenticado → biblioteca) |
| **Sintético** | anúncio estilo "Claude Tag" da Anthropic (prompt bar digitando, cliques, toast) | `add-scene prompt-<módulo>` / `home-hero` / `end-card` |
| **Misto** | vídeo longo com overlays | real embaixo + `lowerThird`/`statCard`/`toast`/`appIcon` |

## Regras INEGOCIÁVEIS (criativos Lovarch)

1. **⛔ SEMPRE light mode** — nunca dark (regra do Pablo, 2026-07-10).
2. **Accent #A16207 só em dose pequena** (≠ #C9995C do ArchPrime); ícone-app =
   variante `light` (tile branco + símbolo gold) ou `mono` (símbolo preto).
3. **UI fiel**: placeholders/pills por módulo são LITERAIS do código real —
   specs em `/Users/pablo/lovarch-atlas/specs/` (não inventar).
4. **Smoke visual obrigatório**: `render-still --at <ms>` nos beats + olhar o
   PNG antes de entregar (regra ⛔ global).

## Roteamento (ops-chief)

Pedido de vídeo → ativar skill `primeeditor` + task do squad dono:
- Criativo/anúncio/demo → `creative-studio` (`tasks/lovarch-motion-kit.md`,
  `tasks/compose-in-primeeditor.md`)
- Aula/CPL → checklist `cpl-studio/checklists/montagem-smoke-checklist.md`
  (+ `scripts/compose-aula.mjs` no editor)
- Vídeo p/ Meta Ads → criativo SEMPRE em 2 versões CTA (clique + comenta)

## Materiais = pasta (organização + sync do time) — 2026-07-10

Cada vídeo é 1 MATERIAL = 1 PASTA (`projects/<id>/`: timeline, biblioteca,
`brief.md` com o pedido/links/decisões, `uploads/`, `renders/`). Nada de vala
comum — tudo do material fica junto e achável.

**Sync remoto (editor é local em cada máquina):**
```bash
node scripts/material.mjs push [--id X]   # sobe a pasta ao bucket + registry
node scripts/material.mjs pull <id>        # baixa noutra máquina
node scripts/material.mjs list             # o que existe
```
Auth = sessão pto individual (auditável). **Vitrine**:
`primeteam.archprime.io/materiali` — qualquer um do time acha um material (busca
nome/mês/status, links do brief, render final) SEM abrir o editor.

**Onde está o material X?** → vitrine `/materiali` (ou `material list`). O brief
de cada material (`brief.md` / verbo `brief`) tem o pedido, os links e as
decisões — é a memória do material.
