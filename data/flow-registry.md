# Flow Registry — fluxos completos das funções Lovarch (screencast roteirizado)

> Para a modalidade **B** (fluxo multi-tela do app real), executada pelo
> `flow-runner.mjs`. Cada função tem um `motion-engine/flows/<nome>.json` com a
> sequência de passos (a jornada de cliques). Auto-mapeável com `explore-ui.mjs`.

## DSL do flow.json

```json
{
  "name": "render-image-generation",
  "account": "olimpia",                       // opcional; sem isto o runner pergunta o PrimeVoice
  "viewport": { "width": 1600, "height": 900 },
  "out": "flow-render-image.mp4",
  "steps": [ { "action": "...", ... } ]
}
```

| action | params | efeito |
|---|---|---|
| `goto` | `module`, `ms?` | abre `/new-home?m=<module>` |
| `wait` | `ms` | pausa |
| `clickText` | `text`, `required?` | clica botão/toggle/tab por texto (busca ampla) |
| `pickMode` | `mode` | abre o dropdown de modo do Render e escolhe (Crea/Stili/Modifica/Arredo/Pianta→3D/Render 3D) |
| `pickChip` | `from[]`, `to` | troca chip da barra (estilo/modelo/ratio) |
| `type` | `text` | digita no prompt bar (com jitter humano) |
| `upload` | `asset` | carrega arquivo (image-to-image / frame base de vídeo) |
| `generate` | `label?`, `timeout?` | clica Genera e espera o resultado (imagem) |
| `generateVideo` | `timeout?` | clica Genera e espera o `<video>` (minutos) |
| `click` | `x`, `y`, `ms?` | clique em coordenada (fechar dropdown etc.) |

## UI real do Render Studio (mapeada 2026-06-27, `explore-ui.mjs`)

- Geração de imagem **e** vídeo acontecem em `?m=render` (o `?m=video` é chat genérico).
- Barra inferior: toggle **Immagine/Video** · dropdown de **modo** (Arredo é o default;
  opções: Arredo · Render 3D · Pianta → 3D · Crea · Stili · Modifica) · **estilo** ·
  **ratio 16:9** · **modelo** (Nano Banana 2 / Pro · GPT Image 2 · FLUX 2 Pro · Ideogram) ·
  "Migliora prompt con IA".
- **Crea** = text-to-image (só prompt). **Modifica/Stili/Arredo/Pianta** = exigem `upload`.
- **Vídeo** = `upload` (frame base) → toggle **Video** → prompt de movimento → Genera (image-to-video).

## Fluxo completo como ANIMAÇÃO (não só gravação)

Qualquer fluxo pode virar **animação determinística** (modalidade A multi-cena), não só
screencast. Padrão: gravar com `flow-runner` (rápido) + os **assets reais da galeria**
(imagens/vídeos gerados de verdade) como insumo → recriar a jornada como preset HTML.

- Exemplo pronto: `presets/scene-video-flow.html` (clip `clips/video-flow.json` →
  `ANIM-video-generation.mp4`): jornada de geração de vídeo (digita prompt → loader
  neural → **vídeo REAL embutido tocando**), 1920×1080 limpo, ~2 MB vs ~10 MB da gravação.
- O `render-motion.mjs` captura frames de `<video data-anim>` de forma determinística
  (espera load + seek por `currentTime` antes do screenshot).

## Fluxos prontos

| flow.json | função | status |
|---|---|---|
| `render-image-generation.json` | gerar render (Crea) | ✅ provado end-to-end (olimpia, ~39cr, resultado real gravado) |
| `video-generation.json` | gerar vídeo (image-to-video) | ✅ provado end-to-end (olimpia, Runway Gen-4.5 5s, vídeo 1280×720 salvo na galeria) |

> **Toggles de ícone (Immagine/Video) usam `clickTitle`, não `clickText`** — o toggle de
> vídeo é um botão com `title="Video"` (sem texto); `clickText "Video"` clicava no filtro
> de galeria. Sequência do vídeo: upload (frame base) → `clickTitle Video` → modo vídeo
> (Runway Gen-4.5 · 5s · ~600cr) → prompt de movimento → `generateVideo`.

## Como adicionar uma função nova

1. `node scripts/explore-ui.mjs <module> <conta> --open-dropdown` → ver controles reais.
2. Escrever `flows/<nome>.json` com os passos.
3. `node scripts/flow-runner.mjs flows/<nome>.json` → gravar.
4. Conferir o MP4 (extrair frame final). Ajustar e repetir até a jornada ficar limpa.

> Mapeamento por **auto-exploração + revisão humana**: eu descubro os passos navegando
> nas 7 contas; você revisa/ajusta o roteiro de cada função.
