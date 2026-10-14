# Brand Playground

Tiny generative tools for making brand assets: patterns, badges, gradients, dithers and kinetic type.
Every tool runs entirely in the browser. There are no accounts, nothing is uploaded, and every result is a shareable link.

## Tools

### Raw collection
Abstract, grainy, editorial generators, each with one-click **moods**.

| # | Tool | What it makes | Output | Motion |
|---|------|---------------|--------|--------|
| 01 | Glitch Field | Pixel blocks, pixel-sorted streaks and radial bursts gathered around a reversed-out mark (hypher H or your own text) | SVG / PNG | ✓ |
| 02 | Ink Bleed | Saturated ink blooming into paper: fibrous feathered edges, hot/deep thermal cores, blots, splats and brush sweeps | PNG | ✓ |
| 03 | Long Exposure | Silky, motion-blurred water (or any photo) via a slow-shutter flow smear | PNG | ✓ |
| 04 | Line Sweep | String-art envelopes between two rails, stepped connectors, a marker track | SVG / PNG | ✓ |
| 05 | Particle Stream | Stippled particles swept along vortices and currents | SVG / PNG | ✓ |
| 06 | Blur Echo | Forms softening row by row, sliced into refracting strips | SVG / PNG | ✓ |
| 07 | Screen Orb | Gradient spheres and horizons printed through a fine halftone screen | PNG | ✓ |
| 08 | Photogram | Darkroom treatments (glow, negative, threshold, posterise, duotone) for your image or a generated botanical | PNG | |
| 09 | Bar Type | Letterforms rebuilt from horizontal bars, and redaction-style text blocks | SVG / PNG | ✓ |

### Classics
| # | Tool | Category | Output | Motion |
|---|------|----------|--------|--------|
| 10 | Halftone | Pattern | SVG / PNG | ✓ |
| 11 | Mesh Gradient | Texture | PNG | ✓ |
| 12 | Dither (upload your own image) | Image | PNG | |
| 13 | Stamp | Type | SVG / PNG | ✓ |
| 14 | Bauhaus Grid | Shape | SVG / PNG | |
| 15 | Flow Field | Texture | SVG / PNG | ✓ |
| 16 | Truchet | Pattern | SVG / PNG | |
| 17 | Blob | Shape | SVG / PNG | ✓ |
| 18 | Topography | Texture | SVG / PNG | ✓ |
| 19 | Type Repeat | Type | SVG / PNG | ✓ |
| 20 | Sunburst | Pattern | SVG / PNG | ✓ |
| 21 | Wave Lines | Pattern | SVG / PNG | ✓ |
| 22 | Op-Art Rings | Pattern | SVG / PNG | ✓ |

Every tool supports:

- **Randomize** (`R`), with per-parameter **locks** so you can keep what you like.
- **History**: step back and forward through results (`←` `→`, `⌘Z`).
- **Formats**: 1:1, 4:5, 16:9, 9:16, 3:1.
- **Type layer**: title, body, a highlighted label and a mono caption in three weights and five editorial layouts (bottom right, bottom left, top left, centred, stacked words), with an optional **ink bleed** that rags and swells the letter edges. Randomize never changes it.
- **Finish layer**: soft grain, print speckle or dust, plus vignette.
- **Export**: SVG, copy SVG code, PNG at 1×/2×/4×, and seamless **video loops** (WebM) for animated tools. Type and grain are baked in, and the artwork fonts (Inter Tight, JetBrains Mono, self-hosted) are embedded, so exports match the preview exactly.
- **Share links**: the full state, including type and finish, is encoded in the URL.

## Develop

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production build → dist/
```

Stack: Vite, React 19, TypeScript, Tailwind CSS v4. Runtime dependencies are just React and two self-hosted font packages.
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

Then add it to `TOOLS` in `src/tools/index.ts`. The controls panel, randomizer, type and finish layers, URL sharing and all exports come for free.
Optional: `raw: true` puts it in the Raw collection, `defaults` sets its starting format/finish/type, and `presets` adds mood chips.
Rules: use the seeded `rng`/`noise` (never `Math.random`) so results are reproducible, and escape user text with `escapeXml`.

## Project layout

```
src/
  tools/        one file per generator + registry and types
  lib/          engine (state, randomize, render), type + finish layers, fonts, export, noise, rng, palettes, url state
  components/   Gallery (home), Studio (editor), Controls, Preview, ExportMenu
  hooks/        hash router, reduced-motion
```
