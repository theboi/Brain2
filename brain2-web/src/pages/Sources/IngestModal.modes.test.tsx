import { describe, expect, it } from 'vitest';
import { INGEST_MODES } from './IngestModal';

describe('INGEST_MODES', () => {
  it('describes wiki auditing and verbatim static handling', () => {
    const wiki = INGEST_MODES.find((m) => m.id === 'wiki');
    const stat = INGEST_MODES.find((m) => m.id === 'static');

    expect(wiki?.desc.toLowerCase()).toMatch(/audit/);
    expect(stat?.desc.toLowerCase()).toMatch(/verbatim|as-is|as is/);
  });
});
