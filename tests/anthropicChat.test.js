// Claude (Anthropic Messages API) request/response conversion. Pure, no network.
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { fromAnthropicResponse, toAnthropicRequest } from '../lib/aiInsights';

describe('toAnthropicRequest', () => {
  it('moves the system prompt into the system field', () => {
    const body = toAnthropicRequest([
      { role: 'system', content: 'Return JSON.' },
      { role: 'user', content: 'Hi' },
    ], { model: 'claude-haiku-4-5-20251001' });
    assert.equal(body.system, 'Return JSON.');
    assert.deepEqual(body.messages, [{ role: 'user', content: 'Hi' }]);
    assert.equal(body.model, 'claude-haiku-4-5-20251001');
    assert.equal(body.max_tokens, 1500);
  });

  it('converts an image data URL into a base64 image block', () => {
    const body = toAnthropicRequest([
      { role: 'user', content: [
        { type: 'text', text: 'Read this' },
        { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      ] },
    ], { model: 'm' });
    assert.deepEqual(body.messages[0].content, [
      { type: 'text', text: 'Read this' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } },
    ]);
    assert.equal('system' in body, false);
  });

  it('rejects an image that is not a base64 data URL', () => {
    assert.throws(() => toAnthropicRequest([
      { role: 'user', content: [{ type: 'image_url', image_url: { url: 'https://x/y.jpg' } }] },
    ], { model: 'm' }), /base64 data URL/);
  });
});

describe('fromAnthropicResponse', () => {
  it('joins the text blocks of a reply', () => {
    const text = fromAnthropicResponse({
      content: [{ type: 'text', text: '{"a":' }, { type: 'text', text: '1}' }],
    });
    assert.equal(text, '{"a":1}');
  });

  it('throws when the reply has no text', () => {
    assert.throws(() => fromAnthropicResponse({ content: [] }), /did not contain a message body/);
  });
});
