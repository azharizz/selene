#!/bin/sh
# Release APK for Amazon's cloud Fire TV devices (Appstore Quality Central > Live Device Interaction).
# The cloud device can't reach 127.0.0.1, so this opens a temporary Cloudflare tunnel to the relay
# and bakes its URL into the build. The tunnel stays up until you press Ctrl-C; the relay is public meanwhile.
set -e
cd "$(dirname "$0")"
export JAVA_HOME=/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
export ANDROID_HOME=/opt/homebrew/share/android-commandlinetools EXPO_TV=1
log=$(mktemp)
# The relay only accepts its own Host; rewrite it so requests through the tunnel are treated as the TV's.
cloudflared tunnel --no-autoupdate --url http://127.0.0.1:4519 --http-host-header 127.0.0.1:4519 >"$log" 2>&1 &
tunnel=$!
trap 'kill $tunnel; printf "{\"appUrl\":\"http://127.0.0.1:4519\"}\n" > src/config.json' EXIT
trap 'exit 1' INT TERM
until url=$(grep -oE 'https://[a-z0-9-]+\.trycloudflare\.com' "$log" | head -1) && [ -n "$url" ]; do sleep 1; done
until curl -sf "$url/api/health" >/dev/null; do sleep 2; done
printf '{"appUrl":"%s"}\n' "$url" > src/config.json
# Gradle doesn't see config.json changes as a bundle input; drop the cached bundle so the new URL is baked in.
rm -rf android/app/build/generated/assets/react/release
(cd android && ./gradlew assembleRelease -PreactNativeArchitectures=armeabi-v7a,arm64-v8a --console=plain -q)
echo "Relay: $url"
echo "APK:   $PWD/android/app/build/outputs/apk/release/app-release.apk"
echo "Upload it in the console now. Ctrl-C closes the tunnel when you're done testing."
wait $tunnel
