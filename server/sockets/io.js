// Professional chess.com/lichess-inspired implementation
const INITIAL_TIME = 600; // 10 minutes in seconds
const Chess = require('chess.js'); // Server-side validation

// Store game intervals and state
const gameTimers = new Map();
const gameStates = new Map();

module.exports = io => {
    io.on('connection', socket => {
        console.log(`🔌 Socket connected: ${socket.id}`);
        
        let currentGameId = null;
        let playerColor = null;

        // Join game handler - CRITICAL LOGIC
        socket.on('joinGame', function(data) {
            const gameId = data.code;
            currentGameId = gameId;
            
            console.log(`🎮 Player ${socket.id} joining game ${gameId}`);
            socket.join(gameId);
            
            // Initialize or join existing game
            if (!gameStates.has(gameId)) {
                // Create new game - first player is WHITE
                const gameState = {
                    id: gameId,
                    whitePlayer: socket.id,
                    blackPlayer: null,
                    playerCount: 1,
                    whiteTime: INITIAL_TIME,
                    blackTime: INITIAL_TIME,
                    turn: 'w',
                    isRunning: false,
                    chess: new Chess(),
                    chat: [],
                    lastMoveTime: Date.now()
                };
                
                gameStates.set(gameId, gameState);
                playerColor = 'white';
                
                console.log(`✅ Game ${gameId} created, ${socket.id} is WHITE`);
                socket.emit('gameJoined', { 
                    color: 'white', 
                    waiting: true,
                    gameState: {
                        fen: gameState.chess.fen(),
                        whiteTime: gameState.whiteTime,
                        blackTime: gameState.blackTime,
                        turn: gameState.turn
                    }
                });
                
            } else {
                const gameState = gameStates.get(gameId);
                
                if (gameState.playerCount === 1 && !gameState.blackPlayer) {
                    // Second player joins as BLACK
                    gameState.blackPlayer = socket.id;
                    gameState.playerCount = 2;
                    gameState.isRunning = true;
                    gameState.lastMoveTime = Date.now();
                    playerColor = 'black';
                    
                    console.log(`🚀 Game ${gameId} STARTED! White: ${gameState.whitePlayer}, Black: ${gameState.blackPlayer}`);
                    
                    // Notify both players game has started
                    io.to(gameState.whitePlayer).emit('gameStarted', { 
                        color: 'white',
                        gameState: {
                            fen: gameState.chess.fen(),
                            whiteTime: gameState.whiteTime,
                            blackTime: gameState.blackTime,
                            turn: gameState.turn,
                            chat: gameState.chat
                        }
                    });
                    
                    io.to(gameState.blackPlayer).emit('gameStarted', { 
                        color: 'black',
                        gameState: {
                            fen: gameState.chess.fen(),
                            whiteTime: gameState.whiteTime,
                            blackTime: gameState.blackTime,
                            turn: gameState.turn,
                            chat: gameState.chat
                        }
                    });
                    
                    // Start the game timer
                    startGameTimer(gameId);
                    
                } else {
                    // Game is full or player reconnecting
                    console.log(`❌ Game ${gameId} is full or already joined`);
                    socket.emit('gameError', { message: 'Game is full' });
                }
            }
        });

        // Move handler - SERVER VALIDATES ALL MOVES
        socket.on('move', function(moveData) {
            if (!currentGameId || !gameStates.has(currentGameId)) return;
            
            const gameState = gameStates.get(currentGameId);
            if (!gameState.isRunning) return;
            
            console.log(`♟️ Move attempt in ${currentGameId}:`, moveData);
            
            // Validate move server-side
            const move = gameState.chess.move({
                from: moveData.from,
                to: moveData.to,
                promotion: moveData.promotion || 'q'
            });
            
            if (!move) {
                console.log(`❌ Invalid move rejected:`, moveData);
                socket.emit('moveRejected', { move: moveData, reason: 'Illegal move' });
                return;
            }
            
            // Move is valid - update game state
            gameState.turn = gameState.chess.turn();
            gameState.lastMoveTime = Date.now();
            
            console.log(`✅ Move accepted: ${move.san}`);
            
            // Check for game end
            if (gameState.chess.isGameOver()) {
                gameState.isRunning = false;
                stopGameTimer(currentGameId);
                
                let result = { winner: null, reason: 'unknown' };
                if (gameState.chess.isCheckmate()) {
                    result.winner = gameState.chess.turn() === 'w' ? 'black' : 'white';
                    result.reason = 'checkmate';
                } else if (gameState.chess.isDraw()) {
                    result.winner = 'draw';
                    result.reason = 'draw';
                }
                
                io.to(currentGameId).emit('gameOver', result);
            }
            
            // Broadcast move to all players in game
            io.to(currentGameId).emit('moveMade', {
                move: moveData,
                san: move.san,
                fen: gameState.chess.fen(),
                pgn: gameState.chess.pgn(),
                whiteTime: gameState.whiteTime,
                blackTime: gameState.blackTime,
                turn: gameState.turn
            });
        });

        // Chat handler
        socket.on('chatMessage', function(data) {
            if (!currentGameId || !gameStates.has(currentGameId)) return;
            
            const gameState = gameStates.get(currentGameId);
            const message = {
                color: playerColor,
                text: data.msg,
                timestamp: Date.now()
            };
            
            gameState.chat.push(message);
            if (gameState.chat.length > 20) gameState.chat.shift(); // Limit chat history
            
            io.to(currentGameId).emit('chatMessage', message);
        });

        // Disconnect handler
        socket.on('disconnect', function() {
            console.log(`🔌 Socket disconnected: ${socket.id}`);
            
            if (currentGameId && gameStates.has(currentGameId)) {
                const gameState = gameStates.get(currentGameId);
                
                if (gameState.whitePlayer === socket.id || gameState.blackPlayer === socket.id) {
                    // Player left - end the game
                    gameState.isRunning = false;
                    stopGameTimer(currentGameId);
                    
                    io.to(currentGameId).emit('playerDisconnected');
                    gameStates.delete(currentGameId);
                }
            }
        });
    });

    // Timer management functions
    function startGameTimer(gameId) {
        if (gameTimers.has(gameId)) {
            clearInterval(gameTimers.get(gameId));
        }
        
        const interval = setInterval(() => {
            const gameState = gameStates.get(gameId);
            if (!gameState || !gameState.isRunning) {
                stopGameTimer(gameId);
                return;
            }
            
            // Decrement time for current player
            if (gameState.turn === 'w') {
                gameState.whiteTime = Math.max(0, gameState.whiteTime - 1);
                if (gameState.whiteTime === 0) {
                    gameState.isRunning = false;
                    io.to(gameId).emit('gameOver', { winner: 'black', reason: 'timeout' });
                    stopGameTimer(gameId);
                    return;
                }
            } else {
                gameState.blackTime = Math.max(0, gameState.blackTime - 1);
                if (gameState.blackTime === 0) {
                    gameState.isRunning = false;
                    io.to(gameId).emit('gameOver', { winner: 'white', reason: 'timeout' });
                    stopGameTimer(gameId);
                    return;
                }
            }
            
            // Broadcast timer update
            io.to(gameId).emit('timerUpdate', {
                whiteTime: gameState.whiteTime,
                blackTime: gameState.blackTime,
                turn: gameState.turn
            });
            
        }, 1000);
        
        gameTimers.set(gameId, interval);
        console.log(`⏰ Timer started for game ${gameId}`);
    }
    
    function stopGameTimer(gameId) {
        if (gameTimers.has(gameId)) {
            clearInterval(gameTimers.get(gameId));
            gameTimers.delete(gameId);
            console.log(`⏰ Timer stopped for game ${gameId}`);
        }
    }
};
