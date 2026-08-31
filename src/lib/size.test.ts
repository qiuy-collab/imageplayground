import { describe, expect, it } from 'vitest'
import {
  calculateGeminiImageSize,
  calculateImageSize,
  convertImageSizeForProvider,
  findSizePresetFor,
  normalizeCodexCliImageSize,
  prependCodexCliSizePrompt,
  sizeToGeminiImageConfig,
  stripInjectedCodexCliSizePrompt,
} from './size'

describe('calculateImageSize', () => {
  it('uses common 16:9 display resolutions for the built-in tiers', () => {
    expect(calculateImageSize('1K', '16:9')).toBe('1280x720')
    expect(calculateImageSize('2K', '16:9')).toBe('2560x1440')
    expect(calculateImageSize('4K', '16:9')).toBe('3840x2160')
  })

  it('uses matching portrait presets for common ratios', () => {
    expect(calculateImageSize('2K', '9:16')).toBe('1440x2560')
    expect(calculateImageSize('2K', '2:3')).toBe('1440x2160')
    expect(calculateImageSize('2K', '3:4')).toBe('1536x2048')
  })

  it('falls back to budget-based sizing for custom ratios', () => {
    expect(calculateImageSize('2K', '5:4')).toBe('2288x1824')
  })
})

describe('Codex CLI size compatibility', () => {
  it('normalizes custom sizes to the 1K pixel budget', () => {
    expect(normalizeCodexCliImageSize('2048x2048')).toBe('1024x1024')
    expect(normalizeCodexCliImageSize('2048x1536')).toBe('1024x768')
    expect(normalizeCodexCliImageSize('1536x1024')).toBe('1536x1024')
  })

  it('preserves non-preset ratios approximately and clamps excessive ratios', () => {
    expect(normalizeCodexCliImageSize('2500x2000')).toBe(calculateImageSize('1K', '5:4'))
    const [width, height] = normalizeCodexCliImageSize('4000x1000').split('x').map(Number)
    expect(width / height).toBeCloseTo(3, 2)
    expect(width * height).toBeLessThanOrEqual(1_572_864)
  })

  it('prepends a concise resolution hint only for explicit sizes', () => {
    expect(prependCodexCliSizePrompt('Draw a cat.\n', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.\n')
    expect(prependCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(prependCodexCliSizePrompt('Draw a cat.', 'auto')).toBe('Draw a cat.')
  })

  it('strips only the matching injected resolution hint', () => {
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 2048x2048 resolution. Draw a cat.', 'Draw a cat.', '1024x1024')).toBe('Generate at 2048x2048 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Generate at 1024x1024 resolution. Draw a cat.', '1024x1024')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
    expect(stripInjectedCodexCliSizePrompt('Generate at 1024x1024 resolution. Draw a cat.', 'Draw a cat.', 'auto')).toBe('Generate at 1024x1024 resolution. Draw a cat.')
  })
})

describe('Gemini size adaptation', () => {
  it('maps pixel sizes to official Gemini aspectRatio/imageSize tiers', () => {
    expect(sizeToGeminiImageConfig('1376x768')).toEqual({ aspectRatio: '16:9', imageSize: '1K' })
    expect(sizeToGeminiImageConfig('2048x2048')).toEqual({ aspectRatio: '1:1', imageSize: '2K' })
    // OpenAI 形态的 4K 16:9 按像素总数分档到 Gemini 4K
    expect(sizeToGeminiImageConfig('3840x2160')).toEqual({ aspectRatio: '16:9', imageSize: '4K' })
    // OpenAI 形态的 1K 16:9 就近映射到 Gemini 1K 16:9
    expect(sizeToGeminiImageConfig('1280x720')).toEqual({ aspectRatio: '16:9', imageSize: '1K' })
  })

  it('omits imageConfig for auto or unparsable sizes', () => {
    expect(sizeToGeminiImageConfig('auto')).toBeNull()
    expect(sizeToGeminiImageConfig('')).toBeNull()
    expect(sizeToGeminiImageConfig('not-a-size')).toBeNull()
  })

  it('converts the same tier/ratio pick between provider presets', () => {
    expect(convertImageSizeForProvider('1280x720', 'gemini')).toBe('1376x768')
    expect(convertImageSizeForProvider('1536x1024', 'gemini')).toBe('1264x848')
    expect(convertImageSizeForProvider('1024x1024', 'gemini')).toBe('1024x1024')
    expect(convertImageSizeForProvider('3840x2160', 'gemini')).toBe('5504x3072')
    expect(convertImageSizeForProvider('1376x768', 'openai')).toBe('1280x720')
    expect(convertImageSizeForProvider('5504x3072', 'openai')).toBe('3840x2160')
    // 非 openai/gemini 目标（fal、自定义）按 OpenAI 形态处理
    expect(convertImageSizeForProvider('1376x768', 'fal')).toBe('1280x720')
  })

  it('round-trips a tier/ratio choice across providers', () => {
    expect(convertImageSizeForProvider(convertImageSizeForProvider('1536x1024', 'gemini'), 'openai')).toBe('1536x1024')
    expect(convertImageSizeForProvider(convertImageSizeForProvider('3840x2160', 'gemini'), 'openai')).toBe('3840x2160')
    expect(convertImageSizeForProvider(convertImageSizeForProvider('1280x720', 'gemini'), 'openai')).toBe('1280x720')
  })

  it('keeps auto untouched when switching providers', () => {
    expect(convertImageSizeForProvider('auto', 'gemini')).toBe('auto')
    expect(convertImageSizeForProvider('auto', 'openai')).toBe('auto')
  })

  it('snaps custom Gemini ratios to the nearest official option', () => {
    expect(calculateGeminiImageSize('1K', '5:4')).toBe('1152x928')
    expect(calculateGeminiImageSize('1K', '2.39:1')).toBe('1584x672')
    expect(calculateGeminiImageSize('4K', '21:9')).toBe('6336x2688')
    expect(calculateGeminiImageSize('2K', '4:5')).toBe('1856x2304')
  })

  it('finds presets for both variants when restoring the picker state', () => {
    expect(findSizePresetFor('1376x768', 'gemini')).toEqual({ tier: '1K', ratio: '16:9' })
    expect(findSizePresetFor('1280x720', 'openai')).toEqual({ tier: '1K', ratio: '16:9' })
    expect(findSizePresetFor('1280x720', 'gemini')).toEqual({ tier: '1K', ratio: '16:9' })
    expect(findSizePresetFor('auto', 'gemini')).toBeNull()
  })
})
