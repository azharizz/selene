import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseAgentJson} from '../server/agent.mjs';

test('agent accepts exactly one JSON response and rejects ambiguous trailing verdicts', () => {
  assert.deepEqual(parseAgentJson(' {"answer":"a } in a string"} '), {answer: 'a } in a string'});
  for (const text of ['{"supported":true}{"supported":false}', '{"answer":"ok"} trailing text', '{bad}', '{"answer":']) {
    assert.throws(() => parseAgentJson(text), SyntaxError);
  }
});
