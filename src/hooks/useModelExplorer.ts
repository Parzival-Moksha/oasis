// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
// 04515 — Model Explorer Hook
// Dynamic model discovery from filesystem
// ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░

import { useState, useEffect, useCallback } from 'react'

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

export interface ModelExplorerState {
  tree: FolderNode | null
  flatList: ModelFile[]
  categories: string[]
  loading: boolean
  error: string | null
  selectedFolder: string | null
  currentFiles: ModelFile[]
}

export function useModelExplorer() {
  const [state, setState] = useState<ModelExplorerState>({
    tree: null,
    flatList: [],
    categories: [],
    loading: true,
    error: null,
    selectedFolder: null,
    currentFiles: [],
  })

  // Fetch models from API
  const fetchModels = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))

    try {
      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || ''
      const res = await fetch(`${basePath}/api/models?format=tree`)
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`)
      }

      const data = await res.json()

      // Extract flat list from tree
      const flattenTree = (node: FolderNode): ModelFile[] => {
        const files: ModelFile[] = [...node.files]
        for (const child of node.children) {
          files.push(...flattenTree(child))
        }
        return files
      }

      const flatList = flattenTree(data.tree)

      // Extract unique categories
      const categories = [...new Set(flatList.map(m => m.category))].sort()

      setState({
        tree: data.tree,
        flatList,
        categories,
        loading: false,
        error: null,
        selectedFolder: null,
        currentFiles: flatList, // Show all files initially
      })
    } catch (err) {
      setState(prev => ({
        ...prev,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load models',
      }))
    }
  }, [])

  // Fetch on mount
  useEffect(() => {
    fetchModels()
  }, [fetchModels])

  // Navigate to a folder in the tree
  const navigateToFolder = useCallback((folderPath: string | null) => {
    setState(prev => {
      if (!prev.tree) return prev

      // Root folder - show all
      if (!folderPath || folderPath === '/') {
        return {
          ...prev,
          selectedFolder: null,
          currentFiles: prev.flatList,
        }
      }

      // Find the folder node
      const findFolder = (node: FolderNode, targetPath: string): FolderNode | null => {
        if (node.path === targetPath) return node
        for (const child of node.children) {
          const found = findFolder(child, targetPath)
          if (found) return found
        }
        return null
      }

      const folder = findFolder(prev.tree, folderPath)
      if (!folder) return prev

      // Get all files in this folder and subfolders
      const getFilesRecursive = (node: FolderNode): ModelFile[] => {
        const files = [...node.files]
        for (const child of node.children) {
          files.push(...getFilesRecursive(child))
        }
        return files
      }

      return {
        ...prev,
        selectedFolder: folderPath,
        currentFiles: getFilesRecursive(folder),
      }
    })
  }, [])

  // Filter by category
  const filterByCategory = useCallback((category: string | null) => {
    setState(prev => ({
      ...prev,
      currentFiles: category
        ? prev.flatList.filter(m => m.category === category)
        : prev.flatList,
    }))
  }, [])

  return {
    ...state,
    refresh: fetchModels,
    navigateToFolder,
    filterByCategory,
  }
}
