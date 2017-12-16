'use strict'

var MAX_PLAYERS_PER_GAME = 4,
	ACTION_POINTS = 4,
	WebSocketServer = require('ws').Server,
	wss = new WebSocketServer({port: 64220}),
	games = [],
	updates = [],
	playerSerial = 0

wss.on('connection', function(ws) {
	var playerId = ++playerSerial,
		lastUpdate = 0,
		currentGame = null

	function parseJson(s) {
		try {
			return JSON.parse(s)
		} catch (e) {
			return {}
		}
	}

	function sendJSON(obj) {
		try {
			ws.send(JSON.stringify(obj))
		} catch (e) {
			leaveGame()
		}
	}

	function sendError(message) {
		sendJSON({error: message})
	}

	function sendAll(obj) {
		var game = currentGame
		if (game) {
			var u = updates[game.id]
			if (!(u instanceof Array)) {
				u = updates[game.id] = []
			}
			u.push(obj)
			var players = game.players
			for (var i = players.length; i--;) {
				players[i].listener();
			}
		}
	}

	function findNextPlayer(game) {
		var players = game.players,
			len = players.length
		if (len < 1) {
			return -1
		}
		var atTurn = game.turn,
			i = 0
		for (; i < len; ++i) {
			var player = players[i]
			if (player.id === atTurn) {
				++i
				break
			}
		}
		return players[i % len]
	}

	function nextMoveOrPlayer(game, player, actionPoints) {
		player.actions -= actionPoints
		if (player.actions < 1) {
			var next = findNextPlayer(game)
			next.actions = next.maxActions
			game.turn = next.id
			sendAll({turn: {next: next.id, actions: next.actions}})
		}
	}

	function getOffset(game, x, y) {
		return Math.round(y * game.height + x) % game.map.length
	}

	function getTile(game, x, y) {
		return game.map[getOffset(game, x, y)]
	}

	function getGold(game, x, y) {
		var offset = getOffset(game, x, y),
			gold = game.loot[offset]
		if (gold > 0) {
			game.loot[offset] = 0
			sendAll({loot: {x: x, y: y}})
		}
		return gold
	}

	function getPlayerByPosition(players, x, y) {
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.x === x && player.y === y) {
				return player
			}
		}
		return null
	}

	function updateClient() {
		var game = currentGame
		if (!game) {
			return
		}
		var ud = updates[game.id],
			len = ud.length
		for (var i = lastUpdate; i < len; ++i) {
			sendJSON(ud[i])
		}
		lastUpdate = len
	}

	function insertPlayer(player, game) {
		var width = game.width,
			height = game.height,
			cx = width >> 1,
			cy = height >> 1,
			a = Math.PI * .5 * game.players.length,
			r = Math.min(width, height) * .4,
			x = Math.round(cx + Math.cos(a) * r),
			y = Math.round(cy + Math.sin(a) * r)
		player.x = x
		player.y = y
	}

	function addPlayerToGame(game) {
		var player = {
			id: playerId,
			gold: 0,
			escaped: false,
			maxActions: ACTION_POINTS,
			actions: ACTION_POINTS,
			listener: updateClient
		}
		insertPlayer(player, game)
		game.players.push(player)
		return player
	}

	function getPlayerFromGame(game) {
		var players = game.players
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.id === playerId) {
				return player
			}
		}
		return null
	}

	function removePlayerFromGame(game, id) {
		var players = game.players
		for (var i = players.length; i--;) {
			var player = players[i]
			if (player.id === id) {
				players.splice(i, 1)
				return true
			}
		}
		return false
	}

	function playerEscape() {
		var game = currentGame,
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('Player not in game')
			return
		}
		if (player.escaped) {
			sendError('Player already escaped')
			return
		}
		player.escaped = true
		sendAll({escaped: {id: player.id}})
		nextMoveOrPlayer(game, player, player.maxActions)
	}

	function playerMove(json) {
		if (!json ||
				typeof json.x === 'undefined' ||
				typeof json.y === 'undefined') {
			sendError('Missing a destination')
			return
		}
		var game = currentGame,
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('Player not in game')
			return
		}
		var width = game.width,
			height = game.height,
			players = game.players,
			x = parseInt(json.x),
			y = parseInt(json.y)
		if (x < 0 || x >= width || y < 0 || y >= height) {
			sendError('Out of bounds')
			return
		} else if (getPlayerByPosition(players, x, y)) {
			sendError('Position alread occupied')
			return
		}
		var cost = Math.abs(x - player.x) + Math.abs(y - player.y),
			gold = getGold(game, x, y)
		player.x = x
		player.y = y
		player.gold += gold
		var move = {
			id: player.id,
			x: x,
			y: y,
			cost: cost,
			gold: gold,
		}
		sendAll({move: move})
		nextMoveOrPlayer(game, player, cost)
	}

	function playerSteal(json) {
		if (!json ||
				typeof json.x === 'undefined' ||
				typeof json.y === 'undefined') {
			sendError('Missing steal coordinates')
			return
		}
		var game = currentGame,
			player
		if (!game || !(player = getPlayerFromGame(game))) {
			sendError('Player not in game')
			return
		}
		var x = parseInt(json.x),
			y = parseInt(json.y),
			players = game.players,
			victim = getPlayerByPosition(players, x, y)
		if (!victim) {
			sendError('Victim not found')
			return
		}
		if (Math.abs(victim.x - player.x) > 1 ||
				Math.abs(victim.y - player.y) > 1) {
			sendError('Victim not in range')
			return
		}
		var tileId = getTile(game, victim.x, victim.y),
			steal = {
				attacker: player.id,
				victim: victim.id,
				goldMoved: 0,
				cost: 1
			},
			handicap = .5 * victim.gold / 100
		if (Math.random() < .5 / getTileBonus(tileId) + handicap) {
			steal.goldMoved = victim.gold
			player.gold += victim.gold
			victim.gold = 0
		}
		sendAll({steal: steal})
		nextMoveOrPlayer(game, player, 1)
	}

	function joinGame(json) {
		if (!json || !json.gameId) {
			sendError('Missing ID')
			return
		}
		var idx = parseInt(json.gameId),
			game
		if (idx < 1 || !(game = games[idx])) {
			sendError('Game does not exist')
			return
		}
		if (game.players.length >= MAX_PLAYERS_PER_GAME) {
			sendError('Already full')
			return
		}
		if (getPlayerFromGame(game)) {
			sendError('You are already in this game')
			return
		}
		currentGame = game
		var newPlayer = addPlayerToGame(game)
		sendJSON({game: currentGame, playerId: playerId})
		sendAll({addPlayer: newPlayer})
	}

	function getTileBonus(tileId) {
		switch (tileId) {
		default:
			return 1 // everything else
		case 1:
		case 2:
		case 3:
		case 4:
			return 3 // wood
		case 5:
		case 6:
		case 7:
			return 2 // stone
		}
	}

	function createGame() {
		if (games[playerId]) {
			sendError('You already created a game')
			return
		}
		currentGame = {
			id: playerId,
			players: [],
			turn: playerId,
			width: 8,
			height: 8,
			map: [
				6, 4, 0, 0, 0, 5, 3, 0,
				0, 0, 1, 4, 0, 2, 6, 4,
				5, 2, 7, 2, 0, 1, 0, 0,
				0, 3, 1, 6, 0, 0, 3, 0,
				0, 0, 0, 1, 0, 3, 0, 5,
				0, 4, 6, 5, 4, 7, 0, 0,
				2, 0, 0, 0, 3, 5, 0, 6,
				0, 3, 2, 1, 0, 0, 4, 0,
			],
			loot: [
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 5, 0, 0, 0, 0, 5, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 10, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 10, 0, 0, 0, 0,
				0, 5, 0, 0, 0, 0, 5, 0,
				0, 0, 0, 0, 0, 0, 0, 0,
			]
		}
		addPlayerToGame(currentGame)
		games[playerId] = currentGame
		updates[playerId] = []
		sendJSON({game: currentGame, playerId: playerId})
	}

	function leaveGame() {
		if (currentGame) {
			removePlayerFromGame(currentGame, playerId)
			if (currentGame.players.length < 1) {
				var idx = currentGame.id
				games.splice(idx, 1)
				updates.splice(idx, 1)
			} else {
				sendAll({remove: playerId})
			}
		}
		currentGame = null
	}

	ws.on('message', function(message) {
		var json = parseJson(message)
		switch (json.cmd) {
		default:
			sendError('Unknown command: ' + json.cmd)
			break
		case 'create':
			createGame()
			break
		case 'leave':
			leaveGame()
			break
		case 'join':
			joinGame(json)
			break
		case 'steal':
			playerSteal(json)
			break
		case 'move':
			playerMove(json)
			break
		case 'escape':
			playerEscape()
			break
		}
	})

	ws.on('close', function() {
		leaveGame()
	})
})
