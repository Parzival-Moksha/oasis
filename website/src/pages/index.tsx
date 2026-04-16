import { useEffect, type ReactNode } from 'react'
import Head from '@docusaurus/Head'
import useDocusaurusContext from '@docusaurus/useDocusaurusContext'
import Layout from '@theme/Layout'

const docsPrefix = process.env.DOCS_ROUTE_BASE_PATH === '/' ? '' : '/docs'
const redirectTarget = `${docsPrefix}/getting-started/quickstart`

export default function Home(): ReactNode {
  const { siteConfig } = useDocusaurusContext()

  useEffect(() => {
    window.location.replace(redirectTarget)
  }, [])

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
