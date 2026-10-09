#!/usr/bin/env bash
set -euo pipefail
: "${RUNNER_TEMP:?}" "${HVM_APPLE_CERT_P12_BASE64:?}" "${HVM_APPLE_CERT_PASSWORD:?}" "${HVM_APPLE_API_KEY_P8_BASE64:?}" "${HVM_APPLE_API_KEY_ID:?}" "${HVM_APPLE_API_ISSUER_ID:?}" "${HVM_APPLE_TEAM_ID:?}"
[[ "$HVM_APPLE_TEAM_ID" =~ ^[A-Z0-9]{10}$ ]]
[[ "$HVM_APPLE_API_KEY_ID" =~ ^[A-Z0-9]{10}$ ]]
[[ "$HVM_APPLE_API_ISSUER_ID" =~ ^[a-fA-F0-9-]{36}$ ]]
umask 077
HVM_KEYCHAIN_PATH="$RUNNER_TEMP/hvm-release.keychain-db"
HVM_CERT_PATH="$RUNNER_TEMP/hvm-distribution.p12"
HVM_KEY_DIRECTORY="$RUNNER_TEMP/hvm-apple-keys"
HVM_KEYCHAIN_PASSWORD="$(openssl rand -base64 24)"
cleanup() {
  security delete-keychain "$HVM_KEYCHAIN_PATH" >/dev/null 2>&1 || true
  rm -f "$HVM_CERT_PATH"
  rm -rf "$HVM_KEY_DIRECTORY"
}
trap cleanup EXIT
mkdir -p "$HVM_KEY_DIRECTORY" packaging/capacitor/release-assets
printf '%s' "$HVM_APPLE_CERT_P12_BASE64" | base64 --decode > "$HVM_CERT_PATH"
printf '%s' "$HVM_APPLE_API_KEY_P8_BASE64" | base64 --decode > "$HVM_KEY_DIRECTORY/AuthKey_$HVM_APPLE_API_KEY_ID.p8"
security create-keychain -p "$HVM_KEYCHAIN_PASSWORD" "$HVM_KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$HVM_KEYCHAIN_PATH"
security unlock-keychain -p "$HVM_KEYCHAIN_PASSWORD" "$HVM_KEYCHAIN_PATH"
security import "$HVM_CERT_PATH" -P "$HVM_APPLE_CERT_PASSWORD" -T /usr/bin/codesign -T /usr/bin/security -k "$HVM_KEYCHAIN_PATH" >/dev/null
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$HVM_KEYCHAIN_PASSWORD" "$HVM_KEYCHAIN_PATH" >/dev/null
security list-keychains -d user -s "$HVM_KEYCHAIN_PATH" login.keychain-db
HVM_KEY_PATH="$HVM_KEY_DIRECTORY/AuthKey_$HVM_APPLE_API_KEY_ID.p8"
xcodebuild -project packaging/capacitor/ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS' -archivePath "$RUNNER_TEMP/HortiVitalMix.xcarchive" -allowProvisioningUpdates -authenticationKeyPath "$HVM_KEY_PATH" -authenticationKeyID "$HVM_APPLE_API_KEY_ID" -authenticationKeyIssuerID "$HVM_APPLE_API_ISSUER_ID" DEVELOPMENT_TEAM="$HVM_APPLE_TEAM_ID" CODE_SIGN_STYLE=Automatic archive
HVM_EXPORT_OPTIONS="$RUNNER_TEMP/hvm-ExportOptions.plist"
plutil -create xml1 "$HVM_EXPORT_OPTIONS"
plutil -insert method -string app-store-connect "$HVM_EXPORT_OPTIONS"
plutil -insert signingStyle -string automatic "$HVM_EXPORT_OPTIONS"
plutil -insert teamID -string "$HVM_APPLE_TEAM_ID" "$HVM_EXPORT_OPTIONS"
xcodebuild -exportArchive -archivePath "$RUNNER_TEMP/HortiVitalMix.xcarchive" -exportPath "$RUNNER_TEMP/hvm-ios-export" -exportOptionsPlist "$HVM_EXPORT_OPTIONS" -allowProvisioningUpdates -authenticationKeyPath "$HVM_KEY_PATH" -authenticationKeyID "$HVM_APPLE_API_KEY_ID" -authenticationKeyIssuerID "$HVM_APPLE_API_ISSUER_ID"
HVM_IPA_PATH="$RUNNER_TEMP/hvm-ios-export/App.ipa"
test -f "$HVM_IPA_PATH"
cp "$HVM_IPA_PATH" packaging/capacitor/release-assets/HortiVitalMix.ipa
unzip -q "$HVM_IPA_PATH" -d "$RUNNER_TEMP/hvm-ios-inspection"
HVM_APP_PATH="$RUNNER_TEMP/hvm-ios-inspection/Payload/App.app"
test -d "$HVM_APP_PATH"
codesign --verify --deep --strict "$HVM_APP_PATH"
codesign -dv --verbose=4 "$HVM_APP_PATH" 2> "$RUNNER_TEMP/hvm-ios-codesign.txt"
codesign -d --entitlements :- "$HVM_APP_PATH" > "$RUNNER_TEMP/hvm-ios-entitlements.plist" 2> /dev/null
plutil -convert json -o "$RUNNER_TEMP/hvm-ios-info.json" "$HVM_APP_PATH/Info.plist"
plutil -convert json -o "$RUNNER_TEMP/hvm-ios-entitlements.json" "$RUNNER_TEMP/hvm-ios-entitlements.plist"
node scripts/mobile/ios-proof.mjs "$RUNNER_TEMP/hvm-ios-info.json" "$RUNNER_TEMP/hvm-ios-entitlements.json" "$RUNNER_TEMP/hvm-ios-codesign.txt" > packaging/capacitor/release-assets/signing-identity.txt
shasum -a 256 packaging/capacitor/release-assets/HortiVitalMix.ipa > packaging/capacitor/release-assets/SHA256SUMS
API_PRIVATE_KEYS_DIR="$HVM_KEY_DIRECTORY" xcrun altool --upload-app --type ios --file "$HVM_IPA_PATH" --apiKey "$HVM_APPLE_API_KEY_ID" --apiIssuer "$HVM_APPLE_API_ISSUER_ID"
