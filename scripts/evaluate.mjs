import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const conditions = ['usual_help', 'usual_help_plus_selene'];
const causes = ['captions', 'rewind', 'native_assistance', 'family_help', 'selene', 'other'];
const support = ['captions', 'rewind', 'family_help', 'native_assistance'];
const integer = value => Number.isSafeInteger(value) && value >= 0;
const identifier = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(value);

export function summarize(trials) {
  if (!Array.isArray(trials) || trials.length > 1000) throw new Error('Expected at most 1000 anonymous trials');
  const ids = new Set(); const pairs = new Map();
  for (const trial of trials) {
    if (!trial || !['trial_id', 'participant_id', 'pair_id', 'clip_id'].every(key => identifier(trial[key])) ||
      !conditions.includes(trial.condition) || ![1, 2].includes(trial.order) || !integer(trial.correct) || !integer(trial.questions) ||
      !trial.questions || trial.correct > trial.questions || trial.questions > 100 ||
      ![true, false, null].includes(trial.voluntary_reuse) || (trial.condition === 'usual_help' && trial.voluntary_reuse !== null) || !Array.isArray(trial.interruptions) || trial.interruptions.length > 300 ||
      !trial.available_support || !support.every(key => ['available', 'unavailable'].includes(trial.available_support[key])) || Object.keys(trial.available_support).some(key => !support.includes(key))) throw new Error('Invalid trial: use the documented anonymous record and complete scores');
    if (ids.has(trial.trial_id)) throw new Error('Duplicate trial ID'); ids.add(trial.trial_id);
    for (const interruption of trial.interruptions) {
      if (!interruption || !Number.isFinite(interruption.seconds) || interruption.seconds < 0 || interruption.seconds > 3600 ||
        !['viewer', 'shared'].includes(interruption.scope) || !Array.isArray(interruption.causes) || !interruption.causes.length ||
        new Set(interruption.causes).size !== interruption.causes.length || interruption.causes.some(cause => !causes.includes(cause)) ||
        (trial.condition === 'usual_help' && interruption.causes.includes('selene'))) throw new Error('Invalid interruption or Selene use in the usual-help condition');
    }
    const pair = pairs.get(trial.pair_id) ?? [];
    if (pair.some(other => other.condition === trial.condition)) throw new Error('Duplicate condition within a pair');
    pair.push(trial); pairs.set(trial.pair_id, pair);
  }
  const shared = trial => trial.interruptions.filter(event => event.scope === 'shared');
  const duration = events => events.reduce((sum, event) => sum + event.seconds, 0);
  const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const byCondition = conditions.map(condition => {
    const rows = trials.filter(trial => trial.condition === condition); const reuse = rows.filter(trial => trial.voluntary_reuse !== null);
    return {condition, trials: rows.length, comprehension_percent: average(rows.map(trial => 100 * trial.correct / trial.questions)),
      mean_shared_interruptions: average(rows.map(trial => shared(trial).length)), mean_shared_interruption_seconds: average(rows.map(trial => duration(shared(trial)))),
      mean_viewer_attention_seconds: average(rows.map(trial => duration(trial.interruptions))),
      family_help_events: rows.reduce((sum, trial) => sum + trial.interruptions.filter(event => event.causes.includes('family_help')).length, 0),
      reuse_observed_trials: reuse.length, voluntary_reuse_percent: reuse.length ? 100 * reuse.filter(trial => trial.voluntary_reuse).length / reuse.length : null};
  });
  const paired = []; const exclusions = [];
  for (const [pairId, rows] of pairs) {
    const baseline = rows.find(trial => trial.condition === 'usual_help'); const selene = rows.find(trial => trial.condition === 'usual_help_plus_selene');
    if (!baseline || !selene) {exclusions.push({pair_id: pairId, reason: 'Incomplete pair'}); continue;}
    if (baseline.participant_id !== selene.participant_id || baseline.order === selene.order || baseline.questions !== selene.questions ||
      baseline.clip_id === selene.clip_id || support.some(key => baseline.available_support[key] !== selene.available_support[key])) {
      exclusions.push({pair_id: pairId, reason: 'Participant, order, question count, fresh clip or assistance availability is not comparable'}); continue;
    }
    paired.push({pair_id: pairId, comprehension_change_percentage_points: 100 * (selene.correct - baseline.correct) / baseline.questions,
      shared_interruption_change: shared(selene).length - shared(baseline).length,
      shared_interruption_seconds_change: duration(shared(selene)) - duration(shared(baseline)),
      viewer_attention_seconds_change: duration(selene.interruptions) - duration(baseline.interruptions)});
  }
  return {observations: trials.length, by_condition: byCondition, paired, excluded_pairs: exclusions,
    limitation: 'Descriptive formative observations, not causal proof or population estimates. Selene is added to existing assistance; family help remains available.'};
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (!process.argv[2]) throw new Error('Usage: npm run evaluate -- evaluation/results.json');
    const source = await readFile(process.argv[2], 'utf8');
    if (Buffer.byteLength(source) > 1048576) throw new Error('Evaluation file exceeds 1 MiB');
    console.info(JSON.stringify(summarize(JSON.parse(source).trials), null, 2));
  } catch (error) {console.error(`Evaluation failed: ${error.message}`); process.exitCode = 1;}
}
