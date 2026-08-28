import { describe, expect, it, vi } from 'vitest'
import { callGeminiImageApi } from './geminiImageApi'
import { createDefaultGeminiProfile, normalizeSettings } from './apiProfiles'
import type { CallApiOptions } from './imageApiShared'

function createOptions(): CallApiOptions {
  return {
    settings: normalizeSettings({}),
    prompt: '一只戴黄色围巾的猫',
    params: {
      size: 'auto',
      quality: 'auto',
      output_format: 'png',
      output_compression: null,
      moderation: 'auto',
      n: 1,
      transparent_output: false,
    },
    inputImageDataUrls: [],
  }
}

describe('callGeminiImageApi', () => {
  it('submits Gemini generateContent payload and extracts inline image data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ inlineData: { mimeType: 'image/png', data: 'aGVsbG8=' } }],
        },
      }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await callGeminiImageApi(createOptions(), createDefaultGeminiProfile({
      baseUrl: 'https://gemini.example.com',
      apiKey: 'test-key',
    }))

    expect(fetchMock).toHaveBeenCalledWith(
      'https://gemini.example.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer test-key' }),
      }),
    )
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body).toMatchObject({
      contents: [{ parts: [{ text: '一只戴黄色围巾的猫' }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    })
    expect(result.images).toEqual(['data:image/png;base64,aGVsbG8='])
  })

  it('sends input images as Gemini inlineData for image editing', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/jpeg', data: 'aGVsbG8=' } }] } }],
    }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await callGeminiImageApi({
      ...createOptions(),
      inputImageDataUrls: ['data:image/png;base64,aW1hZ2U='],
    }, createDefaultGeminiProfile({ baseUrl: 'https://gemini.example.com', apiKey: 'test-key' }))

    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.contents[0].parts).toEqual([
      { text: '一只戴黄色围巾的猫' },
      { inlineData: { mimeType: 'image/png', data: 'aW1hZ2U=' } },
    ])
  })
})
