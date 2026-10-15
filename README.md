# Brand Playground

Tiny generative tools for making brand assets: patterns, badges, gradients, dithers and kinetic type.
Every tool runs entirely in the browser. There are no accounts, nothing is uploaded, and every result is a shareable link.

## Tools

### Raw collection
Abstract, grainy, editorial generators, each with one-click **moods**.

| # | Tool | What it makes | Output | Motion |
|---|------|---------------|--------|--------|
| 01 | Slipstream | Light at speed: soft streaks converging on an ember, printed on a paper mat or lit in the dark, with film grain and a lens bloom | PNG | ✓ |
| 02 | Stipple Cloud | A galaxy of stippled dots condensing around an ember core: galaxy, spray or crossing-cone fields, soft blur, and a capture → retain → resume accumulation | PNG | ✓ |
| 03 | Glitch Field | Pixel blocks, pixel-sorted streaks and radial bursts gathered around a reversed-out mark (hypher H or your own text) | SVG / PNG | ✓ |
| 04 | Ink Bleed | Saturated ink blooming into paper: fibrous feathered edges, hot/deep thermal cores, blots, splats and brush sweeps | PNG | ✓ |
| 05 | Long Exposure | Silky, motion-blurred water (or any photo) via a slow-shutter flow smear | PNG | ✓ |
| 06 | Line Sweep | String-art envelopes between two rails, stepped connectors, a marker track | SVG / PNG | ✓ |
| 07 | Particle Stream | Stippled particles swept along vortices and currents | SVG / PNG | ✓ |
| 08 | Blur Echo | Forms softening row by row, sliced into refracting strips | SVG / PNG | ✓ |
| 09 | Screen Orb | Gradient spheres and horizons printed through a fine halftone screen | PNG | ✓ |
| 10 | Photogram | Darkroom treatments (glow, negative, threshold, posterise, duotone) for your image or a generated botanical | PNG | |
| 11 | Bar Type | Letterforms rebuilt from horizontal bars, and redaction-style text blocks | SVG / PNG | ✓ |

### Classics
| # | Tool | Category | Output | Motion |
|---|------|----------|--------|--------|
| 12 | Halftone | Pattern | SVG / PNG | ✓ |
| 13 | Mesh Gradient | Texture | PNG | ✓ |
| 14 | Dither (upload your own image) | Image | PNG | |
| 15 | Stamp | Type | SVG / PNG | ✓ |
| 16 | Bauhaus Grid | Shape | SVG / PNG | |
| 17 | Flow Field | Texture | SVG / PNG | ✓ |
| 18 | Truchet | Pattern | SVG / PNG | |
| 19 | Blob | Shape | SVG / PNG | ✓ |
| 20 | Topography | Texture | SVG / PNG | ✓ |
| 21 | Type Repeat | Type | SVG / PNG | ✓ |
| 22 | Sunburst | Pattern | SVG / PNG | ✓ |
| 23 | Wave Lines | Pattern | SVG / PNG | ✓ |
| 24 | Op-Art Rings | Pattern | SVG / PNG | ✓ |

Every tool supports:

- **Randomize** (`R`), with per-parameter **locks** so you can keep what you like.
- **History**: step back and forward through results (`←` `→`, `⌘Z`).
- **Formats**: 1:1, 4:5, 16:9, 9:16, 3:1.
- **Filter layer**: re-draws the artwork as a screen of marks, one per cell, sized by the brightness underneath: ticks, dashes, dots, crosses, hatch or ASCII, in one ink or the artwork's own colours. **Dark** mode lights marks in a dark room; **Light** mode prints dark ink on paper, sized by darkness, so pale artwork reads as a positive. **Auto levels** stretches each frame's tones, so thin lines and flat images still fill the screen. Works on every tool, and exports as vector SVG too. Randomize never changes it.
- **Type layer**: title, body, a highlighted label and a mono caption in three weights and five editorial layouts (bottom right, bottom left, top left, centred, stacked words), with an optional **ink bleed** that rags and swells the letter edges. Randomize never changes it.
- **Finish layer**: soft grain, print speckle or dust, plus vignette.
- **Export**: SVG, copy SVG code, PNG at 1×/2×/4×, and seamless **video loops** (WebM) for animated tools. Filter, type and grain are baked in, and the artwork fonts (Inter Tight, JetBrains Mono, self-hosted) are embedded, so exports match the preview exactly.
- **Share links**: the full state, including filter, type and finish, is encoded in the URL.

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

Then add it to `TOOLS` in `src/tools/index.ts`. The controls panel, randomizer, filter, type and finish layers, URL sharing and all exports come for free.
Optional: `raw: true` puts it in the Raw collection, `defaults` sets its starting format/filter/finish/type, and `presets` adds mood chips (a preset can carry a `filter` too).
Rules: use the seeded `rng`/`noise` (never `Math.random`) so results are reproducible, and escape user text with `escapeXml`.

## Project layout

```
src/
  tools/        one file per generator + registry and types
  lib/          engine (state, randomize, render), filter + type + finish layers, filter rendering (one sampling path for preview and export), SVG rasterising, fonts, export, noise, rng, palettes, url state
  components/   Gallery (home), Studio (editor), Controls, Preview, ExportMenu
  hooks/        hash router, reduced-motion
```
