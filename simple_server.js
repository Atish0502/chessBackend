// BRAND NEW SIMPLE SERVER - STARTING FROM SCRATCH
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = process.env.PORT || 3000;

// Simple game storage
const games = {};

io.on('connection', (socket) => {
    console.log('Player connected:', socket.id);
    
    socket.on('join', (gameId) => {
        console.log(`${socket.id} joining game ${gameId}`);
        
        if (!games[gameId]) {
            games[gameId] = {
                players: [],
                moves: []
            };
        }
        
        const game = games[gameId];
        
        if (game.players.length < 2) {
            game.players.push(socket.id);
            socket.join(gameId);
            
            const color = game.players.length === 1 ? 'white' : 'black';
            
            socket.emit('joined', { color, gameId });
            console.log(`${socket.id} joined as ${color}`);
            
            if (game.players.length === 2) {
                io.to(gameId).emit('start');
                console.log(`Game ${gameId} started`);
            }
        } else {
            socket.emit('full');
        }
    });
    
    socket.on('move', (data) => {
        console.log('Move:', data);
        socket.to(data.gameId).emit('move', data);
    });
    
    socket.on('disconnect', () => {
        console.log('Player disconnected:', socket.id);
    });
});

server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

module.exports = app;
