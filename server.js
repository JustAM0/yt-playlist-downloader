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

// Run yt-dlp command
function runYtDlp(args, options = {}) {
    return new Promise((resolve, reject) => {
        const ytDlpPath = process.env.YTDLP_PATH || 'yt-dlp';
        execFile(ytDlpPath, args, { maxBuffer: 1024 * 1024 * 50, ...options }, (error, stdout, stderr) => {
            if (error) reject(new Error(stderr || error.message));
            else resolve(stdout);
        });
    });
}

// Extract playlist ID from YouTube Music URL
function extractPlaylistId(url) {
    // Convert music.youtube.com to www.youtube.com
    url = url.replace('music.youtube.com', 'www.youtube.com');
    
    // Match ?list=PLAYLIST_ID
    const match = url.match(/[?&]list=([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
    
    // Match playlist/PLAYLIST_ID
    const altMatch = url.match(/playlist\/([a-zA-Z0-9_-]+)/);
    if (altMatch) return altMatch[1];
    
    return null;
}

// Common yt-dlp arguments for YouTube Music
function getCommonArgs() {
    return [
        '--no-check-certificates',
        '--no-warnings',
        '--cookies', path.join(__dirname, 'cookies.txt'),
        '--extractor-args', 'youtube:player_client=android',
        '--user-agent', 'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
    ];
}

// GET /api/playlist - Fetch YouTube Music playlist
app.get('/api/playlist', async (req, res) => {
    const { url } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Playlist URL is required' });
    }

    const playlistId = extractPlaylistId(url);
    
    if (!playlistId) {
        return res.status(400).json({ error: 'Invalid YouTube Music playlist URL' });
    }

    try {
        const playlistUrl = `https://www.youtube.com/playlist?list=${playlistId}`;
        
        const args = [
            '--flat-playlist',
            '--dump-json',
            ...getCommonArgs(),
            playlistUrl
        ];

        const stdout = await runYtDlp(args);
        const lines = stdout.trim().split('\n').filter(Boolean);

        if (lines.length === 0) {
            throw new Error('No videos found in playlist');
        }

        const videos = lines.map(line => {
            try {
                const data = JSON.parse(line);
                return {
                    id: data.id,
                    title: data.title || 'Unknown',
                    url: `https://www.youtube.com/watch?v=${data.id}`,
                    duration: data.duration || 0,
                    thumbnail: data.thumbnail || `https://i.ytimg.com/vi/${data.id}/mqdefault.jpg`
                };
            } catch (e) {
                return null;
            }
        }).filter(v => v !== null);

        const firstVideo = JSON.parse(lines[0]);
        const playlistTitle = firstVideo.playlist_title || 'YouTube Music Playlist';
        const channel = firstVideo.uploader || firstVideo.channel || 'YouTube Music';

        res.json({
            title: playlistTitle,
            channel: channel,
            thumbnail: videos[0]?.thumbnail || '',
            videos: videos
        });

    } catch (err) {
        console.error('Playlist error:', err.message);
        res.status(500).json({ error: `Failed to load playlist: ${err.message}` });
    }
});

// GET /api/download - Download single track as MP3
app.get('/api/download', async (req, res) => {
    const { url, title } = req.query;
    
    if (!url) {
        return res.status(400).json({ error: 'Video URL is required' });
    }

    const safeTitle = (title || 'audio')
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100) || 'audio';

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ytmusic-'));
    const outputPath = path.join(tempDir, `${safeTitle}.mp3`);

    try {
        const args = [
            '-f', 'bestaudio',
            '--extract-audio',
            '--audio-format', 'mp3',
            ...getCommonArgs(),
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
    res.json({ status: 'ok', service: 'YouTube Music Downloader' });
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
    console.log(`🎵 YouTube Music Downloader running on port ${PORT}`);
});
