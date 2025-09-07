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
            
            if (!global.games[currentCode]) {
                // First player creates the game and gets white
                global.games[currentCode] = {
                    whiteTime: INITIAL_TIME,
                    blackTime: INITIAL_TIME,
                    turn: 'w',
                    running: false, // Don't start until 2 players
                    chat: [],
                    players: 1,
                    whitePlayer: socket.id, // Track who is white
                    blackPlayer: null,
                    chessInstance: new Chess() // Server-side game state
                };
                playerColor = 'white';
                console.log(`Game ${currentCode} created, player ${socket.id} assigned white`);
                socket.emit('colorAssigned', { color: 'white', waiting: true });
                return;
            }
            
            // Second player joins and gets black
            if (global.games[currentCode].players < 2) {
                global.games[currentCode].players = 2;
                global.games[currentCode].blackPlayer = socket.id;
                global.games[currentCode].running = true;
                playerColor = 'black';
                
                console.log(`Game ${currentCode} started with 2 players`);
                
                // Notify both players of color assignments and game start
                io.to(global.games[currentCode].whitePlayer).emit('colorAssigned', { color: 'white', waiting: false });
                io.to(global.games[currentCode].blackPlayer).emit('colorAssigned', { color: 'black', waiting: false });
                
                // Start the game for both players
                io.to(currentCode).emit('startGame', {
                    whiteTime: global.games[currentCode].whiteTime,
                    blackTime: global.games[currentCode].blackTime,
                    chat: global.games[currentCode].chat,
                    fen: global.games[currentCode].chessInstance.fen()
                });
                
                // Start timer interval for this game
                timerIntervals[currentCode] = setInterval(() => {
                    const game = global.games[currentCode];
                    if (!game || !game.running) return;
                    
                    // Only decrement the timer for the player whose turn it is
                    if (game.turn === 'w') {
                        if (game.whiteTime > 0) {
                            game.whiteTime--;
                            if (game.whiteTime <= 0) {
                                game.whiteTime = 0;
                                game.running = false;
                                io.to(currentCode).emit('gameOver', { winner: 'black', reason: 'timeout' });
                            }
                        }
                    } else {
                        if (game.blackTime > 0) {
                            game.blackTime--;
                            if (game.blackTime <= 0) {
                                game.blackTime = 0;
                                game.running = false;
                                io.to(currentCode).emit('gameOver', { winner: 'white', reason: 'timeout' });
                            }
                        }
                    }
                    io.to(currentCode).emit('timerUpdate', {
                        whiteTime: game.whiteTime,
                        blackTime: game.blackTime,
                        turn: game.turn
                    });
                }, 1000);
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
