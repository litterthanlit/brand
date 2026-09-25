export interface Format {
  id: string
  label: string
  hint: string
  w: number
  h: number
}

export const FORMATS: Format[] = [
  { id: 'square', label: '1:1', hint: 'Post · Avatar', w: 1080, h: 1080 },
  { id: 'portrait', label: '4:5', hint: 'Feed portrait', w: 1080, h: 1350 },
  { id: 'landscape', label: '16:9', hint: 'Slide · Cover', w: 1920, h: 1080 },
  { id: 'story', label: '9:16', hint: 'Story · Reel', w: 1080, h: 1920 },
  { id: 'banner', label: '3:1', hint: 'Banner · Header', w: 1500, h: 500 },
]

export const getFormat = (id: string) => FORMATS.find((f) => f.id === id) ?? FORMATS[0]
