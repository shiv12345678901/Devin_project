import type { GenerateSettings } from '../api/types'

/**
 * Visual builder used by the auto-thumbnail panel and the YouTube intro
 * thumbnail slot. Each thumbnail is a fixed-size canvas containing a flat
 * dictionary of absolutely-positioned elements that we draw with the 2D
 * canvas API. The exact same model is rendered server-side later, so any
 * change here must keep the data JSON-serializable (no class instances,
 * no functions).
 */
export type ThumbnailElementType =
  | 'title'
  | 'label'
  | 'heading'
  | 'subtitle'
  | 'chapter-text'
  | 'image'
  | 'panel'
  | 'shape'
  | 'badge'

export type ThumbnailShapeType = 'rectangle' | 'circle' | 'pill' | 'line'

export type CanvasFillType = 'solid' | 'linear' | 'radial'

export interface CanvasFill {
  type: CanvasFillType
  /** Solid color when {@link type} is `solid`; first stop otherwise. */
  color: string
  /** Stops `[from, to]` for linear/radial. */
  colors?: [string, string]
  /** Linear-gradient angle in degrees (0 = top → bottom, 90 = left → right). */
  angle?: number
}

export interface ThumbnailElement {
  id: string
  type: ThumbnailElementType
  posX: number
  posY: number
  width?: number
  height?: number
  zIndex?: number
  rotation?: number
  opacity?: number
  visible?: boolean
  locked?: boolean
  text: string
  fontSize: number
  fontWeight: string
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
  letterSpacing?: number
  /** Text shadow blur radius (px); 0 disables. */
  shadowBlur?: number
  shadowColor?: string
  shadowOffsetY?: number
  /** Outlined text stroke width (px); 0 disables. */
  strokeWidth?: number
  strokeColor?: string
  color: string
  backgroundColor: string
  borderColor: string
  borderWidth: number
  borderRadius: number
  borderStyle?: 'solid' | 'dashed' | 'dotted' | 'none'
  paddingX: number
  paddingY: number
  imageUrl?: string
  imageOffsetX?: number
  imageOffsetY?: number
  imageZoom?: number
  /** Dark gradient overlay drawn on top of an image (0-100, 0=disabled). */
  imageOverlay?: number
  shapeType?: ThumbnailShapeType
}

export interface ThumbnailTemplateState {
  canvasWidth: number
  canvasHeight: number
  /** Solid color shorthand. {@link canvasFill} takes precedence when set. */
  canvasBackground: string
  canvasFill?: CanvasFill
  elements: Record<string, ThumbnailElement>
}

export interface ThumbnailTemplatePreset {
  id: string
  label: string
  description: string
  /** Aspect ratios supported by this preset; first one is default. */
  aspects?: ThumbnailAspectId[]
  build: (settings: GenerateSettings, text: string) => ThumbnailTemplateState
}

export type ThumbnailAspectId = '16:9' | '1:1' | '9:16'

export const THUMBNAIL_ASPECTS: Record<ThumbnailAspectId, { width: number; height: number; label: string; description: string }> = {
  '16:9': { width: 1280, height: 720, label: '16:9 — YouTube', description: '1280 × 720, the standard YouTube thumbnail size' },
  '1:1': { width: 1080, height: 1080, label: '1:1 — Square', description: '1080 × 1080, ideal for Instagram or LinkedIn' },
  '9:16': { width: 1080, height: 1920, label: '9:16 — Shorts', description: '1080 × 1920, for YouTube Shorts / TikTok / Reels' },
}

const DEFAULT_FONT = "'Inter', 'Noto Sans Devanagari', system-ui, Arial, sans-serif"
const DEVANAGARI_FONT = "'Noto Sans Devanagari', 'Inter', system-ui, Arial, sans-serif"

/* ───────────────────────── Preset templates ─────────────────────────── */

function educationClassic(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const className = cleanLine(settings.class_name, 'Class')
  const subject = cleanLine(settings.subject, 'Subject')
  const title = cleanLine(settings.title, 'Chapter')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  const year = cleanLine(settings.auto_thumbnail_year, '2083')
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')

  return {
    canvasWidth: 1280,
    canvasHeight: 720,
    canvasBackground: '#4caf50',
    elements: {
      leftPanel: panel('leftPanel', { posX: 15, posY: 144, width: 665, height: 356, backgroundColor: '#d4e5f7', borderRadius: 8, zIndex: 1 }),
      rightPanel: panel('rightPanel', { posX: 700, posY: 0, width: 580, height: 720, backgroundColor: '#1a1a1a', zIndex: 1 }),
      title: textBox('title', `${className} ${subject}`, {
        type: 'title', posX: 15, posY: 18, width: 665, height: 112,
        fontSize: 70, fontWeight: '900', color: '#000000', backgroundColor: '#ffee00',
        borderRadius: 12, paddingX: 32, paddingY: 10, zIndex: 5, textAlign: 'center',
      }),
      chapterLabel: textBox('chapterLabel', `पाठ ${chapterNum} :`, {
        type: 'label', posX: 190, posY: 188, width: 300, height: 68,
        fontSize: 65, fontWeight: '800', color: '#1a1a3e', fontFamily: DEVANAGARI_FONT,
        zIndex: 2, paddingY: 8, textAlign: 'left',
      }),
      chapterLine1: textBox('chapterLine1', line1 || autoThumbnailSummary(text), {
        type: 'chapter-text', posX: 70, posY: 300, width: 560, height: 125,
        fontSize: 87, fontWeight: '900', color: '#e51c23', zIndex: 5, textAlign: 'center',
      }),
      chapterLine2: textBox('chapterLine2', line2, {
        type: 'chapter-text', posX: 70, posY: 402, width: 560, height: 76,
        fontSize: 74, fontWeight: '900', color: '#e51c23', zIndex: 5, textAlign: 'center',
      }),
      labelNew: textBox('labelNew', `New\n${year}`, {
        type: 'label', posX: 15, posY: 532, width: 287, height: 172,
        fontSize: 62, fontWeight: '800', color: '#ffffff', backgroundColor: '#e51c23',
        borderRadius: 12, paddingX: 32, paddingY: 16, zIndex: 1, textAlign: 'center',
      }),
      labelChapter: textBox('labelChapter', `Chapter\n${chapterNum}`, {
        type: 'label', posX: 324, posY: 536, width: 357, height: 168,
        fontSize: 61, fontWeight: '800', color: '#ffffff', backgroundColor: '#e51c23',
        borderRadius: 12, paddingX: 32, paddingY: 16, zIndex: 1, textAlign: 'center',
      }),
      rightImage: imageBox('rightImage', sideImageUrl, settings, {
        posX: 696, posY: 24, width: 565, height: 680,
        backgroundColor: '#ffffff', borderRadius: 12, zIndex: 3,
      }),
      badgeYear: badge('badgeYear', year, {
        posX: 1150, posY: 10, width: 120, height: 120,
        fontSize: 32, fontWeight: '900', color: '#e51c23', backgroundColor: '#ffee00',
        zIndex: 10,
      }),
      badgeNew: badge('badgeNew', 'New', {
        posX: 1160, posY: 600, width: 100, height: 100,
        fontSize: 28, fontWeight: '900', color: '#e51c23', backgroundColor: '#ffee00',
        zIndex: 10, paddingX: 16, paddingY: 12,
      }),
    },
  }
}

function modernSplit(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const className = cleanLine(settings.class_name, 'Class 10')
  const subject = cleanLine(settings.subject, 'Subject').toUpperCase()
  const title = cleanLine(settings.title, 'Chapter')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  const year = cleanLine(settings.auto_thumbnail_year, '2083')
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')

  return {
    canvasWidth: 1280,
    canvasHeight: 720,
    canvasBackground: '#0f172a',
    canvasFill: { type: 'linear', color: '#0f172a', colors: ['#0f172a', '#1e293b'], angle: 135 },
    elements: {
      leftPanel: panel('leftPanel', {
        posX: 0, posY: 0, width: 720, height: 720,
        backgroundColor: '#1d4ed8', borderRadius: 0, zIndex: 1,
      }),
      classBadge: textBox('classBadge', className.toUpperCase(), {
        type: 'label', posX: 60, posY: 60, width: 260, height: 64,
        fontSize: 32, fontWeight: '800', color: '#1e293b', backgroundColor: '#fde047',
        borderRadius: 999, paddingX: 28, paddingY: 14, letterSpacing: 1.5, zIndex: 5,
      }),
      subject: textBox('subject', subject, {
        type: 'subtitle', posX: 60, posY: 144, width: 600, height: 56,
        fontSize: 36, fontWeight: '700', color: '#bfdbfe', textAlign: 'left',
        letterSpacing: 4, zIndex: 5,
      }),
      title: textBox('title', line1 || title, {
        type: 'title', posX: 60, posY: 220, width: 620, height: 220,
        fontSize: 110, fontWeight: '900', color: '#ffffff', textAlign: 'left',
        zIndex: 6, shadowBlur: 18, shadowColor: 'rgba(0,0,0,0.45)', shadowOffsetY: 4,
      }),
      titleLine2: textBox('titleLine2', line2, {
        type: 'title', posX: 60, posY: 360, width: 620, height: 120,
        fontSize: 90, fontWeight: '900', color: '#fde047', textAlign: 'left', zIndex: 6,
      }),
      chapterTag: textBox('chapterTag', `CHAPTER ${chapterNum}`, {
        type: 'label', posX: 60, posY: 590, width: 320, height: 64,
        fontSize: 30, fontWeight: '800', color: '#0f172a', backgroundColor: '#ffffff',
        borderRadius: 12, paddingX: 24, paddingY: 14, letterSpacing: 4, zIndex: 5,
      }),
      yearTag: textBox('yearTag', year, {
        type: 'label', posX: 400, posY: 590, width: 140, height: 64,
        fontSize: 30, fontWeight: '800', color: '#fde047',
        borderRadius: 12, paddingX: 18, paddingY: 14, letterSpacing: 2, zIndex: 5,
        backgroundColor: 'transparent',
      }),
      rightImage: imageBox('rightImage', sideImageUrl, settings, {
        posX: 720, posY: 0, width: 560, height: 720, borderRadius: 0,
        backgroundColor: '#1e293b', imageOverlay: 35, zIndex: 3,
      }),
      summary: textBox('summary', autoThumbnailSummary(text), {
        type: 'subtitle', posX: 760, posY: 580, width: 480, height: 100,
        fontSize: 28, fontWeight: '600', color: '#ffffff', textAlign: 'left',
        zIndex: 8,
      }),
    },
  }
}

function photoHero(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const subject = cleanLine(settings.subject, 'Topic').toUpperCase()
  const title = cleanLine(settings.title, 'Chapter')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')

  return {
    canvasWidth: 1280,
    canvasHeight: 720,
    canvasBackground: '#0b1120',
    elements: {
      heroImage: imageBox('heroImage', sideImageUrl, settings, {
        posX: 0, posY: 0, width: 1280, height: 720, borderRadius: 0,
        backgroundColor: '#1e293b', imageOverlay: 55, zIndex: 1,
      }),
      accent: panel('accent', {
        posX: 0, posY: 660, width: 1280, height: 60,
        backgroundColor: '#ef4444', zIndex: 5,
      }),
      chapterBadge: textBox('chapterBadge', `CH ${chapterNum}`, {
        type: 'label', posX: 60, posY: 60, width: 200, height: 80,
        fontSize: 38, fontWeight: '900', color: '#0b1120', backgroundColor: '#fde047',
        borderRadius: 16, paddingX: 22, paddingY: 18, letterSpacing: 2, zIndex: 6,
      }),
      subjectBadge: textBox('subjectBadge', subject, {
        type: 'label', posX: 60, posY: 160, width: 360, height: 60,
        fontSize: 28, fontWeight: '700', color: '#ffffff', backgroundColor: 'transparent',
        textAlign: 'left', letterSpacing: 6, zIndex: 6,
      }),
      title: textBox('title', line1 || title, {
        type: 'title', posX: 60, posY: 280, width: 1160, height: 200,
        fontSize: 140, fontWeight: '900', color: '#ffffff', textAlign: 'left',
        zIndex: 7, shadowBlur: 22, shadowColor: 'rgba(0,0,0,0.6)', shadowOffsetY: 6,
        strokeWidth: 0, strokeColor: '#000000',
      }),
      titleLine2: textBox('titleLine2', line2, {
        type: 'title', posX: 60, posY: 460, width: 1160, height: 140,
        fontSize: 120, fontWeight: '900', color: '#fde047', textAlign: 'left',
        zIndex: 7, shadowBlur: 22, shadowColor: 'rgba(0,0,0,0.6)', shadowOffsetY: 6,
      }),
      summary: textBox('summary', autoThumbnailSummary(text), {
        type: 'subtitle', posX: 60, posY: 612, width: 1160, height: 40,
        fontSize: 24, fontWeight: '600', color: '#f1f5f9', textAlign: 'left',
        zIndex: 7,
      }),
    },
  }
}

function boldMinimal(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const subject = cleanLine(settings.subject, 'Topic').toUpperCase()
  const title = cleanLine(settings.title, 'Title')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  return {
    canvasWidth: 1280,
    canvasHeight: 720,
    canvasBackground: '#1d4ed8',
    canvasFill: { type: 'linear', color: '#1d4ed8', colors: ['#1e3a8a', '#2563eb'], angle: 160 },
    elements: {
      ribbon: panel('ribbon', {
        posX: 0, posY: 0, width: 24, height: 720,
        backgroundColor: '#fde047', zIndex: 2,
      }),
      classTag: textBox('classTag', subject, {
        type: 'label', posX: 80, posY: 90, width: 600, height: 60,
        fontSize: 32, fontWeight: '700', color: '#bfdbfe', textAlign: 'left',
        letterSpacing: 8, zIndex: 5,
      }),
      title: textBox('title', line1 || title, {
        type: 'title', posX: 80, posY: 200, width: 1120, height: 220,
        fontSize: 160, fontWeight: '900', color: '#ffffff', textAlign: 'left',
        zIndex: 6, shadowBlur: 16, shadowColor: 'rgba(0,0,0,0.35)', shadowOffsetY: 4,
      }),
      titleLine2: textBox('titleLine2', line2, {
        type: 'title', posX: 80, posY: 380, width: 1120, height: 180,
        fontSize: 140, fontWeight: '900', color: '#fde047', textAlign: 'left',
        zIndex: 6,
      }),
      footer: textBox('footer', autoThumbnailSummary(text), {
        type: 'subtitle', posX: 80, posY: 600, width: 900, height: 56,
        fontSize: 28, fontWeight: '600', color: '#bfdbfe', textAlign: 'left',
        zIndex: 5,
      }),
      chapterDot: textBox('chapterDot', chapterNum, {
        type: 'badge', posX: 1080, posY: 540, width: 140, height: 140,
        fontSize: 80, fontWeight: '900', color: '#1d4ed8', backgroundColor: '#fde047',
        borderRadius: 999, zIndex: 6, textAlign: 'center', paddingY: 30,
      }),
    },
  }
}

function splitCard(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const className = cleanLine(settings.class_name, 'Class')
  const subject = cleanLine(settings.subject, 'Subject')
  const title = cleanLine(settings.title, 'Chapter')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  const year = cleanLine(settings.auto_thumbnail_year, '2083')
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')

  return {
    canvasWidth: 1280,
    canvasHeight: 720,
    canvasBackground: '#fef3c7',
    canvasFill: { type: 'linear', color: '#fef3c7', colors: ['#fde68a', '#fef3c7'], angle: 180 },
    elements: {
      card: panel('card', {
        posX: 40, posY: 40, width: 1200, height: 640,
        backgroundColor: '#ffffff', borderRadius: 24, zIndex: 1,
      }),
      cardBorder: panel('cardBorder', {
        posX: 56, posY: 56, width: 1168, height: 608,
        backgroundColor: 'transparent', borderRadius: 16, zIndex: 1,
        borderColor: '#fbbf24', borderWidth: 4,
      }),
      header: textBox('header', `${className} • ${subject}`, {
        type: 'subtitle', posX: 80, posY: 80, width: 720, height: 60,
        fontSize: 30, fontWeight: '700', color: '#b45309', textAlign: 'left',
        letterSpacing: 4, zIndex: 5,
      }),
      title: textBox('title', line1 || title, {
        type: 'title', posX: 80, posY: 180, width: 720, height: 180,
        fontSize: 110, fontWeight: '900', color: '#7c2d12', textAlign: 'left',
        zIndex: 6,
      }),
      titleLine2: textBox('titleLine2', line2, {
        type: 'title', posX: 80, posY: 340, width: 720, height: 140,
        fontSize: 96, fontWeight: '900', color: '#dc2626', textAlign: 'left',
        zIndex: 6,
      }),
      summary: textBox('summary', autoThumbnailSummary(text), {
        type: 'subtitle', posX: 80, posY: 530, width: 720, height: 90,
        fontSize: 26, fontWeight: '600', color: '#78350f', textAlign: 'left',
        zIndex: 6,
      }),
      rightImage: imageBox('rightImage', sideImageUrl, settings, {
        posX: 820, posY: 100, width: 380, height: 520, borderRadius: 20,
        backgroundColor: '#fef3c7', zIndex: 4,
      }),
      chapterPill: textBox('chapterPill', `CHAPTER ${chapterNum}`, {
        type: 'label', posX: 820, posY: 80, width: 220, height: 56,
        fontSize: 24, fontWeight: '800', color: '#ffffff', backgroundColor: '#dc2626',
        borderRadius: 999, paddingX: 24, paddingY: 14, letterSpacing: 2, zIndex: 7,
      }),
      yearTag: textBox('yearTag', `New ${year}`, {
        type: 'label', posX: 1060, posY: 80, width: 140, height: 56,
        fontSize: 24, fontWeight: '800', color: '#7c2d12', backgroundColor: '#fde047',
        borderRadius: 999, paddingX: 16, paddingY: 14, letterSpacing: 1, zIndex: 7,
      }),
    },
  }
}

export const THUMBNAIL_TEMPLATES: ThumbnailTemplatePreset[] = [
  {
    id: 'education-classic',
    label: 'Education classic',
    description: 'Yellow + red + green textbook layout with chapter labels and side photo.',
    aspects: ['16:9', '1:1'],
    build: educationClassic,
  },
  {
    id: 'modern-split',
    label: 'Modern split',
    description: 'Brand color panel with bold typography and a photo on the right.',
    aspects: ['16:9', '9:16', '1:1'],
    build: modernSplit,
  },
  {
    id: 'photo-hero',
    label: 'Photo hero',
    description: 'Full-bleed photo with a dark gradient and overlaid title.',
    aspects: ['16:9', '9:16', '1:1'],
    build: photoHero,
  },
  {
    id: 'bold-minimal',
    label: 'Bold minimal',
    description: 'Solid gradient background. Big typography, no photo.',
    aspects: ['16:9', '9:16', '1:1'],
    build: boldMinimal,
  },
  {
    id: 'split-card',
    label: 'Split card',
    description: 'Light tinted background with a clean white card and photo.',
    aspects: ['16:9', '1:1'],
    build: splitCard,
  },
]

export const DEFAULT_TEMPLATE_ID = 'education-classic'

export function findTemplatePreset(id: string | undefined | null): ThumbnailTemplatePreset {
  return THUMBNAIL_TEMPLATES.find((t) => t.id === id) ?? THUMBNAIL_TEMPLATES[0]
}

/* ───────────────────────── Element helpers ─────────────────────────── */

type Patch<T> = Partial<T>

function panel(id: string, patch: Patch<ThumbnailElement>): ThumbnailElement {
  return {
    id, type: 'panel', text: '',
    posX: 0, posY: 0, width: 100, height: 100,
    fontSize: 0, fontWeight: '400',
    color: 'transparent',
    backgroundColor: '#ffffff',
    borderColor: 'transparent', borderWidth: 0, borderRadius: 0,
    paddingX: 0, paddingY: 0, zIndex: 1, visible: true,
    ...patch,
  }
}

function textBox(id: string, text: string, patch: Patch<ThumbnailElement>): ThumbnailElement {
  return {
    id, type: 'title', text,
    posX: 0, posY: 0, width: 200, height: 60,
    fontSize: 32, fontWeight: '700',
    color: '#0f172a',
    backgroundColor: 'transparent',
    borderColor: 'transparent', borderWidth: 0, borderRadius: 0,
    paddingX: 16, paddingY: 12, zIndex: 5, visible: true,
    textAlign: 'left',
    fontFamily: DEFAULT_FONT,
    ...patch,
  }
}

function imageBox(
  id: string,
  url: string,
  settings: GenerateSettings,
  patch: Patch<ThumbnailElement>,
): ThumbnailElement {
  return {
    id, type: 'image', text: '',
    posX: 0, posY: 0, width: 400, height: 400,
    fontSize: 0, fontWeight: '400',
    color: '#ffffff',
    backgroundColor: '#f1f5f9',
    borderColor: 'transparent', borderWidth: 0, borderRadius: 12,
    paddingX: 0, paddingY: 0, zIndex: 3, visible: true,
    imageUrl: url || undefined,
    imageOffsetX: settings.auto_thumbnail_image_offset_x ?? 50,
    imageOffsetY: settings.auto_thumbnail_image_offset_y ?? 50,
    imageZoom: settings.auto_thumbnail_image_zoom ?? 100,
    imageOverlay: 0,
    ...patch,
  }
}

function badge(id: string, text: string, patch: Patch<ThumbnailElement>): ThumbnailElement {
  return {
    id, type: 'badge', text,
    posX: 0, posY: 0, width: 120, height: 120,
    fontSize: 32, fontWeight: '900',
    color: '#000000',
    backgroundColor: '#fde047',
    borderColor: 'transparent', borderWidth: 0, borderRadius: 999,
    paddingX: 0, paddingY: 0, zIndex: 8, visible: true, textAlign: 'center',
    ...patch,
  }
}

/* ───────────────────────── Public builder API ──────────────────────── */

export function buildAutoThumbnailTemplate(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const preset = findTemplatePreset(settings.auto_thumbnail_template_id)
  let template = preset.build(settings, text)

  const aspect = settings.auto_thumbnail_canvas_aspect
  if (aspect && aspect in THUMBNAIL_ASPECTS) {
    const target = THUMBNAIL_ASPECTS[aspect]
    if (target.width !== template.canvasWidth || target.height !== template.canvasHeight) {
      template = scaleTemplate(template, target.width / template.canvasWidth, target.height / template.canvasHeight)
    }
  }

  if (settings.auto_thumbnail_canvas_background) {
    template = {
      ...template,
      canvasBackground: settings.auto_thumbnail_canvas_background,
      canvasFill: { type: 'solid', color: settings.auto_thumbnail_canvas_background },
    }
  }

  template = applyTemplateOverrides(template, settings.auto_thumbnail_overrides)
  template = applyAddedElements(template, settings.auto_thumbnail_added_elements)
  template = applyHiddenElements(template, settings.auto_thumbnail_hidden_elements)

  return template
}

function scaleTemplate(template: ThumbnailTemplateState, sx: number, sy: number): ThumbnailTemplateState {
  if (sx === 1 && sy === 1) return template
  const scaleK = (sx + sy) / 2
  const elements: Record<string, ThumbnailElement> = {}
  for (const [id, e] of Object.entries(template.elements)) {
    elements[id] = {
      ...e,
      posX: Math.round(e.posX * sx),
      posY: Math.round(e.posY * sy),
      width: e.width != null ? Math.round(e.width * sx) : e.width,
      height: e.height != null ? Math.round(e.height * sy) : e.height,
      fontSize: Math.round(e.fontSize * scaleK),
      paddingX: Math.round(e.paddingX * sx),
      paddingY: Math.round(e.paddingY * sy),
      borderRadius: Math.round(e.borderRadius * scaleK),
    }
  }
  return {
    ...template,
    canvasWidth: Math.round(template.canvasWidth * sx),
    canvasHeight: Math.round(template.canvasHeight * sy),
    elements,
  }
}

function applyTemplateOverrides(
  template: ThumbnailTemplateState,
  overrides: GenerateSettings['auto_thumbnail_overrides'],
): ThumbnailTemplateState {
  if (!overrides) return template
  const elements = { ...template.elements }
  for (const [id, patch] of Object.entries(overrides)) {
    const current = elements[id]
    if (!current) continue
    elements[id] = { ...current, ...(patch as Partial<ThumbnailElement>) }
  }
  return { ...template, elements }
}

function applyAddedElements(
  template: ThumbnailTemplateState,
  added: GenerateSettings['auto_thumbnail_added_elements'],
): ThumbnailTemplateState {
  if (!added) return template
  const elements = { ...template.elements }
  for (const [id, element] of Object.entries(added)) {
    if (!element) continue
    elements[id] = { ...(element as unknown as ThumbnailElement), id }
  }
  return { ...template, elements }
}

function applyHiddenElements(
  template: ThumbnailTemplateState,
  hidden: GenerateSettings['auto_thumbnail_hidden_elements'],
): ThumbnailTemplateState {
  if (!hidden || hidden.length === 0) return template
  const set = new Set(hidden)
  const elements = { ...template.elements }
  for (const id of set) {
    if (elements[id]) elements[id] = { ...elements[id], visible: false }
  }
  return { ...template, elements }
}

export async function buildAutoThumbnailFile(settings: GenerateSettings, text: string): Promise<File> {
  const template = buildAutoThumbnailTemplate(settings, text)
  const blob = await renderTemplateToBlob(template, 1.5)
  const safeTitle = cleanLine(settings.title, 'thumbnail').replace(/[^A-Za-z0-9._-]+/g, '_').slice(0, 40)
  return new File([blob], `auto_${safeTitle || 'thumbnail'}.png`, { type: 'image/png' })
}

export async function renderTemplateToBlob(
  template: ThumbnailTemplateState,
  pixelRatio = 1,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(template.canvasWidth * pixelRatio)
  canvas.height = Math.round(template.canvasHeight * pixelRatio)
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is not available in this browser')
  ctx.scale(pixelRatio, pixelRatio)
  const images = await loadTemplateImages(template)
  renderTemplate(ctx, template, images)
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob)
      else reject(new Error('Could not render thumbnail image'))
    }, 'image/png')
  })
}

export async function renderTemplateToDataUrl(
  template: ThumbnailTemplateState,
  pixelRatio = 1,
): Promise<string> {
  const blob = await renderTemplateToBlob(template, pixelRatio)
  return await new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(reader.error ?? new Error('Could not read blob'))
    reader.readAsDataURL(blob)
  })
}

async function loadTemplateImages(
  template: ThumbnailTemplateState,
): Promise<Record<string, HTMLImageElement>> {
  const entries = await Promise.all(
    Object.values(template.elements)
      .filter((e) => e.type === 'image' && e.imageUrl)
      .map(async (e) => {
        try {
          return [e.id, await loadImage(e.imageUrl!)] as const
        } catch {
          return null
        }
      }),
  )
  return Object.fromEntries(entries.filter(Boolean) as Array<readonly [string, HTMLImageElement]>)
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.crossOrigin = 'anonymous'
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load thumbnail side image'))
    image.src = src
  })
}

/* ───────────────────────── Canvas drawing ──────────────────────────── */

function renderTemplate(
  ctx: CanvasRenderingContext2D,
  template: ThumbnailTemplateState,
  images: Record<string, HTMLImageElement>,
) {
  paintCanvasBackground(ctx, template)
  const elements = Object.values(template.elements)
    .filter((e) => e.visible !== false)
    .sort((a, b) => (a.zIndex ?? 5) - (b.zIndex ?? 5))

  for (const e of elements) {
    ctx.save()
    ctx.globalAlpha = (e.opacity ?? 100) / 100
    if (e.rotation) {
      const centerX = e.posX + (e.width ?? 0) / 2
      const centerY = e.posY + (e.height ?? 0) / 2
      ctx.translate(centerX, centerY)
      ctx.rotate((e.rotation * Math.PI) / 180)
      ctx.translate(-centerX, -centerY)
    }
    drawElement(ctx, e, images[e.id])
    ctx.restore()
  }
}

function paintCanvasBackground(ctx: CanvasRenderingContext2D, template: ThumbnailTemplateState) {
  const fill = template.canvasFill ?? { type: 'solid' as const, color: template.canvasBackground }
  if (fill.type === 'solid') {
    ctx.fillStyle = fill.color
  } else if (fill.type === 'linear') {
    const [a, b] = fill.colors ?? [fill.color, fill.color]
    const angle = ((fill.angle ?? 180) % 360) * (Math.PI / 180)
    const w = template.canvasWidth
    const h = template.canvasHeight
    const dx = Math.sin(angle) * w
    const dy = -Math.cos(angle) * h
    const cx = w / 2
    const cy = h / 2
    const grad = ctx.createLinearGradient(cx - dx / 2, cy - dy / 2, cx + dx / 2, cy + dy / 2)
    grad.addColorStop(0, a)
    grad.addColorStop(1, b)
    ctx.fillStyle = grad
  } else {
    const [a, b] = fill.colors ?? [fill.color, fill.color]
    const cx = template.canvasWidth / 2
    const cy = template.canvasHeight / 2
    const r = Math.max(template.canvasWidth, template.canvasHeight) * 0.7
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    grad.addColorStop(0, a)
    grad.addColorStop(1, b)
    ctx.fillStyle = grad
  }
  ctx.fillRect(0, 0, template.canvasWidth, template.canvasHeight)
}

function drawElement(
  ctx: CanvasRenderingContext2D,
  e: ThumbnailElement,
  image: HTMLImageElement | undefined,
) {
  if (e.type === 'image') {
    drawImageElement(ctx, e, image)
    return
  }
  if (e.type === 'panel' || e.type === 'shape') {
    drawShape(ctx, e)
    return
  }
  if (e.type === 'badge') {
    drawBadge(ctx, e)
    return
  }
  drawTextBox(ctx, e)
}

function drawShape(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  const w = e.width ?? 0
  const h = e.height ?? 0
  const shape = e.shapeType ?? 'rectangle'
  const drawPath = () => {
    if (shape === 'circle') {
      ctx.beginPath()
      ctx.ellipse(e.posX + w / 2, e.posY + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.closePath()
    } else if (shape === 'pill') {
      const r = Math.min(w, h) / 2
      roundedRect(ctx, e.posX, e.posY, w, h, r)
    } else if (shape === 'line') {
      ctx.beginPath()
      ctx.moveTo(e.posX, e.posY + h / 2)
      ctx.lineTo(e.posX + w, e.posY + h / 2)
      ctx.closePath()
    } else {
      roundedRect(ctx, e.posX, e.posY, w, h, e.borderRadius)
    }
  }
  if (e.backgroundColor && e.backgroundColor !== 'transparent') {
    drawPath()
    ctx.fillStyle = e.backgroundColor
    ctx.fill()
  }
  if (e.borderWidth > 0 && e.borderColor && e.borderColor !== 'transparent') {
    drawPath()
    ctx.strokeStyle = e.borderColor
    ctx.lineWidth = shape === 'line' ? Math.max(2, e.borderWidth) : e.borderWidth
    ctx.stroke()
  }
}

function fillBox(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  if (e.backgroundColor === 'transparent' || !e.backgroundColor) return
  ctx.fillStyle = e.backgroundColor
  roundedRect(ctx, e.posX, e.posY, e.width ?? 0, e.height ?? 0, e.borderRadius)
  ctx.fill()
  if (e.borderWidth > 0 && e.borderColor && e.borderColor !== 'transparent') {
    ctx.strokeStyle = e.borderColor
    ctx.lineWidth = e.borderWidth
    roundedRect(ctx, e.posX, e.posY, e.width ?? 0, e.height ?? 0, e.borderRadius)
    ctx.stroke()
  }
}

function drawImageElement(
  ctx: CanvasRenderingContext2D,
  e: ThumbnailElement,
  image?: HTMLImageElement,
) {
  if (!image) {
    drawImagePlaceholder(ctx, e)
    return
  }
  const x = e.posX
  const y = e.posY
  const width = e.width ?? 0
  const height = e.height ?? 0
  ctx.save()
  roundedRect(ctx, x, y, width, height, e.borderRadius)
  ctx.clip()
  ctx.fillStyle = e.backgroundColor || '#ffffff'
  ctx.fillRect(x, y, width, height)
  const zoom = (e.imageZoom ?? 100) / 100
  const scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom
  const drawWidth = image.naturalWidth * scale
  const drawHeight = image.naturalHeight * scale
  const offsetX = ((e.imageOffsetX ?? 50) / 100) * (width - drawWidth)
  const offsetY = ((e.imageOffsetY ?? 50) / 100) * (height - drawHeight)
  ctx.drawImage(image, x + offsetX, y + offsetY, drawWidth, drawHeight)
  if (e.imageOverlay && e.imageOverlay > 0) {
    const grad = ctx.createLinearGradient(x, y, x, y + height)
    grad.addColorStop(0, `rgba(15, 23, 42, ${(e.imageOverlay / 100) * 0.2})`)
    grad.addColorStop(1, `rgba(15, 23, 42, ${(e.imageOverlay / 100) * 0.85})`)
    ctx.fillStyle = grad
    ctx.fillRect(x, y, width, height)
  }
  ctx.restore()
}

function drawTextBox(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  if (e.backgroundColor && e.backgroundColor !== 'transparent') fillBox(ctx, e)
  const fontFamily = e.fontFamily ?? DEFAULT_FONT
  const align = e.textAlign ?? (e.width ? 'center' : 'left')
  ctx.textAlign = align
  ctx.textBaseline = 'top'
  const lines = e.text.split('\n')
  const maxWidth = Math.max(1, (e.width ?? 0) - e.paddingX * 2)
  let fontSize = e.fontSize
  if (e.width) {
    const minFontSize = Math.max(14, e.fontSize * 0.4)
    while (fontSize > minFontSize) {
      ctx.font = `${e.fontWeight} ${fontSize}px ${fontFamily}`
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 0)
      const totalHeight = lines.length * fontSize * 1.08
      if (widest <= maxWidth && (!e.height || totalHeight <= e.height - e.paddingY * 2)) break
      fontSize -= 2
    }
  }
  ctx.font = `${e.fontWeight} ${fontSize}px ${fontFamily}`
  if (e.letterSpacing) {
    // Browsers: Canvas2D `letterSpacing` is supported in modern engines; fall
    // back gracefully where it isn't recognized.
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${e.letterSpacing}px`
    } catch {
      // ignore unsupported letterSpacing setter
    }
  }
  const x =
    align === 'left'
      ? e.posX + e.paddingX
      : align === 'right'
        ? e.posX + (e.width ?? 0) - e.paddingX
        : e.posX + (e.width ?? 0) / 2
  const lineHeight = fontSize * 1.08
  const totalHeight = lines.length * lineHeight
  const y =
    e.height && e.height > totalHeight
      ? e.posY + (e.height - totalHeight) / 2
      : e.posY + e.paddingY

  if (e.shadowBlur && e.shadowBlur > 0) {
    ctx.shadowColor = e.shadowColor || 'rgba(0,0,0,0.5)'
    ctx.shadowBlur = e.shadowBlur
    ctx.shadowOffsetY = e.shadowOffsetY ?? 0
  }

  if (e.strokeWidth && e.strokeWidth > 0) {
    ctx.strokeStyle = e.strokeColor || '#000000'
    ctx.lineWidth = e.strokeWidth
    ctx.lineJoin = 'round'
    lines.forEach((line, index) => {
      ctx.strokeText(line, x, y + index * lineHeight)
    })
  }

  ctx.fillStyle = e.color
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })

  ctx.shadowBlur = 0
  ctx.shadowOffsetY = 0
}

function drawImagePlaceholder(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  fillBox(ctx, e)
  const x = e.posX
  const y = e.posY
  const width = e.width ?? 0
  const height = e.height ?? 0
  ctx.save()
  roundedRect(ctx, x, y, width, height, e.borderRadius)
  ctx.clip()
  // Soft tinted background
  const grad = ctx.createLinearGradient(x, y, x + width, y + height)
  grad.addColorStop(0, '#e2e8f0')
  grad.addColorStop(1, '#cbd5e1')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, width, height)
  // Generic mountain + sun glyph
  ctx.fillStyle = '#94a3b8'
  ctx.beginPath()
  ctx.arc(x + width * 0.3, y + height * 0.32, Math.min(width, height) * 0.08, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.moveTo(x + width * 0.15, y + height * 0.78)
  ctx.lineTo(x + width * 0.4, y + height * 0.45)
  ctx.lineTo(x + width * 0.55, y + height * 0.6)
  ctx.lineTo(x + width * 0.75, y + height * 0.35)
  ctx.lineTo(x + width * 0.95, y + height * 0.78)
  ctx.closePath()
  ctx.fill()
  // "Add image" hint
  ctx.fillStyle = '#475569'
  ctx.font = '600 22px Inter, system-ui, Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('Add image', x + width / 2, y + height * 0.9)
  ctx.restore()
}

function drawBadge(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  const w = e.width ?? 120
  const h = e.height ?? w
  const cx = e.posX + w / 2
  const cy = e.posY + h / 2
  ctx.fillStyle = e.backgroundColor || '#fde047'
  if ((e.borderRadius ?? 0) >= Math.min(w, h) / 2) {
    ctx.beginPath()
    ctx.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2)
    ctx.fill()
  } else if (e.borderRadius && e.borderRadius > 0) {
    roundedRect(ctx, e.posX, e.posY, w, h, e.borderRadius)
    ctx.fill()
  } else {
    drawStarburst(ctx, cx, cy, Math.min(w, h) / 2)
    ctx.fill()
  }
  if (!e.text) return
  ctx.font = `${e.fontWeight} ${e.fontSize}px ${e.fontFamily ?? DEFAULT_FONT}`
  ctx.fillStyle = e.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  e.text.split('\n').forEach((line, idx, arr) => {
    const totalH = arr.length * e.fontSize * 1.1
    ctx.fillText(line, cx, cy - totalH / 2 + (idx + 0.5) * e.fontSize * 1.1)
  })
}

function drawStarburst(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number) {
  const points = 14
  const innerR = outerR * 0.78
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2
    const radius = i % 2 === 0 ? outerR : innerR
    const x = cx + radius * Math.cos(angle)
    const y = cy + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(Math.max(radius, 0), Math.min(width, height) / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

/* ───────────────────────── Text utilities ──────────────────────────── */

function cleanLine(value: string | undefined, fallback: string): string {
  const line = (value ?? '').replace(/\s+/g, ' ').trim()
  return line || fallback
}

function splitTitle(title: string): [string, string] {
  const normalized = title.replace(/\u2013|\u2014/g, '-')
  const words = normalized.replace(/^Chapter\s*\d+\s*[-:]?\s*/i, '').split(/\s+/).filter(Boolean)
  if (words.length <= 2) return [words.join(' '), '']
  const mid = Math.ceil(words.length / 2)
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')]
}

function autoThumbnailSummary(text: string): string {
  const firstUsefulLine =
    text
      .split(/\r?\n/)
      .map((line) => line.replace(/^[\s#>*\-0-9.)]+/, '').trim())
      .find((line) => line.length > 16) ?? text.replace(/\s+/g, ' ').trim()
  return firstUsefulLine.slice(0, 60)
}

/* ───────────────────────── New element factories ───────────────────── */

export function createTextElement(id: string, label = 'New text'): ThumbnailElement {
  return textBox(id, label, {
    type: 'title', posX: 100, posY: 100, width: 360, height: 90,
    fontSize: 56, fontWeight: '800', color: '#0f172a',
    textAlign: 'center', backgroundColor: 'transparent',
  })
}

export function createHeadingElement(id: string): ThumbnailElement {
  return textBox(id, 'HEADLINE', {
    type: 'title', posX: 80, posY: 80, width: 700, height: 160,
    fontSize: 110, fontWeight: '900', color: '#0f172a',
    textAlign: 'left', backgroundColor: 'transparent',
  })
}

export function createSubtitleElement(id: string): ThumbnailElement {
  return textBox(id, 'Subtitle text', {
    type: 'subtitle', posX: 80, posY: 240, width: 600, height: 64,
    fontSize: 32, fontWeight: '600', color: '#475569',
    textAlign: 'left', backgroundColor: 'transparent',
  })
}

export function createShapeElement(id: string, shape: ThumbnailShapeType = 'rectangle'): ThumbnailElement {
  return panel(id, {
    type: 'shape', shapeType: shape,
    posX: 100, posY: 100, width: 200, height: 200,
    backgroundColor: '#3b82f6', borderRadius: shape === 'circle' || shape === 'pill' ? 999 : 16,
    zIndex: 4,
  })
}

export function createBadgeElement(id: string, text = 'New'): ThumbnailElement {
  return badge(id, text, {
    posX: 1100, posY: 40, width: 140, height: 140,
    fontSize: 38, fontWeight: '900', color: '#1e293b',
    backgroundColor: '#fde047', borderRadius: 999, zIndex: 9,
  })
}

export function createImageElement(id: string): ThumbnailElement {
  return imageBox(id, '', {}, {
    posX: 200, posY: 150, width: 400, height: 400, borderRadius: 24,
  })
}

export function duplicateElement(source: ThumbnailElement, newId: string): ThumbnailElement {
  return {
    ...source,
    id: newId,
    posX: source.posX + 24,
    posY: source.posY + 24,
    zIndex: (source.zIndex ?? 5) + 1,
  }
}

export function nextElementId(prefix: string): string {
  const random = Math.random().toString(36).slice(2, 7)
  return `${prefix}_${Date.now().toString(36)}_${random}`
}
