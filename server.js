const express = require('express');
const cors    = require('cors');
const { spawn } = require('child_process');
const path    = require('path');
const os      = require('os');
const fs      = require('fs');
const crypto  = require('crypto');

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Health check ──
app.get('/', (req, res) => res.json({ status: 'ClipCut server running' }));

// ── Download endpoint ──
app.post('/api/download', async (req, res) => {
  const { videoId, startSec, durationSec, format, quality, filename } = req.body;

  if (!videoId || startSec == null || durationSec == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const safeName = (filename || 'trimmed_clip').replace(/[^\w\-. ]/g, '_');
  const ext      = format === 'mp3' ? 'mp3' : 'mp4';
  const outFile  = path.join(os.tmpdir(), `${crypto.randomUUID()}_${safeName}.${ext}`);
  const url      = `https://www.youtube.com/watch?v=${videoId}`;
  const trim     = `-ss ${startSec} -t ${durationSec}`;

  let args = [];

  if (format === 'mp3') {
    args = [
      '-x',
      '--audio-format', 'mp3',
      '--postprocessor-args', `ffmpeg:${trim}`,
      '-o', outFile,
      url,
    ];
  } else {
    const fmtStr = quality === 'best'
      ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]'
      : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]`;
    args = [
      '-f', fmtStr,
      '--merge-output-format', 'mp4',
      '--postprocessor-args', `ffmpeg:${trim}`,
      '-o', outFile,
      url,
    ];
  }

  console.log('[yt-dlp]', args.join(' '));

  const ytdlp = spawn('python3', ['-m', 'yt_dlp', ...args]);

  let stderr = '';
  ytdlp.stderr.on('data', d => { stderr += d.toString(); });
  ytdlp.stdout.on('data', d => process.stdout.write(d));

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('[yt-dlp error]', stderr);
      // Clean up if partial file exists
      try { fs.unlinkSync(outFile); } catch {}
      return res.status(500).json({ error: stderr || 'yt-dlp failed' });
    }

    // Stream file to client then delete
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.${ext}"`);
    res.setHeader('Content-Type', ext === 'mp3' ? 'audio/mpeg' : 'video/mp4');

    const stream = fs.createReadStream(outFile);
    stream.pipe(res);
    stream.on('end', () => {
      try { fs.unlinkSync(outFile); } catch {}
    });
    stream.on('error', (err) => {
      console.error('[stream error]', err);
      try { fs.unlinkSync(outFile); } catch {}
      if (!res.headersSent) res.status(500).json({ error: 'Stream error' });
    });
  });

  // If client disconnects, kill yt-dlp
  req.on('close', () => {
    ytdlp.kill();
    try { fs.unlinkSync(outFile); } catch {}
  });
});

app.listen(PORT, () => console.log(`ClipCut server listening on port ${PORT}`));
