import { readNamespaceContext, requireChosenNamespace } from './namespace-resolver';
import { BadRequestException, ForbiddenException } from '@nestjs/common';

describe('namespace-resolver', () => {
  it('parses x-namespace-map into id+name pairs', () => {
    const ctx = readNamespaceContext({
      'x-namespace-map': 'mc-potato=11111111-1111-1111-1111-111111111111,default=22222222-2222-2222-2222-222222222222',
    });
    expect(ctx.accessible).toEqual([
      { id: '11111111-1111-1111-1111-111111111111', name: 'mc-potato' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'default' },
    ]);
    expect(ctx.chosen).toBeNull();
  });

  it('falls back to x-namespace-ids (legacy) when map is absent', () => {
    const ctx = readNamespaceContext({
      'x-namespace-ids': '11111111-1111-1111-1111-111111111111,22222222-2222-2222-2222-222222222222',
    });
    expect(ctx.accessible).toEqual([
      { id: '11111111-1111-1111-1111-111111111111', name: '' },
      { id: '22222222-2222-2222-2222-222222222222', name: '' },
    ]);
  });

  it('pins accessible to the chosen namespace when x-beeable-namespace matches', () => {
    const ctx = readNamespaceContext({
      'x-namespace-map': 'mc-potato=ns-a,default=ns-b',
      'x-beeable-namespace': 'mc-potato',
    });
    expect(ctx.chosen).toEqual({ id: 'ns-a', name: 'mc-potato' });
    expect(ctx.accessible).toEqual([{ id: 'ns-a', name: 'mc-potato' }]);
  });

  it('throws Forbidden when x-beeable-namespace is not in the map', () => {
    expect(() =>
      readNamespaceContext({
        'x-namespace-map': 'default=ns-b',
        'x-beeable-namespace': 'mc-potato',
      }),
    ).toThrow(ForbiddenException);
  });

  it('requireChosenNamespace 400s when no namespace was pinned', () => {
    const ctx = readNamespaceContext({ 'x-namespace-map': 'default=ns-b' });
    expect(() => requireChosenNamespace(ctx)).toThrow(BadRequestException);
  });

  it('requireChosenNamespace returns the chosen entry when present', () => {
    const ctx = readNamespaceContext({
      'x-namespace-map': 'mc-potato=ns-a',
      'x-beeable-namespace': 'mc-potato',
    });
    expect(requireChosenNamespace(ctx)).toEqual({ id: 'ns-a', name: 'mc-potato' });
  });

  it('handles empty headers as "no access"', () => {
    const ctx = readNamespaceContext({});
    expect(ctx.accessible).toEqual([]);
    expect(ctx.chosen).toBeNull();
    expect(() => requireChosenNamespace(ctx)).toThrow(BadRequestException);
  });
});
