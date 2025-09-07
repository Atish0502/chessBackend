// MINIMAL SOCKET HANDLER WITH MAXIMUM LOGGING
module.exports = io => {
    console.log('🚀🚀🚀 SOCKET HANDLER LOADED - test_minimal.js');
    
    io.on('connection', socket => {
        console.log(`🔌🔌🔌 NEW CONNECTION: ${socket.id}`);
        
        // Log ALL events received
        socket.onAny((eventName, ...args) => {
            console.log(`📨📨📨 EVENT RECEIVED: ${eventName}`, args);
        });
        
        socket.on('joinGame', (data) => {
            console.log(`🎮🎮🎮 JOIN GAME EVENT: ${socket.id}`, data);
            
            // Send immediate response
            socket.emit('gameJoined', { 
                color: 'white',
                waiting: false,
                test: 'SUCCESS'
            });
            console.log(`✅✅✅ SENT gameJoined to ${socket.id}`);
            
            // Send game started after delay
            setTimeout(() => {
                socket.emit('gameStarted', {
                    message: 'Test game started!',
                    test: 'SUCCESS'
                });
                console.log(`🚀🚀🚀 SENT gameStarted to ${socket.id}`);
            }, 2000);
        });
        
        socket.on('disconnect', () => {
            console.log(`❌❌❌ DISCONNECTION: ${socket.id}`);
        });
    });
    
    console.log('🔧🔧🔧 SOCKET HANDLER SETUP COMPLETE');
};
