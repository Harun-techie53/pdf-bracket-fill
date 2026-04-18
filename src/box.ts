type BoxConfig = {
  clientId: string;
  clientSecret: string;
  grantType: string;
  subjectId: string;
  subjectType: string;
};

function readConfig(): BoxConfig {
  const clientId = process.env.BOX_CLIENT_ID;
  const clientSecret = process.env.BOX_CLIENT_SECRET;
  const grantType = process.env.BOX_GRANT_TYPE ?? 'client_credentials';
  const subjectId = process.env.BOX_SUBJECT_ID;
  const subjectType = process.env.BOX_SUBJECT_TYPE ?? 'enterprise';
  if (!clientId || !clientSecret || !subjectId) {
    throw new Error(
      'Missing Box credentials: BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_SUBJECT_ID are required.',
    );
  }
  return { clientId, clientSecret, grantType, subjectId, subjectType };
}

let cachedToken: { token: string; expiresAt: number } | null = null;

async function getAccessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 30_000) {
    return cachedToken.token;
  }
  const cfg = readConfig();
  const body = new URLSearchParams({
    grant_type: cfg.grantType,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    box_subject_type: cfg.subjectType,
    box_subject_id: cfg.subjectId,
  });
  const res = await fetch('https://api.box.com/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box token request failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + data.expires_in * 1000,
  };
  return data.access_token;
}

export async function downloadBoxFile(fileId: string): Promise<Uint8Array> {
  const token = await getAccessToken();
  const url = `https://api.box.com/2.0/files/${encodeURIComponent(fileId)}/content`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box file download failed (${res.status}): ${text}`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}

export async function uploadBoxFile(
  name: string,
  bytes: Uint8Array,
  parentFolderId: string = process.env.BOX_UPLOAD_FOLDER_ID ?? '0',
): Promise<string> {
  const token = await getAccessToken();
  const form = new FormData();
  form.append('attributes', JSON.stringify({ name, parent: { id: parentFolderId } }));
  form.append('file', new Blob([bytes as BlobPart], { type: 'application/pdf' }), name);

  const res = await fetch('https://upload.box.com/api/2.0/files/content', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Box file upload failed (${res.status}): ${text}`);
  }
  const data = (await res.json()) as { entries: Array<{ id: string; name: string }> };
  const entry = data.entries?.[0];
  if (!entry?.id) throw new Error('Box file upload succeeded but returned no file id.');
  return entry.id;
}
