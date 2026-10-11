# Voice personalization verification — 10 October 2026

The existing recording feeds one relay processor: PCM WAV from Vega and the phone,
M4A from Fire OS. An enrolled ECAPA speaker match supplies profile preferences;
an explicit first-person text declaration can override its role. An unknown voice
does not imply an age or family relationship. No extra voice button or profile UI
was added in this continuation.

## Repairs

- The Fire OS recorder and question-field Select handler were stored only inside
  ignored, generated `fireos/android/` files. Their source now lives in
  `fireos/plugins/VoiceRecorderModule.kt`. The Expo plugin restores and registers
  both during prebuild, including when the Android package changes.
- `npm run test:voice` in `fireos/` covers consent, permission denial, cancellation,
  transcript review, and generation of the recorder and remote handler. Unsupported
  application templates fail prebuild instead of silently omitting voice support.
- The previous Metro process served a cached bundle without the voice feature.
  Emulator checks used a fresh bundler on port 8083.

## Completed checks

| Check | Result |
| --- | --- |
| Node suite | 148 passed |
| Native Jest suites | 23 passed |
| Fire OS voice/generation tests | 7 passed |
| Vega, web, Fire OS TypeScript | Passed |
| Root lint | Passed with three existing warnings |
| Fire OS lint | Passed |
| Web build | Passed |
| Fire OS debug APK | Built, installed and launched on Android TV API 31 |
| Vega debug packages | Built; existing W3C media compatibility-metadata warning remains |
| Live acoustic endpoints | Two independent enrollment clips; held-out utterance matched on TV and phone; another speaker returned unknown |
| Text precedence | “I am a kid” overrode the test grandparent profile |
| Fire OS remote recording | Hold Select opened consent, permission was granted, recording created an M4A, Back canceled and removed the file |
| Real HTTPS phone pairing | TV-generated code joined in a mobile-sized Chrome browser; phone received live TV playback |
| Phone browser recording pipeline | Controlled Web Audio MediaStream recorded and uploaded by the real client; live transcription and ECAPA returned the enrolled grandparent profile; transcript remained editable; zero ask/assistant requests were sent |

Acoustic fixtures are public adult speech with an explicitly assigned test role.
They do not establish the speaker's age or prove recognition of the user's grandmother.
The smoke used isolated profile storage and deleted its test profiles.
Chrome's fake microphone device produced silent audio, which the quality gate
correctly rejected. The passing browser check supplied a known speech MediaStream
at the microphone boundary; it did not simulate the recording, upload,
transcription or matching code. This is not physical phone microphone evidence.

Screenshots and the live endpoint/browser results are in the ignored
`artifacts/voice-2026-10-10/` directory.

## Transport and device limits

The normal local relay had no `SELENE_PRIVATE_URL`, so it correctly rejected phone
pairing. A reachable HTTPS phone address must be supplied when starting the relay.
The HTTPS route must support Server-Sent Events as well as ordinary requests.
[Cloudflare Quick Tunnels do not support SSE](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/#limitations):
the code can join successfully while the phone remains at “Connecting to TV”.
The successful public pairing check used a separate SSH HTTPS tunnel.

The first Android microphone permission dialog backgrounds the app and cancels the
pending attempt. After granting permission, reopen the question and hold Select
again. This preserves cancellation on background; permission is not proof a
recording started.

Physical Fire TV/Vega microphone routing, the system-owned Alexa remote microphone,
real phone hardware capture, household enrollment, and calibrated recognition
accuracy remain unverified. Grandma needs two independent, consented enrollment
recordings before her acoustic voice can select a profile. Typed declarations
already work without enrollment.
