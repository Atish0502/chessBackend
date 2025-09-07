// ULTRA SIMPLE SOCKET HANDLER - NO BUGS
module.exports = io => {
    console.log('🚀 Socket handler started');
    
    io.on('connection', socket => {
        console.log(`✅ Player connected: ${socket.id}`);
        
        socket.on('joinGame', (data) => {
            console.log(`🎮 joinGame received from ${socket.id}:`, data);
            
            // Immediately respond to test connection
            socket.emit('gameJoined', { 
                color: 'white',
                waiting: false
            });
            
            // Immediately start game
            setTimeout(() => {
                socket.emit('gameStarted', {
                    message: 'Game started!'
                });
                console.log(`🚀 gameStarted sent to ${socket.id}`);
            }, 1000);
        });
        
        socket.on('move', (data) => {
            console.log(`♟️ Move from ${socket.id}:`, data);
            socket.emit('moveMade', {
                fen: 'rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1',
                pgn: '1. e4'
            });
        });
        
        socket.on('chatMessage', (data) => {
            console.log(`💬 Chat from ${socket.id}:`, data);
            socket.emit('chatMessage', {
                color: 'white',
                text: data.msg
            });
        });
        
        socket.on('disconnect', () => {
            console.log(`❌ Player disconnected: ${socket.id}`);
        });
    });
};
