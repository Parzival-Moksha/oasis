import OasisClient from '../../OasisClient'

export default function WorldDeepLinkPage({ params }: { params: { id: string } }) {
  return <OasisClient initialWorldId={params.id} />
}
