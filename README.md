# SAN

## Photo memories video maker

`make_video.py` turns a folder of photos into a 30-second portrait (1080x1920)
slideshow video with a slow zoom on each photo, smooth crossfades, and a song
in the background.

### How to use

1. Put your photos in a `photos/` folder in this repo. Name them in the order
   you want them to appear: `01.jpg`, `02.jpg`, `03.jpg`, ...
2. Put your song file (e.g. `channa-mereya.mp3`) in an `audio/` folder.
3. Run:

```bash
python3 make_video.py
```

The video is saved as `memories.mp4`.

### Options

```bash
python3 make_video.py --duration 30 --audio-start 0 --out memories.mp4
```

- `--audio-start` skips into the song, e.g. `--audio-start 60` starts the
  music 1 minute into the track. Useful if your audio file is the full song
  and you want it to begin right at the part you like.
- The song automatically fades out at the end of the video.

Requires `ffmpeg` (and Python 3), nothing else.
