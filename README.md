# specimen-contract-pdf-parsing

A small HTTP service that takes a contract PDF stored in **Box**, detects bracketed placeholders such as `[Insured Name]` or `[Policy Number]`, lets a client supply values for them, then stamps the filled PDF and uploads the result back to Box.

It is built around a two-call flow:

1. **Discover** the placeholders in a PDF.
2. **Stamp** the PDF with values supplied by the client.

## How it works

```
                ┌──────────────┐
client ───────► │  /placeholders
   fileId       │              │ ──► download PDF from Box
                │              │ ──► detect [brackets] + leader dots
                │              │ ──► persist PDF bytes + placeholder metadata
                │              │      under a new session uuid
                │              │ ◄── { placeholderSessionId, placeholders }
                └──────────────┘

                ┌──────────────┐
client ───────► │   /stamp     │ ──► load stored PDF + placeholders
placeholderSessionId           │      by placeholderSessionId
       + values │              │ ──► draw values over each placeholder
                │              │      (single-line / extend into leader dots /
                │              │       wrap to next line as needed)
                │              │ ──► upload stamped PDF to Box
                │              │ ──► clear stored session
                │              │ ◄── { boxFileId }
                └──────────────┘
```

Placeholder geometry (x, y, width, font, leader-dot run) is captured at discovery time using `pdfjs-dist`, so stamping can erase exactly the original span and place text in the correct font/size with `pdf-lib`.

## Project layout

| File | Purpose |
| --- | --- |
| [src/server.ts](src/server.ts) | Express app, two endpoints + `/health` |
| [src/box.ts](src/box.ts) | Box CCG token, file download/upload |
| [src/placeholders.ts](src/placeholders.ts) | Find `[...]` placeholders + infer data type from key |
| [src/stamper.ts](src/stamper.ts) | Erase original span, draw value, wrap if needed |
| [src/db.ts](src/db.ts) | Per-session storage: PDF bytes on disk, metadata in JSON |
| [src/line-grouping.ts](src/line-grouping.ts) | Group pdfjs items into visual lines by baseline Y |
| [src/text-wrap.ts](src/text-wrap.ts) | Word-wrap a string to a max width for a given font |
| [src/fonts.ts](src/fonts.ts) | Map a fontFamily string to a pdf-lib `StandardFonts` key |
| [src/pdf-reader.ts](src/pdf-reader.ts) | `%PDF-` header sanity check |
| [src/types.ts](src/types.ts) | Shared `Placeholder` / `Line` / `DataType` types |

## Requirements

- Node.js **>= 20**
- pnpm (the repo ships a `pnpm-lock.yaml`)
- A Box app with **Client Credentials Grant (CCG)** authorized for your enterprise

## Setup

```bash
pnpm install
cp .env.example .env
# fill in BOX_CLIENT_ID, BOX_CLIENT_SECRET, BOX_SUBJECT_ID, BOX_UPLOAD_FOLDER_ID
```

Environment variables:

| Var | Required | Notes |
| --- | --- | --- |
| `BOX_CLIENT_ID` | yes | From your Box app |
| `BOX_CLIENT_SECRET` | yes | From your Box app |
| `BOX_SUBJECT_ID` | yes | Enterprise ID (or user ID) |
| `BOX_SUBJECT_TYPE` | no | Defaults to `enterprise` |
| `BOX_GRANT_TYPE` | no | Defaults to `client_credentials` |
| `BOX_UPLOAD_FOLDER_ID` | no | Folder to upload stamped PDFs to. Defaults to `0` (root) |
| `PORT` | no | Defaults to `3000` |

## Running

```bash
pnpm start          # production-style: tsx src/server.ts
pnpm dev            # watch mode
```

You should see:

```
PDF stamp server listening on http://localhost:3000
```

## API

### `GET /health`

```json
{ "ok": true }
```

### `POST /placeholders`

Request:

```json
{ "fileId": "1234567890" }
```

Response:

```json
{
  "placeholderSessionId": "8a2c…",
  "placeholders": [
    { "key": "Insured Name", "dataType": "string" },
    { "key": "Policy Number", "dataType": "number" },
    { "key": "Issued Date",  "dataType": "date" }
  ]
}
```

`dataType` is inferred from the placeholder key (e.g. `date`, `currency`, `percentage`) so the client can render the right input control.

### `POST /stamp`

Request:

```json
{
  "placeholderSessionId": "8a2c…",
  "values": {
    "Insured Name": "Jane Doe",
    "Policy Number": "00123",
    "Issued Date": "2026-04-19"
  }
}
```

Response:

```json
{ "boxFileId": "9876543210" }
```

After a successful stamp, the stored PDF and placeholder metadata for the placeholderSessionId are deleted.

## End-to-end example

```bash
# 1. Discover placeholders
SID=$(curl -s -X POST http://localhost:3000/placeholders \
  -H 'content-type: application/json' \
  -d '{"fileId":"1234567890"}' | jq -r .placeholderSessionId)

# 2. Stamp the PDF
curl -s -X POST http://localhost:3000/stamp \
  -H 'content-type: application/json' \
  -d "{\"placeholderSessionId\":\"$SID\",\"values\":{\"Insured Name\":\"Jane Doe\"}}"
```

## Deploying to EC2

1. Provision Node 20+ and install pnpm.
2. `git clone` the repo and `pnpm install --frozen-lockfile`.
3. Create `/etc/specimen-contract.env` (or similar) with the Box credentials.
4. Run under a process supervisor:

   ```bash
   # systemd unit (excerpt)
   ExecStart=/usr/bin/pnpm start
   EnvironmentFile=/etc/specimen-contract.env
   WorkingDirectory=/opt/specimen-contract-pdf-parsing
   Restart=always
   ```
5. Front it with nginx/ALB and only expose the port you need.

## Notes & limits

- Storage is local: PDF bytes are written under `storage/` and metadata under `placeholders.json`. Sessions do not survive a redeploy and are not shared across instances. For multi-instance deploys, swap [src/db.ts](src/db.ts) for a shared store (Redis / S3 / RDS).
- Only **standard** PDF fonts are used when stamping; the closest match to the original `fontFamily` is picked.
- Placeholder syntax is `[label]` followed optionally by leader dots; nested brackets are not supported.
