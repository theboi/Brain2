import { describe, expect, it } from 'vitest';
import { eventDayLabel, eventToActivityItem, type ActivityEvent } from './activity';

const NOW = new Date('2026-06-11T12:00:00Z');

function ev(partial: Partial<ActivityEvent>): ActivityEvent {
  return { id: 'e1', type: 'audit', entity_id: 'src_123', ts: '2026-06-11T09:30:00Z', payload: {}, ...partial };
}

describe('eventToActivityItem', () => {
  it('uses payload.action for audit events and classifies ingest as muted/file', () => {
    const item = eventToActivityItem(ev({ payload: { action: 'source_created' } }));
    expect(item.text).toBe('Source Created');
    expect(item.icon).toBe('file');
    expect(item.tone).toBe('muted');
    expect(item.meta).toBe('src_123');
  });

  it('classifies delete/fail verbs as warning/alert', () => {
    const item = eventToActivityItem(ev({ payload: { action: 'user_deleted' } }));
    expect(item.icon).toBe('alert');
    expect(item.tone).toBe('warning');
  });

  it('falls back to a humanized event type when there is no action', () => {
    const item = eventToActivityItem(ev({ type: 'operation_executed', payload: {} }));
    expect(item.text).toBe('Operation Executed');
    expect(item.tone).toBe('accent');
  });

  it('uses the event type as meta when entity_id is null', () => {
    const item = eventToActivityItem(ev({ entity_id: null, type: 'operation_executed' }));
    expect(item.meta).toBe('operation_executed');
  });
});

describe('eventDayLabel', () => {
  it('labels same-day and previous-day events', () => {
    expect(eventDayLabel('2026-06-11T09:30:00Z', NOW)).toBe('Today');
    expect(eventDayLabel('2026-06-10T23:00:00Z', NOW)).toBe('Yesterday');
  });
});
