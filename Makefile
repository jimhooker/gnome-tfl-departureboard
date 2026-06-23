UUID    := tfl-departures@jameshooker.com
EXT_DIR := $(HOME)/.local/share/gnome-shell/extensions/$(UUID)

# Files that make up the extension (shipped in the zip / copied on install).
SOURCES := extension.js prefs.js stylesheet.css metadata.json schemas icons

.PHONY: schemas install link uninstall enable disable prefs pack clean

# Compile the GSettings schema (needed before the extension can load).
schemas:
	glib-compile-schemas schemas

# Copy a self-contained build into the user's extensions directory.
install: schemas
	rm -rf "$(EXT_DIR)"
	mkdir -p "$(EXT_DIR)"
	cp -r $(SOURCES) "$(EXT_DIR)/"
	@echo "Installed to $(EXT_DIR)"
	@echo "Log out / back in (Wayland), then: make enable"

# Develop in place: symlink this checkout so edits take effect on next reload.
link: schemas
	rm -rf "$(EXT_DIR)"
	ln -s "$(CURDIR)" "$(EXT_DIR)"
	@echo "Symlinked $(EXT_DIR) -> $(CURDIR)"
	@echo "Log out / back in (Wayland), then: make enable"

uninstall:
	rm -rf "$(EXT_DIR)"

enable:
	gnome-extensions enable $(UUID)

disable:
	gnome-extensions disable $(UUID)

prefs:
	gnome-extensions prefs $(UUID)

# Build the distributable zip for extensions.gnome.org.
pack:
	gnome-extensions pack --force --extra-source=icons .
	@echo "Built $(UUID).shell-extension.zip"

clean:
	rm -f schemas/gschemas.compiled *.shell-extension.zip
