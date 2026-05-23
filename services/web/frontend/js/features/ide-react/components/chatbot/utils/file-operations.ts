import { debugConsole } from '@/utils/debugging'
import { findEntityByPath } from '@/features/file-tree/util/path'

const normalizeLookupPath = (path: string) => path.replace(/^\.?\/+/, '').replace(/^\/+/, '')

export const findEntityByNameInTree = (
  folder: any,
  fileName: string,
  currentPath: string = ''
): { entity: any; type: 'fileRef' | 'doc'; fullPath: string } | null => {
  const lookupPath = normalizeLookupPath(fileName)
  const normalizedCurrentPath = normalizeLookupPath(currentPath)

  for (const doc of folder.docs ?? []) {
    const fullPath = normalizedCurrentPath ? `${normalizedCurrentPath}/${doc.name}` : doc.name
    if (fullPath === lookupPath || fullPath.endsWith(`/${lookupPath}`)) {
      return { entity: doc, type: 'doc', fullPath }
    }
  }

  for (const fileRef of folder.fileRefs ?? []) {
    const fullPath = normalizedCurrentPath ? `${normalizedCurrentPath}/${fileRef.name}` : fileRef.name
    if (fullPath === lookupPath || fullPath.endsWith(`/${lookupPath}`)) {
      return { entity: fileRef, type: 'fileRef', fullPath }
    }
  }

  for (const subfolder of folder.folders ?? []) {
    const newPath = normalizedCurrentPath ? `${normalizedCurrentPath}/${subfolder.name}` : subfolder.name
    const result = findEntityByNameInTree(subfolder, lookupPath, newPath)
    if (result) return result
  }

  return null
}

export const getFullFilePathForTooltip = (
  fileName: string,
  fileTreeData: any
): string => {
  if (!fileTreeData) return fileName

  // Primero intentar como path completo
  const resultByPath = findEntityByPath(fileTreeData, fileName)
  if (resultByPath) return fileName

  // Si no encontró, buscar por nombre
  const result = findEntityByNameInTree(fileTreeData, fileName)
  if (result) {
    return result.fullPath
  }

  return fileName
}

export const openEntityByPathUtil = (
  fileName: string,
  fileTreeData: any,
  editorManager: any,
  setEditorPanelOpen: (open: boolean) => void,
  setView: (view: any) => void
): void => {
  try {
    if (!fileTreeData) {
      debugConsole.warn('fileTreeData not available')
      return
    }
    debugConsole.log('Trying to open file:', fileName)

    // Primero intentar como path completo
    let result = findEntityByPath(fileTreeData, fileName)
    debugConsole.log('findEntityByPath result:', result)

    // Si no encontró, buscar por nombre solamente
    if (!result) {
      debugConsole.log('Not found by full path, searching by name...')
      result = findEntityByNameInTree(fileTreeData, fileName)
      debugConsole.log('findEntityByNameInTree result:', result)
    }

    if (!result) {
      debugConsole.warn('Entity not found for:', fileName)
      return
    }

    if (result.type === 'fileRef') {
      debugConsole.log('Opening fileRef with ID:', result.entity._id)
      setEditorPanelOpen(true)
      setView('file')
      editorManager.openFileWithId(result.entity._id)
    } else if (result.type === 'doc') {
      debugConsole.log('Opening doc with ID:', result.entity._id)
      setEditorPanelOpen(true)
      setView('editor')
      editorManager.openDocWithId(result.entity._id)
    }
  } catch (err) {
    debugConsole.error('Error opening entity:', err)
  }
}
