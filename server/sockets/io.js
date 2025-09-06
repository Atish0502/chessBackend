// Add timer state to each game
// Add chat state to each game (in-memory, max 7 messages per player)
const INITIAL_TIME = 600; // 10 minutes in seconds

// Store intervals for each game
const timerIntervals = {};

module.exports = ioOrServer => {
    // If passed an http.Server, initialize socket.io with CORS options
    const io = typeof ioOrServer.on === 'function' && typeof ioOrServer.emit === 'function' && typeof ioOrServer.listen !== 'function'
        ? ioOrServer
        : require('socket.io')(ioOrServer, {
            cors: {
                origin: "https://your-vercel-frontend-url", // replace with your actual Vercel URL
                methods: ["GET", "POST"],
                credentials: true
            }
        });
    io.on('connection', socket => {
        console.log('New socket connection');

        let currentCode = null;
        let lastTurn = 'w';
        let playerColor = null;

        socket.on('setColor', function(color) {
            playerColor = color;
        });

        socket.on('move', function(data) {
            if (!games[currentCode]) return;
            // Switch turn immediately when a move is received
            if (data && data.from && data.to) {
                if (games[currentCode].turn === 'w') {
                    games[currentCode].turn = 'b';
                } else {
                    games[currentCode].turn = 'w';
                }
            }
            // Emit the updated timers and turn
            io.to(currentCode).emit('newMove', {
                move: data,
                whiteTime: games[currentCode].whiteTime,
                blackTime: games[currentCode].blackTime,
                turn: games[currentCode].turn
            });
            // Immediately emit a timerUpdate so the UI updates right after the move
            io.to(currentCode).emit('timerUpdate', {
                whiteTime: games[currentCode].whiteTime,
                blackTime: games[currentCode].blackTime,
                turn: games[currentCode].turn
            });
        });

        socket.on('joinGame', function(data) {
            currentCode = data.code;
            socket.join(currentCode);
            if (!games[currentCode]) {
                games[currentCode] = {
                    whiteTime: INITIAL_TIME,
                    blackTime: INITIAL_TIME,
                    turn: 'w',
                    running: true,
                    chat: [] // single array for all messages
                };
                // Start timer interval for this game
                timerIntervals[currentCode] = setInterval(() => {
                    const game = games[currentCode];
                    if (!game || !game.running) return;
                    // Only decrement the timer for the player whose turn it is
                    if (game.turn === 'w') {
                        if (game.whiteTime > 0) {
                            game.whiteTime--;
                            if (game.whiteTime <= 0) {
                                game.whiteTime = 0;
                                game.running = false;
                            }
                        }
                    } else {
                        if (game.blackTime > 0) {
                            game.blackTime--;
                            if (game.blackTime <= 0) {
                                game.blackTime = 0;
                                game.running = false;
                            }
                        }
                    }
                    io.to(currentCode).emit('timerUpdate', {
                        whiteTime: game.whiteTime,
                        blackTime: game.blackTime,
                        turn: game.turn
                    });
                }, 1000);
                return;
            }
            io.to(currentCode).emit('startGame', {
                whiteTime: games[currentCode].whiteTime,
                blackTime: games[currentCode].blackTime,
                chat: games[currentCode].chat
            });
        });

        // Chat message handler
        socket.on('chatMessage', function(data) {
            if (!games[currentCode]) return;
            const msgObj = {
                msg: data.msg,
                color: data.color,
                ts: Date.now()
            };
            games[currentCode].chat.push(msgObj);
            // Keep only the last 28 messages (14 per player max, but in order)
            if (games[currentCode].chat.length > 28) games[currentCode].chat.shift();
            io.to(currentCode).emit('chatUpdate', {
                chat: games[currentCode].chat
            });
        });

        socket.on('disconnect', function() {
            console.log('socket disconnected');
            if (currentCode) {
                io.to(currentCode).emit('gameOverDisconnect');
                delete games[currentCode];
                if (timerIntervals[currentCode]) {
                    clearInterval(timerIntervals[currentCode]);
                    delete timerIntervals[currentCode];
                }
            }
        });
    });
};