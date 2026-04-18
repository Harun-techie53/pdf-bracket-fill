export function assertPdfHeader(bytes: Uint8Array): void {
  const header = Buffer.from(bytes.subarray(0, 5)).toString('utf8');
  if (header !== '%PDF-') {
    throw new Error(`Not a PDF — header was ${JSON.stringify(header)}`);
  }
}
