import { useEffect } from 'react'
import { initStore, restoreExplicitPresetConfig, useStore } from './store'
import { buildSettingsFromUrlParams, clearUrlSettingParams, getExplicitUrlSettingsIds, hasUrlSettingParams } from './lib/urlSettings'
import { createDefaultOpenAIProfile, hasDefaultPresetConfig, isAgentTextApiProfile, normalizeSettings } from './lib/apiProfiles'
import { getCustomProviderConfigUrl, hasEmbeddedDefaultConfig, loadCustomProviderSettingsFromUrl, loadEmbeddedDefaultConfig } from './lib/customProviderConfigUrl'
import { getDefaultPresetProfileId, getPresetProfileIds, isPresetConfigOnlyEnabled, setPresetConfig } from './lib/presetConfig'
import { useDockerApiUrlMigrationNotice } from './hooks/useDockerApiUrlMigrationNotice'
import { useEntryNotice } from './hooks/useEntryNotice'
import type { AppSettings } from './types'
import Header from './components/Header'
import SearchBar from './components/SearchBar'
import TaskGrid from './components/TaskGrid'
import InputBar from './components/InputBar'
import DetailModal from './components/DetailModal'
import Lightbox from './components/Lightbox'
import ConfirmDialog from './components/ConfirmDialog'
import Toast from './components/Toast'
import MaskEditorModal from './components/MaskEditorModal'
import ImageContextMenu from './components/ImageContextMenu'
import SupportPromptModal from './components/SupportPromptModal'
import { FavoriteCollectionPickerModal, FavoriteCollectionsView, ManageCollectionsModal } from './components/FavoriteCollections'
import { useGlobalClickSuppression } from './lib/clickSuppression'
import KeySidebar from './components/KeySidebar'
import { isEmbeddedMode } from './lib/userKeys'


let defaultConfigImportStarted = false

// 嵌入模式（主应用 iframe 同源承载）在应用生命周期内不变，模块级求值一次即可
const EMBEDDED_MODE = isEmbeddedMode()

/**
 * 嵌入模式固定默认行为（配置不再暴露给用户调整）：
 * 请求默认返回 Base64 数据、baseUrl 归一为同源相对路径；流式开关按厂商归一——
 * openai 走流式 Images API（网关支持 SSE chunk），gemini generateContent 无流式概念。
 * 内置默认配置携带的是部署方绝对地址（如 https://sshzyu.com），在本地验证站点或
 * 其他同源部署下会发生跨域，请求立即 Failed to fetch；置空后 openai 走
 * /v1/images/generations（buildApiUrl 自动补 /v1 前缀）、gemini 走
 * /v1beta/models/{model}:generateContent（buildGeminiUrl 空地址默认相对路径），
 * 均与宿主同源。在默认配置导入/URL 应用完成后执行，保证不被初始化流程覆盖。
 */
function forceEmbeddedDefaults() {
  if (!EMBEDDED_MODE) return
  const { settings, setSettings } = useStore.getState()
  setSettings({
    profiles: settings.profiles.map((profile) => ({
      ...profile,
      streamImages: profile.provider !== 'gemini',
      responseFormatB64Json: true,
      baseUrl: '',
    })),
  })
}

export default function App() {
  const filterFavorite = useStore((s) => s.filterFavorite)
  const activeFavoriteCollectionId = useStore((s) => s.activeFavoriteCollectionId)
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)
  useDockerApiUrlMigrationNotice()
  useEntryNotice()
  useGlobalClickSuppression()

  useEffect(() => {
    if (!EMBEDDED_MODE) return
    // InputBar 为 fixed 底部居中，左侧 key 栏存在时整体右移半个侧栏宽度
    document.body.classList.add('embedded-with-sidebar')
    return () => document.body.classList.remove('embedded-with-sidebar')
  }, [])

  useEffect(() => {
    if (defaultConfigImportStarted) return
    defaultConfigImportStarted = true

    const searchParams = new URLSearchParams(window.location.search)
    const customProviderConfigUrl = getCustomProviderConfigUrl()
    const embeddedDefaultConfig = hasEmbeddedDefaultConfig()
    const loadDefaultConfig = () => embeddedDefaultConfig
      ? Promise.resolve().then(() => loadEmbeddedDefaultConfig())
      : loadCustomProviderSettingsFromUrl(customProviderConfigUrl)

    const applyUrlSettings = async (baseSettings: Partial<AppSettings>) => {
      const ids = getExplicitUrlSettingsIds(searchParams)
      const restored = await restoreExplicitPresetConfig(ids)
      const restoredSettings = useStore.getState().settings
      const sourceSettings = restored
        ? { ...restoredSettings, ...baseSettings, customProviders: restoredSettings.customProviders, profiles: restoredSettings.profiles }
        : baseSettings
      const nextSettings = buildSettingsFromUrlParams(sourceSettings, searchParams)
      return Object.keys(nextSettings).length ? nextSettings : sourceSettings
    }

    const clearAppliedUrlSettings = () => {
      if (!hasUrlSettingParams(searchParams)) return
      clearUrlSettingParams(searchParams)
      const nextSearch = searchParams.toString()
      const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ''}${window.location.hash}`
      window.history.replaceState(null, '', nextUrl)
    }

    void initStore()
      .then(async () => {
        const importedSettings = embeddedDefaultConfig || customProviderConfigUrl
          ? await loadDefaultConfig()
          : hasDefaultPresetConfig()
            ? { customProviders: [], profiles: [{ ...createDefaultOpenAIProfile(), isDefault: true }] }
            : null
        setPresetConfig(importedSettings)

        const state = useStore.getState()
        if (importedSettings) {
          await state.setPresetImportedSettings(importedSettings)
        } else if (state.previousPresetConfig) {
          await state.setPresetImportedSettings({ customProviders: [], profiles: [] })
        }

        const syncedState = useStore.getState()
        if (!importedSettings) {
          useStore.setState({ dismissedPresetProfileIds: [], dismissedPresetProviderIds: [] })
          if (syncedState.settings.profiles.some((profile) => profile.isDefault)) {
            syncedState.setSettings({ profiles: syncedState.settings.profiles.map((profile) => profile.isDefault ? { ...profile, isDefault: undefined } : profile) })
          }
        }

        const current = useStore.getState()
        const presetIds = getPresetProfileIds()
        const defaultPresetId = getDefaultPresetProfileId()
        const settings = isPresetConfigOnlyEnabled()
          ? normalizeSettings({
              ...current.settings,
              activeProfileId: presetIds.has(current.settings.activeProfileId) ? current.settings.activeProfileId : defaultPresetId ?? [...presetIds][0],
              agentTextProfileId: current.settings.agentTextProfileId && presetIds.has(current.settings.agentTextProfileId)
                ? current.settings.agentTextProfileId
                : current.settings.profiles.find((profile) => presetIds.has(profile.id) && isAgentTextApiProfile(profile))?.id ?? null,
              agentImageProfileId: current.settings.agentImageProfileId && presetIds.has(current.settings.agentImageProfileId) ? current.settings.agentImageProfileId : defaultPresetId ?? [...presetIds][0],
            })
          : current.settings
        current.setSettings(await applyUrlSettings(settings))
        clearAppliedUrlSettings()
        forceEmbeddedDefaults()
      })
      .catch((error) => {
        console.warn('Failed to import preset config:', error)
        setPresetConfig(null)
        const state = useStore.getState()
        void applyUrlSettings(state.settings).then((settings) => {
          useStore.getState().setSettings(settings)
          clearAppliedUrlSettings()
          forceEmbeddedDefaults()
        })
      })
  }, [])

  useEffect(() => {
    const preventPageImageDrag = (e: DragEvent) => {
      if ((e.target as HTMLElement | null)?.closest('img')) e.preventDefault()
    }
    document.addEventListener('dragstart', preventPageImageDrag)
    return () => document.removeEventListener('dragstart', preventPageImageDrag)
  }, [])

  useEffect(() => {
    // 嵌入模式下左侧 key 栏即配置入口，跳过首启强制弹窗
    if (EMBEDDED_MODE) return
    setConfirmDialog({
      title: '开始前请先配置',
      message: '请于左上角设置配置好模型和apikey。',
      showCancel: false,
      confirmText: '我知道了',
      icon: 'info',
      action: () => {},
    })
  }, [setConfirmDialog])

  return (
    <>
      <Header />
      {EMBEDDED_MODE && <KeySidebar />}
      <main data-home-main data-drag-select-surface className={`pb-48${EMBEDDED_MODE ? ' md:ml-60' : ''}`}>
        <div className="safe-area-x max-w-7xl mx-auto">
          <SearchBar />
          {filterFavorite && !activeFavoriteCollectionId ? <FavoriteCollectionsView /> : <TaskGrid />}
        </div>
      </main>
      <InputBar />
      <DetailModal />
      <Lightbox />
      <ConfirmDialog />
      <SupportPromptModal />
      <FavoriteCollectionPickerModal />
      <ManageCollectionsModal />
      <Toast />
      <MaskEditorModal />
      <ImageContextMenu />
    </>
  )
}
