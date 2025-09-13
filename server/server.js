const http = require('http'),
      path = require('path'),
      express = require('express'),
      handlebars = require('express-handlebars'),
      { Server } = require('socket.io');

const config = require('../config');

const productionIo = require('./sockets/production_io'),
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
  console.log(`🚀 Production Chess Server starting on port ${PORT}`);
  
  // Initialize production socket handler
  productionIo(io);
  
  console.log(`✅ Production server ready on port ${PORT}`);
});

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