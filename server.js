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

function runYtDlp(args, options = {}) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';
        execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50, ...options }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr || error.message));
            else resolve(stdout);
        });
    });
}

// Extract playlist ID from various URL formats
function extractPlaylistId(url) {
    // Convert music.youtube.com to www.youtube.com
    url = url.replace('music.youtube.com', 'www.youtube.com');
    
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    const altMatch = url.match(/playlist\/([a-zA-Z0-9_-]+)/);
    if (altMatch) return altMatch[1];
    return null;
}

// Detect platform from URL
function detectPlatform(url) {
    if (url.includes('youtube.com') || url.includes('youtu.be')) return 'youtube';
    if (url.includes('soundcloud.com')) return 'soundcloud';
    if (url.includes('bandcamp.com')) return 'bandcamp';
    if (url.includes('spotify.com')) return 'spotify';
    if (url.includes('deezer.com')) return 'deezer';
    if (url.includes('apple.com')) return 'apple';
    return 'generic';
}

// Common yt-dlp args for all platforms
const COMMON_ARGS = [
    '--no-check-certificates',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--js-runtimes', 'deno',
    '--no-warnings',
    '--no-playlist'
];

// Get platform-specific args
function getPlatformArgs(url) {
    const platform = detectPlatform(url);
    
    switch(platform) {
        case 'youtube':
            return [
                '--extractor-args', 'youtube:player_client=web_music',
            ];
        case 'soundcloud':
            return [
                '--extractor-args', 'soundcloud:client_id=YOUR_CLIENT_ID',
            ];
        case 'spotify':
            return [
                '--extractor-args', 'spotify:client_id=YOUR_CLIENT_ID:client_secret=YOUR_CLIENT_SECRET',
            ];
        default:
            return [];
    }
}

// GET /api/playlist – fetch playlist metadata and video list
app.get('/api/playlist', async (req, res) => {
    const { url } = req.query;
    if (!url) return res.status(400).json({ error: 'Playlist URL is required' });

    try {
        const platform = detectPlatform(url);
        const playlistId = extractPlaylistId(url);
        
        let args = [
            '--flat-playlist',
            '--dump-json',
            ...COMMON_ARGS,
            ...getPlatformArgs(url),
        ];
        
        if (playlistId) {
            args.push(`https://www.youtube.com/playlist?list=${playlistId}`);
        } else {
            args.push(url);
        }

        const stdout = await runYtDlp(args);
        const lines = stdout.trim().split('\n').filter(Boolean);

        const videos = lines.map(line => {
            try {
                const data = JSON.parse(line);
                return {
                    id: data.id || Math.random().toString(36).substring(7),
                    title: data.title || 'Unknown Title',
                    url: data.webpage_url || data.url || url,
                    duration: data.duration || 0,
                    thumbnail: data.thumbnail || (data.thumbnails && data.thumbnails[0]?.url) || ''
                };
            } catch (e) {
                return null;
            }
        }).filter(v => v !== null);

        let title = 'Playlist';
        let channel = 'Unknown';
        if (videos.length > 0) {
            const firstLine = JSON.parse(lines[0]);
            title = firstLine.playlist_title || firstLine.title || 'Playlist';
            channel = firstLine.uploader || firstLine.channel || firstLine.artist || 'Unknown';
        }

        res.json({
            title,
            channel,
            platform: platform,
            thumbnail: videos[0]?.thumbnail || '',
            videos
        });
    } catch (err) {
        console.error('Playlist fetch error:', err);
        res.status(500).json({ error: `Failed to fetch playlist: ${err.message}` });
    }
});

// GET /api/download – download a single video/audio as MP3
app.get('/api/download', async (req, res) => {
    const { url, title } = req.query;
    if (!url) return res.status(400).json({ error: 'Video URL is required' });

    const safeTitle = (title || 'audio').replace(/[^\w\s-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 100);
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmp3-'));
    const outputPath = path.join(tempDir, `${safeTitle || 'audio'}.mp3`);

    try {
const args = [
    '-f', 'bestaudio',
    '--extract-audio',
    '--audio-format', 'mp3',
    '--audio-quality', '0',
    '--no-check-certificates',
    '--user-agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    '--js-runtimes', 'deno',
    '--extractor-args', 'youtube:player_client=web_music',
    '--cookies', 'cookies.txt',
    '--no-warnings',
    '-o', outputPath,
    url
];

        await runYtDlp(args, { timeout: 180000 }); // 3 minutes timeout

        if (!fs.existsSync(outputPath)) {
            throw new Error('Conversion failed, output file not created');
        }

        res.setHeader('Content-Type', 'audio/mpeg');
        res.setHeader('Content-Disposition', `attachment; filename="${safeTitle}.mp3"`);
        const fileStream = fs.createReadStream(outputPath);
        fileStream.pipe(res);

        fileStream.on('close', () => {
            fs.rmSync(tempDir, { recursive: true, force: true });
        });
    } catch (err) {
        console.error('Download error:', err);
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }
        res.status(500).json({ error: `Download failed: ${err.message}` });
    }
});

// GET /api/supported – list supported platforms
app.get('/api/supported', (req, res) => {
    res.json({
        platforms: [
            'YouTube',
            'YouTube Music',
            'SoundCloud',
            'Bandcamp',
            'Vimeo',
            'Twitter/X',
            'Instagram',
            'Facebook',
            'TikTok',
            'And 1000+ more'
        ]
    });
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'), err => {
        if (err) {
            res.send('Frontend not found. Create public/index.html');
        }
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
    console.log('Supported platforms: YouTube, SoundCloud, Bandcamp, and 1000+ more');
});
