const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { Chess } = require('chess.js');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// Configure CORS for Socket.IO
const io = socketIo(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    }
});

app.use(cors());
app.use(express.json());

// Game storage
const games = new Map();
const players = new Map();

console.log('🎮 Chess Backend Server Starting...');

// Socket.IO connection handling
io.on('connection', (socket) => {
    console.log(`👤 Player connected: ${socket.id}`);
    
    socket.on('joinGame', (data) => {
        try {
            const { code } = data;
            console.log(`🎮 ${socket.id} joining game: ${code}`);
            
            let game = games.get(code);
            
            if (!game) {
                // Create new game
                game = {
                    id: code,
                    chess: new Chess(),
                    players: {},
                    spectators: [],
                    status: 'waiting',
                    whiteTime: 600, // 10 minutes
                    blackTime: 600,
                    turn: 'w',
                    timerInterval: null,
                    lastMoveTime: Date.now()
                };
                games.set(code, game);
                console.log(`✨ Created new game: ${code}`);
            }
            
            // Assign player color
            let color = null;
            if (!game.players.white) {
                color = 'white';
                game.players.white = { id: socket.id, connected: true };
            } else if (!game.players.black) {
                color = 'black';
                game.players.black = { id: socket.id, connected: true };
            } else {
                // Game is full, add as spectator
                game.spectators.push(socket.id);
                socket.emit('error', { message: 'Game is full. Joining as spectator.' });
                return;
            }
            
            // Store player info
            players.set(socket.id, { gameId: code, color });
            socket.join(code);
            
            // Send join confirmation
            socket.emit('gameJoined', {
                color,
                gameState: {
                    fen: game.chess.fen(),
                    turn: game.chess.turn(),
                    whiteTime: game.whiteTime,
                    blackTime: game.blackTime,
                    status: game.status
                }
            });
            
            console.log(`✅ ${socket.id} joined as ${color} in game ${code}`);
            
            // Start game if both players joined
            if (game.players.white && game.players.black && game.status === 'waiting') {
                game.status = 'playing';
                startGameTimer(game);
                
                io.to(code).emit('gameStarted', {
                    gameState: {
                        fen: game.chess.fen(),
                        turn: game.chess.turn(),
                        whiteTime: game.whiteTime,
                        blackTime: game.blackTime,
                        status: game.status
                    }
                });
                
                console.log(`🚀 Game ${code} started!`);
            }
            
        } catch (error) {
            console.error('❌ Error joining game:', error);
            socket.emit('error', { message: 'Failed to join game' });
        }
    });
    
    socket.on('makeMove', (data) => {
        try {
            const playerInfo = players.get(socket.id);
            if (!playerInfo) {
                socket.emit('moveRejected', { reason: 'Not in a game' });
                return;
            }
            
            const game = games.get(playerInfo.gameId);
            if (!game) {
                socket.emit('moveRejected', { reason: 'Game not found' });
                return;
            }
            
            // Validate it's player's turn
            const currentTurn = game.chess.turn();
            if ((currentTurn === 'w' && playerInfo.color !== 'white') ||
                (currentTurn === 'b' && playerInfo.color !== 'black')) {
                socket.emit('moveRejected', { reason: 'Not your turn' });
                return;
            }
            
            // Try to make the move
            const move = game.chess.move({
                from: data.from,
                to: data.to,
                promotion: data.promotion || 'q'
            });
            
            if (!move) {
                socket.emit('moveRejected', { reason: 'Invalid move' });
                return;
            }
            
            console.log(`♟️ Move in ${playerInfo.gameId}: ${move.san} by ${playerInfo.color}`);
            
            // Update game state
            game.lastMoveTime = Date.now();
            
            // Broadcast move to all players in the game
            io.to(playerInfo.gameId).emit('moveExecuted', {
                move: {
                    from: move.from,
                    to: move.to,
                    san: move.san,
                    color: playerInfo.color
                },
                gameState: {
                    fen: game.chess.fen(),
                    turn: game.chess.turn(),
                    whiteTime: game.whiteTime,
                    blackTime: game.blackTime,
                    status: game.status
                }
            });
            
            // Check for game end
            if (game.chess.isGameOver()) {
                let result = 'Draw';
                let reason = 'Unknown';
                
                if (game.chess.isCheckmate()) {
                    result = currentTurn === 'w' ? 'Black' : 'White';
                    reason = 'Checkmate';
                } else if (game.chess.isDraw()) {
                    if (game.chess.isStalemate()) reason = 'Stalemate';
                    else if (game.chess.isThreefoldRepetition()) reason = 'Threefold repetition';
                    else if (game.chess.isInsufficientMaterial()) reason = 'Insufficient material';
                    else reason = 'Draw';
                }
                
                game.status = 'finished';
                clearInterval(game.timerInterval);
                
                io.to(playerInfo.gameId).emit('gameEnded', { result, reason });
                console.log(`🏁 Game ${playerInfo.gameId} ended: ${result} (${reason})`);
            }
            
        } catch (error) {
            console.error('❌ Error making move:', error);
            socket.emit('moveRejected', { reason: 'Server error' });
        }
    });
    
    socket.on('sendChat', (data) => {
        try {
            const playerInfo = players.get(socket.id);
            if (!playerInfo) {
                socket.emit('error', { message: 'Not in a game' });
                return;
            }
            
            const { message } = data;
            if (!message || message.trim().length === 0) {
                return;
            }
            
            if (message.length > 200) {
                socket.emit('error', { message: 'Message too long' });
                return;
            }
            
            console.log(`💬 Chat in ${playerInfo.gameId} from ${playerInfo.color}: ${message}`);
            
            // Broadcast chat to all players in the game
            io.to(playerInfo.gameId).emit('chatReceived', {
                color: playerInfo.color,
                message: message.trim(),
                timestamp: Date.now()
            });
            
        } catch (error) {
            console.error('❌ Error sending chat:', error);
            socket.emit('error', { message: 'Failed to send message' });
        }
    });
    
    socket.on('disconnect', () => {
        console.log(`👤 Player disconnected: ${socket.id}`);
        
        const playerInfo = players.get(socket.id);
        if (playerInfo) {
            const game = games.get(playerInfo.gameId);
            if (game) {
                // Mark player as disconnected
                if (game.players.white?.id === socket.id) {
                    game.players.white.connected = false;
                }
                if (game.players.black?.id === socket.id) {
                    game.players.black.connected = false;
                }
                
                // Clean up if both players disconnected
                if ((!game.players.white?.connected) && (!game.players.black?.connected)) {
                    clearInterval(game.timerInterval);
                    games.delete(playerInfo.gameId);
                    console.log(`🗑️ Cleaned up game ${playerInfo.gameId}`);
                }
            }
            
            players.delete(socket.id);
        }
    });
});

function startGameTimer(game) {
    if (game.timerInterval) {
        clearInterval(game.timerInterval);
    }
    
    game.timerInterval = setInterval(() => {
        if (game.status !== 'playing') {
            clearInterval(game.timerInterval);
            return;
        }
        
        const currentTurn = game.chess.turn();
        
        // Decrease time for current player
        if (currentTurn === 'w') {
            game.whiteTime = Math.max(0, game.whiteTime - 1);
        } else {
            game.blackTime = Math.max(0, game.blackTime - 1);
        }
        
        // Check for time up
        if (game.whiteTime <= 0 || game.blackTime <= 0) {
            const winner = game.whiteTime <= 0 ? 'Black' : 'White';
            game.status = 'finished';
            clearInterval(game.timerInterval);
            
            io.to(game.id).emit('gameEnded', {
                result: winner,
                reason: 'Time expired'
            });
            
            console.log(`⏰ Game ${game.id} ended: ${winner} wins on time`);
            return;
        }
        
        // Broadcast timer update
        io.to(game.id).emit('timerTick', {
            whiteTime: game.whiteTime,
            blackTime: game.blackTime,
            turn: currentTurn
        });
        
    }, 1000);
}

// Status endpoint
app.get('/status', (req, res) => {
    res.json({
        status: 'online',
        games: games.size,
        players: players.size,
        timestamp: new Date().toISOString()
    });
});

const PORT = process.env.PORT || 1000;

server.listen(PORT, () => {
    console.log(`🚀 Chess Backend Server running on port ${PORT}`);
    console.log(`📊 Server Status: 0 active games, 0 connected players`);
    
    // Status logging
    setInterval(() => {
        console.log(`📊 Server Status: ${games.size} active games, ${players.size} connected players`);
    }, 60000);
});

module.exports = { app, server, io };
