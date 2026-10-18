# ReadFlow

A browser extension that helps people finish long articles: it shows how many words you have read, how far you are, and how much time is left, and it can dim everything except the article so your eyes can rest.

## Install (Chrome or Edge)
1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Click **Load unpacked** and choose this folder (the one that contains `manifest.json`).
3. Open a long article and scroll. Click the ReadFlow icon in the toolbar for the popup.
4. After changing any code, click the reload icon on the extension card and refresh the article page.

## Features
- **Words read and progress, always visible.** A card in the bottom-right corner shows `words read / total words`, a progress bar, the percent done and the minutes left. A thin bar also runs along the top of the page (switch it off with *Progress bar on page*). The card stays visible even when the panel is closed. Progress is measured on the article itself, not the whole page.
- **Dim focus mode.** The page keeps its normal layout. The article stays lit with a soft warm glow around its edge, and the rest of the page goes dark. Turn it on from the popup, from the on-page panel (*Dim focus*), and press **Esc** to turn it off. *Dim focus strength* (40% to 95%) is in the popup settings.
- **Pomodoro timer with your own length.** 25 minutes focus and 5 minutes break by default. Change them to anything from 1 to 180 minutes (for example 2 or 10):
  - In the popup, click the **⋮** button at the top right (or **Change time** next to Pomodoro), then pick a preset (2, 5, 10, 25, 45) or type your own focus and break minutes.
  - On the page, open the ReadFlow panel and click its **⋮** button for the same settings.
  - A running session keeps its length; the new length is used from the next session.
  - You get a notification and a short beep at the end of each focus and break.
- **Text size, line spacing and theme.** In the popup (*Text & theme*) and in the on-page panel:
  - *Text size*: A− / A+ in steps of 10% from 70% to 200%. Click the percent to reset to 100%.
  - *Line spacing*: Auto (the page's own), 1.4, 1.6, 1.8 or 2.0.
  - *Theme*: Default (the page's own colors), Light, Sepia or Dark.
  - Setting size back to 100%, spacing to Auto and theme to Default restores the page exactly. These apply on article pages only.
- **Movable panel.** Drag the panel's title or the progress card anywhere on the page, or pick a corner (↖ ↗ ↙ ↘) in the panel or the popup. The position is remembered. At the top of the screen the panel opens downward.
- **Article summary.** Click **Summarize article** in the panel or the popup. It picks the 3 to 5 most important sentences of the article, in the article's own language. It runs in your browser: no server, no API key, nothing is sent anywhere.
- **Bionic reading** (bold word beginnings) and **reading history** (time read today, in 7 days and all time, plus the articles you read).

## If the card does not show up
- Reload the extension at `chrome://extensions`, then **refresh** the article tab. Tabs opened before the install or reload do not get the extension until they are refreshed.
- ReadFlow works on `http` and `https` pages with 100 or more words of text. It does not run on `chrome://` pages, the Chrome Web Store, PDFs or `file://` pages.
- Sites that change pages without reloading (Substack, Medium, news apps) are handled: ReadFlow rescans when the address changes and keeps looking for late-loading text.

## Files
| File | Job |
|---|---|
| `manifest.json` | Tells the browser what the extension is and which files to use |
| `content.js` | Runs on web pages: finds the article, counts words, tracks progress, draws the card, top bar and dim focus, bionic reading, history |
| `content.css` | Styles for the top bar, the dim spotlight, messages, text size, line spacing and themes |
| `popup.html`, `popup.css`, `popup.js` | The toolbar popup: live words read, tools, ⋮ settings, Pomodoro, history |
| `background.js` | Runs the Pomodoro timer (alarms, notifications, saved lengths) |
| `offscreen.html`, `offscreen.js` | Plays the alarm sound |
| `icon16.png`, `icon48.png`, `icon128.png` | Extension icons |

## Privacy
Everything stays in your browser's own extension storage (settings, timer lengths, reading history). There is no server and nothing is sent anywhere. To see the saved data, right-click the popup, choose **Inspect**, and run `chrome.storage.local.get(null, console.log)` in the Console.
