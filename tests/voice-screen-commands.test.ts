import { describe, expect, it } from 'vitest';
import { matchScreenCommand } from '../src/client/voice-screen-commands.js';

describe('matchScreenCommand', () => {
  it('recognizes spoken minimize commands', () => {
    expect(matchScreenCommand('Can you minimize the screen and tell me?')).toBe(
      'minimize',
    );
    expect(matchScreenCommand('Minimize')).toBe('minimize');
    expect(matchScreenCommand('please minimize the screen')).toBe('minimize');
    expect(matchScreenCommand('minimise the call view')).toBe('minimize');
    expect(matchScreenCommand('hide it')).toBe('minimize');
    expect(matchScreenCommand('make it smaller please')).toBe('minimize');
    expect(matchScreenCommand('shrink the call')).toBe('minimize');
  });

  it('recognizes self-directed commands like "minimize yourself"', () => {
    expect(
      matchScreenCommand(
        'Can you minimize yourself and you know kind of show in the chat like the code?',
      ),
    ).toBe('minimize');
    expect(matchScreenCommand('minimize yourself')).toBe('minimize');
    expect(matchScreenCommand('hide yourself please')).toBe('minimize');
    expect(matchScreenCommand('make yourself smaller')).toBe('minimize');
    expect(matchScreenCommand('expand yourself')).toBe('expand');
    expect(matchScreenCommand('maximize yourself')).toBe('expand');
    expect(matchScreenCommand('make yourself bigger')).toBe('expand');
    expect(matchScreenCommand('make yourself full screen')).toBe('expand');
  });

  it('recognizes spoken expand commands', () => {
    expect(matchScreenCommand('expand the screen')).toBe('expand');
    expect(matchScreenCommand('please maximize')).toBe('expand');
    expect(matchScreenCommand('make it full screen')).toBe('expand');
    expect(matchScreenCommand('open the call back up')).toBe('expand');
    expect(matchScreenCommand('bring the view back')).toBe('expand');
    expect(matchScreenCommand('restore the call view')).toBe('expand');
    expect(matchScreenCommand('make it bigger')).toBe('expand');
  });

  it('recognizes move left and right commands', () => {
    expect(matchScreenCommand('move it to the left')).toBe('left');
    expect(matchScreenCommand('slide it right')).toBe('right');
    expect(matchScreenCommand('go to the left side')).toBe('left');
    expect(matchScreenCommand('put it on the right')).toBe('right');
    expect(matchScreenCommand('nudge the pill left')).toBe('left');
  });

  it('ignores ordinary conversation that merely contains keywords', () => {
    // Agreement, not direction.
    expect(matchScreenCommand("that's right")).toBeNull();
    expect(matchScreenCommand('alright, sounds good')).toBeNull();
    // Code talk, not screen control.
    expect(matchScreenCommand('minimize the bundle size')).toBeNull();
    expect(matchScreenCommand('expand the tax deduction')).toBeNull();
    expect(matchScreenCommand('restore the git stash')).toBeNull();
    expect(matchScreenCommand('can you write Java code')).toBeNull();
    expect(matchScreenCommand('what is the Scanner class')).toBeNull();
    // "Yourself" is only a trigger adjacent to the command verb.
    expect(matchScreenCommand('tell me about yourself')).toBeNull();
    expect(matchScreenCommand('you should minimize your taxes yourself')).toBeNull();
    expect(matchScreenCommand('')).toBeNull();
  });

  it('ignores long monologues even if they contain a command', () => {
    const monologue =
      'so anyway I was telling my colleague about how we should minimize the risk in the deployment pipeline by adding canary releases ' +
      'and then we could expand the monitoring dashboard coverage across all regions and beyond';
    expect(matchScreenCommand(monologue)).toBeNull();
  });

  it('prefers direction when both appear in one utterance', () => {
    expect(matchScreenCommand('move it left and shrink the call')).toBe(
      'left',
    );
  });
});
