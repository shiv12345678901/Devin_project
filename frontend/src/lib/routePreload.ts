import type { ComponentType } from 'react'

type PageModule = { default: ComponentType<{ sourceMode?: 'text' | 'html' | 'youtube' }> }

export const pageLoaders = {
  home: () => import('../pages/Home') as Promise<PageModule>,
  workspace: () => import('../pages/Workspace') as Promise<PageModule>,
  text: () => import('../pages/TextToVideo') as Promise<PageModule>,
  html: () => import('../pages/HtmlToVideo') as Promise<PageModule>,
  image: () => import('../pages/ImageToVideo') as Promise<PageModule>,
  screenshots: () => import('../pages/ScreenshotsToVideo') as Promise<PageModule>,
  youtubeScreenshots: () => import('../pages/YouTubeScreenshots') as Promise<PageModule>,
  library: () => import('../pages/Library') as Promise<PageModule>,
  publish: () => import('../pages/YouTubePublish') as Promise<PageModule>,
  processes: () => import('../pages/Processes') as Promise<PageModule>,
  settings: () => import('../pages/Settings') as Promise<PageModule>,
}

const pathToLoader: Array<[RegExp, () => Promise<PageModule>]> = [
  [/^\/$/, pageLoaders.home],
  [/^\/workspace$/, pageLoaders.workspace],
  [/^\/workspace\/text$/, pageLoaders.text],
  [/^\/workspace\/html$/, pageLoaders.html],
  [/^\/workspace\/image$/, pageLoaders.image],
  [/^\/workspace\/screenshots$/, pageLoaders.screenshots],
  [/^\/workspace\/youtube$/, pageLoaders.text],
  [/^\/workspace\/youtube-screenshots$/, pageLoaders.youtubeScreenshots],
  [/^\/library$/, pageLoaders.library],
  [/^\/publish(?:\/.*)?$/, pageLoaders.publish],
  [/^\/processes$/, pageLoaders.processes],
  [/^\/settings$/, pageLoaders.settings],
]

const warmed = new Set<string>()

export function preloadRoute(path: string): void {
  const clean = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/'
  if (warmed.has(clean)) return
  const match = pathToLoader.find(([pattern]) => pattern.test(clean))
  if (!match) return
  warmed.add(clean)
  void match[1]().catch(() => warmed.delete(clean))
}
