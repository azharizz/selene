const {test} = require('node:test');
const assert = require('node:assert/strict');
const {mkdtemp, readFile, rm} = require('node:fs/promises');
const {tmpdir} = require('node:os');
const {join} = require('node:path');
const withVoiceRecorder = require('./withVoiceRecorder');

test('prebuild restores and registers the recorder once, including a changed Android package', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'selene-voice-prebuild-'));
  t.after(() => rm(directory, {recursive: true, force: true}));
  const config = withVoiceRecorder({name: 'Selene', slug: 'selene-fireos'});
  let compiled = {...config, modRequest: {}, modResults: {language: 'kt', path: join(directory, 'MainApplication.kt'),
    contents: 'package com.example.tv\nval packages = PackageList(this).packages.apply {\n}\n'}};
  compiled = await config.mods.android.mainApplication(compiled);
  compiled = await config.mods.android.mainApplication(compiled);
  assert.equal(compiled.modResults.contents.match(/add\(VoiceRecorderPackage\(\)\)/g).length, 1);
  const source = await readFile(join(directory, 'VoiceRecorderModule.kt'), 'utf8');
  assert.match(source, /^package com\.example\.tv\n/);
  assert.match(source, /class VoiceRecorderPackage : ReactPackage/);
  assert.match(source, /getName\(\) = "SeleneVoiceRecorder"/);
});

test('unsupported generated application fails prebuild instead of silently losing voice', async () => {
  const config = withVoiceRecorder({name: 'Selene', slug: 'selene-fireos'});
  await assert.rejects(config.mods.android.mainApplication({...config, modRequest: {},
    modResults: {language: 'kt', contents: 'package com.example.tv\nclass MainApplication'}}), /Voice recorder requires/);
});

test('prebuild restores the question-field remote key handler once', async () => {
  const config = withVoiceRecorder({name: 'Selene', slug: 'selene-fireos'});
  let compiled = {...config, modRequest: {}, modResults: {language: 'kt',
    contents: 'package com.example.tv\nclass MainActivity : ReactActivity() {\n}\n'}};
  compiled = await config.mods.android.mainActivity(compiled);
  compiled = await config.mods.android.mainActivity(compiled);
  assert.equal(compiled.modResults.contents.match(/override fun dispatchKeyEvent/g).length, 1);
  assert.match(compiled.modResults.contents, /emit\("SeleneQuestionLongPress", null\)/);
  await assert.rejects(config.mods.android.mainActivity({...config, modRequest: {},
    modResults: {language: 'java', contents: 'class MainActivity {}'}}), /Kotlin MainActivity/);
});
