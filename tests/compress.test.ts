import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compressImage, fitSize } from '../src/lib/compress.ts';

// Node has no DOM, canvas or image decoder (and this repo has no jsdom), so these stub the
// browser surface and check what compressImage asks of it. The real decode — and the
// createImageBitmap path on iOS Safari / Samsung Browser — is verified on-device in acceptance.

interface FakeCanvas { width: number; height: number; drawn: unknown[]; out?: { type: string; q: number } }
const canvases: FakeCanvas[] = [];
const g = globalThis as Record<string, unknown>;

g.document = {
  createElement: () => {
    const c: FakeCanvas & Record<string, unknown> = { width: 0, height: 0, drawn: [] };
    c.getContext = () => ({ drawImage: (...a: unknown[]) => c.drawn.push(a) });
    c.toBlob = (cb: (b: Blob) => void, type: string, q: number) => {
      c.out = { type, q };
      cb(new Blob([`${c.width}x${c.height}`], { type }));
    };
    canvases.push(c);
    return c;
  },
};

test('fitSize keeps the aspect, caps the long edge, never enlarges', () => {
  assert.deepEqual(fitSize(4000, 3000, 1280), { width: 1280, height: 960 });
  assert.deepEqual(fitSize(3000, 4000, 1280), { width: 960, height: 1280 });
  assert.deepEqual(fitSize(800, 600, 1280), { width: 800, height: 600 });
});

test('fallback <img> path: a 4000×3000 capture becomes a 1280-edge JPEG at 0.7', async () => {
  assert.equal(typeof g.createImageBitmap, 'undefined');
  g.Image = class {
    width = 4000; height = 3000;
    onload: (() => void) | null = null;
    set src(_: string) { setTimeout(() => this.onload?.()); }
  };
  canvases.length = 0;
  const out = await compressImage(new Blob(['x'], { type: 'image/jpeg' }), 1280);
  assert.equal(out.type, 'image/jpeg');
  assert.equal(await out.text(), '1280x960');
  assert.deepEqual(canvases[0].out, { type: 'image/jpeg', q: 0.7 });
  delete g.Image;
});

test('bitmap path: resized while decoding, portrait fixed from the small bitmap, all closed', async () => {
  const closed: string[] = [];
  const calls: unknown[] = [];
  // A 3000×4000 portrait; honours resize options like current Chrome/Safari.
  g.createImageBitmap = async (src: unknown, o: { resizeWidth?: number; resizeHeight?: number } = {}) => {
    calls.push(o);
    const base = (src as { width?: number }).width ? src as { width: number; height: number } : { width: 3000, height: 4000 };
    const isProbe = src instanceof Blob && src.type === 'image/png';
    const w0 = isProbe ? 2 : base.width, h0 = isProbe ? 2 : base.height;
    const width = o.resizeWidth ?? (o.resizeHeight ? Math.round(w0 * o.resizeHeight / h0) : w0);
    const height = o.resizeHeight ?? (o.resizeWidth ? Math.round(h0 * o.resizeWidth / w0) : h0);
    const name = `${width}x${height}`;
    return { width, height, close: () => closed.push(name) };
  };
  canvases.length = 0;
  const out = await compressImage(new Blob(['x'], { type: 'image/jpeg' }), 1280);
  assert.equal(await out.text(), '960x1280');
  assert.deepEqual(calls.slice(1), [
    { resizeWidth: 1280, resizeQuality: 'high' },
    { resizeHeight: 1280, resizeQuality: 'high' },
  ]);
  assert.deepEqual(closed, ['1x1', '1280x1707', '960x1280']);
  delete g.createImageBitmap;
});
