# Meeting Copilot

A meeting assistant that runs in Safari on your iPhone. Put the phone next to your laptop during a call: it transcribes what it hears, notices when someone asks a question, and shows a short, clear answer from Claude (with code when the question calls for it). You can also type a question, paste a screenshot, or snap a photo of your screen.

It's a static web app hosted on GitHub Pages. There's no server and nothing runs on your laptop: the phone talks straight to the Anthropic API with your own key.

## How it works

```
laptop speaker ──► iPhone mic ──► speech-to-text ──► transcript
                                   (Safari or Deepgram)     │
                                                            ▼
                          pause in speech (≈1.3s) ──► Claude: "is there a new question here?"
                                                            │
                                    NO_QUESTION ◄───────────┤ (discarded)
                                                            ▼
                                             streamed answer card on screen
```

- **Listening.** By default it uses Safari's built-in speech recognition, which is free. Deepgram (`nova-3`, streamed over a WebSocket) is optional: it's more accurate on long calls and also works when the app is added to the Home Screen.
- **Detecting questions.** After each pause, the new speech is sent to Claude along with the recent transcript and the questions it has already answered. Claude either replies `NO_QUESTION` (the app stops that request after a few tokens and shows nothing) or streams an answer. If speech continues while Claude is still deciding, that check is cancelled and redone with the extra words.
- **Answers** start with a `Q:` line restating the question, then a sentence you can say out loud, then up to five bullets, or a code block plus notes on complexity. The newest answer is on top and expanded, and older ones collapse to a single line.
- **Typing, pasting and photos.** The text box and the image button send whatever you add, plus the transcript, to Claude. With the box empty, the button reads **Answer**, which answers the latest question right away.
- **Follow-ups.** Recent questions and answers go back to Claude with each request, so "shorter" or "now in Java" works.
- **Context.** Settings › *About me and this call* is where you put your role, résumé, the job description or the agenda. Answers about you are written in the first person from it.

## Use it

1. Open the GitHub Pages URL in **Safari** on your iPhone.
2. Paste your Anthropic API key (console.anthropic.com). It's saved only in that browser's localStorage.
3. Tap **Start listening** and allow the microphone.
4. Use your laptop's **speakers**, not headphones, so the phone can hear the other person. Keep this page open and the screen on (the app holds a screen wake lock while listening).

Safari's speech recognition generally doesn't work in a Home Screen web app on iOS. Either keep using it in a Safari tab, or switch to Deepgram in Settings.

### Settings

| Setting | Default | Notes |
|---|---|---|
| Model | Sonnet 5.5 | Opus 5.5 is smarter but slower; Haiku 5.5 is fastest and cheapest |
| Thinking effort | Low | Raise it for hard coding problems |
| Fast mode | Off | Opus only, up to 2.5× faster output at 2× the price |
| Auto | On | Turn it off to answer only when you tap **Answer** |
| Pause | 1.3s | How long a silence counts as the end of a question |

**Cost.** Every pause in the conversation is one small Claude request. The system prompt is cached, and requests with nothing to answer stop after a few tokens. Haiku 5.5 is by far the cheapest choice if you'll use it for hours.

## Develop

```bash
npm install
npm run dev
```

`npm run dev` listens on your LAN too. Safari only allows the microphone on HTTPS or `localhost`, though, so test listening on a phone from the deployed Pages site.

## Deploy

Push to `main`. `.github/workflows/deploy.yml` builds the site and publishes it to GitHub Pages. In the repo, go to **Settings › Pages** and set **Source** to **GitHub Actions** once.

## Privacy

Your API keys stay in the browser. Audio goes to Apple's speech service (Safari) or to Deepgram. Transcripts and images go to Anthropic. Nothing is saved after you reload the page. Recording-consent laws vary, so tell people on the call that you're transcribing.
