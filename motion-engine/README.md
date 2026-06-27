# motion-engine — Animação determinística das telas Lovarch

Tudo que o **@screen-motion-engineer** precisa para recriar e animar qualquer tela
da plataforma Lovarch como vídeo MP4, de forma **autossuficiente** (não depende do
repo da Lovarch) e **replicável por qualquer funcionário** — inclusive quem não tem
acesso ao código.

## Estrutura

```
motion-engine/
├── presets/        24 HTML self-contained (window.__CONTENT/__render) das telas
├── ground-truth/   screenshots REAIS de referência (recapturáveis via produção)
├── clips/          1 .json por tela (preset + overrides + fps/size) → render config-driven
├── scripts/        pipeline durável (reconstrução do que vivia em /tmp)
│   ├── render-motion.mjs        preset → MP4 (frame-a-frame Playwright + ffmpeg)
│   ├── smoke-verify.mjs         juiz SSIM (recriação-vs-real e vídeo-vs-vídeo)
│   ├── lovarch-login.mjs        login autônomo nas 7 contas (Management API)
│   └── capture-ground-truth.mjs recaptura telas reais em produção
└── out/            MP4s gerados (gitignored)
```

Docs de apoio em `../data/`: `lovarch-screen-registry.md`, `capture-infra.md`,
`motion-fidelity-rules.md`. Workflow: `../workflows/wf-lovarch-screen-motion.yaml`.

## Uso rápido (rodar a partir de `/Users/pablo/PrimeTeam`)

```bash
# 1) Animar uma tela existente → MP4 (config-driven)
node motion-engine/scripts/render-motion.mjs motion-engine/clips/planning.json

# 2) Regressão: o MP4 bate com a referência?
node motion-engine/scripts/smoke-verify.mjs \
  --video motion-engine/out/21-pianificazione.mp4 \
  --ref ~/Desktop/motions-academy/21-pianificazione-MOTION.mp4 --threshold 0.99

# 3) Recriar/ajustar uma tela a partir de um print (modo screenshot→recria)
#    salvar o print em ground-truth/<key>.png e iterar até passar:
node motion-engine/scripts/smoke-verify.mjs \
  --preset scene-finance.html --truth ground-truth/mod-finance.png --threshold 0.95

# 4) Recaptura completa do ground-truth em produção (quem tem SUPABASE_ACCESS_TOKEN)
node motion-engine/scripts/capture-ground-truth.mjs
```

## Duas modalidades de animação

| Modalidade | Script | O que faz | Quando usar |
|---|---|---|---|
| **A. Tela única (motion graphics determinístico)** | `render-motion.mjs` | anima 1 tela via preset HTML (`__render(T)`), pixel-perfect, leve | hero shots de uma tela, vídeos por persona/aula |
| **B. Fluxo completo (screencast roteirizado)** | `flow-runner.mjs` | NAVEGA o app real e grava a jornada multi-tela (dropdowns→prompt→loading real→resultado) | "o que acontece quando clica em cada coisa": gerar render/vídeo, etc. |

### B. Fluxos completos (`flow-runner.mjs`)

Lê um `flows/<nome>.json` (DSL de passos), **pergunta com qual PrimeVoice gravar**
(seletor interativo), loga via a Edge Function `primevoices-session` (sem senha, sem
token local) e grava o screencast real com cursor sintético → MP4.

```bash
# pergunta qual PrimeVoice e grava o fluxo:
node motion-engine/scripts/flow-runner.mjs flows/render-image-generation.json
# ou fixa a conta:
node motion-engine/scripts/flow-runner.mjs flows/video-generation.json --account olimpia
```

**Mapear uma função nova** (descobrir os controles reais p/ montar o flow.json):
```bash
node motion-engine/scripts/explore-ui.mjs render olimpia --open-dropdown
```

DSL do `flow.json`: `goto`, `wait`, `clickText`, `pickMode`, `pickChip`, `type`,
`upload`, `generate`, `generateVideo`, `click`. Ver `flows/*.json` e `../data/flow-registry.md`.

Login: o `flow-runner` chama a EF `primevoices-session` (Lovarch) com o shared secret
de `config/gateway.json`. O service_role nunca sai do servidor. Ver `../data/capture-infra.md`.

## Contrato dos presets

```js
window.__DURATION = 9000;   // ms
window.__CONTENT  = Object.assign({defaults}, window.__CONTENT||{}); // overrides via clip.json
function __render(T){ /* T em ms — função PURA do tempo, determinística */ }
window.__render = __render; boot(); // boot → __render(0); SEM requestAnimationFrame
```

Um vídeo novo por persona/aula = trocar `content` no `clip.json` (prompt, render,
modelo, nome, avatar). Sem tocar no HTML.

## Setup (máquina nova — roda 1x)

```bash
cd /Users/pablo/PrimeTeam
bash motion-engine/setup.sh   # instala/verifica ffmpeg + playwright + smoke
```

## Pré-requisitos

- `node` + `playwright` + `ffmpeg` (o `setup.sh` instala/verifica)
- **Para animar/gravar (qualquer funcionário):** nada mais — `flow-runner` loga via a EF
  `primevoices-session` usando o secret em `config/gateway.json` (já no repo).
- **Admin-only:** `capture-ground-truth.mjs` e `seed-demo-data.mjs` exigem
  `SUPABASE_ACCESS_TOKEN` (Management API). O ground-truth já está versionado — o
  funcionário comum não precisa recapturar.
- **Nada da Lovarch é necessário** para recriar/animar a partir de um print.

## Prova (2026-06-27)

Re-render dos presets bate quase pixel-a-pixel com os vídeos originais do Pablo:
- `scene-planning` → `21-pianificazione-MOTION.mp4`: **SSIM 0.99997**
- `scene-caosometro` → `14-caosometro-MOTION.mp4`: **SSIM 0.99996**
