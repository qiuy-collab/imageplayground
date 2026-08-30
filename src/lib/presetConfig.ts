import type { ApiProfile, AppSettings, CustomProviderDefinition, PresetProviderPresets } from '../types'
import { readRuntimeEnv } from './runtimeEnv'

const RAW_SHOW_PRESET_CONFIG_ONLY = readRuntimeEnv(import.meta.env.VITE_SHOW_PRESET_CONFIG_ONLY)
const SHOW_PRESET_CONFIG_ONLY = (RAW_SHOW_PRESET_CONFIG_ONLY || readRuntimeEnv(import.meta.env.VITE_SHOW_DEFAULT_CONFIG_ONLY)) === 'true'
const LOCK_PRESET_CONFIG_PARAMS = readRuntimeEnv(import.meta.env.VITE_LOCK_PRESET_CONFIG_PARAMS) === 'true'
const PREVENT_PRESET_CONFIG_DELETION = readRuntimeEnv(import.meta.env.VITE_PREVENT_PRESET_CONFIG_DELETION) === 'true'
// 锁定预置参数时仍允许用户编辑的字段（逗号分隔），例如 VITE_PRESET_UNLOCKED_FIELDS=model 表示模型 ID 仅预填、可自行修改
const UNLOCKED_PRESET_FIELDS = readRuntimeEnv(import.meta.env.VITE_PRESET_UNLOCKED_FIELDS)
  .split(',')
  .map((field) => field.trim())
  .filter(Boolean)
// 豁免机制不可覆盖的受控字段：身份与鉴权始终由部署方/用户自身控制
const PROTECTED_PRESET_FIELDS = new Set(['id', 'apiKey', 'provider', 'isDefault'])
// 「单配置 + 类型切换」模式下允许用户在配置内切换的服务商类型
const SWITCHABLE_PRESET_PROVIDERS = new Set<string>(['openai', 'gemini'])

let presetProfiles: ApiProfile[] = []
let presetProviders: CustomProviderDefinition[] = []
let presetProfileFields: Record<string, string[]> | undefined
let presetProviderPresets: PresetProviderPresets | undefined
let defaultPresetProfileId: string | null = null

export function setPresetConfig(settings: Pick<AppSettings, 'customProviders' | 'profiles'> & {
  presetProfileFields?: Record<string, string[]>
  providerPresets?: PresetProviderPresets
} | null) {
  presetProfiles = settings?.profiles.map((profile) => ({ ...profile })) ?? []
  presetProviders = settings?.customProviders.map((provider) => ({ ...provider })) ?? []
  presetProfileFields = settings?.presetProfileFields
  presetProviderPresets = settings?.providerPresets
  defaultPresetProfileId = presetProfiles.length === 1
    ? presetProfiles[0].id
    : presetProfiles.find((profile) => profile.isDefault === true)?.id ?? null
}

export function getPresetProfileIds() {
  return new Set(presetProfiles.map((profile) => profile.id))
}

export function getPresetProfileDescription(id: string) {
  return presetProfiles.find((profile) => profile.id === id)?.description
}

export function getPresetProviderIds() {
  return new Set(presetProviders.map((provider) => provider.id))
}

export function getPresetConfig() {
  if (presetProfiles.length === 0 && presetProviders.length === 0) return null
  return {
    customProviders: presetProviders.map((provider) => ({ ...provider })),
    profiles: presetProfiles.map((profile) => ({ ...profile })),
    presetProfileFields,
  }
}

export function getDefaultPresetProfileId() {
  return defaultPresetProfileId
}

export function getDefaultPresetBaseUrl() {
  const profile = presetProfiles.find((profile) => profile.id === defaultPresetProfileId)
  if (!profile || profile.provider === 'fal') return ''
  return profile.baseUrl
}

export function isPresetProfile(id: string) {
  return presetProfiles.some((profile) => profile.id === id)
}

export function isPresetProvider(id: string) {
  return presetProviders.some((provider) => provider.id === id)
}

export function isPresetConfigOnlyEnabled() {
  return SHOW_PRESET_CONFIG_ONLY && presetProfiles.length > 0
}

export function isPresetConfigParamsLocked() {
  return LOCK_PRESET_CONFIG_PARAMS && presetProfiles.length > 0
}

export function isPresetConfigDeletionPrevented() {
  return (PREVENT_PRESET_CONFIG_DELETION || SHOW_PRESET_CONFIG_ONLY) && presetProfiles.length > 0
}

export function isPresetProfileLocked(id: string) {
  return isPresetConfigParamsLocked() && isPresetProfile(id)
}

export function isPresetProfileFieldUnlocked(field: string) {
  return presetProfiles.length > 0 && UNLOCKED_PRESET_FIELDS.includes(field.trim())
}

export function getPresetProviderPresets() {
  return presetProviderPresets
}

/** 「单配置 + 类型切换」模式：锁定部署提供了 providerPresets 时启用 */
export function isPresetProviderSwitchable() {
  return LOCK_PRESET_CONFIG_PARAMS && presetProfiles.length > 0 && Boolean(presetProviderPresets)
}

/** 该服务商类型是否在 providerPresets 允许切换的范围内 */
export function isPresetSwitchableProvider(provider: string) {
  if (!isPresetProviderSwitchable()) return false
  return SWITCHABLE_PRESET_PROVIDERS.has(provider.trim()) && Boolean(presetProviderPresets?.[provider.trim() as keyof PresetProviderPresets])
}

/**
 * 锁定部署下是否放行「服务商类型切换」的整包 patch。
 * 这类 patch 由 switchApiProfileProvider 生成（含 provider/baseUrl/model 等字段），
 * baseUrl/model 会再经 enforcePresetConfigPolicy 按预置归位，因此整包放行是安全的；
 * 不含 provider 字段的 patch（如自由编辑 URL）不在此列，仍走字段白名单。
 */
export function isPresetProviderSwitchPatch(patch: Partial<ApiProfile>) {
  if (!isPresetProviderSwitchable()) return false
  const { provider } = patch
  return typeof provider === 'string' && isPresetSwitchableProvider(provider)
}

function getPresetProviderPreset(provider: string) {
  return presetProviderPresets?.[provider.trim() as keyof PresetProviderPresets]
}

export function isPresetProviderLocked(id: string) {
  return isPresetConfigParamsLocked() && isPresetProvider(id)
}

export function isPresetProviderDeletionPrevented(id: string, profiles: ApiProfile[]) {
  if (!isPresetProvider(id)) return false
  if (isPresetConfigDeletionPrevented()) return true
  return profiles.some((profile) => profile.provider === id && isPresetProfileLocked(profile.id))
}

export function enforcePresetConfigPolicy(
  settings: AppSettings,
  options: { dismissedPresetProviderIds?: string[] } = {},
): AppSettings {
  const presetConfigOnly = isPresetConfigOnlyEnabled()
  const paramsLocked = isPresetConfigParamsLocked()
  if (presetProfiles.length === 0) return settings

  const dismissedProviderIds = new Set(options.dismissedPresetProviderIds ?? [])
  const profileIds = getPresetProfileIds()
  const presetProfilesById = new Map(presetProfiles.map((profile) => [profile.id, profile]))
  const presetProvidersById = new Map(presetProviders.map((provider) => [provider.id, provider]))
  const providerSwitchable = isPresetProviderSwitchable()
  let profiles = settings.profiles.map((profile) => {
    const preset = presetProfilesById.get(profile.id)
    if (!preset) return profile.isDefault ? { ...profile, isDefault: undefined } : profile
    // 类型切换模式：provider 放行为 providerPresets 内的类型，其余场景维持原有锁定行为
    const nextProvider = providerSwitchable && isPresetSwitchableProvider(profile.provider)
      ? profile.provider
      : (paramsLocked || presetConfigOnly ? preset.provider : profile.provider)
    const providerPreset = providerSwitchable ? getPresetProviderPreset(nextProvider) : undefined
    const enforced: ApiProfile = {
      ...(paramsLocked ? preset : profile),
      apiKey: profile.apiKey,
      provider: nextProvider,
      isDefault: profile.id === defaultPresetProfileId ? true : undefined,
    }
    if (providerSwitchable && profile.providerDrafts) enforced.providerDrafts = profile.providerDrafts
    if (providerPreset) {
      if (typeof providerPreset.baseUrl === 'string') enforced.baseUrl = providerPreset.baseUrl
      if (typeof providerPreset.model === 'string') enforced.model = providerPreset.model
    }
    if (paramsLocked) {
      const profileRecord = profile as unknown as Record<string, unknown>
      for (const field of UNLOCKED_PRESET_FIELDS) {
        if (PROTECTED_PRESET_FIELDS.has(field)) continue
        ;(enforced as unknown as Record<string, unknown>)[field] = profileRecord[field]
      }
    }
    return enforced
  })
  // 类型切换的锁定部署不允许删掉预置配置：它是用户唯一的配置来源
  if (isPresetConfigDeletionPrevented() || providerSwitchable) {
    for (const profile of presetProfiles) {
      if (!profiles.some((item) => item.id === profile.id)) profiles.push({ ...profile, isDefault: profile.id === defaultPresetProfileId ? true : undefined })
    }
  }
  // 单配置收敛：类型切换的锁定部署只保留预置配置；历史残留配置的 API Key 迁移到默认预置，避免用户重新填写
  if (providerSwitchable) {
    const legacyProfiles = profiles.filter((profile) => !profileIds.has(profile.id))
    if (legacyProfiles.length > 0) {
      const fallbackApiKey = legacyProfiles.find((profile) => profile.apiKey.trim())?.apiKey ?? ''
      profiles = profiles
        .filter((profile) => profileIds.has(profile.id))
        .map((profile) =>
          fallbackApiKey && profile.id === defaultPresetProfileId && !profile.apiKey.trim()
            ? { ...profile, apiKey: fallbackApiKey }
            : profile,
        )
    }
  }
  const customProviders = settings.customProviders.filter((provider) => !dismissedProviderIds.has(provider.id)).map((provider) => {
    const preset = presetProvidersById.get(provider.id)
    return preset && paramsLocked ? preset : provider
  })
  for (const provider of presetProviders) {
    if (dismissedProviderIds.has(provider.id)) continue
    if (!customProviders.some((item) => item.id === provider.id)) customProviders.push(provider)
  }
  const activeProfileId = (presetConfigOnly || providerSwitchable) && !profileIds.has(settings.activeProfileId)
    ? defaultPresetProfileId ?? presetProfiles[0]?.id ?? settings.activeProfileId
    : settings.activeProfileId
  const agentTextProfileId = (presetConfigOnly || providerSwitchable) && (!settings.agentTextProfileId || !profileIds.has(settings.agentTextProfileId))
    ? presetProfiles.find((profile) => profile.provider === 'openai' && profile.apiMode === 'responses')?.id ?? null
    : settings.agentTextProfileId
  const agentImageProfileId = (presetConfigOnly || providerSwitchable) && (!settings.agentImageProfileId || !profileIds.has(settings.agentImageProfileId))
    ? defaultPresetProfileId ?? presetProfiles[0]?.id ?? null
    : settings.agentImageProfileId

  return {
    ...settings,
    customProviders,
    profiles,
    activeProfileId,
    agentTextProfileId,
    agentImageProfileId,
  }
}
