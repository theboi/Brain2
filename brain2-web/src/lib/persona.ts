/* Parse the freeform persona markdown into a small view-model for the Reports banner. */

export interface ParsedPersona {
  summary: string;
  signals: string[];
  isEmpty: boolean;
}

const BULLET = /^[-*]\s+/;
const APPEND_DATE = /^\[\d{4}-\d{2}-\d{2}\]\s*/;

export function parsePersona(content: string): ParsedPersona {
  const text = (content ?? '').trim();
  if (!text) return { summary: '', signals: [], isEmpty: true };

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const summaryLine = lines.find((line) => !BULLET.test(line)) ?? '';
  const summary = summaryLine.replace(/^#+\s*/, '').slice(0, 120);

  const signals = lines
    .filter((line) => BULLET.test(line))
    .map((line) => line.replace(BULLET, '').replace(APPEND_DATE, '').trim())
    .filter(Boolean)
    .slice(0, 4);

  return { summary, signals, isEmpty: false };
}
