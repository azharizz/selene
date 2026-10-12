import {resolveRequester} from './requesters.mjs';

const choices = {
  role: ['grandparent', 'parent', 'child', 'adult', 'everyone'],
  style: ['simple', 'standard', 'detailed'],
  language: ['English', 'Indonesian', 'Spanish'],
  need: ['Explain simply', 'Slower answer voice', 'Translate', 'Show visually'],
};

// Required legacy fields include neutral UI defaults. Explicit keys also permit resetting a profile to those defaults.
function currentPreferences(input) {
  const explicit = input.communication_preferences === undefined ? {} : input.communication_preferences;
  if (!explicit || typeof explicit !== 'object' || Array.isArray(explicit)
    || Object.entries(explicit).some(([key, value]) => !choices[key]?.includes(value)))
    throw Object.assign(new Error('Invalid communication preferences'), {status: 400});
  return {
    ...(input.recipient && input.recipient !== 'everyone' ? {role: input.recipient} : {}),
    ...(input.language && input.language !== 'English' ? {language: input.language} : {}),
    ...(input.need && input.need !== 'Show visually' ? {need: input.need} : {}),
    ...explicit,
  };
}

// Communication preferences are never identity authentication, age inference or film evidence.
export async function requesterContext(input, context) {
  const current = currentPreferences(input);
  const resolved = await resolveRequester(input, input.requester_id);
  // Only a caller's same-question context may continue preferences; fixture audiences never personalize generation.
  const previous = context.requester?.source !== 'fixture' && input.requester_id === undefined ? context.requester : null;
  const preference = previous ? {
    role: previous.role ?? null, style: previous.style ?? null, language: previous.language ?? null,
    need: previous.need ?? null, source: previous.source,
  } : {
    role: resolved.role, style: resolved.style, language: resolved.language, need: null, source: resolved.source,
  };
  if (resolved.source === 'declaration') Object.assign(preference, {role: resolved.role, source: 'declaration'});
  Object.assign(preference, current);
  // Audience provenance follows the role, not independent need/style/language overrides.
  if (current.role !== undefined || preference.source === 'none' && Object.keys(current).length) preference.source = 'request';
  if (preference.source === 'none') {
    const {requester, ...cleanContext} = context;
    return {input, context: requester ? cleanContext : context};
  }
  if (current.need === 'Explain simply' && current.style === undefined) preference.style = 'simple';
  const need = preference.need ?? (preference.style === 'simple' ? 'Explain simply' : input.need);
  return {
    input: {...input, recipient: preference.role ?? input.recipient, language: preference.language ?? input.language, need},
    context: {...context, requester: {...preference, language: preference.language ?? input.language}},
  };
}
