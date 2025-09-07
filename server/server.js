const http = require('http'),
      path = require('path'),
      express = require('express'),
      handlebars = require('express-handlebars'),
      { Server } = require('socket.io');

const config = require('../config');

const myIo = require('./sockets/test_minimal'),
      routes = require('./routes/routes');

const app = express(),
      server = http.Server(app),
      io = new Server(server, {
        cors: {
          origin: [
            "https://jocular-selkie-2cc178.netlify.app", 
            "https://*.netlify.app",
            "https://netlify.app", 
            "http://localhost:3000", 
            "http://localhost:1000"
          ],
          methods: ["GET", "POST"],
          credentials: true
        }
      });

const PORT = process.env.PORT || config.port;

server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
  
  // INLINE SOCKET HANDLER - NO MODULE LOADING ISSUES
  console.log('🚀🚀🚀 INLINE SOCKET HANDLER STARTING');
  
  io.on('connection', (socket) => {
    console.log(`🔌🔌🔌 NEW CONNECTION: ${socket.id}`);
    
    // Log ALL events
    socket.onAny((eventName, ...args) => {
      console.log(`📨📨📨 EVENT RECEIVED: ${eventName}`, args);
    });
    
    socket.on('joinGame', (data) => {
      console.log(`🎮🎮🎮 JOIN GAME EVENT: ${socket.id}`, data);
      
      socket.emit('gameJoined', { 
        color: 'white',
        waiting: false,
        test: 'INLINE_SUCCESS'
      });
      console.log(`✅✅✅ SENT gameJoined to ${socket.id}`);
      
      setTimeout(() => {
        socket.emit('gameStarted', {
          message: 'Inline test game started!',
          test: 'INLINE_SUCCESS'
        });
        console.log(`🚀🚀🚀 SENT gameStarted to ${socket.id}`);
      }, 1000);
    });
    
    socket.on('disconnect', () => {
      console.log(`❌❌❌ DISCONNECTION: ${socket.id}`);
    });
  });
  
  console.log('🔧🔧🔧 INLINE SOCKET HANDLER COMPLETE');
});

// Initialize professional game state management
global.games = new Map();

console.log(`Server starting on port ${PORT}`);

const Handlebars = handlebars.create({
  extname: '.html', 
  partialsDir: path.join(__dirname, '..', 'front', 'views', 'partials'), 
  defaultLayout: false,
  helpers: {}
});
app.engine('html', Handlebars.engine);
app.set('view engine', 'html');
app.set('views', path.join(__dirname, '..', 'front', 'views'));
app.use('/public', express.static(path.join(__dirname, '..', 'front', 'public')));

routes(app);