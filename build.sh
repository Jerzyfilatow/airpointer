#!/bin/zsh
set -euo pipefail
cd -- "${0:A:h}"
mkdir -p AirPointer.app/Contents/MacOS AirPointer.app/Contents/Resources
airpointer_build_mode="${AIRPOINTER_OPTIMIZATION:--O}"
airpointer_signing_identity="${AIRPOINTER_SIGNING_IDENTITY:--}"
cp Assets/CaseFront.png Assets/AppIcon.icns AirPointer.app/Contents/Resources/
for frame in Assets/CaseLid/lid-*.png; do cp "$frame" "AirPointer.app/Contents/Resources/Case${frame:t:r:s/lid/Lid/}.png"; done
cp Assets/TapClick/click.wav AirPointer.app/Contents/Resources/TapClick.wav
cp Assets/NotchShimmer.wav AirPointer.app/Contents/Resources/NotchShimmer.wav
clang -fobjc-arc -Wall -Wextra -Werror -framework Foundation -framework CoreBluetooth -framework IOBluetooth ClosedCase/CaseSustainedRenewal.m -o AirPointer.app/Contents/Resources/ClosedCaseMotion.bin
xcrun swiftc -swift-version 5 -O ClosedCaseRestore.swift -o AirPointer.app/Contents/Resources/ClosedCaseRestore.bin -framework Foundation -framework CoreBluetooth -framework IOBluetooth
cp ClosedCase/Orientation.js AirPointer.app/Contents/Resources/ClosedCaseOrientation.js
# The app finds the paired AirPods itself; no address is built in.
cat > AirPointer.app/Contents/Info.plist <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>AirPointer</string>
<key>CFBundleIdentifier</key><string>local.airpointer</string>
<key>CFBundleName</key><string>AirPointer</string>
<key>CFBundleIconFile</key><string>AppIcon</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>0.2</string>
<key>CFBundleVersion</key><string>2</string>
<key>LSMinimumSystemVersion</key><string>14.0</string>
<key>NSHighResolutionCapable</key><true/>
<key>NSBluetoothAlwaysUsageDescription</key><string>AirPointer connects to your paired AirPods to keep motion available with the case closed.</string>
</dict></plist>
PLIST
xcrun swiftc -swift-version 5 "$airpointer_build_mode" AirPointer.swift ClosedCaseSession.swift ClosedCaseTap.swift TapTest.swift ClosedCaseAirPods.swift AudioOutputGuard.swift AppHome.swift AirPointerHome.swift RemoteKit.swift SetupAssistant.swift AccessibilityGuide.swift PointerShortcut.swift CursorSize.swift StatusBarUI.swift NotchFlow.swift HomeChecks.swift MotionLearning.swift CaseLessons.swift Checks.swift -o AirPointer.app/Contents/MacOS/.AirPointer-next -framework AppKit -framework JavaScriptCore -framework QuartzCore -framework ApplicationServices -framework Carbon -framework AVFoundation -framework CoreAudio -framework CoreBluetooth
mv -f AirPointer.app/Contents/MacOS/.AirPointer-next AirPointer.app/Contents/MacOS/AirPointer
if [[ "$airpointer_signing_identity" != "-" ]]; then
    codesign --force --sign "$airpointer_signing_identity" --timestamp=none --identifier local.airpointer.closed-case-motion AirPointer.app/Contents/Resources/ClosedCaseMotion.bin
    codesign --force --sign "$airpointer_signing_identity" --timestamp=none --identifier local.airpointer.closed-case-restore AirPointer.app/Contents/Resources/ClosedCaseRestore.bin
fi
codesign --force --sign "$airpointer_signing_identity" --timestamp=none AirPointer.app
/System/Library/Frameworks/CoreServices.framework/Versions/A/Frameworks/LaunchServices.framework/Versions/A/Support/lsregister -f "$PWD/AirPointer.app"
AirPointer.app/Contents/MacOS/AirPointer --self-test
AirPointer.app/Contents/MacOS/AirPointer --check-closed-case-tap ClosedCase/TapFixtures.csv
