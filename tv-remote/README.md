# Living Room TV Remote

This standalone web remote connects to an Android TV over Wireless debugging through a local ADB bridge. The launcher stays offline; this tool runs separately on your computer.

## Connect over Wi-Fi

1. Put the TV and computer on the same Wi-Fi network.
2. On the TV, open **Developer options → Wireless debugging → Pair device with pairing code**.
3. Run `pair-tv.ps1` in PowerShell. Enter the temporary `IP:pairing-port` and six-digit code while the pairing screen is open.
4. Enter the separate `IP:connection-port` shown on the main Wireless debugging screen.
5. Run `start-bridge.ps1` and open `http://127.0.0.1:8765` in a browser on this computer.
6. In Quick settings, connect to `ws://127.0.0.1:8765/bridge`.

The ADB authorization key and selected TV address are kept under the ignored `tools/adb-profile/` folder. Use **Forget** in the TV's Paired devices list to revoke this computer later. Keep the bridge window open while using the page; press Ctrl+C in that window to stop it.

## Features

- Launcher-style Add menu, Photos, app shortcut, settings, local bridge and port controls.
- D-pad, back/home/menu, volume, mute, playback and keyboard input over ADB.
- Image upload, fullscreen local preview, drawing overlay, and TV display via the TV's browser.
- Voice orb uses browser speech recognition and maps a small set of recognized commands to remote actions.

Photo display opens a local page served by this computer. The TV needs a browser app that can open a local-network URL. If the TV has no browser, remote buttons and text input can still work, but displaying a photo requires a TV-side display app or another receiver.

The voice orb is a local command demo, not a generative AI service or Google Assistant integration. A real AI connection needs a server-side provider setup and credentials. This bridge does not change Wi-Fi settings or install apps on the TV. Only use Wireless debugging on a trusted home network, and turn it off or forget this computer when finished if you no longer need the connection.
