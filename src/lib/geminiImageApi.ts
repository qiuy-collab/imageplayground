import type { ApiProfile, TaskParams } from '../types'
import {
  assertImageInputPayloadSize,
  getApiErrorMessage,
  getDataUrlEncodedByteSize,
  MIME_MAP,
  normalizeBase64Image,
  type CallApiOptions,
  type CallApiResult,
} from './imageApiShared'

function getImagePart(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+);base64,(.+)$/)
  if (!match) throw new Error('Gemini 参考图必须是 Base64 图片数据')
  return {
    inlineData: {
      mimeType: match[1],
      data: match[2],
    },
  }
}

function getResponseImages(payload: unknown, fallbackMime: string): string[] {
  if (!payload || typeof payload !== 'object') throw new Error('Gemini 接口未返回图片数据')
  const candidates = (payload as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) throw new Error('Gemini 接口未返回图片数据')

  const images = candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return []
    const parts = (candidate as { content?: { parts?: unknown } }).content?.parts
    if (!Array.isArray(parts)) return []
    return parts.flatMap((part) => {
      if (!part || typeof part !== 'object') return []
      const inlineData = (part as { inlineData?: { data?: unknown, mimeType?: unknown } }).inlineData
      if (!inlineData || typeof inlineData.data !== 'string' || !inlineData.data.trim()) return []
      const mime = typeof inlineData.mimeType === 'string' && inlineData.mimeType.trim() ? inlineData.mimeType : fallbackMime
      return [normalizeBase64Image(inlineData.data, mime)]
    })
  })

  if (images.length) return images
  const err = new Error('Gemini 接口没有返回可识别的图片数据')
  ;(err as Error & { rawResponsePayload?: string }).rawResponsePayload = JSON.stringify(payload, null, 2)
  throw err
}

function buildGeminiUrl(profile: ApiProfile): string {
  const baseUrl = profile.baseUrl.trim().replace(/\/+$/, '')
  const model = encodeURIComponent(profile.model.trim())
  if (!baseUrl) return `/v1beta/models/${model}:generateContent`
  return `${baseUrl}/v1beta/models/${model}:generateContent`
}

function buildPrompt(opts: CallApiOptions): string {
  if (!opts.nativeTransparentBackground) return opts.prompt
  return `${opts.prompt}\n\n使用纯白色背景。`
}

async function callGeminiOnce(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  assertImageInputPayloadSize(opts.inputImageDataUrls.reduce((sum, dataUrl) => sum + getDataUrlEncodedByteSize(dataUrl), 0))

  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), profile.timeout * 1000)
  try {
    const response = await fetch(buildGeminiUrl(profile), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${profile.apiKey}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [
            { text: buildPrompt(opts) },
            ...opts.inputImageDataUrls.map(getImagePart),
          ],
        }],
        generationConfig: {
          responseModalities: ['IMAGE'],
        },
      }),
      signal: controller.signal,
    })

    if (!response.ok) throw new Error(await getApiErrorMessage(response))
    const images = getResponseImages(await response.json(), MIME_MAP[opts.params.output_format] || 'image/png')
    return {
      images,
      actualParams: { n: images.length },
      actualParamsList: images.map(() => ({ n: 1 })),
    }
  } finally {
    clearTimeout(timeoutId)
  }
}

export async function callGeminiImageApi(opts: CallApiOptions, profile: ApiProfile): Promise<CallApiResult> {
  const count = Math.max(1, opts.params.n)
  if (count === 1) return callGeminiOnce(opts, profile)

  const results = await Promise.allSettled(Array.from({ length: count }).map((_, requestIndex) => callGeminiOnce({
    ...opts,
    params: { ...opts.params, n: 1 },
    onPartialImage: opts.onPartialImage
      ? (partial) => opts.onPartialImage?.({ ...partial, requestIndex })
      : undefined,
  }, profile)))
  const successful = results.filter((result): result is PromiseFulfilledResult<CallApiResult> => result.status === 'fulfilled').map((result) => result.value)
  if (!successful.length) throw (results.find((result): result is PromiseRejectedResult => result.status === 'rejected')?.reason ?? new Error('Gemini 图片生成失败'))

  const images = successful.flatMap((result) => result.images)
  return {
    images,
    actualParams: { n: images.length },
    actualParamsList: images.map(() => ({ n: 1 })),
    failedRequests: results.flatMap((result, requestIndex) => result.status === 'rejected'
      ? [{ requestIndex, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }]
      : []),
  }
}
