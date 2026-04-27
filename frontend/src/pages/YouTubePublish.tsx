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

const TEMPLATE_KEY = 'textbro:youtube-publish-template:v1'
const DEFAULT_TEMPLATE = `Title:
{class_name} {subject} - {chapter_name} Complete Notes | SEE Preparation

Description:
In this video, we study {chapter_name} from {class_name} {subject}. This lesson includes clear explanations, important notes, and exam-focused content for students preparing for SEE and school exams.

Video file: {video_path}
Thumbnail file: {thumbnail_path}

Tags:
{class_name}, {subject}, {chapter_name}, SEE preparation, Nepali education, exam notes`

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

function applyTemplate(template: string, video: YoutubeVideoItem): string {
  return template
    .replaceAll('{class_name}', video.class_name || 'Class')
    .replaceAll('{subject}', video.subject || 'Subject')
    .replaceAll('{chapter_name}', video.chapter_name || video.title)
    .replaceAll('{video_path}', video.video_file)
    .replaceAll('{thumbnail_path}', video.thumbnail_file ?? 'No thumbnail selected')
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="h-page">YouTube Publish</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted">
            Finished MP4 outputs grouped by class, subject, and chapter, ready for YouTube upload prep.
          </p>
        </div>
        <button type="button" className="btn-secondary" onClick={onRefresh} disabled={loading}>
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3 border-y border-slate-200 py-3 dark:border-white/10">
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
        <div className="text-sm text-muted">{filtered.length} video{filtered.length === 1 ? '' : 's'}</div>
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
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.className} className="space-y-4">
              <div className="flex items-center justify-between border-b border-slate-200 pb-2 dark:border-white/10">
                <h2 className="h-section">{group.className}</h2>
                <span className="text-xs text-muted">
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
      className="group block overflow-hidden rounded-lg border border-slate-200 bg-[rgb(var(--bg-surface))] transition hover:border-brand-300 hover:shadow-glass dark:border-white/10 dark:hover:border-brand-500/50"
    >
      <div className="aspect-video bg-slate-100 dark:bg-slate-950">
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
      </div>
      <div className="space-y-2 p-3">
        <div className="line-clamp-2 text-sm font-semibold text-[rgb(var(--text-strong))]">
          {video.chapter_name}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          {video.duration_seconds != null && <span>{formatRuntime(video.duration_seconds * 1000)}</span>}
          {video.screenshot_count != null && <span>{video.screenshot_count} screenshots</span>}
        </div>
        <div className="truncate font-mono text-[10px] text-faint">{video.video_file}</div>
      </div>
    </Link>
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
  const [template, setTemplate] = useState(() => window.localStorage.getItem(TEMPLATE_KEY) ?? DEFAULT_TEMPLATE)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [tags, setTags] = useState('')
  const [generating, setGenerating] = useState(false)
  const [preview, setPreview] = useState<'video' | 'thumbnail' | null>(null)

  useEffect(() => {
    if (!video) return
    const t = window.setTimeout(() => {
      setTitle(`${video.class_name} ${video.subject} - ${video.chapter_name} Complete Notes | SEE Preparation`)
      setDescription(applyTemplate(template, video))
      setTags([
        video.class_name,
        video.subject,
        video.chapter_name,
        'SEE preparation',
        'Nepali education',
        'exam notes',
      ].filter(Boolean).join(', '))
    }, 0)
    return () => window.clearTimeout(t)
  }, [template, video])

  const saveTemplate = (next: string) => {
    setTemplate(next)
    window.localStorage.setItem(TEMPLATE_KEY, next)
  }

  const copy = async (label: string, value: string) => {
    await navigator.clipboard.writeText(value)
    toast.push({ variant: 'success', message: `${label} copied.` })
  }

  const generateAi = async () => {
    if (!video) return
    setGenerating(true)
    try {
      const res = await api.youtubeMetadata({
        run_id: video.run_id,
        template,
        model_choice: video.model_choice ?? undefined,
      })
      setTitle(res.title)
      setDescription(res.description)
      setTags(res.tags.join(', '))
      toast.push({ variant: 'success', message: 'AI metadata generated.' })
    } catch (e) {
      toast.push({
        variant: 'error',
        title: 'AI generation failed',
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setGenerating(false)
    }
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
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link to="/publish" className="btn-ghost btn-sm mb-3">
            <ArrowLeft size={14} /> Back
          </Link>
          <h1 className="h-page truncate">{video.chapter_name}</h1>
          <p className="mt-2 text-sm text-muted">
            {video.class_name} / {video.subject}
          </p>
        </div>
        <button type="button" className="btn-primary" onClick={generateAi} disabled={generating}>
          {generating ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          Generate with AI
        </button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(340px,0.9fr)]">
        <div className="space-y-4">
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-black dark:border-white/10">
            <button type="button" className="block aspect-video w-full" onClick={() => setPreview('video')}>
              <video src={api.downloadUrl(video.video_file)} muted preload="metadata" className="h-full w-full object-contain" />
            </button>
          </div>
          <PathRow label="Video path" value={video.video_file} onCopy={() => copy('Video path', video.video_file)} />
          {video.thumbnail_file && (
            <>
              <button
                type="button"
                className="block w-full overflow-hidden rounded-lg border border-slate-200 bg-slate-100 text-left dark:border-white/10 dark:bg-slate-950"
                onClick={() => setPreview('thumbnail')}
              >
                <img src={api.thumbnailUrl(video.thumbnail_file)} alt="Thumbnail" className="aspect-video w-full object-cover" />
              </button>
              <PathRow
                label="Thumbnail path"
                value={`output/thumbnails/${video.thumbnail_file}`}
                onCopy={() => copy('Thumbnail path', `output/thumbnails/${video.thumbnail_file}`)}
              />
            </>
          )}
        </div>

        <div className="space-y-4">
          <Field label="YouTube title" value={title} onChange={setTitle} onCopy={() => copy('Title', title)} />
          <Field label="Description" value={description} onChange={setDescription} onCopy={() => copy('Description', description)} multiline />
          <Field label="Tags" value={tags} onChange={setTags} onCopy={() => copy('Tags', tags)} multiline rows={4} icon={<Tags size={14} />} />
        </div>
      </div>

      <section className="space-y-3 border-t border-slate-200 pt-5 dark:border-white/10">
        <div className="flex items-center justify-between gap-3">
          <h2 className="h-section">Default AI Format</h2>
          <button type="button" className="btn-secondary btn-sm" onClick={() => saveTemplate(DEFAULT_TEMPLATE)}>
            <RefreshCw size={12} /> Reset
          </button>
        </div>
        <textarea
          className="textarea min-h-52 font-mono text-xs"
          value={template}
          onChange={(e) => saveTemplate(e.target.value)}
        />
      </section>

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

function PathRow({ label, value, onCopy }: { label: string; value: string; onCopy: () => void }) {
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
      <a href={api.downloadUrl(value)} className="btn-ghost btn-sm" aria-label={`Open ${label}`}>
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
}: {
  label: string
  value: string
  onChange: (value: string) => void
  onCopy: () => void
  multiline?: boolean
  rows?: number
  icon?: React.ReactNode
}) {
  const [copied, setCopied] = useState(false)
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
      {multiline ? (
        <textarea className="textarea resize-y" rows={rows} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input className="input" value={value} onChange={(e) => onChange(e.target.value)} />
      )}
    </label>
  )
}
