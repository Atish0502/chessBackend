// PRODUCTION CHESS BACKEND - ROBUST & ERROR-FREE
const Chess = require('chess.js');

// Game state storage
const activeGames = new Map();
const playerSockets = new Map(); // socketId -> gameId mapping
const gameTimers = new Map();

// Constants
const GAME_TIMER_SECONDS = 600; // 10 minutes per player
const CHAT_MESSAGE_LIMIT = 200;
const CHAT_HISTORY_LIMIT = 50;
const RECONNECT_TIMEOUT = 30000; // 30 seconds

module.exports = (io) => {
    console.log('🚀 Production Chess Server Starting...');
    
    io.on('connection', (socket) => {
        console.log(`🔌 Player connected: ${socket.id}`);
        
        // Clean up on disconnect
        socket.on('disconnect', () => {
            handlePlayerDisconnect(socket.id);
        });
        
        // Handle game join
        socket.on('joinGame', (data) => {
            handleJoinGame(socket, data);
        });
        
        // Handle chess moves
        socket.on('makeMove', (data) => {
            handleMakeMove(socket, data);
        });
        
        // Handle chat messages
        socket.on('sendChat', (data) => {
            handleSendChat(socket, data);
        });
        
        // Handle player reconnection
        socket.on('reconnect', (data) => {
            handleReconnect(socket, data);
        });
    });
    
    // Game Management Functions
    
    function handleJoinGame(socket, data) {
        try {
            if (!data || !data.code) {
                socket.emit('error', {
                    code: 'INVALID_REQUEST',
                    message: 'Game code is required'
                });
                return;
            }
            
            const gameCode = data.code.toUpperCase();
            console.log(`🎮 Player ${socket.id} joining game: ${gameCode}`);
            
            // Leave any existing game
            leaveCurrentGame(socket.id);
            
            let game = activeGames.get(gameCode);
            
            if (!game) {
                // Create new game
                game = createNewGame(gameCode);
                activeGames.set(gameCode, game);
                console.log(`📝 Created new game: ${gameCode}`);
            }
            
            // Try to join as white first, then black
            let playerColor = null;
            
            if (!game.white) {
                game.white = socket.id;
                playerColor = 'white';
                console.log(`⚪ ${socket.id} joined as WHITE`);
            } else if (!game.black) {
                game.black = socket.id;
                playerColor = 'black';
                console.log(`⚫ ${socket.id} joined as BLACK`);
                
                // Game is now full, start it
                game.status = 'playing';
                startGameTimer(gameCode);
                
                // Notify both players
                notifyGameStarted(gameCode);
            } else {
                // Game is full
                socket.emit('error', {
                    code: 'GAME_FULL',
                    message: 'This game is already full'
                });
                return;
            }
            
            // Join socket room and track player
            socket.join(gameCode);
            playerSockets.set(socket.id, gameCode);
            
            // Send game state to joining player
            socket.emit('gameJoined', {
                color: playerColor,
                gameState: getGameStateForClient(game)
            });
            
        } catch (error) {
            console.error('❌ Error in joinGame:', error);
            socket.emit('error', {
                code: 'JOIN_ERROR',
                message: 'Failed to join game'
            });
        }
    }
    
    function handleMakeMove(socket, data) {
        try {
            const gameCode = playerSockets.get(socket.id);
            if (!gameCode) {
                socket.emit('error', {
                    code: 'NOT_IN_GAME',
                    message: 'You are not in a game'
                });
                return;
            }
            
            const game = activeGames.get(gameCode);
            if (!game || game.status !== 'playing') {
                socket.emit('moveRejected', {
                    reason: 'game_not_active',
                    move: data
                });
                return;
            }
            
            // Verify it's the player's turn
            const playerColor = getPlayerColor(socket.id, game);
            const currentTurn = game.chess.turn() === 'w' ? 'white' : 'black';
            
            if (playerColor !== currentTurn) {
                socket.emit('moveRejected', {
                    reason: 'not_your_turn',
                    move: data
                });
                return;
            }
            
            // Validate and execute move
            const move = game.chess.move({
                from: data.from,
                to: data.to,
                promotion: data.promotion || 'q'
            });
            
            if (!move) {
                socket.emit('moveRejected', {
                    reason: 'illegal',
                    move: data
                });
                return;
            }
            
            // Move is valid - update game state
            game.lastMoveTime = Date.now();
            console.log(`♟️ Valid move in ${gameCode}: ${move.san}`);
            
            // Check for game end conditions
            let gameEnded = false;
            if (game.chess.isGameOver()) {
                gameEnded = true;
                game.status = 'finished';
                stopGameTimer(gameCode);
                
                let result = { winner: 'draw', reason: 'draw' };
                if (game.chess.isCheckmate()) {
                    result.winner = game.chess.turn() === 'w' ? 'black' : 'white';
                    result.reason = 'checkmate';
                } else if (game.chess.isStalemate()) {
                    result.reason = 'stalemate';
                } else if (game.chess.isThreefoldRepetition()) {
                    result.reason = 'threefold_repetition';
                } else if (game.chess.isInsufficientMaterial()) {
                    result.reason = 'insufficient_material';
                }
                
                game.result = result;
            }
            
            // Broadcast move to all players in game
            io.to(gameCode).emit('moveExecuted', {
                move: {
                    from: data.from,
                    to: data.to,
                    san: move.san
                },
                gameState: getGameStateForClient(game)
            });
            
            // Broadcast game end if applicable
            if (gameEnded) {
                io.to(gameCode).emit('gameEnded', {
                    result: game.result.winner,
                    reason: game.result.reason,
                    gameState: getGameStateForClient(game)
                });
                
                // Clean up game after 30 seconds
                setTimeout(() => {
                    cleanupGame(gameCode);
                }, 30000);
            }
            
        } catch (error) {
            console.error('❌ Error in makeMove:', error);
            socket.emit('error', {
                code: 'MOVE_ERROR',
                message: 'Failed to process move'
            });
        }
    }
    
    function handleSendChat(socket, data) {
        try {
            const gameCode = playerSockets.get(socket.id);
            if (!gameCode) return;
            
            const game = activeGames.get(gameCode);
            if (!game) return;
            
            if (!data || !data.message || typeof data.message !== 'string') {
                return;
            }
            
            const message = data.message.trim().substring(0, CHAT_MESSAGE_LIMIT);
            if (message.length === 0) return;
            
            const playerColor = getPlayerColor(socket.id, game);
            if (!playerColor) return;
            
            const chatMessage = {
                color: playerColor,
                message: message,
                timestamp: Date.now()
            };
            
            // Add to game chat history
            game.chat.push(chatMessage);
            if (game.chat.length > CHAT_HISTORY_LIMIT) {
                game.chat.shift();
            }
            
            // Broadcast to all players in game
            io.to(gameCode).emit('chatReceived', chatMessage);
            
            console.log(`💬 Chat in ${gameCode}: ${playerColor} said "${message}"`);
            
        } catch (error) {
            console.error('❌ Error in sendChat:', error);
        }
    }
    
    function handlePlayerDisconnect(socketId) {
        try {
            console.log(`❌ Player disconnected: ${socketId}`);
            
            const gameCode = playerSockets.get(socketId);
            if (!gameCode) return;
            
            const game = activeGames.get(gameCode);
            if (!game) return;
            
            const playerColor = getPlayerColor(socketId, game);
            if (!playerColor) return;
            
            console.log(`🔌 ${playerColor} player disconnected from ${gameCode}`);
            
            // Notify other players
            io.to(gameCode).emit('playerDisconnected', {
                color: playerColor,
                reconnectTimeout: RECONNECT_TIMEOUT / 1000
            });
            
            // Set reconnection timeout
            setTimeout(() => {
                const currentGame = activeGames.get(gameCode);
                if (currentGame && currentGame.status === 'playing') {
                    // Player didn't reconnect, end game
                    currentGame.status = 'finished';
                    currentGame.result = {
                        winner: playerColor === 'white' ? 'black' : 'white',
                        reason: 'disconnect'
                    };
                    
                    stopGameTimer(gameCode);
                    
                    io.to(gameCode).emit('gameEnded', {
                        result: currentGame.result.winner,
                        reason: currentGame.result.reason,
                        gameState: getGameStateForClient(currentGame)
                    });
                    
                    cleanupGame(gameCode);
                }
            }, RECONNECT_TIMEOUT);
            
        } catch (error) {
            console.error('❌ Error in handlePlayerDisconnect:', error);
        } finally {
            playerSockets.delete(socketId);
        }
    }
    
    function handleReconnect(socket, data) {
        try {
            if (!data || !data.gameCode) return;
            
            const gameCode = data.gameCode.toUpperCase();
            const game = activeGames.get(gameCode);
            
            if (!game) {
                socket.emit('error', {
                    code: 'GAME_NOT_FOUND',
                    message: 'Game not found'
                });
                return;
            }
            
            // Try to reconnect as existing player
            let playerColor = null;
            if (game.white === socket.id) {
                playerColor = 'white';
            } else if (game.black === socket.id) {
                playerColor = 'black';
            }
            
            if (playerColor) {
                socket.join(gameCode);
                playerSockets.set(socket.id, gameCode);
                
                socket.emit('gameJoined', {
                    color: playerColor,
                    gameState: getGameStateForClient(game)
                });
                
                console.log(`🔄 ${playerColor} reconnected to ${gameCode}`);
            }
            
        } catch (error) {
            console.error('❌ Error in handleReconnect:', error);
        }
    }
    
    // Helper Functions
    
    function createNewGame(gameCode) {
        return {
            id: gameCode,
            white: null,
            black: null,
            status: 'waiting', // waiting, playing, finished
            chess: new Chess(),
            whiteTime: GAME_TIMER_SECONDS,
            blackTime: GAME_TIMER_SECONDS,
            lastMoveTime: Date.now(),
            chat: [],
            result: null
        };
    }
    
    function getGameStateForClient(game) {
        return {
            fen: game.chess.fen(),
            whiteTime: game.whiteTime,
            blackTime: game.blackTime,
            turn: game.chess.turn(),
            status: game.status,
            pgn: game.chess.pgn(),
            chat: game.chat,
            result: game.result
        };
    }
    
    function getPlayerColor(socketId, game) {
        if (game.white === socketId) return 'white';
        if (game.black === socketId) return 'black';
        return null;
    }
    
    function leaveCurrentGame(socketId) {
        const currentGameCode = playerSockets.get(socketId);
        if (currentGameCode) {
            const game = activeGames.get(currentGameCode);
            if (game) {
                if (game.white === socketId) game.white = null;
                if (game.black === socketId) game.black = null;
            }
            playerSockets.delete(socketId);
        }
    }
    
    function notifyGameStarted(gameCode) {
        const game = activeGames.get(gameCode);
        if (!game) return;
        
        console.log(`🚀 Game ${gameCode} started!`);
        
        io.to(gameCode).emit('gameStarted', {
            gameState: getGameStateForClient(game)
        });
    }
    
    function startGameTimer(gameCode) {
        if (gameTimers.has(gameCode)) {
            clearInterval(gameTimers.get(gameCode));
        }
        
        const interval = setInterval(() => {
            const game = activeGames.get(gameCode);
            if (!game || game.status !== 'playing') {
                stopGameTimer(gameCode);
                return;
            }
            
            // Decrement time for current player
            const currentTurn = game.chess.turn();
            if (currentTurn === 'w') {
                game.whiteTime = Math.max(0, game.whiteTime - 1);
                if (game.whiteTime === 0) {
                    // White timeout
                    game.status = 'finished';
                    game.result = { winner: 'black', reason: 'timeout' };
                    io.to(gameCode).emit('gameEnded', {
                        result: 'black',
                        reason: 'timeout',
                        gameState: getGameStateForClient(game)
                    });
                    stopGameTimer(gameCode);
                    cleanupGame(gameCode);
                    return;
                }
            } else {
                game.blackTime = Math.max(0, game.blackTime - 1);
                if (game.blackTime === 0) {
                    // Black timeout
                    game.status = 'finished';
                    game.result = { winner: 'white', reason: 'timeout' };
                    io.to(gameCode).emit('gameEnded', {
                        result: 'white',
                        reason: 'timeout',
                        gameState: getGameStateForClient(game)
                    });
                    stopGameTimer(gameCode);
                    cleanupGame(gameCode);
                    return;
                }
            }
            
            // Broadcast timer update
            io.to(gameCode).emit('timerTick', {
                whiteTime: game.whiteTime,
                blackTime: game.blackTime,
                turn: currentTurn
            });
            
        }, 1000);
        
        gameTimers.set(gameCode, interval);
        console.log(`⏰ Timer started for game ${gameCode}`);
    }
    
    function stopGameTimer(gameCode) {
        if (gameTimers.has(gameCode)) {
            clearInterval(gameTimers.get(gameCode));
            gameTimers.delete(gameCode);
            console.log(`⏰ Timer stopped for game ${gameCode}`);
        }
    }
    
    function cleanupGame(gameCode) {
        try {
            const game = activeGames.get(gameCode);
            if (game) {
                // Remove player mappings
                if (game.white) playerSockets.delete(game.white);
                if (game.black) playerSockets.delete(game.black);
                
                // Stop timer
                stopGameTimer(gameCode);
                
                // Remove game
                activeGames.delete(gameCode);
                
                console.log(`🗑️ Cleaned up game: ${gameCode}`);
            }
        } catch (error) {
            console.error('❌ Error cleaning up game:', error);
        }
    }
    
    // Status logging
    setInterval(() => {
        console.log(`📊 Server Status: ${activeGames.size} active games, ${playerSockets.size} connected players`);
    }, 60000); // Every minute
    
    console.log('✅ Production Chess Server Ready');
};
