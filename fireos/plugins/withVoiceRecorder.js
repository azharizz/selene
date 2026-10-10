const {withMainActivity, withMainApplication} = require('@expo/config-plugins');
const {readFile, writeFile} = require('node:fs/promises');
const {dirname, join} = require('node:path');

// Keep the recorder outside generated android/: Expo prebuild --clean must preserve it.
module.exports = function withVoiceRecorder(config) {
  config = withMainApplication(config, async config => {
    const application = config.modResults;
    const packageName = /^package\s+([\w.]+)/m.exec(application.contents)?.[1];
    const packages = /PackageList\(this\)\.packages\.apply\s*\{/;
    if (application.language !== 'kt' || !packageName || !packages.test(application.contents)) {
      throw new Error('Voice recorder requires a Kotlin MainApplication with PackageList(this).packages.apply.');
    }
    const source = await readFile(join(__dirname, 'VoiceRecorderModule.kt'), 'utf8');
    await writeFile(join(dirname(application.path), 'VoiceRecorderModule.kt'),
      source.replace(/^package\s+[\w.]+/m, `package ${packageName}`));
    if (!application.contents.includes('add(VoiceRecorderPackage())')) {
      application.contents = application.contents.replace(packages, '$&\n          add(VoiceRecorderPackage())');
    }
    return config;
  });
  return withMainActivity(config, config => {
    const activity = config.modResults;
    if (activity.language !== 'kt' || !/class MainActivity\s*:\s*ReactActivity\(\)/.test(activity.contents) || !/\n}\s*$/.test(activity.contents)) {
      throw new Error('Voice recorder requires a Kotlin MainActivity extending ReactActivity.');
    }
    if (!activity.contents.includes('private val voiceQuestionKeys')) {
      activity.contents = activity.contents.replace(/\n}\s*$/, `
  private val voiceQuestionKeys by lazy {
    VoiceQuestionKeys(this) {
      reactHost?.currentReactContext
        ?.getJSModule(com.facebook.react.modules.core.DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
        ?.emit("SeleneQuestionLongPress", null)
    }
  }

  override fun dispatchKeyEvent(event: android.view.KeyEvent): Boolean =
    voiceQuestionKeys.dispatch(event) { super.dispatchKeyEvent(it) }
}
`);
    }
    return config;
  });
};
