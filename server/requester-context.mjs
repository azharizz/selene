import {resolveRequester} from './requesters.mjs';

// Personalization is a communication preference, never identity authentication or film evidence.
export async function requesterContext(input, context) {
  const resolved = await resolveRequester(input, input.requester_id);
  // Only the caller's same-question context may carry preferences forward, never a session-wide match.
  const previous = context.requester;
  const preference = previous && input.requester_id === undefined
    ? resolved.source === 'none' ? previous
      : resolved.source === 'declaration' ? {...previous, role: resolved.role, source: resolved.source} : resolved
    : resolved;
  if (preference.source === 'none') return {input, context};
  return {input: {...input, recipient: preference.role ?? input.recipient,
    language: preference.language ?? input.language,
    need: preference.style === 'simple' ? 'Explain simply' : input.need},
  context: {...context, requester: {role: preference.role, style: preference.style,
    language: preference.language, source: preference.source}}};
}
