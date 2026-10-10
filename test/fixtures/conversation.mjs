import {getStory, registerStory} from '../../server/context.mjs';
import {playerStory} from '../../server/personal.mjs';

export function session(now = 100000) {
  if (!getStory('conversation-test')) registerStory({id: 'conversation-test', title: 'A match together', duration: 7200,
    scenes: [{id: 'match', label: 'The match', start: 0, end: 7200}], facts: [],
    transcript: [{id: 'minute70', start: 4190, end: 4200, text: 'Seventy minutes played; Harbor City lead two nil.'},
      {id: 'late-play', start: 5390, end: 5400, text: 'Ninety minutes, but play continues with five added minutes.'},
      {id: 'whistle', start: 5700, end: 5710, text: 'The final whistle. Harbor City have won.'}]});
  const story = getStory('conversation-test'), version = playerStory(story).content_version;
  return {contentId: story.id, contentVersion: version, duration: story.duration,
    playback: {content_id: story.id, content_version: version, epoch: 0, sequence: 1, at_seconds: 4200,
      play_state: 'playing', playback_rate: 1, received_at: now},
    memory: {lastExplanation: null, responses: new Map()}, mirror: {token: 'pair-one', clients: new Set()}};
}

export const call = (name, args = {}) => ({tool_calls: [{id: 'test-call', type: 'function', function: {name, arguments: JSON.stringify(args)}}]});
export const invitations = () => ({opportunity: 'reflection', boundary_id: 'minute70', options: [
  {id: 'memory', angle: 'Remember a match', question: 'That lead brings a comeback to mind. Which comeback do you remember watching together?', recipient: 'everyone', evidence_ids: ['minute70']},
  {id: 'choice', angle: 'Make a choice', question: 'With a two-goal lead at that point, would you attack or defend? Compare your choices.', recipient: 'everyone', evidence_ids: ['minute70']},
  {id: 'imagine', angle: 'Imagine together', question: 'If you coached the team trailing at that point, what would you tell them?', recipient: 'everyone', evidence_ids: ['minute70']},
]});
