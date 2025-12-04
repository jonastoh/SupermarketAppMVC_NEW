const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
});

connection.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL (UserModel)');
});

const User = {
    add: (username, email, password, address, contact, role, callback) => {
        const sql = 'INSERT INTO users (username, email, password, address, contact, role) VALUES (?, ?, SHA1(?), ?, ?, ?)';
        connection.query(sql, [username, email, password, address, contact, role], callback);
    },
    getByCredentials: (email, password, callback) => {
        const sql = 'SELECT * FROM users WHERE email=? AND password=SHA1(?)';
        connection.query(sql, [email, password], callback);
    }
};

module.exports = User;
