import { useEffect, useMemo, type ReactNode } from 'react'
import Head from '@docusaurus/Head'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import useBaseUrl from '@docusaurus/useBaseUrl'
import Layout from '@theme/Layout'

const docsPrefix = process.env.DOCS_ROUTE_BASE_PATH === '/' ? '' : 'docs'

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext()
  const redirectTarget = useBaseUrl(`${docsPrefix}/getting-started/quickstart`)

  useEffect(() => {
    window.location.replace(redirectTarget)
  }, [redirectTarget])

  return (
    <Layout title="Docs" description={siteConfig.tagline}>
      <Head>
        <meta httpEquiv="refresh" content={`0; url=${redirectTarget}`} />
      </Head>
      <main style={{ padding: '6rem 1.5rem', textAlign: 'center' }}>
        <p>Redirecting to the docs...</p>
      </main>
    </Layout>
  )
}
