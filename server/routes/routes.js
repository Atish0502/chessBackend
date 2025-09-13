module.exports = app => {

    app.get('/', (req, res) => {
        res.render('index');
    });

    app.get('/white', (req, res) => {
        res.render('game', {
            color: 'white'
        });
    });
    
    app.get('/black', (req, res) => {
        const gameCode = req.query.code;
        if (!gameCode) {
            return res.redirect('/?error=missingCode');
        }

        res.render('game', {
            color: 'black',
            gameCode: gameCode
        });
    });
    
    app.get('/ai', (req, res) => {
        res.render('ai');
    });
};