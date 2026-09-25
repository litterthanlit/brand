/** Curated palettes. First colour is usually the background, the rest are inks. */
export interface Palette {
  name: string
  colors: string[]
}

export const PALETTES: Palette[] = [
  { name: 'Signal', colors: ['#F4F2EE', '#111111', '#FF4F12'] },
  { name: 'Ink', colors: ['#111111', '#F4F2EE', '#FF4F12'] },
  { name: 'Riso', colors: ['#F6F1E7', '#FF48B0', '#0078BF', '#FFE800'] },
  { name: 'Bauhaus', colors: ['#EFE8DA', '#1C1C1C', '#D8352A', '#2A5CAA', '#F2B632'] },
  { name: 'Klein', colors: ['#F2EFE9', '#002FA7', '#0A0A0A'] },
  { name: 'Acid', colors: ['#0D0D0D', '#D4FF3A', '#F5F5F0'] },
  { name: 'Lavender Haze', colors: ['#EDE9FE', '#6D28D9', '#F472B6', '#1E1B4B'] },
  { name: 'Terracotta', colors: ['#F3E9DC', '#C0582F', '#2F3E46', '#E7B460'] },
  { name: 'Forest', colors: ['#E8EDE4', '#1F3D2B', '#7FA36B', '#F2C14E'] },
  { name: 'Sorbet', colors: ['#FFF4EC', '#FF8A5B', '#FFC857', '#7AD3C0', '#3B3355'] },
  { name: 'Mono', colors: ['#FFFFFF', '#000000'] },
  { name: 'Newsprint', colors: ['#E9E4D8', '#232020', '#8C857B'] },
  { name: 'Ultraviolet', colors: ['#120B2E', '#7B5CFF', '#FF5CA8', '#F4F0FF'] },
  { name: 'Citrus', colors: ['#FFFBEA', '#FF6B00', '#FFD000', '#0F5132'] },
  { name: 'Coastal', colors: ['#F1F5F4', '#0E4C5A', '#4FB0C6', '#F2A65A'] },
  { name: 'Cherry', colors: ['#FCEFEF', '#B3001B', '#262626'] },
  { name: 'Mint Chip', colors: ['#E6F7EF', '#113C2F', '#3DDC97', '#FF7A59'] },
  { name: 'Midnight', colors: ['#0B1026', '#F3E9D2', '#E94F37', '#39A0ED'] },
  { name: 'Sand Dune', colors: ['#EFE6D6', '#B08968', '#7F5539', '#1D1A16'] },
  { name: 'Pop Art', colors: ['#FFFFFF', '#000000', '#FF2E63', '#08D9D6', '#FFE45E'] },
  { name: 'Matcha', colors: ['#F2F0E6', '#5A7D3A', '#1F2A18', '#D9C8A0'] },
  { name: 'Candy', colors: ['#FFE8F3', '#FF3E9A', '#6C3BFF', '#00C2A8'] },
  { name: 'Steel', colors: ['#E6E8EB', '#2B3440', '#6B7A8F', '#FF6B35'] },
  { name: 'Ember', colors: ['#1A0F0A', '#FF7A1A', '#FFD27A', '#8C1C13'] },
  { name: 'Glacier', colors: ['#F4FBFF', '#0B3D91', '#6EC1E4', '#B9E6FF'] },
  { name: 'Retro Tech', colors: ['#EDE6D6', '#E4572E', '#29335C', '#F3A712', '#669BBC'] },
  { name: 'Noir Gold', colors: ['#0E0E0E', '#C9A227', '#EDE3C8'] },
  { name: 'Peach Fuzz', colors: ['#FFF1E6', '#FFA07A', '#E2725B', '#3D2C2E'] },
]

export const DEFAULT_PALETTE = PALETTES[0].colors
