# TfL Departures

A GNOME Shell extension that puts a Transport for London roundel in the top
bar. Click it for live departure boards — Tube, Overground, Elizabeth line,
DLR, trams, rail and bus stops — for one or more stations you choose, powered
by the [TfL Unified API](https://api-portal.tfl.gov.uk/).

![GNOME Shell 48–50](https://img.shields.io/badge/GNOME%20Shell-48%E2%80%9350-4A86CF)
![License: GPL v3](https://img.shields.io/badge/License-GPLv3-blue)

## Features

- Live departure boards for **multiple stations**, each in its own section.
- Brand-coloured line badges (Victoria, Central, Elizabeth, DLR, …) with
  automatic black/white text for contrast.
- Destination, platform and time-to-departure for each service.
- Search for stations by name right in the preferences window — no need to
  hunt down NaPTAN / StopPoint ids.
- Auto-refreshes while the board is open; interval and rows-per-station are
  configurable.
- Works keyless for light use; add an optional TfL app key for higher rate
  limits.
- Monochrome roundel icon that follows your panel's light/dark theme.

## Install

### From source

```sh
git clone git@github.com:jimhooker/gnome-tfl-departureboard.git
cd gnome-tfl-departureboard
make install      # compiles the schema and copies into ~/.local/share/gnome-shell/extensions
```

Then reload GNOME Shell so it picks up the new extension:

- **Wayland:** log out and back in.
- **X11:** press `Alt`+`F2`, type `r`, press `Enter`.

Finally enable it:

```sh
make enable       # or: gnome-extensions enable tfl-departures@jameshooker.com
```

Open the settings with `make prefs` (or from the Extensions app) to add your
stations.

## Configuration

Everything is in the extension's preferences:

| Setting | Description | Default |
|---------|-------------|---------|
| **Your stations** | Add/remove stations. Search by name and pick a result. | King's Cross St. Pancras |
| **App key** | Optional TfL Unified API key for higher rate limits. | _(none)_ |
| **Maximum departures** | Rows shown per station (1–25). | 8 |
| **Auto-refresh interval** | Seconds between refreshes while the board is open (10–300). | 30 |

You can get a free app key at <https://api-portal.tfl.gov.uk>. It isn't
required — the API works without one for low volumes.

## Development

The extension is a standard GNOME 45+ ESM extension (`extension.js` /
`prefs.js`, `import` from `gi://`).

```sh
make link     # symlink this checkout so edits apply on the next shell reload
make prefs    # open the preferences window
make pack     # build the extensions.gnome.org zip
```

Notes:

- On Wayland there is no live reload — log out / back in to load code changes.
- For a throwaway test without touching your session:
  `dbus-run-session -- gnome-shell --nested --wayland`
- Watch logs with: `journalctl -f -o cat /usr/bin/gnome-shell`
- After editing `schemas/*.gschema.xml`, recompile with `make schemas`.

## License

[GPL-3.0-or-later](LICENSE). Not affiliated with or endorsed by Transport for
London; the roundel is a TfL trademark used here only to identify the data
source.
