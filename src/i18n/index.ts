import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { enUS, zhCN } from './resources'

export type AppLanguage = 'zh-CN' | 'en-US'
export type LanguagePreference = 'system' | AppLanguage

export const LANGUAGE_STORAGE_KEY = 'android-log-desktop.language'

export const LANGUAGE_OPTIONS: Array<{ value: LanguagePreference; labelKey: string }> = [
  { value: 'system', labelKey: 'language.system' },
  { value: 'zh-CN', labelKey: 'language.zhCN' },
  { value: 'en-US', labelKey: 'language.enUS' },
]

function systemLanguage(): AppLanguage {
  if (typeof navigator === 'undefined') {
    return 'zh-CN'
  }
  const language = navigator.language || navigator.languages?.[0] || ''
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

export function normalizeLanguagePreference(value: unknown): LanguagePreference {
  return value === 'zh-CN' || value === 'en-US' || value === 'system' ? value : 'system'
}

export function readLanguagePreference(): LanguagePreference {
  try {
    if (typeof window === 'undefined') {
      return 'system'
    }
    return normalizeLanguagePreference(window.localStorage.getItem(LANGUAGE_STORAGE_KEY))
  } catch {
    return 'system'
  }
}

export function resolvedLanguage(preference: LanguagePreference): AppLanguage {
  return preference === 'system' ? systemLanguage() : preference
}

export function writeLanguagePreference(preference: LanguagePreference) {
  try {
    if (typeof window === 'undefined') {
      return
    }
    window.localStorage.setItem(LANGUAGE_STORAGE_KEY, preference)
  } catch {
    // Language persistence is optional when the WebView storage is unavailable.
  }
}

export async function applyLanguagePreference(preference: LanguagePreference) {
  const nextLanguage = resolvedLanguage(preference)
  if (typeof document !== 'undefined') {
    document.documentElement.lang = nextLanguage
  }
  if (i18n.language !== nextLanguage) {
    await i18n.changeLanguage(nextLanguage)
  }
}

export function translate(key: string, options?: Record<string, unknown>) {
  return i18n.t(key, options)
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': {
      translation: zhCN,
    },
    'en-US': {
      translation: enUS,
    },
  },
  lng: resolvedLanguage(readLanguagePreference()),
  fallbackLng: 'zh-CN',
  interpolation: {
    escapeValue: false,
  },
})

if (typeof document !== 'undefined') {
  document.documentElement.lang = resolvedLanguage(readLanguagePreference())
}

export default i18n
