# ChordKeys

Play piano chords from your computer keyboard. Letter keys play **minor** chords. Hold **Shift** for **major**.

The tone is tuned for soft Tamil/Hindi melody songs: warmer lows, felt-style highs, gentle hall reverb, slower attack/release, and open chord voicings that sit under a vocal line.

## Play

Open `index.html` in a browser, or serve the folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`. Click **Begin playing** (browsers require a click before audio starts), then press keys.

| Key | Minor | Shift + key |
|-----|-------|-------------|
| A | A minor | A major |
| B | B minor | B major |
| C | C minor | C major |
| D | D minor | D major |
| E | E minor | E major |
| F | F minor | F major |
| G | G minor | G major |
| 1 | C♯ minor | C♯ major |
| 2 | D♯ minor | D♯ major |
| 3 | F♯ minor | F♯ major |
| 4 | G♯ minor | G♯ major |
| 5 | A♯ minor | A♯ major |

Click the on-screen keys for single notes. Click a row in the key map to hear that chord.

Sound uses sampled grand-piano notes shaped into a soft film-ballad voice (with a built-in fallback tone if samples cannot load).
