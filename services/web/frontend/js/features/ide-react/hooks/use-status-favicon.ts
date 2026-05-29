import { useDetachCompileContext as useCompileContext } from '@/shared/context/detach-compile-context'
import { useEffect, useState } from 'react'
import usePreviousValue from '@/shared/hooks/use-previous-value'
import getMeta from '@/utils/meta'

const RESET_AFTER_MS = 5_000

const COMPILE_ICONS = {
  ERROR: 'branding/favicon-error.svg?v=20260529',
  COMPILING: 'branding/favicon-compiling.svg?v=20260529',
  COMPILED: 'branding/favicon-compiled.svg?v=20260529',
  UNCOMPILED: 'branding/favicon.svg?v=20260529',
} as const

type CompileStatus = keyof typeof COMPILE_ICONS

const useCompileStatus = (): CompileStatus => {
  const compileContext = useCompileContext()
  if (compileContext.uncompiled) return 'UNCOMPILED'
  if (compileContext.compiling) return 'COMPILING'
  if (compileContext.error) return 'ERROR'
  return 'COMPILED'
}

const removeFavicon = () => {
  const existingFavicons = document.head.querySelectorAll(
    "link[rel*='icon']"
  ) as NodeListOf<HTMLLinkElement>
  existingFavicons.forEach(favicon => {
    try {
      const href = favicon.href || ''
      const pathname = new URL(href).pathname
      if (
        pathname.endsWith('.svg') ||
        href.includes('/branding/favicon') ||
        favicon.getAttribute('data-compile-status') === 'true'
      ) {
        favicon.parentNode?.removeChild(favicon)
      }
    } catch (err) {
      if (favicon.href && favicon.href.indexOf('.svg') !== -1) {
        favicon.parentNode?.removeChild(favicon)
      }
    }
  })
}

const updateFavicon = (status: CompileStatus = 'UNCOMPILED') => {
  removeFavicon()
  const linkElement = document.createElement('link')
  linkElement.rel = 'icon'
  linkElement.href = getMeta('ol-baseAssetPath') + COMPILE_ICONS[status]
  linkElement.type = 'image/svg+xml'
  linkElement.setAttribute('data-compile-status', 'true')
  document.head.appendChild(linkElement)
}

const isActive = () => !document.hidden

const useIsWindowActive = () => {
  const [isWindowActive, setIsWindowActive] = useState(isActive())
  useEffect(() => {
    const handleVisibilityChange = () => setIsWindowActive(isActive())
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])
  return isWindowActive
}

export const useStatusFavicon = () => {
  const compileStatus = useCompileStatus()
  const previousCompileStatus = usePreviousValue(compileStatus)
  const isWindowActive = useIsWindowActive()

  useEffect(() => {
    if (previousCompileStatus !== compileStatus) {
      return updateFavicon(compileStatus)
    }

    if (
      isWindowActive &&
      (compileStatus === 'COMPILED' || compileStatus === 'ERROR')
    ) {
      const timeout = setTimeout(updateFavicon, RESET_AFTER_MS)
      return () => clearTimeout(timeout)
    }
  }, [compileStatus, isWindowActive, previousCompileStatus])
}
