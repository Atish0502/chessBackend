// Add timer state to each game
// Add chat state to each game (in-memory, max 7 messages per player)
const INITIAL_TIME = 600; // 10 minutes in seconds

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
            
            console.log(`Move received in game ${currentCode}:`, data);
            
            // Switch turn immediately when a move is received
            if (data && data.from && data.to) {
                if (global.games[currentCode].turn === 'w') {
                    global.games[currentCode].turn = 'b';
                } else {
                    global.games[currentCode].turn = 'w';
                }
            }
            // Emit the updated timers and turn
            io.to(currentCode).emit('newMove', {
                move: data,
                whiteTime: global.games[currentCode].whiteTime,
                blackTime: global.games[currentCode].blackTime,
                turn: global.games[currentCode].turn
            });
            // Immediately emit a timerUpdate so the UI updates right after the move
            io.to(currentCode).emit('timerUpdate', {
                whiteTime: global.games[currentCode].whiteTime,
                blackTime: global.games[currentCode].blackTime,
                turn: global.games[currentCode].turn
            });
        });

        socket.on('joinGame', function(data) {
            currentCode = data.code;
            socket.join(currentCode);
            
            if (!global.games[currentCode]) {
                // First player creates the game
                global.games[currentCode] = {
                    whiteTime: INITIAL_TIME,
                    blackTime: INITIAL_TIME,
                    turn: 'w',
                    running: false, // Don't start until 2 players
                    chat: [],
                    players: 1 // Track number of players
                };
                console.log(`Game ${currentCode} created, waiting for second player`);
                return;
            }
            
            // Second player joins
            if (global.games[currentCode].players < 2) {
                global.games[currentCode].players = 2;
                global.games[currentCode].running = true;
                
                console.log(`Game ${currentCode} started with 2 players`);
                
                // Start the game for both players
                io.to(currentCode).emit('startGame', {
                    whiteTime: global.games[currentCode].whiteTime,
                    blackTime: global.games[currentCode].blackTime,
                    chat: global.games[currentCode].chat
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
