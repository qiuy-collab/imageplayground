import { useEffect } from 'react'
import { useStore } from '../store'

const DISMISSED_KEY = 'entry-notice-dismissed-on'

function getLocalDateKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 进入应用时的使用提示弹窗：
 * 提示窗口内生图请勿退出、后台生图走右上角「在新窗口打开」；
 * 勾选「本日不再提醒」后当天不再弹出，次日恢复提醒。
 */
export function useEntryNotice() {
  const setConfirmDialog = useStore((s) => s.setConfirmDialog)

  useEffect(() => {
    const today = getLocalDateKey()
    if (localStorage.getItem(DISMISSED_KEY) === today) return

    setConfirmDialog({
      title: '使用提示',
      message: '在本窗口生图时请勿退出，否则任务会中断。\n\n若要在后台生图，请点击右上角「在新窗口打开」。',
      confirmText: '我知道了',
      showCancel: false,
      icon: 'info',
      checkbox: { label: '本日不再提醒' },
      action: (checked) => {
        if (checked) localStorage.setItem(DISMISSED_KEY, getLocalDateKey())
      },
    })
  }, [setConfirmDialog])
}
