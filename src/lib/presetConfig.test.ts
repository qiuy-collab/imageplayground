import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('preset config policy', () => {
  it('exposes every current preset profile in preset-only mode', async () => {
    vi.stubEnv('VITE_SHOW_PRESET_CONFIG_ONLY', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({
      customProviders: [],
      profiles: [
        createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true }),
        createDefaultFalProfile({ id: 'preset-b' }),
      ],
    })

    expect(policy.isPresetConfigOnlyEnabled()).toBe(true)
    expect(policy.getPresetProfileIds()).toEqual(new Set(['preset-a', 'preset-b']))
    expect(policy.getDefaultPresetProfileId()).toBe('preset-a')
  })

  it('exposes an optional Markdown description for preset profiles', async () => {
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({
      customProviders: [],
      profiles: [createDefaultOpenAIProfile({ id: 'preset-a', description: '使用 [说明](https://example.com)' })],
    })

    expect(policy.getPresetProfileDescription('preset-a')).toBe('使用 [说明](https://example.com)')
    expect(policy.getPresetProfileDescription('missing')).toBeUndefined()
  })

  it('accepts the legacy preset-only environment variable', async () => {
    vi.stubEnv('VITE_SHOW_DEFAULT_CONFIG_ONLY', 'true')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({ customProviders: [], profiles: [createDefaultOpenAIProfile()] })

    expect(policy.isPresetConfigOnlyEnabled()).toBe(true)
  })

  it('locks preset parameters and providers except API keys without preventing profile deletion', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const source = createDefaultOpenAIProfile({
      id: 'preset-a',
      isDefault: true,
      provider: 'preset-provider',
      baseUrl: 'https://preset.example.com/v1',
      apiKey: 'deployed-key',
      model: 'preset-model',
    })
    const user = createDefaultFalProfile({ id: 'user-profile', model: 'user-model' })
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const removed = createDefaultOpenAIProfile({ id: 'preset-removed', provider: provider.id })
    policy.setPresetConfig({ customProviders: [provider], profiles: [source, removed] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [{ ...provider, submit: { path: 'local/generate' } }],
      profiles: [{ ...source, baseUrl: 'https://local.example.com/v1', apiKey: 'user-key', model: 'local-model' }, user],
      activeProfileId: user.id,
    }))

    expect(enforced.profiles[0]).toMatchObject({
      id: source.id,
      baseUrl: 'https://preset.example.com/v1',
      apiKey: 'user-key',
      model: 'preset-model',
    })
    expect(enforced.profiles[1]).toMatchObject({ id: user.id, model: 'user-model' })
    expect(enforced.profiles.some((profile) => profile.id === removed.id)).toBe(false)
    expect(enforced.customProviders[0]).toEqual(provider)
    expect(enforced.activeProfileId).toBe(user.id)
    expect(policy.isPresetConfigDeletionPrevented()).toBe(false)
    expect(policy.isPresetProviderLocked(provider.id)).toBe(true)
    expect(policy.isPresetProviderDeletionPrevented(provider.id, enforced.profiles)).toBe(true)
    expect(policy.isPresetProviderDeletionPrevented('user-provider', enforced.profiles)).toBe(false)
  })

  it('allows removed presets to stay deleted by default', async () => {
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true })
    const presetB = createDefaultFalProfile({ id: 'preset-b' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetA, user],
      activeProfileId: user.id,
    }))

    expect(policy.isPresetProfile(presetA.id)).toBe(true)
    expect(policy.isPresetProfile(presetB.id)).toBe(true)
    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile'])
  })

  it('preserves the user order when the default preset is not first', async () => {
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true })
    const presetB = createDefaultFalProfile({ id: 'preset-b' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetB, user, presetA],
      activeProfileId: user.id,
    }))

    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-b', 'user-profile', 'preset-a'])
    expect(enforced.profiles[2].isDefault).toBe(true)
  })

  it('restores removed presets when deletion is prevented', async () => {
    vi.stubEnv('VITE_PREVENT_PRESET_CONFIG_DELETION', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true })
    const presetB = createDefaultFalProfile({ id: 'preset-b' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [provider], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [{ ...provider, submit: { path: 'local/generate' } }],
      profiles: [presetA, user],
      activeProfileId: user.id,
    }))

    expect(policy.isPresetConfigDeletionPrevented()).toBe(true)
    expect(policy.isPresetConfigParamsLocked()).toBe(false)
    expect(policy.isPresetProviderLocked(provider.id)).toBe(false)
    expect(policy.isPresetProviderDeletionPrevented(provider.id, enforced.profiles)).toBe(true)
    expect(enforced.customProviders[0].submit.path).toBe('local/generate')
    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile', 'preset-b'])
  })

  it('preserves dismissed provider IDs while deletion is prevented', async () => {
    vi.stubEnv('VITE_PREVENT_PRESET_CONFIG_DELETION', 'true')
    const { createDefaultOpenAIProfile, DEFAULT_SETTINGS, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const { useStore } = await import('../store')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const profile = createDefaultOpenAIProfile({ id: 'preset-profile', provider: provider.id })
    const preset = { customProviders: [provider], profiles: [profile] }
    policy.setPresetConfig(preset)
    useStore.setState({
      settings: normalizeSettings({ ...DEFAULT_SETTINGS, customProviders: [], profiles: [] }),
      dismissedPresetProviderIds: [provider.id],
    })

    await useStore.getState().setPresetImportedSettings(preset)
    useStore.getState().setSettings({ profiles: [profile] })

    const state = useStore.getState()
    expect(state.settings.customProviders).toEqual([expect.objectContaining({ id: provider.id })])
    expect(state.dismissedPresetProviderIds).toEqual([provider.id])
  })

  it('always prevents preset provider deletion in preset-only mode', async () => {
    vi.stubEnv('VITE_SHOW_PRESET_CONFIG_ONLY', 'true')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const profile = createDefaultOpenAIProfile({ id: 'preset-profile', provider: 'openai' })
    policy.setPresetConfig({ customProviders: [provider], profiles: [profile] })

    expect(policy.isPresetProviderDeletionPrevented(provider.id, [])).toBe(true)
  })

  it('locks preset parameters without restoring their deployment order', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const presetA = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true, model: 'preset-a-model' })
    const presetB = createDefaultFalProfile({ id: 'preset-b', model: 'preset-b-model' })
    const user = createDefaultOpenAIProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [], profiles: [presetA, presetB] })

    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      profiles: [presetA, user, { ...presetB, model: 'local-model' }],
      activeProfileId: user.id,
    }))

    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['preset-a', 'user-profile', 'preset-b'])
    expect(enforced.profiles[2].model).toBe('preset-b-model')
  })

  it('restores a dismissed provider while a current locked preset profile references it', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const source = createDefaultOpenAIProfile({
      id: 'preset-profile',
      provider: provider.id,
      model: 'preset-model',
    })
    policy.setPresetConfig({ customProviders: [provider], profiles: [source] })
    const deleted = normalizeSettings({
      customProviders: [],
      profiles: [{ ...source, provider: 'openai', model: 'local-openai-model' }],
    })

    expect(policy.isPresetProviderDeletionPrevented(provider.id, [source])).toBe(true)

    const enforced = policy.enforcePresetConfigPolicy(deleted, { dismissedPresetProviderIds: [] })

    expect(enforced.customProviders).toEqual([provider])
    expect(enforced.profiles[0]).toMatchObject({
      id: source.id,
      provider: provider.id,
      model: 'preset-model',
    })
  })

  it('allows a dismissed provider to stay deleted after its only preset profile is deleted', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultFalProfile, createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const source = createDefaultOpenAIProfile({ id: 'preset-profile', provider: provider.id })
    const user = createDefaultFalProfile({ id: 'user-profile' })
    policy.setPresetConfig({ customProviders: [provider], profiles: [source] })

    expect(policy.isPresetProviderDeletionPrevented(provider.id, [])).toBe(false)

    const merged = (await import('./apiProfiles')).mergePresetImportedSettings({
      customProviders: [],
      profiles: [user],
      activeProfileId: user.id,
    }, { customProviders: [provider], profiles: [source] }, {
      lockPresetParams: true,
      dismissedPresetProfileIds: [source.id],
      dismissedPresetProviderIds: [provider.id],
    }).settings
    const reloaded = policy.enforcePresetConfigPolicy(merged, {
      dismissedPresetProviderIds: [provider.id],
    })

    expect(reloaded.customProviders).toEqual([])
    expect(reloaded.profiles.map((profile) => profile.id)).toEqual([user.id])
  })

  it('keeps a shared provider protected while another current locked preset profile references it', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const provider = { id: 'preset-provider', name: 'Preset Provider', submit: { path: 'generate' } }
    const profiles = [
      createDefaultOpenAIProfile({ id: 'preset-a', provider: provider.id, isDefault: true }),
      createDefaultOpenAIProfile({ id: 'preset-b', provider: provider.id }),
    ]
    policy.setPresetConfig({ customProviders: [provider], profiles })

    expect(policy.isPresetProviderDeletionPrevented(provider.id, [profiles[1]])).toBe(true)
  })

  it('uses the default OpenAI-compatible preset URL but not the fal.ai URL as the empty-field fallback', async () => {
    const { createDefaultFalProfile, createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({
      customProviders: [],
      profiles: [createDefaultOpenAIProfile({ id: 'openai-preset', baseUrl: 'https://preset.example.com/v1' })],
    })
    expect(policy.getDefaultPresetBaseUrl()).toBe('https://preset.example.com/v1')

    policy.setPresetConfig({
      customProviders: [],
      profiles: [createDefaultFalProfile({ id: 'fal-preset', baseUrl: 'https://fal-proxy.example.com' })],
    })
    expect(policy.getDefaultPresetBaseUrl()).toBe('')
  })

  it('does not unlock any preset field by default', async () => {
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({ customProviders: [], profiles: [createDefaultOpenAIProfile({ id: 'preset-a' })] })

    expect(policy.isPresetProfileFieldUnlocked('model')).toBe(false)
    expect(policy.isPresetProfileFieldUnlocked('baseUrl')).toBe(false)
  })

  it('keeps locked baseUrl but preserves the user-edited model when model is unlocked', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const preset = createDefaultOpenAIProfile({
      id: 'preset-a',
      isDefault: true,
      baseUrl: 'https://preset.example.com/v1',
      model: 'preset-model',
    })
    policy.setPresetConfig({ customProviders: [], profiles: [preset] })

    expect(policy.isPresetProfileFieldUnlocked('model')).toBe(true)
    expect(policy.isPresetProfileFieldUnlocked('baseUrl')).toBe(false)

    const user = createDefaultOpenAIProfile({
      id: 'preset-a',
      baseUrl: 'https://user-edited.example.com/v1',
      model: 'user-model',
      apiKey: 'user-key',
    })
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [user] }))

    expect(enforced.profiles).toHaveLength(1)
    expect(enforced.profiles[0].baseUrl).toBe('https://preset.example.com/v1')
    expect(enforced.profiles[0].model).toBe('user-model')
    expect(enforced.profiles[0].apiKey).toBe('user-key')
    expect(enforced.profiles[0].provider).toBe('openai')
  })

  it('never unlocks protected preset fields even when listed', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model,provider,apiKey,id,isDefault')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const preset = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true, baseUrl: 'https://preset.example.com/v1', model: 'preset-model' })
    policy.setPresetConfig({ customProviders: [], profiles: [preset] })

    const user = createDefaultOpenAIProfile({
      id: 'preset-a',
      provider: 'gemini',
      model: 'user-model',
      apiKey: 'user-key',
      baseUrl: 'https://user-edited.example.com/v1',
    })
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [user] }))

    expect(enforced.profiles[0].provider).toBe('openai')
    expect(enforced.profiles[0].apiKey).toBe('user-key')
    expect(enforced.profiles[0].model).toBe('user-model')
  })
})

describe('preset provider switch mode (single profile + providerPresets)', () => {
  const PRESET_PROVIDER_PRESETS = {
    openai: { baseUrl: 'https://gateway.example.com/v1', model: 'gpt-image2' },
    gemini: { baseUrl: 'https://gateway.example.com', model: 'gemini-3.1-flash-image-preview' },
  }

  async function setup() {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model')
    const { createDefaultOpenAIProfile, normalizeSettings, switchApiProfileProvider } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const preset = createDefaultOpenAIProfile({
      id: 'default-openai',
      isDefault: true,
      name: '官网图片',
      baseUrl: 'https://gateway.example.com/v1',
      model: 'gpt-image2',
    })
    policy.setPresetConfig({ customProviders: [], profiles: [preset], providerPresets: PRESET_PROVIDER_PRESETS })
    return { policy, normalizeSettings, preset, switchApiProfileProvider }
  }

  it('lets the user switch between the declared provider types while pinning each baseUrl', async () => {
    const { policy, normalizeSettings, preset } = await setup()
    expect(policy.isPresetProviderSwitchable()).toBe(true)
    expect(policy.isPresetSwitchableProvider('openai')).toBe(true)
    expect(policy.isPresetSwitchableProvider('gemini')).toBe(true)
    expect(policy.isPresetSwitchableProvider('fal')).toBe(false)

    const switchedToGemini = { ...preset, provider: 'gemini' as const, model: 'gemini-3.1-flash-image-preview' }
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [switchedToGemini] }))

    expect(enforced.profiles[0].provider).toBe('gemini')
    expect(enforced.profiles[0].baseUrl).toBe('https://gateway.example.com')
    expect(enforced.profiles[0].model).toBe('gemini-3.1-flash-image-preview')
  })

  it('keeps the user-edited model per provider type', async () => {
    const { policy, normalizeSettings, preset } = await setup()
    const openaiEdited = { ...preset, provider: 'openai' as const, model: 'my-custom-gpt-model' }
    const enforcedOpenAI = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [openaiEdited] }))
    expect(enforcedOpenAI.profiles[0].model).toBe('my-custom-gpt-model')

    const geminiEdited = { ...preset, provider: 'gemini' as const, model: 'my-custom-gemini-model' }
    const enforcedGemini = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [geminiEdited] }))
    expect(enforcedGemini.profiles[0].provider).toBe('gemini')
    expect(enforcedGemini.profiles[0].model).toBe('my-custom-gemini-model')
    expect(enforcedGemini.profiles[0].baseUrl).toBe('https://gateway.example.com')
  })

  it('falls back to the preset provider for types outside the switch list', async () => {
    const { policy, normalizeSettings, preset } = await setup()
    const falProfile = { ...preset, provider: 'fal' as const, baseUrl: 'https://fal.run' }
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [falProfile] }))

    expect(enforced.profiles[0].provider).toBe('openai')
    expect(enforced.profiles[0].baseUrl).toBe('https://gateway.example.com/v1')
  })

  it('collapses legacy profiles into the single preset and carries over an API key', async () => {
    const { policy, normalizeSettings, preset } = await setup()
    const legacyGemini = { ...preset, id: 'preset-gemini', provider: 'gemini' as const, apiKey: 'legacy-key', baseUrl: 'https://gateway.example.com' }
    const legacyCustom = { ...preset, id: 'legacy-openai', apiKey: 'another-key' }
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [],
      profiles: [legacyGemini, legacyCustom],
      activeProfileId: legacyCustom.id,
    }))

    expect(enforced.profiles).toHaveLength(1)
    expect(enforced.profiles[0].id).toBe('default-openai')
    expect(enforced.profiles[0].apiKey).toBe('legacy-key')
    expect(enforced.activeProfileId).toBe('default-openai')
  })

  it('restores the preset profile even after the user deleted it', async () => {
    const { policy, normalizeSettings, preset } = await setup()
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [],
      profiles: [{ ...preset, id: 'legacy-openai', apiKey: 'legacy-key' }],
      activeProfileId: 'legacy-openai',
    }))

    expect(enforced.profiles.map((profile) => profile.id)).toEqual(['default-openai'])
    expect(enforced.profiles[0].apiKey).toBe('legacy-key')
    expect(enforced.activeProfileId).toBe('default-openai')
  })

  it('stays locked to the preset provider when providerPresets is absent', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const preset = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true, baseUrl: 'https://preset.example.com/v1', model: 'preset-model' })
    policy.setPresetConfig({ customProviders: [], profiles: [preset] })

    expect(policy.isPresetProviderSwitchable()).toBe(false)
    const switched = { ...preset, provider: 'gemini' as const }
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [switched] }))
    expect(enforced.profiles[0].provider).toBe('openai')
    expect(enforced.profiles[0].baseUrl).toBe('https://preset.example.com/v1')
  })

  it('admits only declared provider-type switch patches through the locked-patch gate', async () => {
    const { policy, preset } = await setup()

    expect(policy.isPresetProviderSwitchPatch({ ...preset, provider: 'gemini' as const, baseUrl: '', model: 'x' })).toBe(true)
    expect(policy.isPresetProviderSwitchPatch({ ...preset, provider: 'openai' as const })).toBe(true)
    expect(policy.isPresetProviderSwitchPatch({ ...preset, provider: 'fal' as const })).toBe(false)
    // 不含 provider 字段的自由编辑 patch 不放行，仍走字段白名单
    expect(policy.isPresetProviderSwitchPatch({ baseUrl: 'https://evil.example.com' })).toBe(false)
  })

  it('keeps the provider switch reachable at the UI guard level in a locked deployment', async () => {
    const { policy, preset, switchApiProfileProvider } = await setup()
    // SettingsModal 三处守卫均由这些 lib 判定决定（组件无测试设施，等价覆盖）：
    //   select.disabled = presetConfigOnly || (activeProfileLocked && !isPresetProviderSwitchable())
    //   handleProviderTypeChange 早退 = presetConfigOnly || (activeProfileLocked && !providerSwitchable)
    //   patch 白名单 = isPresetProviderSwitchPatch(patch)
    const switchPatch = switchApiProfileProvider(preset, 'gemini')

    expect(policy.isPresetConfigOnlyEnabled()).toBe(false)
    expect(policy.isPresetProviderSwitchable()).toBe(true)
    expect(policy.isPresetSwitchableProvider('gemini')).toBe(true)
    expect(policy.isPresetProviderSwitchPatch(switchPatch)).toBe(true)
  })

  it('prefills the preset URL and model on the first real switch to gemini', async () => {
    const { policy, normalizeSettings, preset, switchApiProfileProvider } = await setup()
    // 首次切换无 gemini 存档：switchApiProfileProvider 落默认值（baseUrl='' + DEFAULT_GEMINI_MODEL），
    // 由 enforce 按预置归位；此用例同时防止 DEFAULT_GEMINI_MODEL 与预置模型漂移
    const switched = switchApiProfileProvider(preset, 'gemini')
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [switched] }))

    expect(enforced.profiles[0].provider).toBe('gemini')
    expect(enforced.profiles[0].baseUrl).toBe('https://gateway.example.com')
    expect(enforced.profiles[0].model).toBe('gemini-3.1-flash-image-preview')
    expect(enforced.profiles[0].providerDrafts?.openai?.model).toBe('gpt-image2')
  })

  it('restores the per-type draft when switching back to openai', async () => {
    const { policy, normalizeSettings, preset, switchApiProfileProvider } = await setup()
    const editedOpenAI = { ...preset, model: 'my-gpt-model' }
    const toGemini = switchApiProfileProvider(editedOpenAI, 'gemini')
    const backToOpenAI = switchApiProfileProvider(toGemini, 'openai')
    const enforced = policy.enforcePresetConfigPolicy(normalizeSettings({ customProviders: [], profiles: [backToOpenAI] }))

    expect(enforced.profiles[0].provider).toBe('openai')
    expect(enforced.profiles[0].baseUrl).toBe('https://gateway.example.com/v1')
    expect(enforced.profiles[0].model).toBe('my-gpt-model')
  })

  it('pins the preset baseUrl into the draft on the first switch to gemini (before any enforce runs)', async () => {
    const { policy, preset, switchApiProfileProvider } = await setup()
    // 复现线上 bug：首切 gemini 时 switchApiProfileProvider 落空 baseUrl fallback，
    // 运行中保存不经过 enforce，空 URL 会直接显示并持久化。
    // UI 层修复 = 写入 draft 前先过 applyPresetProviderSwitch
    const switched = switchApiProfileProvider(preset, 'gemini')
    expect(switched.baseUrl).toBe('')

    const pinned = policy.applyPresetProviderSwitch(switched, 'gemini')
    expect(pinned.baseUrl).toBe('https://gateway.example.com')
    expect(pinned.model).toBe('gemini-3.1-flash-image-preview')
    // providerDrafts 里的 openai 存档不受影响
    expect(pinned.providerDrafts?.openai?.model).toBe('gpt-image2')
  })

  it('pins the preset baseUrl when switching back to openai, overriding any stale saved draft', async () => {
    const { policy, preset, switchApiProfileProvider } = await setup()
    const toGemini = switchApiProfileProvider(preset, 'gemini')
    const backToOpenAI = switchApiProfileProvider(toGemini, 'openai')
    // providerDrafts.openai 里存档的 baseUrl 可能是带 /v1 的历史值，URL 固定语义下仍归位为预置值
    const pinned = policy.applyPresetProviderSwitch(backToOpenAI, 'openai')

    expect(pinned.baseUrl).toBe('https://gateway.example.com/v1')
    expect(pinned.model).toBe('gpt-image2')
  })

  it('keeps a user-edited model when pinning the preset baseUrl', async () => {
    const { policy, preset, switchApiProfileProvider } = await setup()
    // 用户在 gemini 上改过 model（UNLOCKED_PRESET_FIELDS=model 的恢复形态）：
    // 归位只固定 URL，model 保留用户值
    const toGemini = { ...switchApiProfileProvider(preset, 'gemini'), model: 'my-custom-gemini-model' }
    const pinned = policy.applyPresetProviderSwitch(toGemini, 'gemini')

    expect(pinned.baseUrl).toBe('https://gateway.example.com')
    expect(pinned.model).toBe('my-custom-gemini-model')
  })

  it('leaves switch results untouched when switch mode is off or the target is outside providerPresets', async () => {
    // 未启用切换模式（无 providerPresets）
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const plain = await import('./presetConfig')
    const bare = createDefaultOpenAIProfile({ id: 'preset-a', isDefault: true, baseUrl: 'https://preset.example.com/v1', model: 'preset-model' })
    plain.setPresetConfig({ customProviders: [], profiles: [bare] })
    const untouched = plain.applyPresetProviderSwitch({ ...bare, baseUrl: 'https://user.example.com' }, 'openai')
    expect(untouched.baseUrl).toBe('https://user.example.com')

    // 切换模式开启，但目标类型不在 providerPresets（如自定义服务商）
    const { policy, preset } = await setup()
    const custom = { ...preset, provider: 'some-custom' as typeof preset.provider, baseUrl: 'https://custom.example.com' }
    const customResult = policy.applyPresetProviderSwitch(custom, 'some-custom')
    expect(customResult.baseUrl).toBe('https://custom.example.com')

    // 同 provider 调用同样归位（URL 固定语义不依赖「刚切换」状态）
    const sameProvider = policy.applyPresetProviderSwitch({ ...preset, baseUrl: 'https://whatever.example.com' }, 'openai')
    expect(sameProvider.baseUrl).toBe('https://gateway.example.com/v1')
  })

  it('migrates stored legacy preset model values to the updated prefill on enforce', async () => {
    // 线上改版场景：预填从 gpt-image2 更新为 gpt-image-2（网关只认 gpt-image- 前缀）。
    // model 是豁免字段（enforce 用存量值覆盖预置），必须靠迁移映射让未自定义的存量配置跟随新预填。
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model')
    vi.stubEnv('VITE_PRESET_MODEL_MIGRATIONS', 'gpt-image2:gpt-image-2,gptiamge2:gpt-image-2')
    const { createDefaultOpenAIProfile, normalizeSettings } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    const preset = createDefaultOpenAIProfile({
      id: 'default-openai',
      isDefault: true,
      name: '官网图片',
      baseUrl: 'https://sshzyu.com',
      model: 'gpt-image-2',
    })
    policy.setPresetConfig({
      customProviders: [],
      profiles: [preset],
      providerPresets: {
        openai: { baseUrl: 'https://sshzyu.com', model: 'gpt-image-2' },
        gemini: { baseUrl: 'https://sshzyu.com', model: 'gemini-3.1-flash-image-preview' },
      },
    })

    // 未自定义（停留在旧预填值）→ 迁移到新预填值；providerDrafts 存档同步迁移（防切换类型时旧值回流）
    const legacy = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [],
      profiles: [{ ...preset, model: 'gpt-image2', providerDrafts: { gemini: { model: 'gpt-image2', baseUrl: 'https://sshzyu.com' } } }],
    }))
    expect(legacy.profiles[0].model).toBe('gpt-image-2')
    expect(legacy.profiles[0].providerDrafts?.gemini?.model).toBe('gpt-image-2')

    // 历史错拼值同样迁移
    const typo = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [],
      profiles: [{ ...preset, model: 'gptiamge2' }],
    }))
    expect(typo.profiles[0].model).toBe('gpt-image-2')

    // 用户自定义值不受影响
    const customized = policy.enforcePresetConfigPolicy(normalizeSettings({
      customProviders: [],
      profiles: [{ ...preset, model: 'my-own-model' }],
    }))
    expect(customized.profiles[0].model).toBe('my-own-model')
  })

  it('leaves model values untouched when no migration map is configured', async () => {
    const { policy } = await setup()
    expect(policy.migratePresetModelValue('gpt-image2')).toBe('gpt-image2')
    expect(policy.migratePresetModelValue('my-own-model')).toBe('my-own-model')
    expect(policy.migratePresetModelValue('')).toBe('')
  })

  it('unlocks only the fields declared in VITE_PRESET_UNLOCKED_FIELDS', async () => {
    vi.stubEnv('VITE_LOCK_PRESET_CONFIG_PARAMS', 'true')
    vi.stubEnv('VITE_PRESET_UNLOCKED_FIELDS', 'model,name,apiMode,reasoningEffort,streamImages,streamPartialImages,transparentBackgroundMethod,responseFormatB64Json,codexCli,timeout')
    const { createDefaultOpenAIProfile } = await import('./apiProfiles')
    const policy = await import('./presetConfig')
    policy.setPresetConfig({ customProviders: [], profiles: [createDefaultOpenAIProfile({ id: 'p', isDefault: true })] })

    for (const field of ['model', 'name', 'apiMode', 'reasoningEffort', 'streamImages', 'streamPartialImages', 'transparentBackgroundMethod', 'responseFormatB64Json', 'codexCli', 'timeout']) {
      expect(policy.isPresetProfileFieldUnlocked(field)).toBe(true)
    }
    // URL 与受控字段保持锁定
    expect(policy.isPresetProfileFieldUnlocked('baseUrl')).toBe(false)
    expect(policy.isPresetProfileFieldUnlocked('provider')).toBe(false)
    expect(policy.isPresetProfileFieldUnlocked('apiKey')).toBe(false)
  })

  it('keeps API keys separate per provider type across switches', async () => {
    const { policy, normalizeSettings, preset, switchApiProfileProvider } = await setup()
    // openai 有 key → 切 gemini：key 清空（待填 gemini key），原 key 存档
    const openaiProfile = { ...preset, apiKey: 'sk-openai' }
    const toGemini = policy.applyPresetProviderSwitch(switchApiProfileProvider(openaiProfile, 'gemini'), 'gemini')
    expect(toGemini.provider).toBe('gemini')
    expect(toGemini.apiKey).toBe('')
    expect(toGemini.baseUrl).toBe('https://gateway.example.com')
    expect(toGemini.providerDrafts?.openai?.apiKey).toBe('sk-openai')

    // gemini 填 key → 切回 openai：两个 key 互不串、各自保留
    const backToOpenai = policy.applyPresetProviderSwitch(
      switchApiProfileProvider({ ...toGemini, apiKey: 'sk-gemini' }, 'openai'),
      'openai',
    )
    expect(backToOpenai.provider).toBe('openai')
    expect(backToOpenai.apiKey).toBe('sk-openai')
    expect(backToOpenai.baseUrl).toBe('https://gateway.example.com/v1')
    expect(backToOpenai.providerDrafts?.gemini?.apiKey).toBe('sk-gemini')
    expect(backToOpenai.providerDrafts?.openai?.apiKey).toBe('sk-openai')

    // 走一遍序列化，providerDrafts 里的 key 持久化不丢
    const persisted = normalizeSettings({ customProviders: [], profiles: [backToOpenai] })
    expect(persisted.profiles[0].providerDrafts?.gemini?.apiKey).toBe('sk-gemini')
    expect(persisted.profiles[0].providerDrafts?.openai?.apiKey).toBe('sk-openai')
  })
})
