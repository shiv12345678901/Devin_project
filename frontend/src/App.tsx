import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import TextToVideo from './pages/TextToVideo'
import HtmlToVideo from './pages/HtmlToVideo'
import ImageToVideo from './pages/ImageToVideo'
import Processes from './pages/Processes'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Navigate to="/text-to-video" replace />} />
          <Route path="text-to-video" element={<TextToVideo />} />
          <Route path="html-to-video" element={<HtmlToVideo />} />
          <Route path="image-to-video" element={<ImageToVideo />} />
          <Route path="processes" element={<Processes />} />
          <Route path="resources" element={<Navigate to="/processes" replace />} />
          <Route path="*" element={<Navigate to="/text-to-video" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}

export default App
