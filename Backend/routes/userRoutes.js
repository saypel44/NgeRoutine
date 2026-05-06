const express = require('express');
const db = require('../db.js');
const router = express.Router();

router.get('/', async (req, res) => {
  try {
    const users = await db.all('SELECT * FROM users');
    res.json(users);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  const { name, email } = req.body;
  try {
    await db.run('INSERT INTO users (name, email) VALUES (?, ?)', [name, email]);
    res.json({ message: 'User created', name, email });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;