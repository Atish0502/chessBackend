const http = require('http'),
      path = require('path'),
      express = require('express'),
      handlebars = require('express-handlebars');

const config = require('../config');

const myIo = require('./sockets/io'),
      routes = require('./routes/routes');

const app = express(),
      server = http.Server(app);

// Initialize Socket.IO with CORS in the io.js file
const io = myIo(server);

const PORT = process.env.PORT || config.port;

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server listening on port ${PORT}`);
});

global.games = {};

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