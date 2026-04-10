import { describe, it, expect } from 'vitest';
import { parseVoiceCommand, VoiceConfirmationQueue } from '@/services/voiceBrain';

describe('voiceBrain — intent parsing', () => {
  it('parses "screen entity" with wake word', () => {
    const cmd = parseVoiceCommand('Hawkeye, screen Acme Metals LLC please');
    expect(cmd.intent).toBe('screen_entity');
    expect(cmd.entity).toBe('Acme Metals LLC');
    expect(cmd.requiresConfirmation).toBe(false);
  });

  it('parses "file STR" and requires confirmation', () => {
    const cmd = parseVoiceCommand('Hawkeye file an STR for customer C-9912');
    expect(cmd.intent).toBe('file_str');
    expect(cmd.entity).toBe('customer C-9912');
    expect(cmd.requiresConfirmation).toBe(true);
  });

  it('parses "freeze" as destructive', () => {
    const cmd = parseVoiceCommand('Friday freeze the Jones case');
    expect(cmd.intent).toBe('freeze_entity');
    expect(cmd.entity).toBe('Jones case');
    expect(cmd.requiresConfirmation).toBe(true);
  });

  it('parses "top risks"', () => {
    const cmd = parseVoiceCommand('Hawkeye show me my top risks this week');
    expect(cmd.intent).toBe('show_top_risks');
  });

  it('parses "confirm" on its own', () => {
    const cmd = parseVoiceCommand('confirm');
    expect(cmd.intent).toBe('confirm');
  });

  it('parses "cancel" on its own', () => {
    const cmd = parseVoiceCommand('cancel');
    expect(cmd.intent).toBe('cancel');
  });

  it('returns unknown for gibberish', () => {
    const cmd = parseVoiceCommand('Hawkeye banana phone spaceship');
    expect(cmd.intent).toBe('unknown');
    expect(cmd.responseTemplate).toContain('didn');
  });

  it('works without wake word', () => {
    const cmd = parseVoiceCommand('screen Acme Metals');
    expect(cmd.intent).toBe('screen_entity');
    expect(cmd.entity).toBe('Acme Metals');
  });

  it('parses help intent', () => {
    const cmd = parseVoiceCommand('Hawkeye help');
    expect(cmd.intent).toBe('help');
  });
});

describe('voiceBrain — confirmation queue', () => {
  it('stages and confirms a destructive action within TTL', () => {
    const queue = new VoiceConfirmationQueue(30);
    const cmd = parseVoiceCommand('Hawkeye freeze Acme Metals');
    const now = 1_000_000;
    const staged = queue.stage(cmd, now);
    expect(queue.size).toBe(1);
    const confirmed = queue.confirm(staged.id, now + 10_000);
    expect(confirmed).not.toBeNull();
    expect(queue.size).toBe(0);
  });

  it('expires staged actions after TTL', () => {
    const queue = new VoiceConfirmationQueue(30);
    const cmd = parseVoiceCommand('Hawkeye freeze X');
    const staged = queue.stage(cmd, 0);
    const confirmed = queue.confirm(staged.id, 31_000);
    expect(confirmed).toBeNull();
    expect(queue.size).toBe(0);
  });

  it('cancel removes pending action', () => {
    const queue = new VoiceConfirmationQueue();
    const staged = queue.stage(parseVoiceCommand('freeze X'));
    expect(queue.cancel(staged.id)).toBe(true);
    expect(queue.size).toBe(0);
  });

  it('reapExpired clears stale actions', () => {
    const queue = new VoiceConfirmationQueue(30);
    queue.stage(parseVoiceCommand('freeze A'), 0);
    queue.stage(parseVoiceCommand('freeze B'), 0);
    expect(queue.reapExpired(60_000)).toBe(2);
    expect(queue.size).toBe(0);
  });
});
