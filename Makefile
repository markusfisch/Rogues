HTDOCS_DIR = htdocs
HTDOCS_HOST = hhsw.de@ssh.strato.de:sites/rogues/
SERVER_DIR = server
SERVER_HOST = m9h@menkent.uberspace.de:rogues/
ATLAS = $(HTDOCS_DIR)/atlas.png
SPRITES = sprites/*
OPTIONS = \
	--recursive \
	--links \
	--update \
	--delete-after \
	--times \
	--compress

all: front back

front: $(HTDOCS_DIR) $(ATLAS)
	rsync $(OPTIONS) $(HTDOCS_DIR)/* $(HTDOCS_HOST)

back: $(SERVER_DIR)
	rsync $(OPTIONS) $(SERVER_DIR)/* $(SERVER_HOST)

$(ATLAS): $(SPRITES)
	cd $(HTDOCS_DIR) && \
		MAX_SIZE=1024 \
			MIN_SIZE=1024 \
			MARGIN=4 \
			EXPAND='tile_*' \
			mkatlas ../$(SPRITES) | \
		patchatlas index.html
	convert $(ATLAS) \
		-background black \
		-alpha Remove $(ATLAS) \
		-compose Copy_Opacity \
		-composite $(ATLAS)
