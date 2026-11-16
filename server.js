const path = require('path');
const express = require('express');
const session = require('express-session');
const C = require('./src/config');

const app = express();
app.use(express.json());
app.use(session({
  secret: C.SECRET_KEY, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', maxAge: 8 * 60 * 60 * 1000 },
}));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', require('./src/api'));

app.use((err, req, res, next) => {            // any unexpected error
  console.error(err);
  res.status(500).json({ error: 'Server error: ' + err.message });
});

app.listen(C.PORT, () => console.log(`Smart Dairy running at http://localhost:${C.PORT}`));
