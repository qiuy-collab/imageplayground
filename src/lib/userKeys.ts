/**
 * 主应用（iframe 宿主）用户 key 同步。
 *
 * 生图应用以同源 iframe 嵌入主应用时，宿主通过 URL 参数传入
 * token / user_id / ui_mode=embedded（见主应用 buildEmbeddedUrl）。
 * 这里读取这些参数并调用主应用用户端接口 GET /api/v1/keys
 * 拉取当前用户创建的 API Key 列表，供左侧「选择 key」栏展示。
 */

export interface UserApiKey {
  id: number
  name: string
  key: string
  status: string
  groupId: number | null
  groupName: string
  groupPlatform: string
  /** 分组是否已开启图片生成（后台 allow_image_generation 开关）。 */
  groupAllowsImage: boolean
}

export interface EmbeddedAuth {
  token: string
  userId: string
}

const ACTIVE_STATUSES = new Set(['active'])

/** 支持生图请求形态的分组平台（openai → Images API，gemini → generateContent）。 */
const IMAGE_CAPABLE_PLATFORMS = new Set(['openai', 'gemini'])

/** 该 key 所属分组平台是否可在生图工作台使用。 */
export function isImageCapablePlatform(platform: string): boolean {
  return IMAGE_CAPABLE_PLATFORMS.has(platform.trim())
}

/**
 * 该 key 是否可在生图工作台使用：分组平台具备生图请求形态（openai/gemini）
 * 且分组已在后台开启「图片生成」开关（allow_image_generation）。
 * 仅按平台判定会把对话分组（平台同为 openai，如 PLUS/特惠）的 key 放进来——
 * 它们没有生图渠道，选中后生成必然失败。
 */
export function isImageCapableKey(item: Pick<UserApiKey, 'groupPlatform' | 'groupAllowsImage'>): boolean {
  return isImageCapablePlatform(item.groupPlatform) && item.groupAllowsImage
}

export function readEmbeddedAuth(): EmbeddedAuth | null {
  if (typeof window === 'undefined') return null
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')?.trim() ?? ''
  if (!token) return null
  return {
    token,
    userId: params.get('user_id')?.trim() ?? '',
  }
}

export function isEmbeddedMode(): boolean {
  if (typeof window === 'undefined') return false
  const params = new URLSearchParams(window.location.search)
  return params.get('ui_mode') === 'embedded' || params.has('token')
}

interface RawKeyRecord {
  id?: unknown
  name?: unknown
  key?: unknown
  status?: unknown
  group_id?: unknown
  group?: unknown
}

function normalizeKeyRecord(item: RawKeyRecord): UserApiKey | null {
  if (!item || typeof item !== 'object') return null
  const key = typeof item.key === 'string' ? item.key.trim() : ''
  if (!key) return null
  const id = typeof item.id === 'number' ? item.id : Number(item.id)
  const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '未命名 Key'
  const status = typeof item.status === 'string' ? item.status : 'active'
  const groupId = typeof item.group_id === 'number' ? item.group_id : Number(item.group_id)
  const group = (item.group && typeof item.group === 'object' ? item.group : {}) as {
    name?: unknown
    platform?: unknown
    allow_image_generation?: unknown
  }
  return {
    id: Number.isFinite(id) ? id : 0,
    name,
    key,
    status,
    groupId: Number.isFinite(groupId) ? groupId : null,
    groupName: typeof group.name === 'string' ? group.name.trim() : '',
    groupPlatform: typeof group.platform === 'string' ? group.platform.trim() : '',
    // 字段缺失（非 0.2.7+ 后端）时视为开启，回退为仅按平台判定，避免误杀
    groupAllowsImage:
      typeof group.allow_image_generation === 'boolean' ? group.allow_image_generation : true,
  }
}

/**
 * 从后端响应中提取 key 记录数组。
 * 主应用统一响应包装为 { code, message, data: { items: [...] } }（见后端
 * internal/pkg/response：Success + PaginatedData）；原生 fetch 不经 apiClient
 * 拦截器剥壳，这里逐层兼容：裸数组 / { items } / { data: { items } }。
 */
function extractKeyItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (!payload || typeof payload !== 'object') return []
  const withData = payload as { data?: unknown; items?: unknown }
  const inner = withData.items !== undefined ? withData.items : withData.data
  if (Array.isArray(inner)) return inner
  if (inner && typeof inner === 'object' && Array.isArray((inner as { items?: unknown }).items)) {
    return (inner as { items: unknown[] }).items
  }
  return []
}

/**
 * 拉取宿主主应用中当前用户的 key 列表。
 * 同源相对路径即可（iframe 与主应用同域部署）；Bearer token 来自宿主 URL 参数。
 */
export async function fetchUserApiKeys(token: string, signal?: AbortSignal): Promise<UserApiKey[]> {
  const response = await fetch('/api/v1/keys?page=1&page_size=100&sort_by=created_at&sort_order=desc', {
    headers: { Authorization: `Bearer ${token}` },
    credentials: 'include',
    signal,
  })
  if (response.status === 401) throw new Error('登录已过期，请刷新主应用页面后重试')
  if (!response.ok) throw new Error(`获取 key 列表失败（HTTP ${response.status}）`)
  const payload: unknown = await response.json()
  return extractKeyItems(payload)
    .map((item) => normalizeKeyRecord(item as RawKeyRecord))
    .filter((item): item is UserApiKey => Boolean(item))
}

export function isKeyUsable(status: string): boolean {
  return ACTIVE_STATUSES.has(status)
}

/** 网关 /v1/models 返回的模型条目（OpenAI 列表格式）。 */
interface RawModelRecord {
  id?: unknown
}

/**
 * 用用户 key 探测其所属网关支持的模型列表（GET /v1/models，同源代理到网关）。
 * 用于「key 条目下方内联模型选项」：key 属于哪个服务商/网关，就展示哪个的模型。
 * 仅保留生图相关模型（id 含 image/imagen）；过滤后为空则回退全量列表。
 */
export async function fetchGatewayModels(key: string, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch('/v1/models', {
    headers: { Authorization: `Bearer ${key}` },
    signal,
  })
  if (!response.ok) throw new Error(`获取模型列表失败（HTTP ${response.status}）`)
  const payload: unknown = await response.json()
  const items = payload && typeof payload === 'object' && Array.isArray((payload as { data?: unknown }).data)
    ? (payload as { data: unknown[] }).data
    : []
  const ids = items
    .map((item) => (item && typeof item === 'object' ? (item as RawModelRecord).id : item))
    .filter((id): id is string => typeof id === 'string' && id.trim().length > 0)
    .map((id) => id.trim())
  const imageModels = ids.filter((id) => /image|imagen/i.test(id))
  return imageModels.length > 0 ? Array.from(new Set(imageModels)) : Array.from(new Set(ids))
}

export function maskKey(key: string): string {
  if (key.length <= 14) return key
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}
