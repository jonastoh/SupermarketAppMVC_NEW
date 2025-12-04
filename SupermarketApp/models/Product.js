const db = require('./db');

module.exports = {
    findAll: callback => {
        db.query('SELECT * FROM products', callback);
    },

    findById: (id, callback) => {
        db.query('SELECT * FROM products WHERE id = ?', [id], callback);
    },

    create: (data, callback) => {
        db.query(
            'INSERT INTO products (productName, quantity, price, image) VALUES (?, ?, ?, ?)',
            data,
            callback
        );
    },

    update: (data, id, callback) => {
        db.query(
            'UPDATE products SET productName=?, quantity=?, price=?, image=? WHERE id=?',
            [...data, id],
            callback
        );
    },

    delete: (id, callback) => {
        db.query('DELETE FROM products WHERE id=?', [id], callback);
    },

    deductStock: (qty, id, callback) => {
        db.query('UPDATE products SET quantity = quantity - ? WHERE id = ?', [qty, id], callback);
    }
};
