import { lazy, Suspense } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { pageLoaders } from './lib/routePreload'

const Home = lazy(pageLoaders.home)
const Workspace = lazy(pageLoaders.workspace)
const TextToVideo = lazy(pageLoaders.text)
const HtmlToVideo = lazy(pageLoaders.html)
const ImageToVideo = lazy(pageLoaders.image)
const ScreenshotsToVideo = lazy(pageLoaders.screenshots)
const YouTubeScreenshots = lazy(pageLoaders.youtubeScreenshots)
const Library = lazy(pageLoaders.library)
const Processes = lazy(pageLoaders.processes)
const Settings = lazy(pageLoaders.settings)
const YouTubePublish = lazy(pageLoaders.publish)

function PageFallback() {
  return (
    <div className="container-page py-12 text-sm text-muted">
      Loading...
    </div>
  )
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Suspense fallback={<PageFallback />}><Home /></Suspense>} />

          <Route path="workspace" element={<Suspense fallback={<PageFallback />}><Workspace /></Suspense>} />
          <Route path="workspace/text" element={<Suspense fallback={<PageFallback />}><TextToVideo /></Suspense>} />
          <Route path="workspace/html" element={<Suspense fallback={<PageFallback />}><HtmlToVideo /></Suspense>} />
          <Route path="workspace/image" element={<Suspense fallback={<PageFallback />}><ImageToVideo /></Suspense>} />
          <Route path="workspace/screenshots" element={<Suspense fallback={<PageFallback />}><ScreenshotsToVideo /></Suspense>} />
          <Route path="workspace/youtube" element={<Suspense fallback={<PageFallback />}><TextToVideo sourceMode="youtube" /></Suspense>} />
          <Route path="workspace/youtube-screenshots" element={<Suspense fallback={<PageFallback />}><YouTubeScreenshots /></Suspense>} />

          <Route path="library" element={<Suspense fallback={<PageFallback />}><Library /></Suspense>} />
          <Route path="publish" element={<Suspense fallback={<PageFallback />}><YouTubePublish /></Suspense>} />
          <Route path="publish/:runId" element={<Suspense fallback={<PageFallback />}><YouTubePublish /></Suspense>} />
          <Route path="processes" element={<Suspense fallback={<PageFallback />}><Processes /></Suspense>} />
          <Route path="settings" element={<Suspense fallback={<PageFallback />}><Settings /></Suspense>} />

          {/* Legacy URLs — redirect so old links keep working. */}
          <Route path="text-to-video" element={<Navigate to="/workspace/text" replace />} />
          <Route path="html-to-video" element={<Navigate to="/workspace/html" replace />} />
          <Route path="image-to-video" element={<Navigate to="/workspace/image" replace />} />
          <Route path="resources" element={<Navigate to="/library" replace />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
