import type { GenerateSettings } from '../api/types'

/**
 * Auto thumbnail builder for the Text-to-Video pipeline.
 *
 * One opinionated 1280×720 layout — the "Education Classic" theme —
 * rendered into a flat, JSON-serializable element tree. Users can:
 *   - tweak any preset element (`auto_thumbnail_overrides`)
 *   - hide preset elements (`auto_thumbnail_hidden_elements`)
 *   - add their own elements on top (`auto_thumbnail_added_elements`)
 *
 * The visual editor in `pages/TextToVideo.tsx` mutates exactly those three
 * fields, and the run pipeline picks them back up here at "Use it" time.
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
  /** How the image is sized inside its element box. `cover` (default)
   * scales-and-crops to fill the box, `contain` shows the whole image with
   * letterboxing, `stretch` ignores aspect ratio. */
  imageFitMode?: 'cover' | 'contain' | 'stretch'
  /** Dark gradient overlay drawn on top of an image (0-100, 0=disabled). */
  imageOverlay?: number
  shapeType?: ThumbnailShapeType
}

export interface ThumbnailTemplateState {
  canvasWidth: number
  canvasHeight: number
  canvasBackground: string
  elements: Record<string, ThumbnailElement>
}

export interface AutoThumbnailMetadata {
  className: string
  subject: string
  topic: string
  prefix: string
  num: string
  year: string
}

const TEMPLATE_BASE_WIDTH = 1280
const TEMPLATE_BASE_HEIGHT = 720

export const THUMBNAIL_CANVAS_WIDTH = 1920
export const THUMBNAIL_CANVAS_HEIGHT = 1080

const HEADING_FONT = "'Inter', 'Noto Sans Devanagari', system-ui, Arial, sans-serif"
const DEVANAGARI_FONT = "'Noto Sans Devanagari', 'Tiro Devanagari Sanskrit', 'Inter', system-ui, Arial, sans-serif"
const DEVANAGARI_DISPLAY_FONT = "'Tiro Devanagari Sanskrit', 'Noto Sans Devanagari', 'Inter', system-ui, Arial, sans-serif"

/** Devanagari Unicode block (0900–097F). Used to auto-pick a script-aware
 * font stack so user-typed Hindi/Nepali text actually renders correctly
 * inside the canvas, instead of falling back to a Latin-only face. */
const DEVANAGARI_RE = /[\u0900-\u097F]/

function hasDevanagari(text: string | undefined): boolean {
  return !!text && DEVANAGARI_RE.test(text)
}

/** Pick the right font stack for a given text element. Display script
 * (`Tiro`) is reserved for the dedicated chapter-label slot since it has
 * very high contrast and reads well only at large sizes. */
function fontFor(text: string, kind: 'body' | 'display' = 'body'): string {
  if (!hasDevanagari(text)) return HEADING_FONT
  return kind === 'display' ? DEVANAGARI_DISPLAY_FONT : DEVANAGARI_FONT
}

/* Education Classic palette — handpicked so backgrounds, badges, and
 * text stay readable next to each other.  Tweaking these here
 * automatically updates every freshly-generated thumbnail. */
const PALETTE = {
  canvas: '#4caf50',
  leftPanel: '#d4e5f7',
  rightPanel: '#1a1a1a',
  headerBg: '#ffee00',
  headerText: '#000000',
  chapterLabel: '#1a1a3e',
  chapterText: '#e51c23',
  pillBg: '#e51c23',
  pillText: '#ffffff',
  badgeBg: '#ffee00',
  badgeText: '#e51c23',
  imageFrame: '#111111',
  imageShadow: 'rgba(0, 0, 0, 0.35)',
}

/* ─────────────────────────── Education Classic ─────────────────────── */

export function buildAutoThumbnailTemplate(
  settings: GenerateSettings,
  text: string,
): ThumbnailTemplateState {
  let template = educationClassic(settings, text)
  if (settings.auto_thumbnail_canvas_background) {
    template = { ...template, canvasBackground: settings.auto_thumbnail_canvas_background }
  }
  template = applyTemplateOverrides(template, settings.auto_thumbnail_overrides)
  template = applyAddedElements(template, settings.auto_thumbnail_added_elements)
  template = applyHiddenElements(template, settings.auto_thumbnail_hidden_elements)
  return template
}

function educationClassic(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const meta = detectAutoThumbnailMetadata(text, settings)
  const { className, subject, topic, prefix: chapterPrefix, num: chapterNum, year } = meta
  const [line1, line2, line3] = splitTitle(topic)
  // Auto-detect "Unit 3" / "Chapter 1" / "पाठ ४" etc. from the title and
  // body text so the thumbnail renders the right prefix + number even when
  // the user hasn't manually populated `auto_thumbnail_chapter_num` /
  // `auto_thumbnail_chapter_prefix`. Manual overrides always win.
  /* Legacy detection is superseded by detectAutoThumbnailMetadata().
  const chapterNum = cleanLine(
    settings.auto_thumbnail_chapter_num,
    detected?.num ?? title.match(/\d+/)?.[0] ?? '1',
  )
  const year = cleanLine(settings.auto_thumbnail_year, '2083')
  const chapterPrefix = cleanLine(
    settings.auto_thumbnail_chapter_prefix,
    detected?.prefix ?? 'पाठ',
  )
  */
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')

  return {
    canvasWidth: THUMBNAIL_CANVAS_WIDTH,
    canvasHeight: THUMBNAIL_CANVAS_HEIGHT,
    canvasBackground: PALETTE.canvas,
    elements: autoFitTextElements(scaleTemplateElements({
      /* Cream card behind the title block — gives the red headline a
       * high-contrast surface to sit on. */
      leftPanel: panel('leftPanel', {
        posX: 15, posY: 144, width: 665, height: 356,
        backgroundColor: PALETTE.leftPanel,
        borderColor: '#ffffff',
        borderStyle: 'dashed',
        borderRadius: 8,
        zIndex: 1,
      }),
      /* Yellow header bar — class & subject label. */
      rightPanel: panel('rightPanel', {
        posX: 700, posY: 0, width: 580, height: 720,
        backgroundColor: PALETTE.rightPanel,
        zIndex: 1,
      }),
      title: textBox('title', `${className} ${subject}`, {
        type: 'title', posX: 13, posY: 18, width: 665, height: 96,
        fontSize: 75, fontWeight: '900', color: PALETTE.headerText,
        fontFamily: fontFor(`${className} ${subject}`),
        backgroundColor: PALETTE.headerBg, borderRadius: 12,
        paddingX: 0, paddingY: 10, zIndex: 5, textAlign: 'center',
      }),
      /* "पाठ N :" Devanagari label sitting on the cream card. */
      chapterLabel: textBox('chapterLabel', `${chapterPrefix} ${chapterNum} :`, {
        type: 'label', posX: 23, posY: 163, width: 230, height: 84,
        fontSize: 65, fontWeight: '800', color: PALETTE.chapterLabel,
        fontFamily: fontFor(chapterPrefix, 'display'), textAlign: 'left',
        backgroundColor: 'transparent', paddingX: 0, paddingY: 8,
        zIndex: 2,
      }),
      /* Chapter title — split across two lines for readability. */
      chapterLine1: textBox('chapterLine1', [line1, line2, line3].filter(Boolean).join('\n') || autoThumbnailSummary(text), {
        type: 'chapter-text', posX: 44, posY: 260, width: 614, height: 205,
        fontSize: 88, fontWeight: '900', color: PALETTE.chapterText,
        fontFamily: fontFor(topic || autoThumbnailSummary(text)),
        textAlign: 'center', backgroundColor: 'transparent',
        zIndex: 5,
      }),
      chapterLine2: textBox('chapterLine2', '', {
        type: 'chapter-text', posX: 44, posY: 279, width: 614, height: 82,
        fontSize: 75, fontWeight: '900', color: PALETTE.chapterText,
        fontFamily: fontFor(line2),
        textAlign: 'center', backgroundColor: 'transparent',
        zIndex: 5,
      }),
      /* Single chapter pill at the bottom — replaces the previous stack of
       * red boxes that fought each other for attention. */
      chapterLine3: textBox('chapterLine3', '', {
        type: 'chapter-text', posX: 46, posY: 379, width: 614, height: 82,
        fontSize: 75, fontWeight: '900', color: PALETTE.chapterText,
        fontFamily: fontFor(line3),
        textAlign: 'center', backgroundColor: 'transparent',
        zIndex: 4,
      }),
      labelNew: textBox('labelNew', `New\n${year}`, {
        type: 'label', posX: 15, posY: 517, width: 287, height: 133,
        fontSize: 62, fontWeight: '800', color: PALETTE.pillText,
        backgroundColor: PALETTE.pillBg, borderRadius: 12,
        paddingX: 0, paddingY: 16, zIndex: 4, textAlign: 'center',
      }),
      labelChapter: textBox('labelChapter', `${chapterPrefix}\n${chapterNum}`, {
        type: 'label', posX: 324, posY: 520, width: 357, height: 115,
        fontSize: 61, fontWeight: '800', color: PALETTE.pillText,
        backgroundColor: PALETTE.pillBg, borderRadius: 12,
        paddingX: 0, paddingY: 16, zIndex: 4, textAlign: 'center',
      }),
      /* Side photo with rounded frame and subtle shadow. */
      rightImage: imageBox('rightImage', sideImageUrl, settings, {
        posX: 696, posY: 24, width: 565, height: 680,
        backgroundColor: PALETTE.imageFrame, borderRadius: 12,
        zIndex: 3,
      }),
      /* Single yellow starburst with the year — the visual anchor in the
       * top-right that sells the "new edition" framing. */
      badgeYear: badge('badgeYear', year, {
        posX: 1150, posY: 10, width: 120, height: 120,
        fontSize: 32, fontWeight: '900', color: PALETTE.badgeText,
        backgroundColor: PALETTE.badgeBg, borderRadius: 0,
        paddingX: 20, paddingY: 16, zIndex: 10,
      }),
      badgeNew: badge('badgeNew', 'New', {
        posX: 1160, posY: 600, width: 100, height: 100,
        fontSize: 28, fontWeight: '900', color: PALETTE.badgeText,
        backgroundColor: PALETTE.badgeBg, borderRadius: 0,
        paddingX: 16, paddingY: 12, zIndex: 10,
      }),
    })),
  }
}

/* ───────────────────────── Element factories ───────────────────────── */

function scaleTemplateElements(
  elements: Record<string, ThumbnailElement>,
): Record<string, ThumbnailElement> {
  const scaleX = THUMBNAIL_CANVAS_WIDTH / TEMPLATE_BASE_WIDTH
  const scaleY = THUMBNAIL_CANVAS_HEIGHT / TEMPLATE_BASE_HEIGHT
  const scaleRadius = (scaleX + scaleY) / 2

  return Object.fromEntries(
    Object.entries(elements).map(([id, element]) => [
      id,
      {
        ...element,
        posX: Math.round(element.posX * scaleX),
        posY: Math.round(element.posY * scaleY),
        width: element.width === undefined ? undefined : Math.round(element.width * scaleX),
        height: element.height === undefined ? undefined : Math.round(element.height * scaleY),
        fontSize: Math.round(element.fontSize * scaleY),
        borderRadius: Math.round(element.borderRadius * scaleRadius),
        paddingX: Math.round(element.paddingX * scaleX),
        paddingY: Math.round(element.paddingY * scaleY),
      },
    ]),
  )
}

/** Shrink each text element's font-size until its content fits the box.
 * Runs once at template-build time so both the canvas renderer and the
 * live DOM preview see the same fitted size. Per-line measurement uses an
 * offscreen 2-D context — same metrics the saved PNG eventually uses. */
function autoFitTextElements(
  elements: Record<string, ThumbnailElement>,
): Record<string, ThumbnailElement> {
  // SSR / non-DOM environments: skip and return the elements unchanged.
  if (typeof document === 'undefined') return elements
  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  if (!ctx) return elements

  return Object.fromEntries(
    Object.entries(elements).map(([id, element]) => {
      const isText =
        element.type !== 'panel' &&
        element.type !== 'shape' &&
        element.type !== 'image'
      if (!isText || !element.width || !element.text) return [id, element]

      const maxWidth = Math.max(1, element.width - element.paddingX * 2)
      const maxHeight = element.height
        ? Math.max(1, element.height - element.paddingY * 2)
        : Infinity
      const fontFamily = element.fontFamily ?? HEADING_FONT
      const lines = element.text.split('\n')

      const fits = (size: number): boolean => {
        ctx.font = `${element.fontWeight} ${size}px ${fontFamily}`
        const widest = Math.max(
          ...lines.map((line) => ctx.measureText(line).width),
          0,
        )
        const totalHeight = lines.length * size * 1.08
        return widest <= maxWidth && totalHeight <= maxHeight
      }

      const minSize = Math.max(14, Math.round(element.fontSize * 0.4))
      let size = element.fontSize
      // Step in 2-px decrements until the element fits or we hit the floor.
      while (size > minSize && !fits(size)) size -= 2
      // Last resort: clamp anyway so we never write a wider-than-box text.
      if (size === minSize && !fits(minSize)) size = minSize
      if (size === element.fontSize) return [id, element]
      return [id, { ...element, fontSize: size }]
    }),
  )
}

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
    fontFamily: HEADING_FONT,
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
    color: PALETTE.badgeText,
    backgroundColor: PALETTE.badgeBg,
    borderColor: 'transparent', borderWidth: 0, borderRadius: 0,
    paddingX: 0, paddingY: 0, zIndex: 8, visible: true, textAlign: 'center',
    ...patch,
  }
}

/* ───────────────────────── Override pipeline ───────────────────────── */

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

/* ───────────────────────── Public render API ───────────────────────── */

/** Slug-style filename from class/subject/chapter so saved thumbnails are
 * recognisable on disk (e.g. "class10-nepali-ch2-thumbnail.png") instead
 * of a UUID. Falls back to the title or a generic name. */
export function autoThumbnailFilename(settings: GenerateSettings): string {
  const slug = (s: string | undefined) =>
    (s ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
  const className = slug(settings.class_name)
  const subject = slug(settings.subject)
  const chapterNum = (settings.auto_thumbnail_chapter_num ?? '')
    .replace(/[^A-Za-z0-9]+/g, '')
    .slice(0, 6)
  const titleSlug = slug(settings.title)
  const parts = [
    className && `class${className}`,
    subject || null,
    chapterNum && `ch${chapterNum}`,
    !className && !subject && !chapterNum ? titleSlug || 'thumbnail' : null,
    'thumbnail',
  ].filter(Boolean) as string[]
  return `${parts.join('-')}.png`
}

export async function buildAutoThumbnailFile(
  settings: GenerateSettings,
  text: string,
  pixelRatio = 1.5,
): Promise<File> {
  const template = buildAutoThumbnailTemplate(settings, text)
  const blob = await renderTemplateToBlob(template, pixelRatio)
  return new File([blob], autoThumbnailFilename(settings), { type: 'image/png' })
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
  // Wait for webfonts (Inter, Noto Sans Devanagari, Tiro) to load before
  // measuring/drawing — otherwise the first render falls back to a system
  // sans and the saved PNG looks different from the editor's live preview.
  if (typeof document !== 'undefined' && document.fonts?.ready) {
    try {
      await document.fonts.ready
    } catch {
      /* font readiness is best-effort */
    }
  }
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
  ctx.fillStyle = template.canvasBackground
  ctx.fillRect(0, 0, template.canvasWidth, template.canvasHeight)

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
  // Subtle drop shadow that gives the framed photo depth on the green canvas.
  ctx.shadowColor = PALETTE.imageShadow
  ctx.shadowBlur = 24
  ctx.shadowOffsetY = 8
  roundedRect(ctx, x, y, width, height, e.borderRadius)
  ctx.fillStyle = e.backgroundColor || '#ffffff'
  ctx.fill()
  ctx.restore()

  ctx.save()
  roundedRect(ctx, x, y, width, height, e.borderRadius)
  ctx.clip()
  const zoom = (e.imageZoom ?? 100) / 100
  const fitMode = e.imageFitMode ?? 'cover'
  let scale: number
  if (fitMode === 'stretch') {
    // Stretch: ignore aspect ratio entirely. Zoom still applies.
    scale = 1
  } else if (fitMode === 'contain') {
    // Contain: shrink so the whole image fits inside the box.
    scale = Math.min(width / image.naturalWidth, height / image.naturalHeight) * zoom
  } else {
    // Cover (default): scale so the image fully fills the box, cropping
    // whichever axis is excess.
    scale = Math.max(width / image.naturalWidth, height / image.naturalHeight) * zoom
  }
  const drawWidth = fitMode === 'stretch' ? width * zoom : image.naturalWidth * scale
  const drawHeight = fitMode === 'stretch' ? height * zoom : image.naturalHeight * scale
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
  const fontFamily = e.fontFamily ?? HEADING_FONT
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
    try {
      (ctx as CanvasRenderingContext2D & { letterSpacing?: string }).letterSpacing = `${e.letterSpacing}px`
    } catch {
      // Browsers without Canvas2D letterSpacing support just render flush text.
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
  // Soft tinted background so the placeholder reads as "image area" and not
  // an empty white box.
  const grad = ctx.createLinearGradient(x, y, x + width, y + height)
  grad.addColorStop(0, '#e2e8f0')
  grad.addColorStop(1, '#cbd5e1')
  ctx.fillStyle = grad
  ctx.fillRect(x, y, width, height)
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
  ctx.fillStyle = e.backgroundColor || PALETTE.badgeBg
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
  ctx.font = `${e.fontWeight} ${e.fontSize}px ${e.fontFamily ?? HEADING_FONT}`
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

// ─── Chapter / unit auto-detection ─────────────────────────────────────
//
// Extract a "Unit N" / "Chapter N" / "पाठ ४" reference from the user's
// project info + body text so the auto-thumbnail renderer can pick the
// right prefix and number when neither is set explicitly.
//
// First match wins, in priority order: numeric English forms first
// (unambiguous), then Devanagari fallbacks. The regex on Devanagari
// "अध्याय" rejects suffixed forms like "अध्यायको" so they don't match the
// bare word.
const CHAPTER_PATTERNS: ReadonlyArray<{ prefix: string; re: RegExp }> = [
  { prefix: 'Unit', re: /\bunit[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'Chapter', re: /\bchapter[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'Lesson', re: /\blesson[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'Section', re: /\bsection[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'Part', re: /\b(?:part|pt\.?)[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'Chapter', re: /\bch\.?[\s\-_:.]*([0-9]{1,3})\b/i },
  { prefix: 'पाठ', re: /पाठ[\s\-_:.]*([0-9\u0966-\u096F]{1,3})/ },
  { prefix: 'एकाइ', re: /एकाइ[\s\-_:.]*([0-9\u0966-\u096F]{1,3})/ },
  { prefix: 'अध्याय', re: /अध्याय(?![\u0900-\u097F])[\s\-_:.]*([0-9\u0966-\u096F]{1,3})/ },
]

export function detectChapterMeta(
  text: string,
  settings: GenerateSettings,
): { prefix: string; num: string } | null {
  const haystacks = [
    settings.title ?? '',
    settings.subject ?? '',
    settings.class_name ?? '',
    text.slice(0, 800),
  ]
  for (const h of haystacks) {
    if (!h) continue
    for (const { prefix, re } of CHAPTER_PATTERNS) {
      const m = h.match(re)
      if (m) return { prefix, num: m[1] }
    }
  }
  return null
}

export function detectAutoThumbnailMetadata(
  text: string,
  settings: GenerateSettings,
): AutoThumbnailMetadata {
  const combined = [
    settings.title ?? '',
    text.slice(0, 1600),
  ].join('\n')
  const detected = detectChapterMeta(text, settings)
  const className = cleanLine(settings.class_name, detectClassName(combined) ?? 'Class')
  const subject = cleanLine(settings.subject, detectSubject(combined) ?? 'Subject')
  const prefix = cleanLine(settings.auto_thumbnail_chapter_prefix, detected?.prefix ?? 'Unit')
  const num = cleanLine(settings.auto_thumbnail_chapter_num, detected?.num ?? '1')
  const year = cleanLine(settings.auto_thumbnail_year, detectYear(combined) ?? '2083')
  const topic = cleanLine(detectTopic(combined, prefix, num), settings.title || autoThumbnailSummary(text))
  return { className, subject, topic, prefix, num, year }
}

function detectClassName(text: string): string | null {
  const match = text.match(/\bclass\s*([0-9]{1,2})\b/i)
  return match ? `Class ${match[1]}` : null
}

function detectSubject(text: string): string | null {
  const match = text.match(/\b(?:class\s*[0-9]{1,2}\s*(?:see\s*)?)(english|nepali|science|math|social)\b/i)
  if (!match) return null
  return match[1][0].toUpperCase() + match[1].slice(1).toLowerCase()
}

function detectYear(text: string): string | null {
  return text.match(/\b(20[0-9]{2}|208[0-9])\b/)?.[1] ?? null
}

function detectTopic(text: string, prefix: string, num: string): string {
  const escapedPrefix = escapeRegExp(prefix)
  const escapedNum = escapeRegExp(num)
  const byUnit = text.match(
    new RegExp(`\\b${escapedPrefix}\\s*${escapedNum}\\s*[:\\-]?\\s*([^\\n|]{3,100})`, 'i'),
  )
  const raw = byUnit?.[1] || text.match(/\b(?:unit|chapter)\s*[0-9]{1,3}\s*[:\-]?\s*([^\n|]{3,100})/i)?.[1] || ''
  return cleanupTopic(raw)
}

function cleanupTopic(value: string): string {
  return value
    .replace(/\bexercise\s*(?:20[0-9]{2}|208[0-9])?\b.*$/i, '')
    .replace(/\bchapter\s*\/\s*reading material\b.*$/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[,:\-\s]+$/g, '')
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Parse an ASCII-or-Devanagari numeric string to an integer, or null. */
export function parseChapterNum(num: string): number | null {
  const ascii = num.replace(/[\u0966-\u096F]/g, (d) => String(d.charCodeAt(0) - 0x0966))
  const n = parseInt(ascii, 10)
  return Number.isFinite(n) ? n : null
}

/**
 * Increment a chapter-number string while preserving its script. Devanagari
 * digits stay Devanagari. Returns the original string if it isn't numeric.
 */
export function incrementChapterNum(num: string): string {
  const n = parseChapterNum(num)
  if (n == null) return num
  const next = String(n + 1)
  if (!/[\u0966-\u096F]/.test(num)) return next
  return next.replace(/[0-9]/g, (d) => String.fromCharCode(0x0966 + d.charCodeAt(0) - 48))
}

function splitTitle(title: string): [string, string, string] {
  const normalized = title.replace(/\u2013|\u2014/g, '-')
  // Strip a leading "Unit 3:", "Chapter 1 -", "Lesson 2 –", "पाठ ४:", etc.
  // The chapter pill already shows that prefix + number; we don't want it
  // duplicated in the title block.
  const stripped = normalized
    .replace(
      /^(?:unit|chapter|ch\.?|lesson|section|part|pt\.?|पाठ|एकाइ|अध्याय)[\s\-_:.]*[\d\u0966-\u096F]+\s*[-:.]?\s*/i,
      '',
    )
    .trim()
  const words = stripped.split(/\s+/).filter(Boolean)
  if (words.length <= 2) return [words.join(' '), '', '']
  if (words.length <= 6) {
    const lines = balanceWords(words, 2)
    return [lines[0] ?? '', lines[1] ?? '', '']
  }
  const lines = balanceWords(words, 3)
  return [lines[0] ?? '', lines[1] ?? '', lines[2] ?? '']
}

function balanceWords(words: string[], lineCount: 2 | 3): string[] {
  if (words.length <= lineCount) return words
  const totalChars = words.join(' ').length
  const target = Math.ceil(totalChars / lineCount)
  const lines: string[] = []
  let current: string[] = []
  let currentChars = 0
  for (let i = 0; i < words.length; i += 1) {
    const word = words[i]
    const remainingWords = words.length - i
    const remainingLines = lineCount - lines.length
    if (
      current.length > 0 &&
      currentChars + word.length + 1 > target &&
      remainingWords > remainingLines
    ) {
      lines.push(current.join(' '))
      current = [word]
      currentChars = word.length
    } else {
      current.push(word)
      currentChars += word.length + (current.length > 1 ? 1 : 0)
    }
  }
  if (current.length) lines.push(current.join(' '))
  while (lines.length > 1 && lines[lines.length - 1].split(/\s+/).length === 1) {
    const last = lines.pop()!
    const prev = lines.pop()!.split(/\s+/)
    lines.push(prev.slice(0, -1).join(' '))
    lines.push(`${prev.at(-1)} ${last}`)
  }
  return lines.slice(0, lineCount)
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
    fontSize: 38, fontWeight: '900', color: PALETTE.badgeText,
    backgroundColor: PALETTE.badgeBg, borderRadius: 999, zIndex: 9,
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
