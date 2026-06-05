import { ref, onUnmounted } from 'vue'

export function useBufferedText(initialText = '') {
  const text = ref(initialText)
  let buffer = initialText
  let frame: number | null = null

  function flush() {
    frame = null
    text.value = buffer
  }

  function appendText(chunk: string) {
    buffer += chunk
    if (frame !== null) return
    frame = requestAnimationFrame(flush)
  }

  function resetText(nextText = '') {
    buffer = nextText
    if (frame !== null) {
      cancelAnimationFrame(frame)
      frame = null
    }
    text.value = nextText
  }

  onUnmounted(() => {
    if (frame !== null) cancelAnimationFrame(frame)
  })

  return { text, appendText, resetText }
}
