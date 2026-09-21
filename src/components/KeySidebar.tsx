import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store'
import { getActiveApiProfile } from '../lib/apiProfiles'
import {
  fetchGatewayModels,
  fetchUserApiKeys,
  isImageCapablePlatform,
  isKeyUsable,
  maskKey,
  readEmbeddedAuth,
  type UserApiKey,
} from '../lib/userKeys'
import { RefreshIcon } from './icons'

type LoadState = 'loading' | 'ready' | 'error'

const REFRESH_INTERVAL_MS = 30_000

/** 网关模型探测失败时的回退选项（与本地 sub2api 网关实测一致）。 */
const FALLBACK_MODELS: Record<string, string[]> = {
  gemini: ['gemini-3-pro-image-preview', 'gemini-3.1-flash-image-preview'],
  openai: ['gpt-image-2.5', 'gpt-image-2'],
}

/**
 * 按厂商归一请求参数：openai 走流式 Images API（网关支持 SSE chunk），
 * gemini generateContent 无流式概念且固定返回 base64 inlineData。
 */
function providerParams(provider: 'openai' | 'gemini') {
  return provider === 'gemini'
    ? { streamImages: false, responseFormatB64Json: true }
    : { streamImages: true, responseFormatB64Json: true }
}

/**
 * 左侧「选择 key」常驻栏（仅主应用 iframe 嵌入模式渲染）。
 * 与宿主用户已创建的 key 实时同步：挂载时拉取、30s 轮询、回到前台时刷新。
 * 展示逻辑：
 * - 仅展示「可生图」的 key：分组平台为 openai / gemini（这两类平台具备生图请求形态）。
 * - 分区展示：OpenAI 区（Images API）与 Gemini 区（generateContent）。
 * - key 条目旁展示所属分组名。
 * 选中 key 按其分组平台自动路由服务商类型（openai/gemini），baseUrl 统一置空走同源相对路径
 * （openai → /v1/images/generations，gemini → /v1beta/models/{model}:generateContent），
 * 避免内置配置携带的绝对地址在本地/同源部署下跨域失败。
 * 显式选择模型时同样按模型名联动服务商、baseUrl 与请求参数（流式/返回格式），
 * 保证请求随所选厂商模型正确适配。
 * 无设置弹窗：配置不暴露给用户手动调整。
 */
export default function KeySidebar() {
  const setSettings = useStore((s) => s.setSettings)
  // getActiveApiProfile 每次返回新对象，不可直接放进 useStore selector——
  // 会令 useSyncExternalStore 快照永不稳定，触发 React #185 无限重渲染（白屏）。
  // 与 InputBar 的 useMemo 写法保持一致：先取稳定引用再派生。
  const settings = useStore((s) => s.settings)
  const activeProfile = useMemo(() => getActiveApiProfile(settings), [settings])
  const activeApiKey = activeProfile.apiKey
  const [keys, setKeys] = useState<UserApiKey[]>([])
  const [state, setState] = useState<LoadState>('loading')
  const [errorMsg, setErrorMsg] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const authRef = useRef(readEmbeddedAuth())
  const modelsCacheRef = useRef(new Map<string, string[]>())

  const load = useCallback(async (showSpinner: boolean) => {
    const auth = authRef.current ?? readEmbeddedAuth()
    authRef.current = auth
    if (!auth) {
      setState('error')
      setErrorMsg('缺少登录凭证，请从主应用侧边栏进入生图页')
      return
    }
    if (showSpinner) setRefreshing(true)
    try {
      const list = await fetchUserApiKeys(auth.token)
      setKeys(list)
      setState('ready')
      setErrorMsg('')
    } catch (error) {
      setState((prev) => {
        // 已有列表时保持可用，仅静默保留旧数据
        if (prev === 'ready') return 'ready'
        setErrorMsg(error instanceof Error ? error.message : '获取 key 列表失败')
        return 'error'
      })
    } finally {
      if (showSpinner) setRefreshing(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const timer = window.setInterval(() => void load(false), REFRESH_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  // 选中 key 变化时，拉取该 key 所属网关支持的模型（缓存优先，失败回退静态列表）
  useEffect(() => {
    if (!activeApiKey) {
      setModels([])
      return
    }
    const cached = modelsCacheRef.current.get(activeApiKey)
    if (cached) {
      setModels(cached)
      return
    }
    const controller = new AbortController()
    fetchGatewayModels(activeApiKey, controller.signal)
      .then((list) => {
        if (list.length === 0) return
        modelsCacheRef.current.set(activeApiKey, list)
        setModels(list)
        // 模型列表到达后回填：当前模型为空或不在该 key 支持列表中时，自动选中第一个，
        // 避免「选了 key 但模型仍是内置默认值（如 gpt-image-2），该 key 的分组并不支持」的错配。
        const { settings: currentSettings, setSettings: patchSettings } = useStore.getState()
        const targetId = currentSettings.activeProfileId
        const currentModel = currentSettings.profiles.find((profile) => profile.id === targetId)?.model ?? ''
        if (!currentModel.trim() || !list.includes(currentModel.trim())) {
          patchSettings({
            profiles: currentSettings.profiles.map((profile) =>
              profile.id === targetId ? { ...profile, model: list[0] } : profile,
            ),
          })
        }
      })
      .catch(() => {})
    return () => controller.abort()
  }, [activeApiKey])

  const fallbackModels = FALLBACK_MODELS[activeProfile.provider] ?? FALLBACK_MODELS.openai
  const modelOptions = models.length > 0 ? models : fallbackModels

  const selectKey = (item: UserApiKey) => {
    const { settings: currentSettings } = useStore.getState()
    const targetId = currentSettings.activeProfileId
    // 按分组平台自动路由服务商：openai → Images API，gemini → generateContent。
    // baseUrl 置空：请求走同源相对路径（空 baseUrl 时 /v1 前缀由 buildApiUrl 自动补齐）。
    // model 置空：待该 key 的网关模型探测返回后回填第一个可用模型。
    // 请求参数按厂商归一（流式/返回格式），见 providerParams。
    const provider = item.groupPlatform.trim() === 'gemini' ? 'gemini' : 'openai'
    setSettings({
      profiles: currentSettings.profiles.map((profile) =>
        profile.id === targetId
          ? { ...profile, apiKey: item.key, provider, baseUrl: '', model: '', ...providerParams(provider) }
          : profile,
      ),
    })
  }

  const selectModel = (model: string) => {
    const { settings: currentSettings } = useStore.getState()
    const targetId = currentSettings.activeProfileId
    // 显式选择模型时按模型名联动请求形态：gemini 模型走 generateContent，
    // 其余（gpt-image / dall-e 等）走 Images API；provider 变化时同步重置 baseUrl
    // 并按厂商归一请求参数（流式/返回格式），见 providerParams。
    const provider = /gemini/i.test(model) ? 'gemini' : 'openai'
    setSettings({
      profiles: currentSettings.profiles.map((profile) => {
        if (profile.id !== targetId) return profile
        if (profile.provider === provider) return { ...profile, model }
        return { ...profile, model, provider, baseUrl: '', ...providerParams(provider) }
      }),
    })
  }

  // 仅展示可生图的 key，并按厂商分区
  const partitions = useMemo(() => {
    const source = keys.filter((item) => isImageCapablePlatform(item.groupPlatform))
    const usableFirst = (a: UserApiKey, b: UserApiKey) => Number(isKeyUsable(b.status)) - Number(isKeyUsable(a.status))
    const openai = source.filter((item) => item.groupPlatform.trim() === 'openai').sort(usableFirst)
    const gemini = source.filter((item) => item.groupPlatform.trim() === 'gemini').sort(usableFirst)
    return { openai, gemini }
  }, [keys])

  const renderModelOptions = () => (
    <div className="mb-1 ml-1 rounded-lg border border-dashed border-gray-200 bg-gray-50/60 px-2 py-1.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
      <p className="mb-1 text-[10px] font-medium tracking-wide text-gray-400 dark:text-gray-500">模型</p>
      <div className="flex flex-wrap gap-1">
        {modelOptions.map((model) => {
          const selected = activeProfile.model === model
          return (
            <button
              key={model}
              type="button"
              onClick={() => selectModel(model)}
              title={selected ? `当前模型：${model}` : `切换到 ${model}`}
              className={`max-w-full truncate rounded-md border px-1.5 py-0.5 font-mono text-[10px] transition-colors ${
                selected
                  ? 'border-blue-500/70 bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'border-gray-200 text-gray-500 hover:border-gray-300 hover:text-gray-700 dark:border-white/[0.08] dark:text-gray-400 dark:hover:text-gray-200'
              }`}
            >
              {model}
            </button>
          )
        })}
      </div>
    </div>
  )

  const renderKeyItem = (item: UserApiKey, usable: boolean) => {
    const selected = Boolean(activeApiKey) && activeApiKey === item.key
    const groupLabel = item.groupName || (item.groupId ? `分组 #${item.groupId}` : '未分组')
    return (
      <li key={item.id || item.key}>
        <button
          type="button"
          disabled={!usable}
          onClick={() => selectKey(item)}
          title={usable ? `使用「${item.name}」（${groupLabel}）` : `该 key 当前不可用（${item.status}）`}
          className={`w-full rounded-lg border px-3 py-2 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-45 ${
            selected
              ? 'border-blue-500/70 bg-blue-50 dark:bg-blue-500/10'
              : 'border-gray-200 hover:bg-gray-100 dark:border-white/[0.08] dark:hover:bg-white/[0.06]'
          }`}
        >
          <span className="flex items-center gap-1.5">
            <span className={`min-w-0 flex-1 truncate text-[13px] font-medium ${selected ? 'text-blue-600 dark:text-blue-400' : 'text-gray-800 dark:text-gray-100'}`}>
              {item.name}
            </span>
            <span
              className={`shrink-0 max-w-[88px] truncate rounded px-1 py-0.5 text-[10px] leading-none ${
                selected
                  ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400'
                  : 'bg-gray-100 text-gray-500 dark:bg-white/[0.06] dark:text-gray-400'
              }`}
              title={`所属分组：${groupLabel}`}
            >
              {groupLabel}
            </span>
            {selected && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-blue-500" aria-hidden />}
          </span>
          <span className="mt-0.5 block truncate font-mono text-[11px] text-gray-400 dark:text-gray-500">
            {maskKey(item.key)}
          </span>
        </button>
        {selected && usable && renderModelOptions()}
      </li>
    )
  }

  const renderPartition = (title: string, items: UserApiKey[]) => {
    if (items.length === 0) return null
    return (
      <section className="mt-3 first:mt-0">
        <p className="mb-1.5 px-1 text-[11px] font-semibold tracking-wide text-gray-400 dark:text-gray-500">{title}</p>
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => renderKeyItem(item, isKeyUsable(item.status)))}
        </ul>
      </section>
    )
  }

  const totalVisible = partitions.openai.length + partitions.gemini.length

  return (
    <aside
      data-no-drag-select
      className="fixed left-0 top-14 bottom-0 z-30 hidden w-60 flex-col overflow-y-auto border-r border-gray-200 bg-white px-3 py-4 md:flex dark:border-white/[0.08] dark:bg-gray-950"
      aria-label="选择 key"
    >
      <div className="mb-3 flex items-center justify-between px-1">
        <div className="min-w-0">
          <h2 className="text-[13px] font-bold tracking-tight text-gray-800 dark:text-gray-100">选择 Key</h2>
          <p className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-gray-500">来自你创建的 API Keys</p>
        </div>
        <button
          type="button"
          onClick={() => void load(true)}
          disabled={refreshing}
          className="rounded-md p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50 dark:hover:bg-white/[0.06] dark:hover:text-gray-300"
          aria-label="刷新 key 列表"
        >
          <RefreshIcon className={refreshing ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
        </button>
      </div>

      {state === 'loading' && (
        <p className="px-1 text-[12px] text-gray-400 dark:text-gray-500">正在获取 key 列表…</p>
      )}

      {state === 'error' && (
        <div className="px-1">
          <p className="text-[12px] leading-relaxed text-red-500">{errorMsg}</p>
          <button
            type="button"
            onClick={() => void load(true)}
            className="mt-2 rounded-md border border-gray-200 px-2.5 py-1 text-[12px] text-gray-600 transition-colors hover:bg-gray-100 dark:border-white/[0.08] dark:text-gray-300 dark:hover:bg-white/[0.06]"
          >
            重试
          </button>
        </div>
      )}

      {state === 'ready' && totalVisible === 0 && (
        <p className="px-1 text-[12px] leading-relaxed text-gray-400 dark:text-gray-500">
          没有可生图的 Key：请将 key 绑定到 OpenAI 或 Gemini 分组后刷新
        </p>
      )}

      {state === 'ready' && (
        <>
          {renderPartition('OpenAI', partitions.openai)}
          {renderPartition('Gemini', partitions.gemini)}
        </>
      )}
    </aside>
  )
}
