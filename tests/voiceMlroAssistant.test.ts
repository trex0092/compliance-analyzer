import { describe, expect, it } from 'vitest';
import { interpretCommand } from '@/services/voiceMlroAssistant';

describe('interpretCommand', () => {
  it('classifies a status sitrep request', () => {
    expect(interpretCommand('What is the status?').kind).toBe('status');
    expect(interpretCommand('brief me').kind).toBe('status');
    expect(interpretCommand('Sitrep please').kind).toBe('status');
    expect(interpretCommand('how are we doing').kind).toBe('status');
  });

  it('classifies show alerts', () => {
    expect(interpretCommand('show alerts').kind).toBe('show_alerts');
    expect(interpretCommand('list warnings').kind).toBe('show_alerts');
  });

  it('classifies show freezes', () => {
    expect(interpretCommand('show active freezes').kind).toBe('show_freezes');
    expect(interpretCommand('list freezes').kind).toBe('show_freezes');
  });

  it('extracts the entity name from "screen Acme Corp"', () => {
    const out = interpretCommand('screen Acme Corp');
    expect(out.kind).toBe('screen');
    if (out.kind === 'screen') expect(out.entityName).toBe('acme corp');
  });

  it('extracts the entity name from "please screen Acme Corp now"', () => {
    const out = interpretCommand('please screen Acme Corp now');
    expect(out.kind).toBe('screen');
    if (out.kind === 'screen') expect(out.entityName).toBe('acme corp');
  });

  it('classifies "rescreen" before "screen"', () => {
    const out = interpretCommand('rescreen Acme Corp');
    expect(out.kind).toBe('rescreen');
    if (out.kind === 'rescreen') expect(out.entityName).toBe('acme corp');
  });

  it('classifies STR drafting commands', () => {
    const out = interpretCommand('file an STR on Acme Corp');
    expect(out.kind).toBe('file_str');
    if (out.kind === 'file_str') expect(out.entityName).toBe('acme corp');
  });

  it('returns unknown for an empty transcript', () => {
    const out = interpretCommand('');
    expect(out.kind).toBe('unknown');
  });

  it('returns unknown for unrelated chatter', () => {
    const out = interpretCommand('what time is it');
    expect(out.kind).toBe('unknown');
  });
});
