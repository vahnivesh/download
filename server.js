
const express = require('express');
const cors = require('cors');
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');
const fs = require('fs');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// ── Health check ──
app.get('/', (req, res) => {
  res.json({ status: 'ClipCut server running' });
});

// ── Download endpoint ──
app.post('/api/download', async (req, res) => {
  const { videoId, startSec, durationSec, format, quality, filename } = req.body;

  if (!videoId || startSec == null || durationSec == null) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  console.log('[REQUEST]', { videoId, startSec, durationSec, format, quality });

  const safeName = (filename || 'trimmed_clip').replace(/[^\w\-. ]/g, '_');
  const ext = format === 'mp3' ? 'mp3' : 'mp4';

  const tempFile = path.join(os.tmpdir(), `${crypto.randomUUID()}_raw.${ext}`);
  const trimmedFile = path.join(os.tmpdir(), `${crypto.randomUUID()}_trimmed.${ext}`);

  const url = `https://www.youtube.com/watch?v=${videoId}`;

  let args = [];

  // ── yt-dlp args (NO trimming here) ──
  if (format === 'mp3') {
    args = [
      '-x',
      '--audio-format', 'mp3',
      '--audio-quality', '0',
      '-o', tempFile,
      url,
    ];
  } else {
    const fmtStr = quality === 'best'
      ? 'bestvideo[ext=mp4]+bestaudio[ext=m4a]/best[ext=mp4]'
      : `bestvideo[height<=${quality}][ext=mp4]+bestaudio[ext=m4a]/best[height<=${quality}][ext=mp4]`;

    args = [
      '-f', fmtStr,
      '--merge-output-format', 'mp4',
      '-o', tempFile,
      url,
    ];
  }

  console.log('[yt-dlp args]', args.join(' '));

  const ytdlp = spawn('python3', ['-m', 'yt_dlp', ...args]);

  let stderr = '';

  ytdlp.stderr.on('data', d => {
    const msg = d.toString();
    stderr += msg;
    console.error('[yt-dlp]', msg);
  });

  ytdlp.on('close', (code) => {
    if (code !== 0) {
      console.error('[yt-dlp error]', stderr);
      try { fs.unlinkSync(tempFile); } catch {}
      return res.status(500).json({ error: stderr || 'yt-dlp failed' });
    }

    // ── Run ffmpeg trimming ──
    console.log('[ffmpeg] trimming...');

    const ffmpeg = spawn('ffmpeg', [
      '-ss', startSec.toString(),
      '-t', durationSec.toString(),
      '-i', tempFile,
      '-c', 'copy',
      trimmedFile
    ]);

    ffmpeg.stderr.on('data', d => {
      console.error('[ffmpeg]', d.toString());
    });

    ffmpeg.on('close', (ffcode) => {
      if (ffcode !== 0) {
        console.error('[ffmpeg error]');
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(trimmedFile); } catch {}
        return res.status(500).json({ error: 'ffmpeg failed' });
      }

      console.log('[ffmpeg] done, streaming file');

      // ── Stream trimmed file ──
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="${safeName}.${ext}"`
      );
      res.setHeader(
        'Content-Type',
        ext === 'mp3' ? 'audio/mpeg' : 'video/mp4'
      );

      const stream = fs.createReadStream(trimmedFile);
      stream.pipe(res);

      stream.on('end', () => {
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(trimmedFile); } catch {}
      });

      stream.on('error', (err) => {
        console.error('[stream error]', err);
        try { fs.unlinkSync(tempFile); } catch {}
        try { fs.unlinkSync(trimmedFile); } catch {}
        if (!res.headersSent) {
          res.status(500).json({ error: 'Stream error' });
        }
      });
    });
  });

  // ── Handle client disconnect ──
  req.on('close', () => {
    ytdlp.kill();
    try { fs.unlinkSync(tempFile); } catch {}
    try { fs.unlinkSync(trimmedFile); } catch {}
  });
});

app.listen(PORT, () => {
  console.log(`ClipCut server listening on port ${PORT}`);
});

