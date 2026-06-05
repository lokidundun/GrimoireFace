import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GitHubUser {
  login: string
  name: string | null
  avatar_url: string
  html_url: string
}

// ─── Storage ──────────────────────────────────────────────────────────────────

const TOKEN_KEY = 'grimoireface_gh_token'

function loadToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY)
  } catch {
    return null
  }
}

function saveToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token)
  } catch {}
}

function clearToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY)
  } catch {}
}

// ─── GitHub API ───────────────────────────────────────────────────────────────

async function fetchGitHubUser(token: string): Promise<GitHubUser> {
  const res = await fetch('https://api.github.com/user', {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  })
  if (!res.ok) throw new Error(`GitHub API ${res.status}: ${res.statusText}`)
  const data = await res.json()
  return {
    login: data.login,
    name: data.name ?? null,
    avatar_url: data.avatar_url,
    html_url: data.html_url,
  }
}

// ─── OAuth URL builder ────────────────────────────────────────────────────────

export function buildGitHubOAuthUrl(): string {
  const clientId = import.meta.env.VITE_GITHUB_CLIENT_ID
  if (!clientId) throw new Error('VITE_GITHUB_CLIENT_ID is not set')
  const state = Math.random().toString(36).slice(2) + Date.now().toString(36)
  try {
    sessionStorage.setItem('grimoireface_oauth_state', state)
  } catch {}
  const params = new URLSearchParams({
    client_id: clientId,
    scope: 'gist',
    state,
  })
  return `https://github.com/login/oauth/authorize?${params.toString()}`
}

// ─── Pinia Store ──────────────────────────────────────────────────────────────

export const useAuthStore = defineStore('auth', () => {
  const token = ref<string | null>(null)
  const user = ref<GitHubUser | null>(null)
  const loading = ref(false)
  const initialized = ref(false)

  const isLoggedIn = computed(() => !!token.value && !!user.value)

  // ── Initialize ──

  async function init() {
    if (initialized.value) return

    // Always check OAuth callback first — token arrives via URL hash after
    // the backend proxy exchanges the code.
    const hashToken = handleOAuthCallback()
    if (hashToken) {
      // OAuth callback provided a fresh token — use it directly
      token.value = hashToken
      loading.value = true
      try {
        user.value = await fetchGitHubUser(hashToken)
      } catch {
        token.value = null
        clearToken()
      } finally {
        loading.value = false
        initialized.value = true
      }
      return
    }

    const stored = loadToken()
    if (!stored) {
      initialized.value = true
      return
    }
    token.value = stored
    loading.value = true
    try {
      user.value = await fetchGitHubUser(stored)
    } catch {
      token.value = null
      clearToken()
    } finally {
      loading.value = false
      initialized.value = true
    }
  }

  /** Extracts token from URL hash. Returns the token string if found, null otherwise. */
  function handleOAuthCallback(): string | null {
    const hash = window.location.hash
    if (!hash.includes('token=')) return null

    const params = new URLSearchParams(hash.slice(1))
    const newToken = params.get('token')
    if (!newToken) return null

    const returnedState = params.get('state')
    const savedState = (() => {
      try {
        return sessionStorage.getItem('grimoireface_oauth_state')
      } catch {
        return null
      }
    })()
    if (savedState && returnedState && savedState !== returnedState) {
      console.warn('[auth] OAuth state mismatch — possible CSRF, ignoring token')
      window.history.replaceState(null, '', window.location.pathname + window.location.search)
      return null
    }
    try {
      sessionStorage.removeItem('grimoireface_oauth_state')
    } catch {}

    window.history.replaceState(null, '', window.location.pathname + window.location.search)

    saveToken(newToken)
    return newToken
  }

  // ── Actions ──

  function login() {
    try {
      window.location.href = buildGitHubOAuthUrl()
    } catch (err) {
      console.error('[auth] Failed to build OAuth URL:', err)
    }
  }

  function logout() {
    clearToken()
    token.value = null
    user.value = null
  }

  async function setToken(newToken: string) {
    saveToken(newToken)
    token.value = newToken
    try {
      user.value = await fetchGitHubUser(newToken)
    } catch {
      clearToken()
      token.value = null
      user.value = null
    }
  }

  return {
    token,
    user,
    loading,
    initialized,
    isLoggedIn,
    init,
    login,
    logout,
    setToken,
  }
})
