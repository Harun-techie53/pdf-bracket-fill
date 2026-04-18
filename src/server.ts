import express, { type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import {
  deletePdfBytes,
  deleteSession,
  loadPdfBytes,
  loadSession,
  savePdfBytes,
  saveSession,
} from './db.js';
import { downloadBoxFile, uploadBoxFile } from './box.js';
import { assertPdfHeader } from './pdf-reader.js';
import { findPlaceholders } from './placeholders.js';
import { stampPdf } from './stamper.js';

try {
  process.loadEnvFile(path.resolve(process.cwd(), '.env'));
} catch {
  // .env is optional
}

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.use((req, _res, next) => {
  console.log('[req]', req.method, req.url);
  next();
});

app.use(express.json({ limit: '2mb' }));

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

// Download the PDF from Box for the given fileId, detect placeholders, and
// persist both the PDF bytes and placeholder metadata under a new session uuid.
// Body: { fileId: string }
app.post('/placeholders', async (req: Request, res: Response) => {
  try {
    const fileId = req.body?.fileId;
    if (typeof fileId !== 'string' || fileId.length === 0) {
      res.status(400).json({ error: 'Request body must include a "fileId" string.' });
      return;
    }

    const bytes = await downloadBoxFile(fileId);
    assertPdfHeader(bytes);

    const placeholders = await findPlaceholders(bytes);
    const uuid = randomUUID();
    savePdfBytes(uuid, bytes);
    saveSession(uuid, placeholders);

    res.json({
      placeholderSessionId: uuid,
      placeholders: placeholders.map((p) => ({
        key: p.key,
        dataType: p.dataType,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Stamp the stored PDF using a previously-issued session uuid + values.
// Body: { uuid: string, values: Record<string, string> }
// Writes the result to OUTPUT_PDF, then clears the session + stored PDF.
app.post('/stamp', async (req: Request, res: Response) => {
  try {
    const uuid = req.body?.uuid;
    if (typeof uuid !== 'string' || uuid.length === 0) {
      res.status(400).json({ error: 'Request body must include a "uuid" string.' });
      return;
    }

    const values = req.body?.values;
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      res.status(400).json({ error: 'Request body must include a "values" object.' });
      return;
    }

    const placeholders = loadSession(uuid);
    if (!placeholders) {
      res.status(404).json({ error: `No placeholder session found for uuid "${uuid}".` });
      return;
    }

    const pdfBytes = loadPdfBytes(uuid);
    if (!pdfBytes) {
      res.status(404).json({ error: `No stored PDF found for uuid "${uuid}".` });
      return;
    }

    const stringValues: Record<string, string> = {};
    for (const [k, v] of Object.entries(values)) {
      if (typeof v !== 'string') {
        res.status(400).json({ error: `Value for "${k}" must be a string.` });
        return;
      }
      stringValues[k] = v;
    }

    const stampedBytes = await stampPdf(pdfBytes, stringValues, placeholders);

    const uploadedFileId = await uploadBoxFile(`stamped-${uuid}.pdf`, stampedBytes);

    deleteSession(uuid);
    deletePdfBytes(uuid);

    res.json({
      boxFileId: uploadedFileId,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

app.listen(PORT, () => {
  console.log(`PDF stamp server listening on http://localhost:${PORT}`);
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /placeholders         body: { fileId }');
  console.log('  POST /stamp                body: { uuid, values: {...} }');
});
