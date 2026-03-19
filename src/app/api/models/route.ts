// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Models API Route
// Runtime folder scanning for dynamic 3D asset discovery
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

export interface ModelFile {
  id: string
  name: string
  path: string
  folder: string
  category: string
}

export interface FolderNode {
  name: string
  path: string
  files: ModelFile[]
  children: FolderNode[]
}

// Recursively scan directory for .gltf files
function scanDirectory(dirPath: string, basePath: string): FolderNode {
  const folderName = path.basename(dirPath)
  const relativePath = dirPath.replace(basePath, '').replace(/\\/g, '/')

  const node: FolderNode = {
    name: folderName,
    path: relativePath || '/',
    files: [],
    children: [],
  }

  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        // Recurse into subdirectories
        const childNode = scanDirectory(fullPath, basePath)
        // Only add if it has files or non-empty children
        if (childNode.files.length > 0 || childNode.children.length > 0) {
          node.children.push(childNode)
        }
      } else if (entry.name.endsWith('.gltf') || entry.name.endsWith('.glb')) {
        // Found a model file
        const fileRelativePath = fullPath.replace(basePath, '').replace(/\\/g, '/')
        const webPath = '/models' + fileRelativePath

        // Infer category from folder structure
        let category = 'misc'
        const folderLower = relativePath.toLowerCase()
        if (folderLower.includes('enem')) category = 'enemies'
        else if (folderLower.includes('pickup')) category = 'pickups'
        else if (folderLower.includes('platform')) category = 'platforms'
        else if (folderLower.includes('character')) category = 'character'
        else if (folderLower.includes('prop')) category = 'props'
        else if (folderLower.includes('vehicle')) category = 'vehicles'
        else if (folderLower.includes('weapon')) category = 'weapons'

        node.files.push({
          id: entry.name.replace(/\.(gltf|glb)$/, '').replace(/[^a-zA-Z0-9]/g, '_').toLowerCase(),
          name: entry.name.replace(/\.(gltf|glb)$/, '').replace(/_/g, ' '),
          path: webPath,
          folder: relativePath,
          category,
        })
      }
    }
  } catch (err) {
    console.error(`Error scanning ${dirPath}:`, err)
  }

  // Sort children alphabetically
  node.children.sort((a, b) => a.name.localeCompare(b.name))
  // Sort files alphabetically
  node.files.sort((a, b) => a.name.localeCompare(b.name))

  return node
}

// Flatten tree to flat list
function flattenTree(node: FolderNode): ModelFile[] {
  const files: ModelFile[] = [...node.files]
  for (const child of node.children) {
    files.push(...flattenTree(child))
  }
  return files
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const format = searchParams.get('format') || 'tree' // 'tree' or 'flat'

  // Determine the models directory path
  const publicDir = path.join(process.cwd(), 'public', 'models')

  if (!fs.existsSync(publicDir)) {
    return NextResponse.json({ error: 'Models directory not found' }, { status: 404 })
  }

  const tree = scanDirectory(publicDir, publicDir)

  if (format === 'flat') {
    const flatList = flattenTree(tree)
    return NextResponse.json({
      count: flatList.length,
      models: flatList,
    })
  }

  return NextResponse.json({
    count: flattenTree(tree).length,
    tree,
  })
}
