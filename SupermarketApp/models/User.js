const db = require('./db');

module.exports = {
    create: (userData, callback) => {
        const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        db.query(sql, userData, callback);
    },

    findByLogin: (email, password, callback) => {
        const sql = 'SELECT * FROM users WHERE email = ? AND password = SHA1(?)';
        db.query(sql, [email, password], callback);
    }
};
