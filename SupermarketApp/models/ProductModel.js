const mysql = require('mysql2');

const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
});

connection.connect(err => {
    if (err) throw err;
    console.log('Connected to MySQL (ProductModel)');
});

const Product = {
    getAll: callback => {
        connection.query('SELECT * FROM products', callback);
    },
    getById: (id, callback) => {
        connection.query('SELECT * FROM products WHERE id = ?', [id], callback);
    },
    add: (name, quantity, price, image, callback) => {
        const sql = 'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)';
        connection.query(sql, [name, quantity, price, image], callback);
    },
    update: (id, name, quantity, price, image, callback) => {
        const sql = 'UPDATE products SET productName=?, quantity=?, price=?, image=? WHERE id=?';
        connection.query(sql, [name, quantity, price, image, id], callback);
    },
    delete: (id, callback) => {
        connection.query('DELETE FROM products WHERE id=?', [id], callback);
    }
};

module.exports = Product;
