const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');

const app = express();
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

app.use('/vendor/three', express.static(path.join(ROOT, 'node_modules', 'three')));
app.use('/models', express.static(path.join(ROOT, 'output'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));
app.use('/user-models', express.static(path.join(ROOT, 'public', 'models'), {
  etag: false,
  lastModified: false,
  setHeaders(res) {
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  }
}));
app.use('/hdr', express.static(path.join(ROOT, 'input', 'hdr')));
app.use(express.static(path.join(ROOT, 'public')));


app.get('/api/hdrs', async (_req, res) => {
  const dir = path.join(ROOT, 'input', 'hdr');

  try {
    await fsp.mkdir(dir, { recursive: true });

    const files = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.hdr'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    res.json({
      ok: true,
      count: files.length,
      files: files.map((name) => ({
        name,
        url: `/hdr/${encodeURIComponent(name)}`
      }))
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/models/:folder', async (req, res) => {
  const folder = String(req.params.folder || '').toUpperCase();

  if (!['A', 'B', 'C', 'D'].includes(folder)) {
    return res.status(400).json({ ok: false, error: 'folder must be A, B, C, or D' });
  }

  const dir = path.join(ROOT, 'public', 'models', folder);

  try {
    await fsp.mkdir(dir, { recursive: true });

    const files = (await fsp.readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.glb'))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    res.json({
      ok: true,
      folder,
      count: files.length,
      files: files.map((name) => ({
        name,
        url: `/user-models/${folder}/${encodeURIComponent(name)}`
      }))
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

app.get('/api/status', (_req, res) => {
  const neutral = path.join(ROOT, 'output', 'czy3d_fixed_neutral_uncompressed.glb');
  const original = path.join(ROOT, 'output', 'czy3d_fixed_original_pbr_uncompressed.glb');
  const art = path.join(ROOT, 'input', 'hdr', 'art_studio.hdr');
  const sky = path.join(ROOT, 'input', 'hdr', 'sky.hdr');

  res.json({
    neutralModel: fs.existsSync(neutral),
    originalModel: fs.existsSync(original),
    artStudioHdr: fs.existsSync(art),
    skyHdr: fs.existsSync(sky)
  });
});

app.post('/api/fetch-sky', async (_req, res) => {
  const url = 'https://app.czy3d.com/manual-editor-v1/sky.hdr';
  const out = path.join(ROOT, 'input', 'hdr', 'sky.hdr');

  try {
    const response = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    await fsp.mkdir(path.dirname(out), { recursive: true });
    await fsp.writeFile(out, bytes);
    res.json({ ok: true, bytes: bytes.length });
  } catch (error) {
    res.status(502).json({ ok: false, error: error.message });
  }
});

app.listen(PORT, () => {
  console.log('');
  console.log('CZY3D Complete Compare Viewer');
  console.log(`http://localhost:${PORT}`);
  console.log('');
});
