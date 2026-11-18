# Meeting Copilot

A live assistant for customer calls. Keep your iPhone next to your laptop during a sales, support or customer-success call. It listens, notices when the customer asks something, and puts a short, clear answer on your screen within a second or two, so you can respond confidently without putting anyone on hold.

It's powered by Claude. It runs entirely in Safari on your phone, and there's nothing to install on your laptop and no server to run.

## What it does

- **Answers customer questions as they come up.** Pricing, product capabilities, integrations, troubleshooting steps, policy details: each answer opens with a one-line restatement of the question, then a sentence you can say out loud, then a few supporting points.
- **Knows your business.** Paste product notes, pricing, FAQs, talk tracks or account details into *About me and this call* in Settings, and answers draw on them.
- **Tells you and the customer apart.** With Deepgram speech recognition, the transcript shows **Me** and **Them**, and only the customer's questions trigger answers.
- **Looks things up.** When a question needs current or specific facts, Claude can search the web or read a link you paste.
- **Handles screenshots and photos.** Paste a screenshot of an error, a dashboard or an email, or take a photo of your laptop screen, and ask about it.
- **Takes typed questions.** Type anything, ask follow-ups like "shorter" or "more detail on the second point", or tap **Answer** to answer the customer's latest question right away.
- **Shows technical answers properly.** Configuration snippets, API examples and code come back formatted, with a copy button.

## Getting started

1. Open **https://chittebbayipenugonda.github.io/meeting-assistant/** in Safari on your iPhone.
2. Paste an Anthropic API key from [console.anthropic.com](https://console.anthropic.com). API usage is billed separately from a Claude subscription, so add credits, and set a monthly spend limit there.
3. Optionally, fill in *About me and this call* with your role, product and anything else the assistant should know.
4. When the call starts, tap **Start listening** and allow the microphone.
5. Play the call through your laptop's **speakers**, not headphones, so the phone can hear the customer. Keep the page open; the screen stays on while the app is listening.

### Speech recognition

| Option | Cost | Notes |
|---|---|---|
| Safari built-in | Free | Works in a Safari tab, but usually not after "Add to Home Screen". Can't tell speakers apart |
| Deepgram | Pay as you go (free credit to start) | More accurate on long calls, labels each speaker, works from the Home Screen. Needs a Deepgram API key |

With Deepgram, tell the app which voice is yours once per session. Either tap **Learn my voice** and talk for a few seconds, or tap the speaker label on one of your own lines.

### Settings

| Setting | Default | Notes |
|---|---|---|
| Model | Sonnet 5.5 | Opus 5.5 is the most capable but slower; Haiku 5.5 is the fastest and cheapest |
| Thinking effort | Low | Raise it for complex technical questions |
| Think before answering | Off | Improves hard answers but delays the first word. Opus always thinks |
| Web search | On | Used only when a question needs current facts ($10 per 1,000 searches). An org admin may need to allow it in the Anthropic Console |
| Fast mode | Off | Opus only: faster output at twice the price |
| Auto | On | Turn it off to answer only when you tap **Answer** |

## How it works

```
laptop speaker ──► iPhone mic ──► speech-to-text ──► transcript (Me / Them)
                                   (Safari or Deepgram)          │
                                                                 ▼
                              each new phrase from the customer ──► Claude: "anything to answer?"
                                                                 │
                                          nothing ◄──────────────┤ (ignored)
                                                                 ▼
                                                   answer streams onto the screen
```

- Each phrase from the customer is sent to Claude as soon as it's transcribed, together with the recent conversation and the questions already answered.
- If there's nothing to answer, the request stops after a few words and nothing appears. Otherwise the answer streams in, with the newest on top.
- Requests are never cancelled midway. A question split across two phrases is checked again as a whole.
- The app is a static site. Your phone talks directly to Anthropic (and to Deepgram, if you use it) with your own keys.

### Cost

Every new phrase from the customer is one small Claude request. On Sonnet 5.5, a busy one-hour call typically comes to around $1–3. Haiku 5.5 is about 20× cheaper. To pay only for questions you choose, turn **Auto** off.

## Practice Pad

**https://chittebbayipenugonda.github.io/meeting-assistant/practice/** is a desktop practice room with an AI interviewer and a shared code pad, for running a mock technical interview on your computer.

- **Voice conversation.** The interviewer talks out loud (a Deepgram Aura voice, or the browser's voice without a Deepgram key) and listens to you through the mic. Your turn ends about 1.4 seconds after you stop talking. You can also use **Done talking**, **Interrupt** or **Mute**, or type instead.
- **Problems in the pad.** The interviewer writes each coding problem into the editor as a comment with a function stub.
- **Run code** in Python 3 (Pyodide, downloaded on first use) or JavaScript with **▶ Run** or ⌘/Ctrl+Enter. Infinite loops are stopped automatically.
- **It sees your work.** Every turn sends the interviewer your current code and latest run output, so it can ask about bugs, edge cases and complexity. It stays quiet while you're just thinking aloud.
- **Feedback.** **End interview** produces written feedback for each question, with a hire / no-hire signal.

Edit the role, length, voice and question list on the start screen. Keys are shared with Meeting Copilot on the same site. A session costs roughly 10–20 cents in Claude usage, plus roughly 30–50 cents for Deepgram listening and voice.

## Privacy

- API keys are stored only in Safari on your phone, and are sent only to the services they belong to.
- Audio goes to Apple's speech service (Safari) or to Deepgram. Transcripts and images go to Anthropic.
- Nothing is kept after you reload the page.
- Recording and transcription rules vary by place and by company. Let customers know when a call is being transcribed, and follow your organization's policies.

## Development

```bash
npm install
npm run dev
```

The app is Vite + React + TypeScript and uses the Anthropic TypeScript SDK in the browser. Safari only allows the microphone on HTTPS or `localhost`, so test listening on a phone with the deployed site.

Pushing to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`. For a new fork, set **Settings › Pages › Source** to **GitHub Actions** once.
