import { ref, onUnmounted, computed } from 'vue'

type SpeechRecognitionErrorCode =
  | 'aborted'
  | 'audio-capture'
  | 'bad-grammar'
  | 'language-not-supported'
  | 'network'
  | 'no-speech'
  | 'not-allowed'
  | 'phrases-not-supported'
  | 'service-allowed'

interface SpeechRecognitionAlternativeLike {
  transcript: string
}

interface SpeechRecognitionResultLike {
  readonly isFinal: boolean
  readonly length: number
  item(index: number): SpeechRecognitionAlternativeLike
  [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionResultListLike {
  readonly length: number
  item(index: number): SpeechRecognitionResultLike
  [index: number]: SpeechRecognitionResultLike
}

interface SpeechRecognitionEventLike extends Event {
  readonly resultIndex: number
  readonly results: SpeechRecognitionResultListLike
}

interface SpeechRecognitionErrorEventLike extends Event {
  readonly error: SpeechRecognitionErrorCode
  readonly message?: string
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  onend: ((event: Event) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onstart: ((event: Event) => void) | null
  abort: () => void
  start: () => void
  stop: () => void
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
}

interface UseSpeechRecognitionOptions {
  lang?: string
  onFinalTranscript: (transcript: string) => void
  onInterimTranscript?: (transcript: string) => void
  onError?: (message: string) => void
}

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  if (typeof window === 'undefined') return null
  return window.SpeechRecognition ?? window.webkitSpeechRecognition ?? null
}

function getSpeechErrorMessage(error: SpeechRecognitionErrorCode, fallback?: string): string {
  switch (error) {
    case 'not-allowed':
    case 'service-allowed':
      return '浏览器未授权麦克风，请允许语音输入后重试'
    case 'audio-capture':
      return '没有检测到可用麦克风'
    case 'language-not-supported':
      return '当前浏览器不支持所选识别语言'
    case 'network':
      return '语音识别服务暂时不可用，请稍后重试'
    case 'no-speech':
      return '没有识别到语音，可以再试一次'
    case 'aborted':
      return ''
    default:
      return fallback || '语音识别失败，请稍后重试'
  }
}

export function useSpeechRecognition({
  lang = 'zh-CN',
  onFinalTranscript,
  onInterimTranscript,
  onError,
}: UseSpeechRecognitionOptions) {
  const listening = ref(false)
  const interimTranscript = ref('')
  const error = ref<string | null>(null)
  const supported = computed(() => Boolean(getSpeechRecognitionConstructor()))

  let recognition: SpeechRecognitionLike | null = null

  function clearInterimTranscript() {
    interimTranscript.value = ''
    onInterimTranscript?.('')
  }

  function stop() {
    recognition?.stop()
  }

  function abort() {
    recognition?.abort()
  }

  function start() {
    const Recognition = getSpeechRecognitionConstructor()
    if (!Recognition) {
      const message = '当前浏览器不支持语音输入'
      error.value = message
      onError?.(message)
      return
    }

    recognition?.abort()

    const rec = new Recognition()
    rec.lang = lang
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 1

    rec.onstart = () => {
      listening.value = true
      error.value = null
      clearInterimTranscript()
    }

    rec.onresult = (event) => {
      let interim = ''
      const finalParts: string[] = []

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0]?.transcript.trim()
        if (!transcript) continue
        if (result.isFinal) {
          finalParts.push(transcript)
        } else {
          interim = `${interim}${transcript}`
        }
      }

      if (finalParts.length > 0) onFinalTranscript(finalParts.join(' '))

      const nextInterim = interim.trim()
      interimTranscript.value = nextInterim
      onInterimTranscript?.(nextInterim)
    }

    rec.onerror = (event) => {
      const message = getSpeechErrorMessage(event.error, event.message)
      if (!message) return
      error.value = message
      onError?.(message)
    }

    rec.onend = () => {
      listening.value = false
      clearInterimTranscript()
      if (recognition === rec) recognition = null
    }

    recognition = rec

    try {
      rec.start()
    } catch {
      const message = '语音识别启动失败，请稍后重试'
      error.value = message
      listening.value = false
      recognition = null
      onError?.(message)
    }
  }

  function toggle() {
    if (listening.value) stop()
    else start()
  }

  function clearError() {
    error.value = null
  }

  onUnmounted(() => abort())

  return {
    supported,
    listening,
    interimTranscript,
    error,
    start,
    stop,
    toggle,
    clearError,
  }
}
