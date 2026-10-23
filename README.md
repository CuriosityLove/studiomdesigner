# Studio M Design

A lighting-package composer for **design.studiomlighting.com**. Designers and homeowners describe a project, pick styles and rooms, and optionally add mood images or a floor plan. Claude composes a room-by-room lighting package from the Studio M collection, presented as an editorial layout with a branded PDF download.

## How it works

| Piece | What it does |
|---|---|
| `public/index.html` | The whole front end: brief builder, matching engine, editorial package layout, swap piece, PDF button. |
| `public/catalog.js` | 503 Studio M products (one or two per collection) with descriptions, finishes, materials, dimensions, lumens and ratings. |
| `public/img/` | Product photos, 420 px JPEG. |
| `public/compose-prompt.js` | Builds the Claude prompt. Used by the server, so the browser never sends its own prompt. |
| `public/pdf.js`, `pdf-fonts.js`, `plates.js` | Branded PDF lookbook (jsPDF), the Jost font, and embedded images for the PDF. |
| `server.js` | Serves `public/` and `POST /api/compose`, which calls Claude (Opus 5.5) with the brief, the shortlist and any images. |

If the server has no API key, or Claude is busy, the page falls back to its built-in matching engine, so it always produces a package.

## Run locally

```bash
npm install
```

```bash
ANTHROPIC_API_KEY=sk-ant-... node server.js
```

Then open http://localhost:3000. Without the key the site still works using the matching engine.

## Deploy on Render

1. In Render, choose **New → Blueprint** and connect this repository. Render reads `render.yaml`.
2. When asked, paste the **ANTHROPIC_API_KEY** (from console.anthropic.com). It is stored in Render, never in this repo.
3. Each push to `main` redeploys automatically.

### Custom domain

1. In the Render service, open **Settings → Custom Domains** and add `design.studiomlighting.com`.
2. At the DNS provider for studiomlighting.com, add the `CNAME` record Render shows (`design` → `<service>.onrender.com`).
3. Render issues the HTTPS certificate automatically once DNS resolves.

## Settings (environment variables)

| Variable | Default | Purpose |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Turns on Claude composition. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | Model used for composition. |
| `PER_IP_LIMIT` | `8` | Compositions per visitor per window. |
| `WINDOW_MINUTES` | `10` | Length of that window. |
| `DAILY_LIMIT` | `300` | Compositions per day across all visitors, as a cost ceiling. |

Each composition is one Claude request of roughly 25–35k input tokens.

## Updating the catalog

The catalog is a snapshot of studiomedition.com (October 2026). `scripts/product-list.txt` lists the product URLs used. The next step is to generate `catalog.js` and `img/` from Studio M's own product database on each deploy.

## Fonts

The site and PDF use Jost (SIL Open Font License) as a stand-in for Sofia Pro, which is licensed. If Studio M's license covers web and PDF embedding, swap Sofia Pro into `index.html` and `pdf-fonts.js`.
