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
        },
        transports: ['polling', 'websocket'],
        allowEIO3: true
      });

const PORT = process.env.PORT || config.port;

server.listen(PORT, () => {
  console.log(`🚀 Server listening on port ${PORT}`);
  
  // SAFE SOCKET HANDLER - NO ONAVY
  io.on('connection', (socket) => {
    console.log(`🔌 NEW CONNECTION: ${socket.id}`);
    
    // Just handle specific events safely
    socket.on('joinGame', (data) => {
      console.log(`📨 joinGame EVENT:`, data);
      
      try {
        socket.emit('echo', {
          originalEvent: 'joinGame',
          originalData: data,
          timestamp: new Date().toISOString(),
          test: 'SAFE_SUCCESS'
        });
        console.log(`📤 ECHOED joinGame`);
      } catch (error) {
        console.log(`❌ ERROR:`, error);
      }
    });
    
    socket.on('disconnect', () => {
      console.log(`❌ DISCONNECT: ${socket.id}`);
    });
    
    console.log(`✅ Handler ready for ${socket.id}`);
  });
  
  console.log(`✅ Socket server ready`);
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