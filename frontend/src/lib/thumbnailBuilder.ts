import type { GenerateSettings } from '../api/types'

export type ThumbnailElementType = 'title' | 'label' | 'chapter-text' | 'image' | 'panel' | 'shape' | 'badge'

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
  text: string
  fontSize: number
  fontWeight: string
  fontFamily?: string
  textAlign?: 'left' | 'center' | 'right'
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
  shapeType?: 'rectangle' | 'circle' | 'line'
}

export interface ThumbnailTemplateState {
  canvasWidth: number
  canvasHeight: number
  canvasBackground: string
  elements: Record<string, ThumbnailElement>
}

const DEFAULT_TEMPLATE: ThumbnailTemplateState = {
  canvasWidth: 1280,
  canvasHeight: 720,
  canvasBackground: '#4caf50',
  elements: {
    leftPanel: {
      id: 'leftPanel',
      type: 'panel',
      text: '',
      posX: 15,
      posY: 144,
      width: 665,
      height: 356,
      fontSize: 0,
      fontWeight: '400',
      color: 'transparent',
      backgroundColor: '#d4e5f7',
      borderColor: '#ffffff',
      borderWidth: 0,
      borderRadius: 8,
      paddingX: 0,
      paddingY: 0,
      zIndex: 1,
      visible: true,
    },
    rightPanel: {
      id: 'rightPanel',
      type: 'panel',
      text: '',
      posX: 700,
      posY: 0,
      width: 580,
      height: 720,
      fontSize: 0,
      fontWeight: '400',
      color: 'transparent',
      backgroundColor: '#1a1a1a',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 0,
      zIndex: 1,
      visible: true,
    },
    title: {
      id: 'title',
      type: 'title',
      text: 'Class 10 Nepali',
      posX: 15,
      posY: 18,
      width: 665,
      height: 112,
      fontSize: 70,
      fontWeight: '900',
      color: '#000000',
      backgroundColor: '#ffee00',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 12,
      paddingX: 32,
      paddingY: 10,
      zIndex: 5,
      visible: true,
      textAlign: 'center',
    },
    chapterLabel: {
      id: 'chapterLabel',
      type: 'label',
      text: 'पाठ 1 :',
      posX: 190,
      posY: 188,
      width: 300,
      height: 68,
      fontSize: 65,
      fontWeight: '800',
      color: '#1a1a3e',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 8,
      zIndex: 2,
      visible: true,
      textAlign: 'left',
    },
    chapterLine1: {
      id: 'chapterLine1',
      type: 'chapter-text',
      text: 'Chapter',
      posX: 70,
      posY: 300,
      width: 560,
      height: 125,
      fontSize: 87,
      fontWeight: '900',
      color: '#e51c23',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 0,
      zIndex: 5,
      visible: true,
      textAlign: 'center',
    },
    chapterLine2: {
      id: 'chapterLine2',
      type: 'chapter-text',
      text: '',
      posX: 70,
      posY: 402,
      width: 560,
      height: 76,
      fontSize: 74,
      fontWeight: '900',
      color: '#e51c23',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 0,
      zIndex: 5,
      visible: true,
      textAlign: 'center',
    },
    labelNew: {
      id: 'labelNew',
      type: 'label',
      text: 'New\n2083',
      posX: 15,
      posY: 532,
      width: 287,
      height: 172,
      fontSize: 62,
      fontWeight: '800',
      color: '#ffffff',
      backgroundColor: '#e51c23',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 12,
      paddingX: 32,
      paddingY: 16,
      zIndex: 1,
      visible: true,
      textAlign: 'center',
    },
    labelChapter: {
      id: 'labelChapter',
      type: 'label',
      text: 'Chapter\n1',
      posX: 324,
      posY: 536,
      width: 357,
      height: 168,
      fontSize: 61,
      fontWeight: '800',
      color: '#ffffff',
      backgroundColor: '#e51c23',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 12,
      paddingX: 32,
      paddingY: 16,
      zIndex: 1,
      visible: true,
      textAlign: 'center',
    },
    rightImage: {
      id: 'rightImage',
      type: 'image',
      text: '',
      posX: 696,
      posY: 24,
      width: 565,
      height: 680,
      fontSize: 0,
      fontWeight: '400',
      color: '#fff',
      backgroundColor: '#ffffff',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 12,
      paddingX: 0,
      paddingY: 0,
      imageOffsetX: 50,
      imageOffsetY: 50,
      imageZoom: 100,
      zIndex: 3,
      visible: true,
    },
    badgeYear: {
      id: 'badgeYear',
      type: 'badge',
      text: '2082',
      posX: 1150,
      posY: 10,
      width: 120,
      height: 120,
      fontSize: 32,
      fontWeight: '900',
      color: '#e51c23',
      backgroundColor: '#ffee00',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 0,
      zIndex: 10,
      visible: true,
    },
    badgeNew: {
      id: 'badgeNew',
      type: 'badge',
      text: 'New',
      posX: 1160,
      posY: 600,
      width: 100,
      height: 100,
      fontSize: 28,
      fontWeight: '900',
      color: '#e51c23',
      backgroundColor: '#ffee00',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 16,
      paddingY: 12,
      zIndex: 10,
      visible: true,
    },
    custom_1_1773057243734: {
      id: 'custom_1_1773057243734',
      type: 'chapter-text',
      text: '',
      posX: 46,
      posY: 379,
      width: 614,
      height: 20,
      fontSize: 75,
      fontWeight: '900',
      color: '#e51c23',
      backgroundColor: 'transparent',
      borderColor: 'transparent',
      borderWidth: 0,
      borderRadius: 0,
      paddingX: 0,
      paddingY: 0,
      zIndex: 4,
      visible: true,
      textAlign: 'center',
    },
  },
}

export function buildAutoThumbnailTemplate(settings: GenerateSettings, text: string): ThumbnailTemplateState {
  const title = cleanLine(settings.title, 'Chapter')
  const [line1, line2] = splitTitle(title)
  const chapterNum = cleanLine(settings.auto_thumbnail_chapter_num, title.match(/\d+/)?.[0] ?? '1')
  const year = cleanLine(settings.auto_thumbnail_year, '2083')
  const sideImageUrl = cleanLine(settings.auto_thumbnail_side_image_url, '')
  const template: ThumbnailTemplateState = {
    ...DEFAULT_TEMPLATE,
    elements: {
      ...DEFAULT_TEMPLATE.elements,
      title: {
        ...DEFAULT_TEMPLATE.elements.title,
        text: `${cleanLine(settings.class_name, 'Class')} ${cleanLine(settings.subject, 'Nepali')}`,
      },
      chapterLabel: {
        ...DEFAULT_TEMPLATE.elements.chapterLabel,
        text: `पाठ ${chapterNum} :`,
      },
      chapterLine1: {
        ...DEFAULT_TEMPLATE.elements.chapterLine1,
        text: line1 || autoThumbnailSummary(text),
      },
      chapterLine2: {
        ...DEFAULT_TEMPLATE.elements.chapterLine2,
        text: line2,
      },
      labelNew: {
        ...DEFAULT_TEMPLATE.elements.labelNew,
        text: `New\n${year}`,
      },
      labelChapter: {
        ...DEFAULT_TEMPLATE.elements.labelChapter,
        text: `Chapter\n${chapterNum}`,
      },
      badgeYear: {
        ...DEFAULT_TEMPLATE.elements.badgeYear,
        text: year,
      },
      rightImage: {
        ...DEFAULT_TEMPLATE.elements.rightImage,
        imageUrl: sideImageUrl,
        imageOffsetX: settings.auto_thumbnail_image_offset_x ?? 50,
        imageOffsetY: settings.auto_thumbnail_image_offset_y ?? 50,
        imageZoom: settings.auto_thumbnail_image_zoom ?? 100,
      },
    },
  }
  return applyTemplateOverrides(template, settings.auto_thumbnail_overrides)
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
  image?: HTMLImageElement,
) {
  if (e.type === 'image') {
    drawImageElement(ctx, e, image)
    return
  }
  if (e.type === 'panel' || e.type === 'shape') {
    fillBox(ctx, e)
    return
  }
  if (e.type === 'badge') {
    drawBadge(ctx, e)
    return
  }
  drawTextBox(ctx, e)
}

function fillBox(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  if (e.backgroundColor === 'transparent') return
  ctx.fillStyle = e.backgroundColor
  roundedRect(ctx, e.posX, e.posY, e.width ?? 0, e.height ?? 0, e.borderRadius)
  ctx.fill()
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
  ctx.restore()
}

function drawTextBox(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  if (e.backgroundColor !== 'transparent') fillBox(ctx, e)
  const fontFamily = e.fontFamily ?? "'Noto Sans Devanagari', Arial, sans-serif"
  ctx.fillStyle = e.color
  ctx.textBaseline = 'top'
  const align = e.textAlign ?? (e.width ? 'center' : 'left')
  ctx.textAlign = align
  const lines = e.text.split('\n')
  const maxWidth = Math.max(1, (e.width ?? 0) - e.paddingX * 2)
  let fontSize = e.fontSize
  if (e.width) {
    while (fontSize > 18) {
      ctx.font = `${e.fontWeight} ${fontSize}px ${fontFamily}`
      const widest = Math.max(...lines.map((line) => ctx.measureText(line).width), 0)
      const totalHeight = lines.length * fontSize * 1.08
      if (widest <= maxWidth && (!e.height || totalHeight <= e.height - e.paddingY * 2)) break
      fontSize -= 2
    }
  }
  ctx.font = `${e.fontWeight} ${fontSize}px ${fontFamily}`
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
  lines.forEach((line, index) => {
    ctx.fillText(line, x, y + index * lineHeight)
  })
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
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(x, y, width, height)
  ctx.fillStyle = '#f02a9a'
  roundedRect(ctx, x + 62, y + 22, 95, 26, 8)
  ctx.fill()
  ctx.fillStyle = '#1f2937'
  ctx.font = '700 30px Arial, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'top'
  ctx.fillText('खाद', x + width / 2, y + 23)
  ctx.strokeStyle = '#f02a9a'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(x + 62, y + 80)
  ctx.lineTo(x + width - 90, y + 80)
  ctx.stroke()
  ctx.strokeStyle = '#f8d020'
  ctx.beginPath()
  ctx.moveTo(x + 62, y + 86)
  ctx.lineTo(x + width - 90, y + 86)
  ctx.stroke()
  ctx.fillStyle = '#e5e7eb'
  for (let i = 0; i < 9; i++) {
    ctx.fillRect(x + 62, y + 330 + i * 37, width - 120, 9)
  }
  ctx.restore()
}

function drawBadge(ctx: CanvasRenderingContext2D, e: ThumbnailElement) {
  const size = e.width ?? 120
  const centerX = e.posX + size / 2
  const centerY = e.posY + size / 2
  const points = 16
  const outerR = size / 2
  const innerR = outerR * 0.78
  ctx.beginPath()
  for (let i = 0; i < points * 2; i++) {
    const angle = (Math.PI * i) / points - Math.PI / 2
    const radius = i % 2 === 0 ? outerR : innerR
    const x = centerX + radius * Math.cos(angle)
    const y = centerY + radius * Math.sin(angle)
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fillStyle = e.backgroundColor
  ctx.fill()
  ctx.font = `${e.fontWeight} ${e.fontSize}px ${e.fontFamily ?? 'Arial, sans-serif'}`
  ctx.fillStyle = e.color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(e.text, centerX, centerY)
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
}

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
  return firstUsefulLine.slice(0, 42)
}
