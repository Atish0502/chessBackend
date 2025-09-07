// Simple Working Socket Handler
const Chess = require('chess.js');

module.exports = io => {
    // Simple game storage
    const games = new Map();
    
    io.on('connection', socket => {
        console.log(`✅ Player connected: ${socket.id}`);
        
        let currentGame = null;
        let playerColor = null;
        
        socket.on('joinGame', (data) => {
            const gameCode = data.code;
            console.log(`🎮 Player ${socket.id} joining game: ${gameCode}`);
            
            socket.join(gameCode);
            currentGame = gameCode;
            
            if (!games.has(gameCode)) {
                // Create new game
                const game = {
                    id: gameCode,
                    white: null,
                    black: null,
                    chess: new Chess(),
                    started: false,
                    chat: []
                };
                games.set(gameCode, game);
                console.log(`📝 Created new game: ${gameCode}`);
            }
            
            const game = games.get(gameCode);
            
            // Assign player color
            if (!game.white) {
                game.white = socket.id;
                playerColor = 'white';
                console.log(`⚪ ${socket.id} assigned WHITE`);
                
                socket.emit('gameJoined', { 
                    color: 'white',
                    waiting: !game.black 
                });
                
            } else if (!game.black) {
                game.black = socket.id;
                playerColor = 'black';
                console.log(`⚫ ${socket.id} assigned BLACK`);
                
                socket.emit('gameJoined', { 
                    color: 'black',
                    waiting: false 
                });
                
                // Start the game
                game.started = true;
                console.log(`🚀 Game ${gameCode} started!`);
                
                io.to(gameCode).emit('gameStarted', {
                    color: playerColor
                });
                
            } else {
                // Game is full
                socket.emit('gameError', { 
                    message: 'Game is full' 
                });
                return;
            }
        });
        
        socket.on('move', (moveData) => {
            if (!currentGame) return;
            
            const game = games.get(currentGame);
            if (!game || !game.started) return;
            
            // Check if it's player's turn
            const isWhiteTurn = game.chess.turn() === 'w';
            const isPlayersTurn = (isWhiteTurn && playerColor === 'white') || 
                                 (!isWhiteTurn && playerColor === 'black');
            
            if (!isPlayersTurn) {
                socket.emit('moveRejected', { 
                    reason: 'Not your turn' 
                });
                return;
            }
            
            // Try to make the move
            const move = game.chess.move({
                from: moveData.from,
                to: moveData.to,
                promotion: moveData.promotion || 'q'
            });
            
            if (move) {
                console.log(`♟️ Valid move in ${currentGame}: ${move.san}`);
                
                // Broadcast move to all players
                io.to(currentGame).emit('moveMade', {
                    move: move,
                    fen: game.chess.fen(),
                    pgn: game.chess.pgn()
                });
                
                // Check for game over
                if (game.chess.isGameOver()) {
                    let winner = 'draw';
                    let reason = 'Draw';
                    
                    if (game.chess.isCheckmate()) {
                        winner = game.chess.turn() === 'w' ? 'black' : 'white';
                        reason = 'Checkmate';
                    } else if (game.chess.isStalemate()) {
                        reason = 'Stalemate';
                    } else if (game.chess.isThreefoldRepetition()) {
                        reason = 'Threefold repetition';
                    }
                    
                    io.to(currentGame).emit('gameOver', {
                        winner: winner,
                        reason: reason
                    });
                    
                    console.log(`🏁 Game ${currentGame} ended: ${reason}`);
                }
                
            } else {
                socket.emit('moveRejected', { 
                    reason: 'Illegal move' 
                });
            }
        });
        
        socket.on('chatMessage', (data) => {
            if (!currentGame || !playerColor) return;
            
            const game = games.get(currentGame);
            if (!game) return;
            
            const message = {
                color: playerColor,
                text: data.msg.substring(0, 100) // Limit message length
            };
            
            game.chat.push(message);
            io.to(currentGame).emit('chatMessage', message);
            
            console.log(`💬 Chat in ${currentGame}: ${playerColor} said "${message.text}"`);
        });
        
        socket.on('disconnect', () => {
            console.log(`❌ Player disconnected: ${socket.id}`);
            
            if (currentGame) {
                const game = games.get(currentGame);
                if (game) {
                    // Notify other players
                    socket.to(currentGame).emit('playerDisconnected');
                    
                    // Clean up if both players disconnect
                    if (game.white === socket.id) game.white = null;
                    if (game.black === socket.id) game.black = null;
                    
                    if (!game.white && !game.black) {
                        games.delete(currentGame);
                        console.log(`🗑️ Deleted empty game: ${currentGame}`);
                    }
                }
            }
        });
    });
    
    console.log('🎮 Simple chess socket handler initialized');
};
