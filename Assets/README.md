# Assets

The images and sounds that the build copies into the app, and the 3D model that
the case images come from.

| File | What it is | Used for |
|---|---|---|
| `airpods-pro.usdz` | Apple's AirPods Pro 3 AR model, unchanged | The source of the case images |
| `CaseLid/lid.json` | The source hash, the camera, and the data for each frame | A record of how the frames were made |
| `CaseFront.png` | The closed case, upright, with the light facing you | How the case looks when you point |
| `CaseLid/lid-00.png` to `lid-11.png` | The lid going from open to closed | The connection steps |
| `TapClick/click.wav` | A mouse button going down and up (96 ms) | The sound of a tap that clicks |
| `NotchShimmer.wav` | Air and two glass bells (652 ms) | The sound of the notch opening |
| `AppIcon.icns` | The closed case, upright, on a dark tile | The app icon |

## Sources and licenses

- The case images are renders of Apple's AirPods Pro 3 AR model. Apple owns the
  model and its materials.
  [Download it from Apple](https://www.apple.com/105/media/us/airpods-pro/2025/7acffb13-4adb-40b1-9393-8f1c99bc6c90/ar/airpods-pro.usdz),
  linked from the [AirPods Pro specs page](https://www.apple.com/airpods-pro/specs/).
- The two sounds use parts from cuelume, MIT license, (c) 2026 Daniel Belyi. See
  `TapClick/LICENSE-cuelume.txt`.

## Make the case images again

You need Blender. A normal app build uses the saved images, so you only need this
to change them. Run this command from the project folder. It writes to
`work/case-renders`.

```sh
/Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --threads 8 --python render-closed-case.py -- --only open,closed,pointer,lid,review
```

Then copy `work/case-renders/case-pointer.png` to `Assets/CaseFront.png`, and copy
`work/case-renders/lid/*` to `Assets/CaseLid/`.

All the images use one camera, 12° above the front of the case, so the frames line
up. `seat-earbuds.py` moves the earbuds from Apple's display position into their
seats, so they fit under the closed lid.
