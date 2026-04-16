import { spawn } from 'node:child_process'
import { cp, mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const repoRoot = resolve(__dirname, '..')
const websiteDir = resolve(repoRoot, 'website')
const buildDir = resolve(websiteDir, 'build')
const targetDir = resolve(repoRoot, 'public', 'docs-site')

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: process.platform === 'win32',
      ...options,
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolvePromise()
        return
      }
      rejectPromise(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })

    child.on('error', rejectPromise)
  })
}

async function main() {
  console.log('[docs:local] Building Docusaurus for local /docs preview...')
  await run('pnpm', ['build'], {
    cwd: websiteDir,
    env: {
      ...process.env,
      DOCS_URL: 'http://localhost:4516',
      DOCS_BASE_URL: '/docs/',
      DOCS_ROUTE_BASE_PATH: '/',
    },
  })

  console.log('[docs:local] Syncing build into public/docs-site...')
  await rm(targetDir, { recursive: true, force: true })
  await mkdir(targetDir, { recursive: true })
  await cp(buildDir, targetDir, { recursive: true })

  console.log('[docs:local] Local docs are ready at http://localhost:4516/docs')
}

main().catch((error) => {
  console.error('[docs:local] Failed:', error)
  process.exitCode = 1
})
