const http = require('http'),
      path = require('path'),
      express = require('express'),
      handlebars = require('express-handlebars'),
      socket = require('socket.io');

const config = require('../config');

const myIo = require('./sockets/io'),
      routes = require('./routes/routes');

const app = express(),
      server = http.Server(app),
      io = socket(server, {
        cors: {
          origin: [
            "https://jocular-selkie-2cc178.netlify.app", 
            "https://netlify.app", 
            "https://vercel.app",
            "https://*.vercel.app",
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
});

// Make games global so routes can access it
global.games = {};

// Call the socket handler directly
myIo(io);

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