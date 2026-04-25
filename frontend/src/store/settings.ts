import { createContext, useContext } from 'react'

export type ThemeMode = 'light' | 'dark' | 'system'

export interface BrandSwatch {
  id: string
  label: string
  /** Hex string of the 500 shade — a preview chip color. */
  preview: string
  /** 10 RGB triplets (space-separated) for shades 50 → 900. */
  scale: [string, string, string, string, string, string, string, string, string, string]
}

export const BRAND_SWATCHES: BrandSwatch[] = [
  {
    id: 'sage',
    label: 'Sage green',
    preview: '#4f9862',
    scale: [
      '243 250 244',
      '228 243 231',
      '200 230 207',
      '160 209 172',
      '115 181 131',
      '79 152 98',
      '61 124 78',
      '49 99 64',
      '40 79 52',
      '32 64 43',
    ],
  },
  {
    id: 'emerald',
    label: 'Emerald',
    preview: '#10b981',
    scale: [
      '236 253 245',
      '209 250 229',
      '167 243 208',
      '110 231 183',
      '52 211 153',
      '16 185 129',
      '5 150 105',
      '4 120 87',
      '6 95 70',
      '6 78 59',
    ],
  },
  {
    id: 'blue',
    label: 'Ocean blue',
    preview: '#3b82f6',
    scale: [
      '239 246 255',
      '219 234 254',
      '191 219 254',
      '147 197 253',
      '96 165 250',
      '59 130 246',
      '37 99 235',
      '29 78 216',
      '30 64 175',
      '30 58 138',
    ],
  },
  {
    id: 'indigo',
    label: 'Deep indigo',
    preview: '#6366f1',
    scale: [
      '238 242 255',
      '224 231 255',
      '199 210 254',
      '165 180 252',
      '129 140 248',
      '99 102 241',
      '79 70 229',
      '67 56 202',
      '55 48 163',
      '49 46 129',
    ],
  },
  {
    id: 'violet',
    label: 'Royal violet',
    preview: '#8b5cf6',
    scale: [
      '245 243 255',
      '237 233 254',
      '221 214 254',
      '196 181 253',
      '167 139 250',
      '139 92 246',
      '124 58 237',
      '109 40 217',
      '91 33 182',
      '76 29 149',
    ],
  },
  {
    id: 'rose',
    label: 'Rose',
    preview: '#f43f5e',
    scale: [
      '255 241 242',
      '255 228 230',
      '254 205 211',
      '253 164 175',
      '251 113 133',
      '244 63 94',
      '225 29 72',
      '190 18 60',
      '159 18 57',
      '136 19 55',
    ],
  },
  {
    id: 'amber',
    label: 'Amber',
    preview: '#f59e0b',
    scale: [
      '255 251 235',
      '254 243 199',
      '253 230 138',
      '252 211 77',
      '251 191 36',
      '245 158 11',
      '217 119 6',
      '180 83 9',
      '146 64 14',
      '120 53 15',
    ],
  },
  {
    id: 'slate',
    label: 'Neutral slate',
    preview: '#64748b',
    scale: [
      '248 250 252',
      '241 245 249',
      '226 232 240',
      '203 213 225',
      '148 163 184',
      '100 116 139',
      '71 85 105',
      '51 65 85',
      '30 41 59',
      '15 23 42',
    ],
  },
]

export interface AppSettings {
  theme: ThemeMode
  brandId: string
  defaultOutputFormat: 'html' | 'images' | 'pptx' | 'video'
  backendUrl: string
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'system',
  brandId: 'indigo',
  defaultOutputFormat: 'images',
  backendUrl: '',
}

export const SETTINGS_STORAGE_KEY = 'textbro:settings:v1'

export interface SettingsContextValue {
  settings: AppSettings
  update: (patch: Partial<AppSettings>) => void
  reset: () => void
}

export const SettingsContext = createContext<SettingsContextValue | null>(null)

export function useSettings(): SettingsContextValue {
  const ctx = useContext(SettingsContext)
  if (!ctx) throw new Error('useSettings must be used inside <SettingsProvider>')
  return ctx
}

export function findSwatch(id: string): BrandSwatch {
  return BRAND_SWATCHES.find((s) => s.id === id) ?? BRAND_SWATCHES[0]
}

/**
 * Applies theme (class on <html>) and brand palette (CSS vars on :root) to
 * the document. Called on mount and whenever settings change.
 */
export function applyTheme(settings: AppSettings) {
  const root = document.documentElement

  // Theme class
  const resolved =
    settings.theme === 'system'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      : settings.theme
  root.classList.toggle('dark', resolved === 'dark')

  // Brand palette
  const swatch = findSwatch(settings.brandId)
  const shades = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900] as const
  shades.forEach((shade, i) => {
    root.style.setProperty(`--brand-${shade}`, swatch.scale[i])
  })
}
