import { useEffect, useState } from 'react'
import { useStore } from '../store'
import { useVersionCheck } from '../hooks/useVersionCheck'
import { useTooltip } from '../hooks/useTooltip'
import { dismissAllTooltips } from '../lib/tooltipDismiss'
import ViewportTooltip from './ViewportTooltip'
import HelpModal from './HelpModal'
import { useFavoriteCollectionTitle } from './FavoriteCollections'
import { ExternalLinkIcon, HelpCircleIcon, SettingsIcon } from './icons'

export default function Header() {
  const setShowSettings = useStore((s) => s.setShowSettings)
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const favoriteCollectionTitle = useFavoriteCollectionTitle()
  const showFavoriteCollectionTitle = Boolean(activeFavoriteCollectionId)
  const { hasUpdate, latestRelease, dismiss } = useVersionCheck()
  const [showHelp, setShowHelp] = useState(false)
  const [scrollDirection, setScrollDirection] = useState<'up' | 'down'>('up')
  const helpTooltip = useTooltip()
  const settingsTooltip = useTooltip()
  const openWindowTooltip = useTooltip()

  useEffect(() => {
    let lastScrollY = window.scrollY
    let ticking = false

    const handleScroll = () => {
      if (ticking) return
      window.requestAnimationFrame(() => {
        const currentScrollY = window.scrollY
        if (currentScrollY < 20) {
          setScrollDirection('up')
        } else if (currentScrollY > lastScrollY + 10) {
          setScrollDirection('down')
        } else if (currentScrollY < lastScrollY - 10) {
          setScrollDirection('up')
        }
        lastScrollY = currentScrollY
        ticking = false
      })
      ticking = true
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  return (
    <>
      <header data-no-drag-select className="safe-area-top fixed top-0 left-0 right-0 z-40 bg-white/80 dark:bg-gray-950/80 backdrop-blur border-b border-gray-200 dark:border-white/[0.08]">
        <div className="safe-area-x safe-header-inner max-w-7xl mx-auto flex items-center justify-between relative">
          <div className="min-w-0 flex items-center gap-1">
            <h1 className="inline-flex min-w-0 items-start relative mr-1">
              {showFavoriteCollectionTitle ? (
                <>
                  <span className="min-w-0 truncate text-[17px] font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:hidden" title={favoriteCollectionTitle}>{favoriteCollectionTitle}</span>
                  <a
                    href="https://github.com/qiuy-collab/imageplayground"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hidden text-lg font-bold tracking-tight text-gray-800 transition-colors hover:text-gray-600 dark:text-gray-100 dark:hover:text-gray-300 sm:inline"
                  >
                    ImagePlayground
                  </a>
                </>
              ) : (
                <a
                  href="https://github.com/qiuy-collab/imageplayground"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[17px] sm:text-lg font-bold tracking-tight text-gray-800 dark:text-gray-100 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  ImagePlayground
                </a>
              )}
              {hasUpdate && latestRelease && (
                <a
                  href={latestRelease.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={dismiss}
                  className="absolute -right-1 -top-1 translate-x-full -translate-y-1/4 px-1 py-0.5 rounded-[4px] border border-red-500/30 text-[9px] font-black bg-red-500 text-white hover:bg-red-600 transition-all animate-fade-in leading-none shadow-sm"
                  title={`新版本 ${latestRelease.tag}`}
                >
                  NEW
                </a>
              )}
            </h1>

            <div className="relative" {...helpTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  setShowHelp(true)
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="操作指南"
              >
                <HelpCircleIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={helpTooltip.visible} className="whitespace-nowrap">操作指南</ViewportTooltip>
            </div>

            <div className="relative" {...settingsTooltip.handlers}>
              <button
                type="button"
                onClick={() => setShowSettings(true, 'api')}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="设置"
              >
                <SettingsIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={settingsTooltip.visible} className="whitespace-nowrap">设置</ViewportTooltip>
            </div>

            <div className="relative" {...openWindowTooltip.handlers}>
              <button
                type="button"
                onClick={() => {
                  dismissAllTooltips()
                  window.open(window.location.href, '_blank', 'noopener,noreferrer')
                }}
                className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-900 transition-colors"
                aria-label="在新窗口打开"
              >
                <ExternalLinkIcon className="w-5 h-5 text-gray-600 dark:text-gray-400" />
              </button>
              <ViewportTooltip visible={openWindowTooltip.visible} className="whitespace-nowrap">在新窗口打开</ViewportTooltip>
            </div>
          </div>

          {showFavoriteCollectionTitle && filterFavorite && (
            <div className="absolute left-1/2 top-1/2 hidden max-w-[30%] -translate-x-1/2 -translate-y-1/2 sm:flex">
              <div className="truncate rounded px-2 py-1 text-sm font-semibold text-gray-700 dark:text-gray-300" title={favoriteCollectionTitle}>
                {favoriteCollectionTitle}
              </div>
            </div>
          )}
        </div>
      </header>

      <div className="safe-area-top invisible pointer-events-none" aria-hidden="true">
        <div className="safe-header-inner" />
        <div className={`safe-area-x sm:hidden overflow-hidden transition-all duration-300 ease-in-out ${scrollDirection === 'down' ? 'max-h-0 pb-0' : 'max-h-20 pb-2'}`}>
          <div className="p-1"><div className="py-1.5 text-sm">占位</div></div>
        </div>
      </div>
      {showHelp && <HelpModal appMode="gallery" isFavoriteCollectionOverview={filterFavorite && !activeFavoriteCollectionId} onClose={() => setShowHelp(false)} />}
    </>
  )
}
