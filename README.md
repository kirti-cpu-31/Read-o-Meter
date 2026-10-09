# Read-o-Meter
# Read-o-Meter

A Chrome extension that makes long online articles easier to read and finish.

## The problem
Long articles are hard to read online. People lose focus, don't know how much is left, and can't easily adjust the page to suit their eyes or attention.

## What it does
- Progress bar and a card showing % read, time left and your own reading pace
- Resume where you left off
- Themes (light, sepia, dark), text size and line spacing
- Bionic reading to help focus


## Who it helps
Students, people with ADHD or dyslexia, and anyone who reads a lot online

## Install
1. Open `chrome://extensions` and turn on Developer mode.
2. Click Load unpacked and pick this folder.
3. Open a long article and scroll.

## How it works
- Built with Vanilla JavaScript, HTML and CSS (Chrome Manifest V3)
- `content.js` runs on web pages and does the tracking and the tools
- The summary scores sentences by word frequency, offline, with no AI service

## Privacy
Everything stays in your browser. No data is sent anywhere. The only permission is `storage`.

## Known limitations
- Works best on English articles
- Pages that don't use `<p>` tags for text may not be detected
