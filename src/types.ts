export type DataType =
  | 'string'
  | 'number'
  | 'currency'
  | 'date'
  | 'enum'
  | 'percentage'
  | 'float'
  | 'year';

export type Placeholder = {
  page: number;
  key: string;        // camelCase identifier derived from label; stable request/response key
  label: string;      // original bracketed text as authored in the PDF
  dataType: DataType; // hint for client input field; inferred from label
  x: number;          // x of '['
  y: number;          // baseline
  width: number;      // width of '[...]' span
  dotsX: number;      // x where leader dots begin
  dotsWidth: number;  // width of leader-dot run (0 if none)
  fontSize: number;
  ascent: number;
  descent: number;
  fontFamily: string;
  // Present only for wrapped placeholders like `[Label ... [Value]]`, where
  // the whole row sits inside an outer pair of brackets. Stamper erases these
  // so the outer `[` and `]` don't survive into the output.
  wrapperOpenX?: number;
  wrapperOpenWidth?: number;
  wrapperCloseX?: number;
  wrapperCloseWidth?: number;
};

export type ItemRange = { start: number; end: number; item: any };
export type Line = { y: number; text: string; ranges: ItemRange[] };
