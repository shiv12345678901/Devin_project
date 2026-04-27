import AssetPreviewModal from './AssetPreviewModal'

interface Props {
  kind: 'html' | 'image'
  src: string
  title: string
  subtitle?: string
  onClose: () => void
}

export default function HtmlPreviewModal({ kind, src, title, subtitle, onClose }: Props) {
  return <AssetPreviewModal kind={kind} src={src} title={title} subtitle={subtitle} onClose={onClose} />
}
