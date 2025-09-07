// Add timer state to each game
// Add chat state to each game (in-memory, max 7 messages per player)
const INITIAL_TIME = 600; // 10 minutes in seconds
const Chess = require('chess.js'); // Add server-side chess validation

// Store intervals for each game
const timerIntervals = {};

module.exports = io => {
    io.on('connection', socket => {
        console.log('New socket connection');

        let currentCode = null;
        let lastTurn = 'w';
        let playerColor = null;

        socket.on('setColor', function(color) {
            playerColor = color;
        });

        socket.on('move', function(data) {
            if (!global.games[currentCode]) return;
            if (!global.games[currentCode].running) return; // Only allow moves when game is running
            
            const game = global.games[currentCode];
            
            // Server-side move validation using chess.js
            if (!game.chessInstance) {
                game.chessInstance = new Chess(); // Initialize chess instance if not exists
            }
            
            console.log(`Move received in game ${currentCode}:`, data);
            
            // Validate move server-side
            const move = game.chessInstance.move({
                from: data.from,
                to: data.to,
                promotion: data.promotion || 'q'
            });
            
            if (!move) {
                console.log('Invalid move rejected:', data);
                socket.emit('invalidMove', { move: data, reason: 'Illegal move' });
                return;
            }
            
            // Move is valid, update turn
            if (game.turn === 'w') {
                game.turn = 'b';
            } else {
                game.turn = 'w';
            }
            
            // Check for game end conditions
            if (game.chessInstance.in_checkmate()) {
                game.running = false;
                const winner = game.chessInstance.turn() === 'w' ? 'black' : 'white';
                io.to(currentCode).emit('gameOver', { winner, reason: 'checkmate' });
            } else if (game.chessInstance.in_draw()) {
                game.running = false;
                io.to(currentCode).emit('gameOver', { winner: 'draw', reason: 'draw' });
            }
            
            // Emit the validated move
            io.to(currentCode).emit('newMove', {
                move: data,
                whiteTime: game.whiteTime,
                blackTime: game.blackTime,
                turn: game.turn,
                fen: game.chessInstance.fen(),
                pgn: game.chessInstance.pgn()
            });
            
            // Immediately emit a timerUpdate so the UI updates right after the move
            io.to(currentCode).emit('timerUpdate', {
                whiteTime: game.whiteTime,
                blackTime: game.blackTime,
                turn: game.turn
            });
        });

        socket.on('joinGame', function(data) {
            currentCode = data.code;
            socket.join(currentCode);
            
            console.log(`Player ${socket.id} trying to join game ${currentCode}`);
            
            if (!global.games[currentCode]) {
                // First player creates the game and gets white
                global.games[currentCode] = {
                    whiteTime: INITIAL_TIME,
                    blackTime: INITIAL_TIME,
                    turn: 'w',
                    running: false,
                    chat: [],
                    players: 1,
                    whitePlayer: socket.id,
                    blackPlayer: null,
                    chessInstance: new Chess()
                };
                playerColor = 'white';
                console.log(`✅ Game ${currentCode} created, player ${socket.id} is WHITE, waiting for BLACK player`);
                socket.emit('colorAssigned', { color: 'white', waiting: true });
                return;
            }
            
            // Game exists, check if we can join as second player
            const game = global.games[currentCode];
            
            if (game.players === 1 && !game.blackPlayer) {
                // Second player joins as black
                game.players = 2;
                game.blackPlayer = socket.id;
                game.running = true;
                playerColor = 'black';
                
                console.log(`✅ Game ${currentCode} STARTED! White: ${game.whitePlayer}, Black: ${game.blackPlayer}`);
                
                // Notify both players
                io.to(game.whitePlayer).emit('colorAssigned', { color: 'white', waiting: false });
                io.to(game.blackPlayer).emit('colorAssigned', { color: 'black', waiting: false });
                
                // Start the game for both players
                io.to(currentCode).emit('startGame', {
                    whiteTime: game.whiteTime,
                    blackTime: game.blackTime,
                    chat: game.chat,
                    fen: game.chessInstance.fen()
                });
                
                // Start timer interval
                timerIntervals[currentCode] = setInterval(() => {
                    if (!global.games[currentCode] || !global.games[currentCode].running) return;
                    
                    const g = global.games[currentCode];
                    if (g.turn === 'w') {
                        if (g.whiteTime > 0) {
                            g.whiteTime--;
                            if (g.whiteTime <= 0) {
                                g.whiteTime = 0;
                                g.running = false;
                                io.to(currentCode).emit('gameOver', { winner: 'black', reason: 'timeout' });
                            }
                        }
                    } else {
                        if (g.blackTime > 0) {
                            g.blackTime--;
                            if (g.blackTime <= 0) {
                                g.blackTime = 0;
                                g.running = false;
                                io.to(currentCode).emit('gameOver', { winner: 'white', reason: 'timeout' });
                            }
                        }
                    }
                    io.to(currentCode).emit('timerUpdate', {
                        whiteTime: g.whiteTime,
                        blackTime: g.blackTime,
                        turn: g.turn
                    });
                }, 1000);
            } else {
                // Game is full or player already in game
                console.log(`❌ Game ${currentCode} is full or player already connected`);
                socket.emit('gameFull', { message: 'Game is full' });
            }
        });

        // Chat message handler
        socket.on('chatMessage', function(data) {
            if (!global.games[currentCode]) return;
            const msgObj = {
                msg: data.msg,
                color: data.color,
                ts: Date.now()
            };
            global.games[currentCode].chat.push(msgObj);
            // Keep only the last 28 messages (14 per player max, but in order)
            if (global.games[currentCode].chat.length > 28) global.games[currentCode].chat.shift();
            io.to(currentCode).emit('chatUpdate', {
                chat: global.games[currentCode].chat
            });
        });

        socket.on('disconnect', function() {
            console.log('socket disconnected');
            if (currentCode && global.games[currentCode]) {
                // Decrease player count
                global.games[currentCode].players--;
                
                if (global.games[currentCode].players <= 0) {
                    // No players left, delete game
                    console.log(`Game ${currentCode} deleted - no players left`);
                    delete global.games[currentCode];
                    if (timerIntervals[currentCode]) {
                        clearInterval(timerIntervals[currentCode]);
                        delete timerIntervals[currentCode];
                    }
                } else {
                    // Still has players, but notify of disconnect
                    console.log(`Player left game ${currentCode}, ${global.games[currentCode].players} players remaining`);
                    io.to(currentCode).emit('gameOverDisconnect');
                    global.games[currentCode].running = false;
                }
            }
        });
    });
};
