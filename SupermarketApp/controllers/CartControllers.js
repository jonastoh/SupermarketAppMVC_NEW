// controllers/CartController.js

const mysql = require('mysql2');

// Create DB connection (reuse your settings)
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
});

// =========================
// Add to Cart Controller
// =========================

exports.addToCart = (req, res) => {
    const productId = parseInt(req.params.id);
    const reqQty = parseInt(req.body.quantity) || 1;

    // Ensure cart exists
    if (!req.session.cart) req.session.cart = [];

    // Fetch product from DB
    connection.query(
        'SELECT * FROM products WHERE id = ?',
        [productId],
        (err, results) => {
            if (err) throw err;
            if (results.length === 0) return res.status(404).send("Product not found");

            const product = results[0];

            // ======================
            // Stock Validation
            // ======================
            if (product.quantity <= 0) {
                req.flash("error", ` ${product.productName} is OUT OF STOCK.`);
                return res.redirect('/shopping');
            }

            if (reqQty > product.quantity) {
                req.flash("error", ` Only ${product.quantity} left in stock.`);
                return res.redirect('/shopping');
            }

            // Check if item already in cart
            const existingItem = req.session.cart.find(item => item.id === productId);

            if (existingItem) {
                const newTotal = existingItem.quantity + reqQty;

                // Prevent exceeding stock
                if (newTotal > product.quantity) {
                    req.flash("error", ` You cannot add more than ${product.quantity} of ${product.productName}.`);
                    return res.redirect('/shopping');
                }

                existingItem.quantity = newTotal;
            } else {
                req.session.cart.push({
                    id: product.id,
                    productName: product.productName,
                    price: product.price,
                    quantity: reqQty,
                    image: product.image
                });
            }

            // Deduct stock from DB
            connection.query(
                'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                [reqQty, productId],
                (err2) => {
                    if (err2) throw err2;

                    req.flash("success", `✔ Added ${reqQty} x ${product.productName} to cart.`);
                    res.redirect('/cart');
                }
            );
        }
    );
};


// =========================
// Update Cart Item Quantity
// =========================

exports.updateCart = (req, res) => {
    const productId = parseInt(req.body.productId);
    const newQty = parseInt(req.body.quantity);

    if (!req.session.cart) req.session.cart = [];

    if (newQty < 1) {
        req.flash("error", " Quantity cannot be less than 1");
        return res.redirect('/cart');
    }

    // Fetch product stock
    connection.query(
        'SELECT quantity FROM products WHERE id = ?',
        [productId],
        (err, result) => {
            if (err) throw err;

            const stock = result[0].quantity;

            if (newQty > stock) {
                req.flash("error", ` Only ${stock} left in stock.`);
                return res.redirect('/cart');
            }

            const cartItem = req.session.cart.find(i => i.id === productId);

            if (!cartItem) {
                req.flash("error", "Item not found in cart.");
                return res.redirect('/cart');
            }

            cartItem.quantity = newQty;

            req.flash("success", "✔ Cart updated.");
            res.redirect('/cart');
        }
    );
};
