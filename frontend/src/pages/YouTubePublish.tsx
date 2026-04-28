import { useCallback, useEffect, useMemo, useState } from 'react'
import type React from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  ArrowLeft,
  Check,
  Clipboard,
  Copy,
  ExternalLink,
  FileVideo,
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Tags,
} from 'lucide-react'

import { api } from '../api/client'
import type { YoutubeVideoItem } from '../api/types'
import AssetPreviewModal from '../components/AssetPreviewModal'
import EmptyState from '../components/EmptyState'
import ErrorCard from '../components/ErrorCard'
import { formatRuntime } from '../store/runs'
import { useToast } from '../store/toast'
import { readYoutubeTemplate } from '../lib/youtubePublishTemplate'

type GroupedVideos = Array<{
  className: string
  subjects: Array<{
    subject: string
    videos: YoutubeVideoItem[]
  }>
}>

function groupVideos(videos: YoutubeVideoItem[]): GroupedVideos {
  const classes = new Map<string, Map<string, YoutubeVideoItem[]>>()
  for (const video of videos) {
    const className = video.class_name || 'Unsorted'
    const subject = video.subject || 'General'
    if (!classes.has(className)) classes.set(className, new Map())
    const subjects = classes.get(className)!
    subjects.set(subject, [...(subjects.get(subject) ?? []), video])
  }
  return [...classes.entries()]
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }))
    .map(([className, subjects]) => ({
      className,
      subjects: [...subjects.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([subject, items]) => ({
          subject,
          videos: items.slice().sort((a, b) => a.chapter_name.localeCompare(b.chapter_name, undefined, { numeric: true })),
        })),
    }))
}

function applyTemplateWithTitle(template: string, video: YoutubeVideoItem, exactTitle: string): string {
  const className = normalizeClassName(video.class_name)
  return template
    .replaceAll('{exact_title}', exactTitle)
    .replaceAll('{title}', exactTitle)
    .replaceAll('{class_name}', video.class_name || 'Class')
    .replaceAll('{class_number}', classNumber(video.class_name))
    .replaceAll('{class_label}', className)
    .replaceAll('{subject}', video.subject || 'Subject')
    .replaceAll('{chapter_name}', video.chapter_name || video.title)
    .replaceAll('{video_path}', videoDisplayPath(video))
    .replaceAll('{thumbnail_path}', thumbnailDisplayPath(video))
    .replaceAll('{hashtags}', defaultHashtags(video, exactTitle).join('\n'))
    .replaceAll('{updated_queries}', defaultQueries(video).join('\n'))
    .replaceAll('{additional_queries}', defaultAdditionalQueries(video).join(', '))
    .replaceAll('{tags}', defaultTags(video).join(','))
}

function videoDisplayPath(video: YoutubeVideoItem): string {
  return normalizeWindowsPath(video.video_abs_path || video.video_file)
}

function thumbnailRelativePath(video: YoutubeVideoItem): string {
  return video.thumbnail_file ? `output/thumbnails/${video.thumbnail_file}` : 'No thumbnail selected'
}

function thumbnailDisplayPath(video: YoutubeVideoItem): string {
  if (video.thumbnail_abs_path) return normalizeWindowsPath(video.thumbnail_abs_path)
  if (!video.thumbnail_file) return 'No thumbnail selected'

  const videoPath = videoDisplayPath(video)
  const outputIndex = videoPath.toLowerCase().lastIndexOf('\\output\\')
  if (outputIndex >= 0) {
    return `${videoPath.slice(0, outputIndex)}\\output\\thumbnails\\${video.thumbnail_file}`
  }
  return thumbnailRelativePath(video)
}

function normalizeWindowsPath(path: string): string {
  return path.replaceAll('/', '\\')
}

function descriptionFromTemplate(template: string, video: YoutubeVideoItem, exactTitle: string): string {
  const filled = applyTemplateWithTitle(template, video, exactTitle).trim()
  const descriptionMatch = filled.match(/(?:^|\n)\s*Description:\s*/i)
  if (!descriptionMatch || descriptionMatch.index == null) return filled

  const start = descriptionMatch.index + descriptionMatch[0].length
  const body = filled.slice(start)
  const tagsMatch = body.match(/(?:^|\n)\s*Tags:\s*/i)
  return (tagsMatch?.index == null ? body : body.slice(0, tagsMatch.index)).trim()
}

function defaultMetadataInput(video: YoutubeVideoItem): string {
  return `${video.class_name} SEE ${video.subject} ${video.chapter_name} exercise 2083`
}

function normalizeClassName(value: string): string {
  const match = String(value || '').match(/class\s*\d+/i)
  if (match) {
    return match[0].replace(/\s+/, ' ').replace(/^class/i, 'Class')
  }
  return String(value || 'Class').trim()
}

function classNumber(value: string): string {
  return String(value || '').match(/\d+/)?.[0] ?? ''
}

function subjectName(value: string): string {
  const raw = String(value || 'Subject').trim()
  return raw ? raw[0].toUpperCase() + raw.slice(1) : 'Subject'
}

function chapterNumber(...values: string[]): string {
  for (const value of values) {
    const match = String(value || '').match(/chapter\s*[_-]?\s*(\d+)/i)
    if (match) return match[1]
  }
  const numeric = values.join(' ').match(/\b(\d{1,2})\b/)
  return numeric?.[1] ?? ''
}

function nepaliChapterName(...values: string[]): string {
  for (const value of values) {
    const match = String(value || '').match(/[\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){0,4}/)
    if (match) return match[0].trim()
  }
  return ''
}

function englishChapterName(...values: string[]): string {
  for (const value of values) {
    const text = String(value || '')
    const beforeNepaliParen = text.match(/([A-Za-z][A-Za-z\s'-]{2,80})\s*\([\u0900-\u097F]/)
    if (beforeNepaliParen) return beforeNepaliParen[1].trim()
    const afterChapter = text.match(/chapter\s*\d+[^A-Za-z]+([A-Za-z][A-Za-z\s'-]{2,60})/i)
    if (afterChapter) return afterChapter[1].trim()
  }
  return ''
}

function withKo(name: string): string {
  const clean = name.trim()
  if (!clean) return 'अध्यायको'
  return clean.endsWith('को') ? clean : `${clean}को`
}

function buildExactTitle(video: YoutubeVideoItem, metadataInput: string): string {
  const className = normalizeClassName(video.class_name)
  const subject = subjectName(video.subject)
  const chapter = chapterNumber(metadataInput, video.chapter_name, video.title)
  const nepali = nepaliChapterName(metadataInput, video.input_text ?? '', video.input_preview ?? '', video.chapter_name)
  const chapterPart = chapter ? ` Chapter ${chapter}` : ''
  return `${withKo(nepali)} सम्पूर्ण अभ्यास | ${className} ${subject}${chapterPart} Exercise | ${className} ${subject} Guide 2083`
}

function compactKey(video: YoutubeVideoItem): string {
  const className = normalizeClassName(video.class_name).replace(/\s+/g, '')
  const subject = subjectName(video.subject).replace(/\s+/g, '')
  const chapter = chapterNumber(video.chapter_name, video.title)
  return `${className}${subject}${chapter ? `Chapter${chapter}` : ''}`
}

function defaultHashtags(video: YoutubeVideoItem, exactTitle: string): string[] {
  const key = compactKey(video)
  const nepali = nepaliChapterName(exactTitle)
  return [
    `#${key}`,
    `#${key}Exercise`,
    nepali ? `#${key}${nepali.replace(/\s+/g, '')}` : `#${key}Guide`,
    `#${key}Guide`,
    `#${key}Solution`,
    '#nepaltopeducationalchannel',
    '#nepalieducationalchannel',
    `#neb${normalizeClassName(video.class_name).replace(/\s+/g, '').toLowerCase()}${subjectName(video.subject).toLowerCase()}`,
    '#nepalieducationalguide',
  ]
}

function defaultQueries(video: YoutubeVideoItem): string[] {
  const className = normalizeClassName(video.class_name).toLowerCase()
  const subject = subjectName(video.subject).toLowerCase()
  const chapter = chapterNumber(video.chapter_name, video.title)
  const prefix = `${className} ${subject}${chapter ? ` chapter ${chapter}` : ''}`
  return [
    `${prefix} exercise`,
    `${prefix} question answer`,
    `${prefix} full exercise`,
    `${prefix} book exercise answer`,
    `${prefix} solution`,
    `${prefix} all exercise solution`,
    `${prefix} notes`,
    `${prefix} guide`,
  ]
}

function defaultAdditionalQueries(video: YoutubeVideoItem): string[] {
  const className = normalizeClassName(video.class_name)
  const subject = subjectName(video.subject)
  const chapter = chapterNumber(video.chapter_name, video.title)
  const base = `${className} ${subject}${chapter ? ` Chapter ${chapter}` : ''}`
  return [
    `${base} Solution`,
    `${base} Summary`,
    `NEB ${base} All Exercise Answer`,
    `${subject} ${chapter ? `Chapter ${chapter}` : 'Chapter'} Complete Guide`,
    `${base} Complete Notes`,
    `${base} Important Questions`,
    `NEB Curriculum 2083 ${className} ${subject}`,
  ]
}

function defaultTags(video: YoutubeVideoItem): string[] {
  const className = normalizeClassName(video.class_name)
  const subject = subjectName(video.subject)
  const chapter = chapterNumber(video.chapter_name, video.title)
  const base = `${className} ${subject}${chapter ? ` Chapter ${chapter}` : ''}`
  const englishChapter = englishChapterName(
    video.input_text ?? '',
    video.input_preview ?? '',
    video.chapter_name,
    video.title,
  )
  return [
    'Educated Nepal',
    `${base} Exercise`,
    `${base} Full Solution`,
    `${base} Notes`,
    `${base} Question Answer`,
    `${base} Complete Notes`,
    `${base} Exercise in Nepali`,
    base.toLowerCase(),
    `${base} exercise`.toLowerCase(),
    `${base} question answer`.toLowerCase(),
    `${base} all exercise`.toLowerCase(),
    `${base} 2083`.toLowerCase(),
    englishChapter ? `${className} ${subject} ${englishChapter}`.toLowerCase() : `${base} guide`.toLowerCase(),
  ]
}

function defaultTagsText(video: YoutubeVideoItem): string {
  return defaultTags(video).join(',')
}

function buildMetadata(video: YoutubeVideoItem, metadataInput: string, template: string) {
  const exactTitle = buildExactTitle(video, metadataInput)
  return {
    title: exactTitle,
    description: descriptionFromTemplate(template, video, exactTitle),
    tags: defaultTagsText(video),
  }
}

export default function YouTubePublish() {
  const { runId } = useParams()
  const [videos, setVideos] = useState<YoutubeVideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await api.youtubeVideos()
      setVideos(res.videos ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => void load(), 0)
    return () => window.clearTimeout(t)
  }, [load])

  const selected = runId ? videos.find((video) => video.run_id === runId) : undefined

  if (runId) {
    return (
      <PublishDetail
        video={selected}
        loading={loading}
        error={error}
        onRefresh={load}
      />
    )
  }

  return (
    <PublishIndex
      videos={videos}
      loading={loading}
      error={error}
      onRefresh={load}
    />
  )
}

function PublishIndex({
  videos,
  loading,
  error,
  onRefresh,
}: {
  videos: YoutubeVideoItem[]
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const [query, setQuery] = useState('')
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return videos
    return videos.filter((video) =>
      [video.class_name, video.subject, video.chapter_name, video.video_file]
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [query, videos])
  const groups = useMemo(() => groupVideos(filtered), [filtered])

  return (
    <div className="container-page space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-slate-200 pb-5 dark:border-white/10">
        <div>
          <h1 className="h-page">YouTube Publish</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Valid finished videos with thumbnails, grouped for fast YouTube upload prep.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <InfoPill label="Publishable" value={videos.length.toLocaleString()} />
          <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] p-3 dark:border-white/10">
        <div className="relative min-w-[240px] flex-1">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            className="input !pl-9"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search class, subject, chapter, or path..."
          />
        </div>
        <div className="rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 dark:bg-white/[0.05] dark:text-slate-300">
          {filtered.length} shown
        </div>
      </div>

      {error ? (
        <ErrorCard title="Couldn't load publish videos" message={error} onRetry={onRefresh} />
      ) : loading ? (
        <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted">
          <Loader2 size={16} className="animate-spin" /> Loading videos...
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          icon={<FileVideo size={20} />}
          title="No finished videos yet"
          description="Generate a process with MP4 video output and it will appear here."
        />
      ) : (
        <div className="space-y-7">
          {groups.map((group) => (
            <section key={group.className} className="space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-slate-200 pb-2 dark:border-white/10">
                <h2 className="h-section">{group.className}</h2>
                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-muted dark:bg-white/[0.05]">
                  {group.subjects.reduce((sum, subject) => sum + subject.videos.length, 0)} videos
                </span>
              </div>
              <div className="space-y-5">
                {group.subjects.map((subject) => (
                  <div key={subject.subject} className="space-y-3">
                    <div className="flex items-center gap-2 text-sm font-medium text-[rgb(var(--text-strong))]">
                      <FolderOpen size={15} className="text-faint" /> {subject.subject}
                    </div>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {subject.videos.map((video) => (
                        <ChapterCard key={video.run_id} video={video} />
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function ChapterCard({ video }: { video: YoutubeVideoItem }) {
  return (
    <Link
      to={`/publish/${encodeURIComponent(video.run_id)}`}
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] transition hover:-translate-y-0.5 hover:border-brand-300 hover:shadow-glass dark:border-white/10 dark:hover:border-brand-500/50"
    >
      <div className="relative aspect-video bg-slate-100 dark:bg-slate-950">
        {video.thumbnail_file ? (
          <img
            src={api.thumbnailUrl(video.thumbnail_file)}
            alt={video.chapter_name}
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.015]"
            loading="lazy"
          />
        ) : (
          <div className="flex h-full items-center justify-center text-faint">
            <ImageIcon size={24} />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-md bg-black/65 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-white">
          Ready
        </span>
      </div>
      <div className="space-y-2.5 p-3">
        <div className="line-clamp-2 text-sm font-semibold text-[rgb(var(--text-strong))]">
          {video.chapter_name}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
          {video.duration_seconds != null && <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/[0.05]">{formatRuntime(video.duration_seconds * 1000)}</span>}
          {video.screenshot_count != null && <span className="rounded bg-slate-100 px-1.5 py-0.5 dark:bg-white/[0.05]">{video.screenshot_count} screenshots</span>}
        </div>
        <div className="truncate font-mono text-[10px] text-faint">{videoDisplayPath(video)}</div>
      </div>
    </Link>
  )
}

function InfoPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-slate-600 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-300">
      <span className="font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      <span className="text-[rgb(var(--text-strong))]">{value}</span>
    </span>
  )
}

function PublishDetail({
  video,
  loading,
  error,
  onRefresh,
}: {
  video?: YoutubeVideoItem
  loading: boolean
  error: string | null
  onRefresh: () => void
}) {
  const toast = useToast()
  const template = readYoutubeTemplate()
  const [metadataInput, setMetadataInput] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [preview, setPreview] = useState<'video' | 'thumbnail' | null>(null)

  useEffect(() => {
    if (!video) return
    const t = window.setTimeout(() => {
      const nextInput = defaultMetadataInput(video)
      const metadata = buildMetadata(video, nextInput, template)
      setMetadataInput(nextInput)
      setTitle(metadata.title)
      setDescription(metadata.description)
      setTags(metadata.tags)
    }, 0)
    return () => window.clearTimeout(t)
  }, [template, video])

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    toast.push({ variant: 'success', message: `${label} copied.` })
  }

  const regenerateMetadata = () => {
    if (!video) return
    const metadata = buildMetadata(video, metadataInput, template)
    setTitle(metadata.title)
    setDescription(metadata.description)
    setTags(metadata.tags)
    toast.push({ variant: 'success', message: 'Metadata regenerated.' })
  }

  if (error) {
    return <ErrorCard title="Couldn't load publish detail" message={error} onRetry={onRefresh} />
  }
  if (loading && !video) {
    return <div className="flex items-center justify-center gap-2 py-16 text-sm text-muted"><Loader2 size={16} className="animate-spin" /> Loading...</div>
  }
  if (!video) {
    return (
      <EmptyState
        icon={<FileVideo size={20} />}
        title="Video run not found"
        description="The selected run is missing or no longer has an MP4 output."
        action={<Link className="btn-secondary btn-sm" to="/publish">Back to publish list</Link>}
      />
    )
  }

  return (
    <div className="container-page space-y-6">
      <div className="rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] p-4 dark:border-white/10">
        <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/publish" className="btn-ghost btn-sm mb-3">
            <ArrowLeft size={14} /> Back
          </Link>
          <h1 className="h-page truncate">{video.chapter_name}</h1>
          <div className="mt-3 flex flex-wrap gap-2">
            <InfoPill label="Class" value={video.class_name} />
            <InfoPill label="Subject" value={video.subject} />
            {video.duration_seconds != null && <InfoPill label="Runtime" value={formatRuntime(video.duration_seconds * 1000)} />}
          </div>
        </div>
        <button type="button" className="btn-primary" onClick={regenerateMetadata}>
          <Sparkles size={14} />
          Regenerate metadata
        </button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <section className="rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] p-4 dark:border-white/10">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-white/5">
            <div>
              <h2 className="text-sm font-semibold text-[rgb(var(--text-strong))]">Assets</h2>
              <p className="mt-0.5 text-xs text-muted">Preview and copy the exact local files for upload.</p>
            </div>
            <FileVideo size={16} className="text-faint" />
          </div>
          <div className="space-y-4">
          {video.thumbnail_file && (
            <>
              <button
                type="button"
                className="group block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left transition hover:border-brand-300 dark:border-white/10 dark:bg-slate-950 dark:hover:border-brand-500/50"
                onClick={() => setPreview('thumbnail')}
              >
                <img src={api.thumbnailUrl(video.thumbnail_file)} alt="Thumbnail" className="aspect-video w-full object-cover transition group-hover:scale-[1.01]" />
              </button>
              <PathRow
                label="Thumbnail path"
                value={thumbnailDisplayPath(video)}
                href={api.thumbnailUrl(video.thumbnail_file)}
                onCopy={() => copy('Thumbnail path', thumbnailDisplayPath(video))}
              />
            </>
          )}
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-black dark:border-white/10">
            <button type="button" className="block aspect-video w-full" onClick={() => setPreview('video')}>
              <video src={api.downloadUrl(video.video_file)} muted preload="metadata" className="h-full w-full object-contain" />
            </button>
          </div>
          <PathRow
            label="Video path"
            value={videoDisplayPath(video)}
            href={api.downloadUrl(video.video_file)}
            onCopy={() => copy('Video path', videoDisplayPath(video))}
          />
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] p-4 dark:border-white/10">
          <div className="mb-4 flex items-center justify-between gap-3 border-b border-slate-100 pb-3 dark:border-white/5">
            <div>
              <h2 className="text-sm font-semibold text-[rgb(var(--text-strong))]">Upload metadata</h2>
              <p className="mt-0.5 text-xs text-muted">Copy-ready fields for YouTube Studio.</p>
            </div>
            <Tags size={16} className="text-faint" />
          </div>
          <div className="space-y-4">
            <Field
              label="Metadata input"
              value={metadataInput}
              onChange={setMetadataInput}
              onCopy={() => copy('Metadata input', metadataInput)}
              multiline
              rows={3}
              icon={<Sparkles size={14} />}
            />
            <Field
              label="YouTube title"
              value={title}
              onChange={setTitle}
              onCopy={() => copy('Title', title)}
              showCounter
              maxChars={100}
            />
            <Field
              label="Description"
              value={description}
              onChange={setDescription}
              onCopy={() => copy('Description', description)}
              multiline
              rows={13}
              showCounter
              maxChars={5000}
            />
            <Field
              label="Tags"
              value={tags}
              onChange={setTags}
              onCopy={() => copy('Tags', tags)}
              multiline
              rows={8}
              icon={<Tags size={14} />}
              showCounter
              maxChars={500}
              controlClassName="font-mono text-xs leading-relaxed"
            />
          </div>
        </section>
      </div>

      {preview === 'video' && (
        <AssetPreviewModal
          kind="video"
          src={api.downloadUrl(video.video_file)}
          title={video.video_file.split('/').pop() ?? video.video_file}
          subtitle="MP4 video"
          onClose={() => setPreview(null)}
        />
      )}
      {preview === 'thumbnail' && video.thumbnail_file && (
        <AssetPreviewModal
          kind="image"
          src={api.thumbnailUrl(video.thumbnail_file)}
          title={video.thumbnail_file}
          subtitle="Thumbnail"
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  )
}

function PathRow({ label, value, href, onCopy }: { label: string; value: string; href: string; onCopy: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] px-3 py-2 dark:border-white/10">
      <FileVideo size={14} className="shrink-0 text-faint" />
      <div className="min-w-0 flex-1">
        <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">{label}</div>
        <div className="truncate font-mono text-xs text-[rgb(var(--text-strong))]">{value}</div>
      </div>
      <button type="button" className="btn-ghost btn-sm" onClick={onCopy} aria-label={`Copy ${label}`}>
        <Copy size={13} />
      </button>
      <a href={href} className="btn-ghost btn-sm" aria-label={`Open ${label}`}>
        <ExternalLink size={13} />
      </a>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  onCopy,
  multiline = false,
  rows = 10,
  icon,
  showCounter = false,
  maxChars,
  controlClassName = '',
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onCopy: () => void
  multiline?: boolean
  rows?: number
  icon?: React.ReactNode
  showCounter?: boolean
  maxChars?: number
  controlClassName?: string
}) {
  const [copied, setCopied] = useState(false)
  const count = value.length
  const ratio = maxChars ? count / maxChars : 0
  const counterTone = maxChars && count > maxChars
    ? 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200'
    : maxChars && ratio >= 0.9
      ? 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200'
      : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400'
  const handleCopy = async () => {
    await onCopy()
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1200)
  }
  return (
    <label className="block">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="label !mb-0 inline-flex items-center gap-1.5">{icon ?? <Clipboard size={14} />} {label}</span>
        <button type="button" className="btn-ghost btn-sm" onClick={handleCopy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <div>
        {multiline ? (
          <textarea
            className={`textarea resize-y ${controlClassName}`}
            rows={rows}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        ) : (
          <input
            className={`input ${controlClassName}`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )}
        {showCounter && (
          <div className="mt-1.5 flex justify-end">
            <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold tabular-nums ${counterTone}`}>
              {count.toLocaleString()}{maxChars ? ` / ${maxChars.toLocaleString()}` : ''} characters
            </span>
          </div>
        )}
      </div>
    </label>
  )
}
