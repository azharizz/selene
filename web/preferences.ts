export const needs = ['Explain simply', 'Slower answer voice', 'Translate', 'Show visually'] as const;
export const recipients = ['everyone', 'grandparent', 'parent', 'child', 'adult'] as const;
export const languages = ['English', 'Indonesian', 'Spanish'] as const;
export type Need = typeof needs[number];
export type Recipient = typeof recipients[number];
export type Language = typeof languages[number];
export type Preferences = {need: Need; language: Language; recipient: Recipient; session: 'family' | 'solo'};
const defaults: Preferences = {need: 'Explain simply', language: 'English', recipient: 'everyone', session: 'family'};

export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('selene.preferences') || 'null');
    if (!value) return {...defaults};
    if (value.need === 'Easy to hear') value.need = 'Slower answer voice';
    return {need: needs.includes(value.need) ? value.need : defaults.need,
      language: languages.includes(value.language) ? value.language : defaults.language,
      recipient: recipients.includes(value.recipient) ? value.recipient : defaults.recipient,
      session: value.session === 'solo' ? 'solo' : 'family'};
  } catch {return {...defaults};} // WebView storage can be disabled or contain an older invalid value.
}

export function savePreferences({need, language, recipient, session}: Preferences) {
  try {localStorage.setItem('selene.preferences', JSON.stringify({need, language, recipient, session}));}
  catch { /* The current viewing session still keeps the explicit selection. */ }
}
