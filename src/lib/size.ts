const SIZE_PATTERN = /^\s*(\d+)\s*[xX×]\s*(\d+)\s*$/
const RATIO_PATTERN = /^\s*(\d+(?:\.\d+)?)\s*[:xX×]\s*(\d+(?:\.\d+)?)\s*$/
const SIZE_MULTIPLE = 16
const MAX_EDGE = 3840
const MAX_ASPECT_RATIO = 3
const MIN_PIXELS = 655_360
const MAX_PIXELS = 8_294_400
const MAX_1K_PIXELS = 1_572_864

export type SizeTier = '1K' | '2K' | '4K'
type PresetRatio = '1:1' | '3:2' | '2:3' | '16:9' | '9:16' | '4:3' | '3:4' | '21:9'

function roundToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

function floorToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.floor(value / multiple) * multiple)
}

function ceilToMultiple(value: number, multiple: number) {
  return Math.max(multiple, Math.ceil(value / multiple) * multiple)
}

function normalizeDimensions(width: number, height: number) {
  let normalizedWidth = roundToMultiple(width, SIZE_MULTIPLE)
  let normalizedHeight = roundToMultiple(height, SIZE_MULTIPLE)

  const scaleToFit = (scale: number) => {
    normalizedWidth = floorToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = floorToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  const scaleToFill = (scale: number) => {
    normalizedWidth = ceilToMultiple(normalizedWidth * scale, SIZE_MULTIPLE)
    normalizedHeight = ceilToMultiple(normalizedHeight * scale, SIZE_MULTIPLE)
  }

  for (let i = 0; i < 4; i++) {
    const maxEdge = Math.max(normalizedWidth, normalizedHeight)
    if (maxEdge > MAX_EDGE) {
      scaleToFit(MAX_EDGE / maxEdge)
    }

    if (normalizedWidth / normalizedHeight > MAX_ASPECT_RATIO) {
      normalizedWidth = floorToMultiple(normalizedHeight * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    } else if (normalizedHeight / normalizedWidth > MAX_ASPECT_RATIO) {
      normalizedHeight = floorToMultiple(normalizedWidth * MAX_ASPECT_RATIO, SIZE_MULTIPLE)
    }

    const pixels = normalizedWidth * normalizedHeight
    if (pixels > MAX_PIXELS) {
      scaleToFit(Math.sqrt(MAX_PIXELS / pixels))
    } else if (pixels < MIN_PIXELS) {
      scaleToFill(Math.sqrt(MIN_PIXELS / pixels))
    }
  }

  return { width: normalizedWidth, height: normalizedHeight }
}

export function normalizeImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const { width, height } = normalizeDimensions(Number(match[1]), Number(match[2]))
  return `${width}x${height}`
}

export function normalizeCodexCliImageSize(size: string) {
  const trimmed = size.trim()
  const match = trimmed.match(SIZE_PATTERN)
  if (!match) return trimmed

  const originalWidth = Number(match[1])
  const originalHeight = Number(match[2])
  const normalized = normalizeDimensions(originalWidth, originalHeight)
  if (normalized.width * normalized.height > MAX_1K_PIXELS) {
    return calculateImageSize('1K', `${normalized.width}:${normalized.height}`) ?? `${normalized.width}x${normalized.height}`
  }

  const { width, height } = normalized
  return `${width}x${height}`
}

export function prependCodexCliSizePrompt(prompt: string, size: string) {
  if (size === 'auto') return prompt
  const trimmed = prompt.trimStart()
  const hint = `Generate at ${size} resolution.`
  if (trimmed.startsWith(hint)) return trimmed
  return `${hint} ${trimmed}`
}

export function stripInjectedCodexCliSizePrompt(prompt: string, originalPrompt: string, size: string) {
  if (size === 'auto') return prompt
  const prefix = `Generate at ${size} resolution.`
  if (originalPrompt.trimStart().startsWith(prefix)) return prompt
  const trimmed = prompt.trimStart()
  if (!trimmed.startsWith(prefix)) return prompt
  return trimmed.slice(prefix.length).trimStart()
}

export function parseRatio(ratio: string) {
  const match = ratio.match(RATIO_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return null
  }

  return { width, height }
}

export function formatImageRatio(width: number, height: number) {
  const roundedWidth = Math.round(width)
  const roundedHeight = Math.round(height)
  if (
    !Number.isFinite(roundedWidth) ||
    !Number.isFinite(roundedHeight) ||
    roundedWidth <= 0 ||
    roundedHeight <= 0
  ) {
    return ''
  }

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(roundedWidth, roundedHeight)
  const simplifiedWidth = roundedWidth / divisor
  const simplifiedHeight = roundedHeight / divisor
  const simplified = `${simplifiedWidth}:${simplifiedHeight}`
  const commonRatios = [
    [1, 1],
    [4, 3],
    [3, 4],
    [3, 2],
    [2, 3],
    [16, 9],
    [9, 16],
    [21, 9],
    [9, 21],
  ]

  for (const [commonWidth, commonHeight] of commonRatios) {
    if (simplifiedWidth === commonWidth && simplifiedHeight === commonHeight) {
      return simplified
    }
  }

  const actualRatio = roundedWidth / roundedHeight
  const squareDelta = Math.abs(actualRatio - 1)
  if (squareDelta <= 0.18) return '≈1:1'

  const nearest = commonRatios
    .map(([commonWidth, commonHeight]) => {
      const ratio = commonWidth / commonHeight
      return {
        label: `${commonWidth}:${commonHeight}`,
        delta: Math.abs(actualRatio - ratio) / ratio,
      }
    })
    .sort((a, b) => a.delta - b.delta)[0]

  if (nearest && nearest.delta <= 0.01) return `≈${nearest.label}`

  const friendlyNearest = Array.from({ length: 12 }, (_, widthIndex) => widthIndex + 1)
    .flatMap((friendlyWidth) =>
      Array.from({ length: 12 }, (_, heightIndex) => heightIndex + 1).map((friendlyHeight) => {
        const ratio = friendlyWidth / friendlyHeight
        const delta = Math.abs(actualRatio - ratio) / ratio
        return {
          label: `${friendlyWidth}:${friendlyHeight}`,
          delta,
          // 在误差接近时偏向更短、更好读的比例，例如 7:6 优于 8:7。
          score: delta + (friendlyWidth + friendlyHeight) * 0.002,
        }
      }),
    )
    .filter((item) => item.label !== simplified)
    .sort((a, b) => a.score - b.score)[0]

  return friendlyNearest && friendlyNearest.delta <= 0.04 ? `≈${friendlyNearest.label}` : simplified
}

/**
 * 每个档位的像素预算上限。
 * 在该预算内、满足所有 OpenAI 约束的前提下，选取总像素最大的候选尺寸。
 */
const TIER_PIXEL_BUDGET: Record<SizeTier, number> = {
  '1K': MAX_1K_PIXELS, // 1024 × 1536
  '2K': 4_194_304,   // 2048 × 2048
  '4K': MAX_PIXELS,  // 8_294_400
}

/**
 * 常用比例优先使用官方示例或通用显示标准，避免按像素预算计算出不常见尺寸。
 * 其中 21:9 的常见显示器尺寸会按 16 倍数约束做轻微规整。
 */
const COMMON_SIZE_PRESETS: Record<SizeTier, Record<PresetRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1536x1024',
    '2:3': '1024x1536',
    '16:9': '1280x720',
    '9:16': '720x1280',
    '4:3': '1024x768',
    '3:4': '768x1024',
    '21:9': '1280x544',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:2': '2160x1440',
    '2:3': '1440x2160',
    '16:9': '2560x1440',
    '9:16': '1440x2560',
    '4:3': '2048x1536',
    '3:4': '1536x2048',
    '21:9': '2560x1088',
  },
  '4K': {
    '1:1': '2880x2880',
    '3:2': '3456x2304',
    '2:3': '2304x3456',
    '16:9': '3840x2160',
    '9:16': '2160x3840',
    '4:3': '3200x2400',
    '3:4': '2400x3200',
    '21:9': '3840x1600',
  },
}

function getPresetRatioKey(ratioWidth: number, ratioHeight: number): PresetRatio | null {
  if (!Number.isInteger(ratioWidth) || !Number.isInteger(ratioHeight)) return null

  const gcd = (a: number, b: number): number => b === 0 ? a : gcd(b, a % b)
  const divisor = gcd(ratioWidth, ratioHeight)
  const key = `${ratioWidth / divisor}:${ratioHeight / divisor}`

  return key in COMMON_SIZE_PRESETS['1K'] ? key as PresetRatio : null
}

const MAX_RATIO_ERROR = 0.01

export function calculateImageSize(tier: SizeTier, ratio: string) {
  const parsed = parseRatio(ratio)
  if (!parsed) return null

  const { width: ratioWidth, height: ratioHeight } = parsed
  const presetRatioKey = getPresetRatioKey(ratioWidth, ratioHeight)
  if (presetRatioKey) return COMMON_SIZE_PRESETS[tier][presetRatioKey]

  const targetRatio = ratioWidth / ratioHeight
  const pixelBudget = TIER_PIXEL_BUDGET[tier]

  let bestWidth = 0
  let bestHeight = 0
  let bestPixels = 0

  for (let w = SIZE_MULTIPLE; w <= MAX_EDGE; w += SIZE_MULTIPLE) {
    const idealH = w / targetRatio
    // 尝试 floor 和 ceil 对齐到 16 的倍数，取像素更大且合法的那个
    const candidates = [
      Math.floor(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
      Math.ceil(idealH / SIZE_MULTIPLE) * SIZE_MULTIPLE,
    ]

    for (const h of candidates) {
      if (h < SIZE_MULTIPLE || h > MAX_EDGE) continue

      const pixels = w * h
      if (pixels > pixelBudget || pixels < MIN_PIXELS) continue
      if (Math.max(w / h, h / w) > MAX_ASPECT_RATIO) continue

      const actualRatio = w / h
      const ratioError = Math.abs(actualRatio - targetRatio) / targetRatio
      if (ratioError > MAX_RATIO_ERROR) continue

      if (pixels > bestPixels) {
        bestPixels = pixels
        bestWidth = w
        bestHeight = h
      }
    }
  }

  if (bestPixels === 0) return null
  return `${bestWidth}x${bestHeight}`
}

// ===== Gemini（Nano Banana / Gemini 3 系图像模型）尺寸适配 =====
// 官方尺寸表来源：ai.google.dev/gemini-api/docs/image-generation
// - Gemini 3.1 Flash Image（Nano Banana 2）支持 512px/1K/2K/4K 四档（512px 档 UI 不提供）
// - Gemini 3 Pro Image（Nano Banana Pro）支持 1K/2K/4K
// - 请求字段：generationConfig.imageConfig { aspectRatio, imageSize: '1K' | '2K' | '4K' }
// 以下像素值与官方「3.1 Flash Image」表逐格一致。

const GEMINI_COMMON_SIZE_PRESETS: Record<SizeTier, Record<PresetRatio, string>> = {
  '1K': {
    '1:1': '1024x1024',
    '3:2': '1264x848',
    '2:3': '848x1264',
    '16:9': '1376x768',
    '9:16': '768x1376',
    '4:3': '1200x896',
    '3:4': '896x1200',
    '21:9': '1584x672',
  },
  '2K': {
    '1:1': '2048x2048',
    '3:2': '2528x1696',
    '2:3': '1696x2528',
    '16:9': '2752x1536',
    '9:16': '1536x2752',
    '4:3': '2400x1792',
    '3:4': '1792x2400',
    '21:9': '3168x1344',
  },
  '4K': {
    '1:1': '4096x4096',
    '3:2': '5056x3392',
    '2:3': '3392x5056',
    '16:9': '5504x3072',
    '9:16': '3072x5504',
    '4:3': '4800x3584',
    '3:4': '3584x4800',
    '21:9': '6336x2688',
  },
}

// Gemini 就近映射的候选比例：UI 的 8 个比例之外，官方表还提供 4:5 / 5:4，
// 仅作为自定义比例的映射目标，不进 UI 按钮列表。
const GEMINI_RATIO_CANDIDATES: PresetRatio[] = [...Object.keys(GEMINI_COMMON_SIZE_PRESETS['1K']), '4:5', '5:4'] as PresetRatio[]
const GEMINI_EXTRA_PRESETS: Partial<Record<SizeTier, Record<string, string>>> = {
  '1K': { '4:5': '928x1152', '5:4': '1152x928' },
  '2K': { '4:5': '1856x2304', '5:4': '2304x1856' },
  '4K': { '4:5': '3712x4608', '5:4': '4608x3712' },
}

const SIZE_TIERS: SizeTier[] = ['1K', '2K', '4K']

export type SizeVariant = 'openai' | 'gemini'

function getPresetTable(variant: SizeVariant): Record<SizeTier, Record<PresetRatio, string>> {
  return variant === 'gemini' ? GEMINI_COMMON_SIZE_PRESETS : COMMON_SIZE_PRESETS
}

function getGeminiPreset(tier: SizeTier, ratio: PresetRatio): string {
  return GEMINI_EXTRA_PRESETS[tier]?.[ratio] ?? GEMINI_COMMON_SIZE_PRESETS[tier][ratio]
}

function inferSizeTierByPixels(pixels: number): SizeTier {
  if (pixels <= TIER_PIXEL_BUDGET['1K']) return '1K'
  if (pixels <= TIER_PIXEL_BUDGET['2K']) return '2K'
  return '4K'
}

function nearestRatio(width: number, height: number, candidates: PresetRatio[]): PresetRatio {
  const target = width / height
  let best = candidates[0]
  let bestDelta = Number.POSITIVE_INFINITY
  for (const ratio of candidates) {
    const parsed = parseRatio(ratio)
    if (!parsed) continue
    const delta = Math.abs(target - parsed.width / parsed.height) / (parsed.width / parsed.height)
    if (delta < bestDelta) {
      bestDelta = delta
      best = ratio
    }
  }
  return best
}

/**
 * 把任意像素尺寸反解为「档位 + 比例」：
 * 1) 先按目标形态的官方预置表精确匹配（保证往返无损）；
 * 2) 匹配不到再按像素总数分档、比例就近映射。
 */
export function decomposeImageSize(size: string, variant: SizeVariant): { tier: SizeTier, ratio: PresetRatio } | null {
  const match = size.trim().match(SIZE_PATTERN)
  if (!match) return null

  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null

  const table = getPresetTable(variant)
  const sizeKey = `${width}x${height}`
  for (const tier of SIZE_TIERS) {
    for (const [ratio, value] of Object.entries(table[tier])) {
      if (value === sizeKey) return { tier, ratio: ratio as PresetRatio }
    }
  }

  const tier = inferSizeTierByPixels(width * height)
  const candidates = variant === 'gemini' ? GEMINI_RATIO_CANDIDATES : (Object.keys(COMMON_SIZE_PRESETS['1K']) as PresetRatio[])
  return { tier, ratio: nearestRatio(width, height, candidates) }
}

/** Gemini 分组下的档位 + 比例 → 官方像素尺寸（自定义比例就近映射到官方支持的比例）。 */
export function calculateGeminiImageSize(tier: SizeTier, ratio: string): string | null {
  const preset = GEMINI_COMMON_SIZE_PRESETS[tier][ratio as PresetRatio]
  if (preset) return preset

  const parsed = parseRatio(ratio)
  if (!parsed) return null
  return getGeminiPreset(tier, nearestRatio(parsed.width, parsed.height, GEMINI_RATIO_CANDIDATES))
}

/**
 * Gemini generateContent 的尺寸参数。
 * 'auto' 或无法解析的尺寸返回 null（请求体不携带 imageConfig，由模型自行决定）。
 */
export function sizeToGeminiImageConfig(size: string): { aspectRatio: string, imageSize: SizeTier } | null {
  const spec = decomposeImageSize(size, 'gemini')
  if (!spec) return null
  return { aspectRatio: spec.ratio, imageSize: spec.tier }
}

/**
 * 分组切换时的尺寸换算：同一个「档位 + 比例」选择，
 * 在 OpenAI 分组与 Gemini 分组下各自落为该分组官方表的像素值。
 * 'auto' / 无法解析的值原样返回。目标不是 openai/gemini 时（自定义、fal）按 OpenAI 形态处理。
 */
export function convertImageSizeForProvider(size: string, targetProvider: string): string {
  const trimmed = size.trim()
  if (!trimmed || trimmed === 'auto') return trimmed

  const variant: SizeVariant = targetProvider === 'gemini' ? 'gemini' : 'openai'
  const spec = decomposeImageSize(trimmed, variant)
  if (!spec) return trimmed

  if (variant === 'gemini') return getGeminiPreset(spec.tier, spec.ratio)
  return calculateImageSize(spec.tier, spec.ratio) ?? trimmed
}

/** 按形态反查像素值对应的预置档位（UI 回显用）。 */
export function findSizePresetFor(size: string, variant: SizeVariant): { tier: SizeTier, ratio: string } | null {
  const spec = decomposeImageSize(size, variant)
  return spec ? { tier: spec.tier, ratio: spec.ratio } : null
}
