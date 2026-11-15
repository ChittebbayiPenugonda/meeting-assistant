import type { SpeechEngine, SpeechHandlers } from './types'

// Streams raw 16-bit PCM from the mic to Deepgram's live transcription
// WebSocket. More reliable and accurate than Safari's recognizer for long
// calls, and it works inside a Home Screen web app.

const WORKLET = `
class PcmTap extends AudioWorkletProcessor {
  process(inputs) {
    const ch = inputs[0] && inputs[0][0]
    if (ch) {
      const out = new Int16Array(ch.length)
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]))
        out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }
      this.port.postMessage(out.buffer, [out.buffer])
    }
    return true
  }
}
registerProcessor('pcm-tap', PcmTap)
`

export function createDeepgram(apiKey: string, lang: string, h: SpeechHandlers): SpeechEngine {
  let ws: WebSocket | null = null
  let ctx: AudioContext | null = null
  let stream: MediaStream | null = null
  let keepAlive: number | undefined
  let wanted = false
  let retries = 0

  async function openAudio() {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
    })
    ctx = new AudioContext()
    const url = URL.createObjectURL(new Blob([WORKLET], { type: 'application/javascript' }))
    await ctx.audioWorklet.addModule(url)
    URL.revokeObjectURL(url)
    const src = ctx.createMediaStreamSource(stream)
    const node = new AudioWorkletNode(ctx, 'pcm-tap')
    node.port.onmessage = (e) => {
      if (ws?.readyState === WebSocket.OPEN) ws.send(e.data)
    }
    src.connect(node)
    // Needs a path to the destination to keep processing on Safari; a muted gain avoids feedback.
    const mute = ctx.createGain()
    mute.gain.value = 0
    node.connect(mute).connect(ctx.destination)
    if (ctx.state === 'suspended') await ctx.resume()
  }

  function openSocket() {
    if (!ctx) return
    const params = new URLSearchParams({
      model: 'nova-3',
      language: lang.split('-')[0] === 'en' ? 'en' : lang,
      encoding: 'linear16',
      sample_rate: String(ctx.sampleRate),
      channels: '1',
      interim_results: 'true',
      smart_format: 'true',
      punctuate: 'true',
      endpointing: '400',
    })
    ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, ['token', apiKey])
    ws.onopen = () => {
      retries = 0
      h.onState(true)
      keepAlive = window.setInterval(() => {
        if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'KeepAlive' }))
      }, 8000)
    }
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data)
        if (msg.type !== 'Results') return
        const text: string = msg.channel?.alternatives?.[0]?.transcript ?? ''
        if (msg.is_final) {
          h.onInterim('')
          if (text.trim()) h.onFinal(text.trim())
        } else {
          h.onInterim(text)
        }
      } catch {}
    }
    ws.onclose = (e) => {
      window.clearInterval(keepAlive)
      if (!wanted) return
      if (e.code === 1008 || e.code === 4001 || e.code === 4008) {
        wanted = false
        h.onError('Deepgram rejected the API key. Check it in Settings.')
        teardown()
        return
      }
      if (retries++ < 5) {
        window.setTimeout(openSocket, 500 * retries)
      } else {
        h.onError('Lost the connection to Deepgram.')
        teardown()
      }
    }
  }

  function teardown() {
    window.clearInterval(keepAlive)
    try {
      ws?.close()
    } catch {}
    ws = null
    stream?.getTracks().forEach((t) => t.stop())
    stream = null
    ctx?.close().catch(() => {})
    ctx = null
    h.onState(false)
  }

  return {
    async start() {
      wanted = true
      try {
        await openAudio()
      } catch (err: any) {
        wanted = false
        h.onError(err?.name === 'NotAllowedError' ? 'Microphone permission was denied.' : `Microphone: ${err?.message ?? err}`)
        teardown()
        return
      }
      openSocket()
    },
    stop() {
      wanted = false
      if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'CloseStream' }))
      teardown()
    },
  }
}
