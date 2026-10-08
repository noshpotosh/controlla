import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import { ControllerSurface } from '../src/client/controls/ControllerSurface.tsx';
void test('shared feedback presentation disables only game controls and renders status as text', () => {
  const html = renderToStaticMarkup(
    <ControllerSurface
      widgets={[]}
      portFor={() => {
        throw new Error('No widgets');
      }}
      enabled={false}
      status={'<b>Your turn</b>'}
    >
      <button>Menu</button>
    </ControllerSurface>,
  );
  assert.match(html, /inert="" aria-disabled="true"/);
  assert.match(html, /&lt;b&gt;Your turn&lt;\/b&gt;/);
  assert.match(html, /<\/div><output[^>]*>.*<\/output><button>Menu<\/button>/);
  const enabled = renderToStaticMarkup(
    <ControllerSurface
      widgets={[]}
      portFor={() => {
        throw new Error('No widgets');
      }}
    />,
  );
  assert.doesNotMatch(enabled, /inert=""|ctl-feedback/);
});
