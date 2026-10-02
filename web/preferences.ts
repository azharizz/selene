export const needs = ['Explain simply', 'Slower answer voice', 'Translate', 'Show visually'] as const;
export const recipients = ['everyone', 'grandparent', 'parent', 'child', 'adult'] as const;
export const languages = ['English', 'Indonesian', 'Spanish'] as const;
export type Need = typeof needs[number];
export type Recipient = typeof recipients[number];
export type Language = typeof languages[number];
export type Preferences = {need: Need; language: Language; recipient: Recipient; session: 'family' | 'solo'};
const defaults: Preferences = {need: 'Show visually', language: 'English', recipient: 'everyone', session: 'family'};

export function readPreferences(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem('selene.preferences') || 'null');
    // Audience and wording now come from the question. Retain only an explicit audio preference.
    return {...defaults, need: ['Slower answer voice', 'Easy to hear'].includes(value?.need) ? 'Slower answer voice' : defaults.need};
  } catch {return {...defaults};}
}

export function savePreferences({need}: Preferences) {
  try {localStorage.setItem('selene.preferences', JSON.stringify({need}));}
  catch { /* The current viewing session still keeps the explicit selection. */ }
}
