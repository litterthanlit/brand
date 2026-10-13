import { withEmbeddedFonts } from './fonts'

export function loadSvgImage(svg: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }))
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not rasterise SVG'))
    }
    img.src = url
  })
}

/** SVG → image with fonts embedded, since images can't see the page's fonts. */
export const rasterise = async (svg: string) => loadSvgImage(await withEmbeddedFonts(svg))
