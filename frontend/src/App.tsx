import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import Home from './pages/Home'
import Workspace from './pages/Workspace'
import TextToVideo from './pages/TextToVideo'
import HtmlToVideo from './pages/HtmlToVideo'
import ImageToVideo from './pages/ImageToVideo'
import ScreenshotsToVideo from './pages/ScreenshotsToVideo'
import Library from './pages/Library'
import Processes from './pages/Processes'
import Settings from './pages/Settings'
import YouTubePublish from './pages/YouTubePublish'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />

          <Route path="workspace" element={<Workspace />} />
          <Route path="workspace/text" element={<TextToVideo />} />
          <Route path="workspace/html" element={<HtmlToVideo />} />
          <Route path="workspace/image" element={<ImageToVideo />} />
          <Route path="workspace/screenshots" element={<ScreenshotsToVideo />} />

          <Route path="library" element={<Library />} />
          <Route path="publish" element={<YouTubePublish />} />
          <Route path="publish/:runId" element={<YouTubePublish />} />
          <Route path="processes" element={<Processes />} />
          <Route path="settings" element={<Settings />} />

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
