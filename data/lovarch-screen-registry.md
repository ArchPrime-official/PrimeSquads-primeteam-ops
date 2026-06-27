# Lovarch Screen Registry — telas, rotas, presets e vídeos

> Fonte da verdade do **@screen-motion-engineer**. Mapeia cada tela da plataforma
> Lovarch ao seu preset HTML animado, ao screenshot ground-truth de referência, à
> rota real e ao vídeo MOTION final. Atualizar sempre que uma tela mudar.

## Rotas dos módulos (new-home)

Todas user-facing em `https://app.lovarch.com/new-home?m=<key>`:

| key (`?m=`) | Tela | Ressalvas |
|---|---|---|
| `render` | Render Studio (img/vídeo) | **NÃO** `/render-studio` (legado admin via Layout redirect). Resultado com RIFERIMENTO só em image-to-render (com foto-base). |
| `video` | Gerador de vídeo (frame iniziale→finale, Kling) | — |
| `moodboard` | Moodboard (paleta/materiais) | thumbnails são gradientes nos presets antigos |
| `branding` | Branding (logo, fontes, guidelines) | manter cores reais da tela (não só ouro) |
| `content_studio` | Content Studio v2 | default do módulo; flag legada removida |
| `archchat` | ArchChat (chat IA) | — |
| `caosometro` | Caosometro (diagnóstico) | **NÃO** `/caosometro` (legado admin-only) |
| `finance` | Finanze (dashboard financeiro) | — |
| `planning` | Pianificazione (simulações) | grid de cards de simulação |
| `crm` | Clienti / CRM | — |
| `projects` | Progetti | — |
| `portal` | Portale Cliente | BETA |
| `disc` / `swot` | DISC + SWOT (mesmo `DiscSwotPanel`) | manter chart multicolor |

## Mapa: vídeo MOTION → preset → ground-truth → conta de captura

Vídeos finais de referência em `~/Desktop/motions-academy/` (13–25 = versões reais).

| Vídeo final | Preset (`motion-engine/presets/`) | Ground-truth | Conta rica | `?m=` |
|---|---|---|---|---|
| 13-render-studio-FLUSSO-v3 | `render-studio-motion.html` | `01-home`,`02-gallery`,`03-prompt-typed`,`05-render-detail` | olimpia | render |
| 14-caosometro | `scene-caosometro.html` | `mod-caosometro` / `caosometro-user` | marco | caosometro |
| 15-finanze | `scene-finance.html` | `mod-finance` | caterina | finance |
| 16-contenuti | `scene-content.html` | `mod-content` | vittoria | content_studio |
| 17-archchat | `scene-archchat.html` (+`scene-archchat-flow.html`) | `mod-archchat` | marco | archchat |
| 18-moodboard | `scene-moodboard.html` | `mod-moodboard` | olimpia | moodboard |
| 19-branding | `scene-branding.html` | `mod-branding` | olimpia | branding |
| 20-disc-swot | `scene-disc.html` | `mod-disc`,`mod-swot` | marco | disc/swot |
| 21-pianificazione | `scene-planning.html` | `mod-planning` | caterina | planning |
| 22-clienti-crm | `scene-crm.html` | `mod-crm` | lorenzo | crm |
| 23-progetti | `scene-projects.html` | `mod-projects` | tommaso | projects |
| 24-portale | `scene-portal.html` | `mod-portal` | tommaso | portal |
| 25-video | `scene-video.html` | `mod-video` | olimpia | video |

Presets auxiliares: `scene-home.html`, `scene-gallery.html`, `scene-editor.html`
(cenas do fluxo Render Studio), `render-studio.html`/`render-studio-anim.html` (versões anteriores).

## Cobertura 100% — duas formas de animar a tela (modalidade A)

- **preset rico** (`scene-*.html`, `render-studio-motion.html`): HTML desenhado, elementos
  animando (stagger, loader, typing). As 11 telas principais + render.
- **screen-anim** (`screen-anim.html`): anima o **ground-truth REAL** (fade + Ken Burns
  determinístico). Cobre QUALQUER tela na hora — basta `clips/<key>.json` com
  `content.image = "../ground-truth/mod-<key>.png"`. Usado nas 15 telas restantes →
  cobertura 26/26. Fidelidade total (é a tela real). Upgrade p/ preset rico sob demanda.

```bash
# animar qualquer tela a partir do screenshot real:
node scripts/render-motion.mjs clips/<key>.json   # preset screen-anim.html
```

Ver `data/coverage-status.md` para o status por módulo (e quais estão em empty-state).

## Contrato do preset (todos expõem)

```js
window.__DURATION = 9000;                 // ms
window.__CONTENT  = Object.assign({...}, window.__CONTENT||{}); // sobrescrevível
function __render(T){ /* T em ms, função PURA do tempo */ }
window.__render = __render; boot(); // boot → __render(0); SEM requestAnimationFrame
```

→ O render é externo (frame-a-frame). Trocar `window.__CONTENT` (via `clip.json` →
`render-motion.mjs --content` ou `addInitScript`) gera um vídeo novo por persona/aula
sem tocar no HTML.
