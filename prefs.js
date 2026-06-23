// SPDX-FileCopyrightText: 2026 James Hooker
// SPDX-License-Identifier: GPL-3.0-or-later

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Soup from 'gi://Soup?version=3.0';

import {ExtensionPreferences, gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async');

export default class TflDeparturesPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const session = new Soup.Session({timeout: 15});

        const page = new Adw.PreferencesPage({
            title: _('General'),
            icon_name: 'preferences-system-symbolic',
        });
        window.add(page);

        // Abort any in-flight search when the window goes away.
        window.connect('close-request', () => session.abort());

        // --- Read/write helpers for the stations list (a(ss)) ---
        const getStations = () => settings.get_value('stations').deepUnpack();
        const setStations = arr =>
            settings.set_value('stations', new GLib.Variant('a(ss)', arr));

        const addStation = (id, name) => {
            const stations = getStations();
            if (stations.some(([sid]) => sid === id))
                return false;
            stations.push([id, name || id]);
            setStations(stations);
            return true;
        };

        const removeStation = id => {
            setStations(getStations().filter(([sid]) => sid !== id));
        };

        // --- Your stations group ---
        const stationsGroup = new Adw.PreferencesGroup({
            title: _('Your stations'),
            description: _('Stations you are monitoring. Each gets its own section in the popup.'),
        });
        page.add(stationsGroup);

        let stationRows = [];
        const renderStations = () => {
            for (const row of stationRows)
                stationsGroup.remove(row);
            stationRows = [];

            const stations = getStations();
            if (stations.length === 0) {
                const empty = new Adw.ActionRow({
                    title: _('No stations yet'),
                    subtitle: _('Search below to add one.'),
                });
                stationsGroup.add(empty);
                stationRows.push(empty);
                return;
            }

            for (const [id, name] of stations) {
                const row = new Adw.ActionRow({title: name || id, subtitle: id});
                const remove = new Gtk.Button({
                    icon_name: 'user-trash-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Remove'),
                });
                remove.add_css_class('flat');
                remove.connect('clicked', () => {
                    removeStation(id);
                    renderStations();
                });
                row.add_suffix(remove);
                stationsGroup.add(row);
                stationRows.push(row);
            }
        };
        renderStations();

        // --- Add a station group (search) ---
        const addGroup = new Adw.PreferencesGroup({
            title: _('Add a station'),
            description: _('Search Transport for London by name, then add a result.'),
        });
        page.add(addGroup);

        const searchRow = new Adw.EntryRow({
            title: _('Search stations (e.g. Oxford Circus)'),
        });
        const searchBtn = new Gtk.Button({
            icon_name: 'system-search-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Search'),
        });
        searchBtn.add_css_class('flat');
        searchRow.add_suffix(searchBtn);
        addGroup.add(searchRow);

        // Result rows live below the search entry and are rebuilt each search.
        let resultRows = [];
        const clearResults = () => {
            for (const row of resultRows)
                addGroup.remove(row);
            resultRows = [];
        };
        const addInfoRow = (title, subtitle) => {
            const row = new Adw.ActionRow({title, subtitle: subtitle || ''});
            addGroup.add(row);
            resultRows.push(row);
        };
        const renderResults = matches => {
            clearResults();
            if (matches.length === 0) {
                addInfoRow(_('No matches'), _('Try a different name.'));
                return;
            }
            for (const m of matches) {
                const subtitle = [m.modes?.join(', '), m.id]
                    .filter(Boolean).join('  ·  ');
                const row = new Adw.ActionRow({title: m.name, subtitle});
                const add = new Gtk.Button({
                    icon_name: 'list-add-symbolic',
                    valign: Gtk.Align.CENTER,
                    tooltip_text: _('Add'),
                });
                add.add_css_class('flat');
                add.connect('clicked', () => {
                    if (addStation(m.id, m.name)) {
                        renderStations();
                        add.icon_name = 'object-select-symbolic';
                        add.sensitive = false;
                    }
                });
                row.add_suffix(add);
                addGroup.add(row);
                resultRows.push(row);
            }
        };

        let searching = false;
        const runSearch = async () => {
            const query = searchRow.get_text().trim();
            if (!query || searching)
                return;
            searching = true;
            searchBtn.sensitive = false;
            clearResults();
            addInfoRow(_('Searching…'), '');

            try {
                const matches = await this._searchStations(session, settings, query);
                renderResults(matches);
            } catch (e) {
                clearResults();
                addInfoRow(_('Search failed'), e.message || String(e));
            } finally {
                searching = false;
                searchBtn.sensitive = true;
            }
        };
        searchRow.connect('entry-activated', runSearch);
        searchBtn.connect('clicked', runSearch);

        // --- API group ---
        const apiGroup = new Adw.PreferencesGroup({
            title: _('TfL API'),
            description: _('An app key is optional but recommended for higher rate limits. Get one at api-portal.tfl.gov.uk.'),
        });
        page.add(apiGroup);

        const keyRow = new Adw.PasswordEntryRow({
            title: _('App key'),
            text: settings.get_string('app-key'),
        });
        keyRow.connect('changed', () =>
            settings.set_string('app-key', keyRow.get_text().trim()));
        apiGroup.add(keyRow);

        // --- Display group ---
        const displayGroup = new Adw.PreferencesGroup({
            title: _('Display'),
        });
        page.add(displayGroup);

        const maxRow = new Adw.SpinRow({
            title: _('Maximum departures'),
            subtitle: _('Per station.'),
            adjustment: new Gtk.Adjustment({
                lower: 1, upper: 25, step_increment: 1, page_increment: 5,
                value: settings.get_int('max-departures'),
            }),
        });
        settings.bind('max-departures', maxRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(maxRow);

        const refreshRow = new Adw.SpinRow({
            title: _('Auto-refresh interval'),
            subtitle: _('Seconds between refreshes while the board is open.'),
            adjustment: new Gtk.Adjustment({
                lower: 10, upper: 300, step_increment: 5, page_increment: 30,
                value: settings.get_int('refresh-interval'),
            }),
        });
        settings.bind('refresh-interval', refreshRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        displayGroup.add(refreshRow);

        window.set_default_size(560, 720);
    }

    // Query the TfL StopPoint search endpoint and return the matches array.
    async _searchStations(session, settings, query) {
        const appKey = settings.get_string('app-key').trim();
        const params = ['maxResults=12'];
        if (appKey)
            params.push(`app_key=${encodeURIComponent(appKey)}`);
        const url = `https://api.tfl.gov.uk/StopPoint/Search/${encodeURIComponent(query)}?${params.join('&')}`;

        const message = Soup.Message.new('GET', url);
        message.request_headers.append('User-Agent', 'gnome-shell-tfl-departures');

        const bytes = await session.send_and_read_async(
            message, GLib.PRIORITY_DEFAULT, null);

        const status = message.get_status();
        if (status !== Soup.Status.OK)
            throw new Error(`HTTP ${status}`);

        const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
        return Array.isArray(data.matches) ? data.matches : [];
    }
}
