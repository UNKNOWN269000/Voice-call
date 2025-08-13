const express = require('express');
const path = require('path');
const dotenv = require('dotenv');
const helmet = require('helmet');
const compression = require('compression');
const cors = require('cors');

dotenv.config();

const app = express();
app.use(helmet());
app.use(compression());
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 3000;

// Expose a minimal, safe config to the browser (no passwords!)
app.get('/config', (_req, res) => {
  res.json({
    sipWssUrl: process.env.SIP_WSS_URL,
    sipUri: process.env.SIP_URI,
    displayName: process.env.DISPLAY_NAME || 'Web Caller',
    iceServers: (process.env.ICE_SERVERS || 'stun:stun.l.google.com:19302')
      .split(',')
      .map(s => ({ urls: s.trim() }))
  });
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Simple health check
app.get('/health', (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => {
  console.log(`✅ Server running on http://localhost:${PORT}`);
});
