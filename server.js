const express = require('express');
const cors = require('cors');
const { execFile } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to run yt-dlp and capture output
function runYtDlp(args, options = {}) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';
        execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50, ...options }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr || error.message));
            else resolve(stdout);
        });
    });
}

// Extract playlist ID from YouTube or YouTube Music URL
function extractPlaylistId(url) {
    // Convert music.youtube.com to www.youtube.com
    url = url.replace('music.youtube.com', 'www.youtube.com');
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    const altMatch = url.match(/playlist\/([a-zA-Z0-9_-]+)/);
    return altMatch ? altMatch[1] : null;
}

// Common arguments for YouTube / YouTube Music
function getCommonYtArgs() {
    return [
        '--no-check-certificates',
        '--no-warnings',
        '--cookies', path.join(__dirname, 'cookies.txt'),
        '--extractor-args', 'youtube:player_client=android',
        '--user-agent', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
        '--js-runtimes', 'node'
    ];
}

// Endpoint: Fetch playlist metadata and entries
app.get('/api/playlist', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Playlist URL is required' });

    const playlistId = extractPlaylistId(url);
    if (!playlistId) return res.status(400).json({ error: 'Invalid playlist URL' });

    const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;

    try {
        const args = [
            '--dump-single-json',
            '--skip-download',
            ...getCommonYtArgs(),
            playlistUrl
        ];

        const stdout = await runYtDlp(args);
        const data = JSON.parse(stdout);

        // Extract videos from entries
        const videos = (data.entries || []).map(entry => ({
            id: entry.id,
            title: entry.title || 'Unknown',
            url: `https://www.youtube.com/watch?v=${entry.id}`,
            duration: entry.duration || 0,
            thumbnail: entry.thumbnail || `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`
        })).filter(v => v.id);

        res.json({
            title: data.title || 'Playlist',
            channel: data.uploader || data.channel || 'Unknown',
            thumbnail: videos[0]?.thumbnail || '',
            videos
        });
    } catch (err) {
        console.error('Playlist fetch error:', err.message);
        res.status(500).json({ error: `Failed to load playlist: ${err.message}` });
    }
});

// Endpoint: Download a single track as MP3
app.get('/api/download', async (req, res) => {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: 'Video URL is required' });

    const safeTitle = (title || 'audio').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100) || 'audio';
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-'));
    const outputPath = path.join(tempDir, `${safeTitle}.mp3`);

    try {
        const args = [
            '-f', 'bestaudio',
            '--extract-audio',
            '--audio-format', 'mp3',
            ...getCommonYtArgs(),
            '-o', outputPath,
            url
        ];

        await runYtDlp(args, { timeout: 180000 });

        if (!fs.existsSync(outputPath)) {
            throw new Error('MP3 file not created');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);

        fileStream.on('close', () => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });
    } catch (err) {
        console.error('Download error:', err.message);
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        res.status(500).json({ error: `Download failed: ${err.message}` });
    }
});

// Health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'YT Music Downloader' });
});

// yt-dlp version check (useful for debugging)
app.get('/version', async (req, res) => {
    try {
        const stdout = await runYtDlp(['--version']);
        res.json({ version: stdout.trim() });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Serve frontend
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
        if (err) {
            res.send('Frontend not found. Create public/index.html');
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
