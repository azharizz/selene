import test from 'node:test';
import assert from 'node:assert/strict';
import {requesterContext} from '../server/requester-context.mjs';

test('explicit self-identification changes communication but never original film evidence', async () => {
  const context = {content_id: 'film', at_seconds: 12, transcript: [{id: 'cue', text: 'Hello.', end: 10}], facts: []};
  const input = {request: "I'm grandma. What does this mean?", recipient: 'everyone', language: 'English', need: 'Show visually'};
  const result = await requesterContext(input, context);
  assert.equal(result.input.recipient, 'grandparent');
  assert.equal(result.context.requester.source, 'declaration');
  assert.deepEqual(result.context.transcript, context.transcript);
  assert.equal(result.context.at_seconds, 12);
  assert.equal(context.requester, undefined);
  assert.equal(input.recipient, 'everyone');
  const quoted = await requesterContext({...input, request: 'The character says "I am grandma". Who is she?'}, context);
  assert.equal(quoted.input.recipient, 'everyone');
  assert.equal(quoted.context.requester, undefined);
});
