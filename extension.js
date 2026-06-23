// SPDX-FileCopyrightText: 2026 James Hooker
// SPDX-License-Identifier: GPL-3.0-or-later

import GObject from 'gi://GObject';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Soup from 'gi://Soup?version=3.0';

import {Extension, gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

// Colours for common Tube/Overground/Elizabeth/DLR lines, used for the
// little line badge. Anything unknown falls back to a neutral grey.
const LINE_COLOURS = {
    'bakerloo': '#B36305',
    'central': '#E32017',
    'circle': '#FFD300',
    'district': '#00782A',
    'hammersmith-city': '#F3A9BB',
    'jubilee': '#A0A5A9',
    'metropolitan': '#9B0056',
    'northern': '#000000',
    'piccadilly': '#003688',
    'victoria': '#0098D4',
    'waterloo-city': '#95CDBA',
    'elizabeth': '#6950A1',
    'dlr': '#00A4A7',
    'london-overground': '#EE7C0E',
    'liberty': '#5D6061',
    'lioness': '#FFA600',
    'mildmay': '#0077AD',
    'suffragette': '#18A95D',
    'weaver': '#823A62',
    'windrush': '#DC241F',
    'tram': '#84B817',
};

const TflIndicator = GObject.registerClass(
class TflIndicator extends PanelMenu.Button {
    _init(extension) {
        super._init(0.0, _('TfL Departures'));

        this._extension = extension;
        this._settings = extension.getSettings();
        this._session = new Soup.Session({timeout: 15});
        this._cancellable = null;
        this._refreshTimeoutId = 0;

        // The roundel SVG is monochrome and carries no fill of its own. Asking
        // the shell to recolour a *file-based* "-symbolic" icon proved
        // unreliable here — it rendered black, i.e. invisible on a dark panel —
        // so we read the panel foreground colour ourselves and bake it into the
        // SVG, re-baking on every style change (e.g. a light/dark theme switch).
        // 'system-status-icon' is the standard panel sizing.
        const svgPath = `${extension.path}/icons/roundel-symbolic.svg`;
        try {
            const [, bytes] = GLib.file_get_contents(svgPath);
            this._iconSvg = new TextDecoder().decode(bytes);
        } catch (e) {
            // Fallback so the icon still works if the file is missing: geometry
            // inline (outer ring with an even-odd hole, plus the centre bar).
            this._iconSvg =
                '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16" width="16" height="16">' +
                '<path fill-rule="evenodd" d="M8 1.6a6.4 6.4 0 1 0 0 12.8 6.4 6.4 0 0 0 0-12.8zm0 2.6a3.8 3.8 0 1 1 0 7.6 3.8 3.8 0 0 1 0-7.6z"/>' +
                '<rect x="0.4" y="6.4" width="15.2" height="3.2"/></svg>';
        }
        this._iconColour = null;
        this._icon = new St.Icon({
            style_class: 'system-status-icon tfl-panel-icon',
        });
        this.add_child(this._icon);
        // Colour it now (once styled) and again on any later style change.
        this._icon.connect('style-changed', () => this._updateIconColour());
        this._updateIconColour();

        this._buildMenu();

        // Re-render when the monitored stations (or other settings) change
        // while the menu is open, so edits in prefs show up immediately.
        this._settingsChangedId = this._settings.connect('changed', () => {
            if (this.menu.isOpen)
                this._refresh();
        });

        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._refresh();
                this._startAutoRefresh();
            } else {
                this._stopAutoRefresh();
            }
        });
    }

    _buildMenu() {
        // Section that holds the per-station departure boards.
        this._boardSection = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._boardSection);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        // Footer: manual refresh + settings.
        const refreshItem = new PopupMenu.PopupMenuItem(_('Refresh'));
        refreshItem.connect('activate', () => this._refresh());
        this.menu.addMenuItem(refreshItem);

        const settingsItem = new PopupMenu.PopupMenuItem(_('Settings…'));
        settingsItem.connect('activate', () => this._extension.openPreferences());
        this.menu.addMenuItem(settingsItem);

        this._setStatus(_('Open to load departures.'));
    }

    // Bake the current panel foreground colour into the roundel SVG and show
    // it. Cheap to call repeatedly: it no-ops unless the colour actually moved.
    _updateIconColour() {
        // get_theme_node() doesn't throw when the actor is off the stage — it
        // just logs "called on the widget … which is not in the stage" and
        // returns a default node. enable() runs all of _init() (including the
        // eager call below) before addToStatusArea() parents us, so guard on
        // the stage explicitly; the style-changed signal re-invokes us once
        // we're mapped and actually styled.
        if (!this._icon || this._icon.get_stage() === null)
            return;
        const node = this._icon.get_theme_node();
        const colour = this._rgbHex(node.get_foreground_color());
        if (colour === this._iconColour)
            return;
        this._iconColour = colour;
        const svg = this._iconSvg.replace('<svg ', `<svg fill="${colour}" `);
        const bytes = new GLib.Bytes(new TextEncoder().encode(svg));
        this._icon.gicon = Gio.BytesIcon.new(bytes);
    }

    // St hands colour components back as 0–255 ints or 0–1 floats depending on
    // the Clutter/Cogl version; normalise either form to a #rrggbb string.
    _rgbHex(c) {
        let {red, green, blue} = c;
        if (red <= 1 && green <= 1 && blue <= 1) {
            red *= 255;
            green *= 255;
            blue *= 255;
        }
        const h = v => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0');
        return `#${h(red)}${h(green)}${h(blue)}`;
    }

    // Read the configured stations as an array of [id, name] pairs.
    _getStations() {
        try {
            return this._settings.get_value('stations').deepUnpack();
        } catch (e) {
            return [];
        }
    }

    _startAutoRefresh() {
        this._stopAutoRefresh();
        const interval = this._settings.get_int('refresh-interval');
        this._refreshTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT, interval, () => {
                this._refresh();
                return GLib.SOURCE_CONTINUE;
            });
    }

    _stopAutoRefresh() {
        if (this._refreshTimeoutId) {
            GLib.Source.remove(this._refreshTimeoutId);
            this._refreshTimeoutId = 0;
        }
    }

    _makeStatusItem(text) {
        const item = new PopupMenu.PopupMenuItem(text, {
            reactive: false,
            can_focus: false,
        });
        item.label.add_style_class_name('tfl-status');
        return item;
    }

    _setStatus(text) {
        this._boardSection.removeAll();
        this._boardSection.addMenuItem(this._makeStatusItem(text));
    }

    async _refresh() {
        const stations = this._getStations();
        if (!stations.length) {
            this._setStatus(_('No stations configured. Open Settings…'));
            return;
        }

        // Cancel any in-flight requests before starting a new round.
        if (this._cancellable)
            this._cancellable.cancel();
        this._cancellable = new Gio.Cancellable();
        const cancellable = this._cancellable;

        // Fetch every station in parallel; failures are captured per-station
        // so one bad stop doesn't blank the whole board.
        const results = await Promise.all(stations.map(([id, name]) =>
            this._fetchArrivals(id, cancellable)
                .then(arrivals => ({id, name, arrivals, error: null}))
                .catch(error => ({id, name, arrivals: null, error}))));

        if (cancellable.is_cancelled())
            return;

        this._renderBoard(results);
    }

    _renderBoard(results) {
        this._boardSection.removeAll();

        let first = true;
        for (const r of results) {
            if (!first)
                this._boardSection.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
            first = false;

            // Station header.
            const header = new PopupMenu.PopupMenuItem(r.name || r.id, {
                reactive: false,
                can_focus: false,
            });
            header.label.add_style_class_name('tfl-header-label');
            this._boardSection.addMenuItem(header);

            if (r.error) {
                if (!(r.error instanceof GLib.Error &&
                      r.error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)))
                    logError(r.error, `TfL Departures: failed to fetch ${r.id}`);
                this._boardSection.addMenuItem(
                    this._makeStatusItem(_('Could not load departures.')));
                continue;
            }

            const arrivals = r.arrivals;
            if (!Array.isArray(arrivals) || arrivals.length === 0) {
                this._boardSection.addMenuItem(
                    this._makeStatusItem(_('No departures right now.')));
                continue;
            }

            const max = this._settings.get_int('max-departures');
            const sorted = arrivals
                .slice()
                .sort((a, b) => (a.timeToStation ?? 0) - (b.timeToStation ?? 0))
                .slice(0, max);

            for (const a of sorted)
                this._boardSection.addMenuItem(this._makeRow(a));
        }
    }

    async _fetchArrivals(stationId, cancellable) {
        const appKey = this._settings.get_string('app-key').trim();
        let url = `https://api.tfl.gov.uk/StopPoint/${encodeURIComponent(stationId)}/Arrivals`;
        if (appKey)
            url += `?app_key=${encodeURIComponent(appKey)}`;

        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'gnome-shell-tfl-departures');

        const bytes = await this._session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, cancellable);

        const status = message.get_status();
        if (status !== Soup.Status.OK)
            throw new Error(`HTTP ${status}`);

        const text = new TextDecoder().decode(bytes.get_data());
        return JSON.parse(text);
    }

    _makeRow(a) {
        const item = new PopupMenu.PopupBaseMenuItem({
            reactive: false,
            can_focus: false,
            style_class: 'popup-menu-item tfl-row',
        });

        const lineId = (a.lineId || '').toLowerCase();
        const colour = LINE_COLOURS[lineId] ?? '#5D6061';

        // Line badge.
        const badge = new St.Label({
            text: a.lineName || a.modeName || '—',
            style_class: 'tfl-line-badge',
            y_align: Clutter.ActorAlign.CENTER,
        });
        badge.set_style(`background-color: ${colour}; color: ${this._textOn(colour)};`);
        item.add_child(badge);

        // Destination + platform.
        const dest = this._cleanDest(a.destinationName) || a.towards ||
            _('Unknown destination');
        const destLabel = new St.Label({
            text: a.platformName && a.platformName !== 'null'
                ? `${dest}  ·  ${a.platformName}`
                : dest,
            style_class: 'tfl-destination',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(destLabel);

        // Time to departure.
        const timeLabel = new St.Label({
            text: this._formatTime(a.timeToStation),
            style_class: 'tfl-time',
            y_align: Clutter.ActorAlign.CENTER,
        });
        item.add_child(timeLabel);

        return item;
    }

    // Trim the verbose station suffixes TfL appends to destination names.
    _cleanDest(name) {
        if (!name)
            return '';
        return name
            .replace(/\s+(Underground|DLR|Rail)?\s*Station$/i, '')
            .trim();
    }

    _formatTime(seconds) {
        if (seconds == null)
            return '—';
        const mins = Math.round(seconds / 60);
        if (mins <= 0)
            return _('Due');
        if (mins === 1)
            return _('1 min');
        return `${mins} ${_('min')}`;
    }

    // Pick black or white text for a given badge background.
    _textOn(hex) {
        const c = hex.replace('#', '');
        const r = parseInt(c.substr(0, 2), 16);
        const g = parseInt(c.substr(2, 2), 16);
        const b = parseInt(c.substr(4, 2), 16);
        const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
        return luminance > 0.6 ? '#000000' : '#FFFFFF';
    }

    destroy() {
        this._stopAutoRefresh();
        if (this._settingsChangedId) {
            this._settings.disconnect(this._settingsChangedId);
            this._settingsChangedId = 0;
        }
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._session) {
            this._session.abort();
            this._session = null;
        }
        super.destroy();
    }
});

export default class TflDeparturesExtension extends Extension {
    enable() {
        this._migrateSettings();
        this._indicator = new TflIndicator(this);
        Main.panel.addToStatusArea(this.uuid, this._indicator);
    }

    // Seed the 'stations' list from the legacy single-station keys so older
    // installs (and anyone who had customised station-id) keep their stop.
    _migrateSettings() {
        const settings = this.getSettings();
        const stations = settings.get_value('stations').deepUnpack();
        if (stations.length > 0)
            return;

        const id = settings.get_string('station-id').trim();
        if (!id)
            return;
        const name = settings.get_string('station-name') || id;
        settings.set_value('stations', new GLib.Variant('a(ss)', [[id, name]]));
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
