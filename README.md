# Brand Playground

Tiny generative tools for making brand assets: patterns, badges, gradients, dithers and kinetic type.
Every tool runs entirely in the browser. There are no accounts, nothing is uploaded, and every result is a shareable link.

## Tools

| # | Tool | Category | Output | Motion |
|---|------|----------|--------|--------|
| 01 | Halftone | Pattern | SVG / PNG | ✓ |
| 02 | Mesh Gradient | Texture | PNG | ✓ |
| 03 | Dither (upload your own image) | Image | PNG | |
| 04 | Stamp | Type | SVG / PNG | ✓ |
| 05 | Bauhaus Grid | Shape | SVG / PNG | |
| 06 | Flow Field | Texture | SVG / PNG | ✓ |
| 07 | Truchet | Pattern | SVG / PNG | |
| 08 | Blob | Shape | SVG / PNG | ✓ |
| 09 | Topography | Texture | SVG / PNG | ✓ |
| 10 | Type Repeat | Type | SVG / PNG | ✓ |
| 11 | Sunburst | Pattern | SVG / PNG | ✓ |
| 12 | Wave Lines | Pattern | SVG / PNG | ✓ |
| 13 | Op-Art Rings | Pattern | SVG / PNG | ✓ |

Every tool supports:

- **Randomize** (`R`), with per-parameter **locks** so you can keep what you like.
- **History**: step back and forward through results (`←` `→`, `⌘Z`).
- **Formats**: 1:1, 4:5, 16:9, 9:16, 3:1.
- **Export**: SVG, copy SVG code, PNG at 1×/2×/4×, and seamless **video loops** (WebM) for animated tools.
- **Share links**: the full state is encoded in the URL.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build → dist/
```

Stack: Vite, React 19, TypeScript, Tailwind CSS v4. It has no runtime dependencies beyond React.
The noise, RNG, marching squares, dithering and exporters are all in `src/lib`.

Deploy: the output is static (`dist/`), so it works on Vercel, Netlify, GitHub Pages or any CDN.

## Adding a tool

A tool is one file in `src/tools/` that exports a `ToolDef`:

```ts
export const myTool: SvgTool = {
  id: 'my-tool',
  name: 'My Tool',
  category: 'Pattern',
  description: 'One line for the gallery card.',
  kind: 'svg',            // or 'canvas' with draw({ g, ... })
  animated: true,         // optional; use `t` (0→1) for a seamless loop
  params: [
    { type: 'palette', key: 'palette', label: 'Palette', default: ['#fff', '#111'] },
    { type: 'number', key: 'count', label: 'Count', min: 1, max: 50, step: 1, default: 10 },
  ],
  render({ w, h, p, rng, noise, t }) {
    return `<rect width="${w}" height="${h}" fill="${pal(p, 'palette')[0]}"/>`
  },
}
```

Then add it to `TOOLS` in `src/tools/index.ts`. The controls panel, randomizer, URL sharing and all exports come for free.
Rules: use the seeded `rng`/`noise` (never `Math.random`) so results are reproducible, and escape user text with `escapeXml`.

## Project layout

```
src/
  tools/        one file per generator + registry and types
  lib/          engine (state, randomize, render), export, noise, rng, palettes, url state
  components/   Gallery (home), Studio (editor), Controls, Preview, ExportMenu
  hooks/        hash router, reduced-motion
```
