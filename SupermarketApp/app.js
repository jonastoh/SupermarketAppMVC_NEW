const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const PDFDocument = require('pdfkit');
const fs = require('fs');

const app = express();

/* ============================================================
   FILE UPLOADS
============================================================ */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

/* ============================================================
   DATABASE
============================================================ */
const connection = mysql.createConnection({
    host: 'localhost',
    user: 'root',
    password: 'Republic_C207',
    database: 'c372_supermarketdb'
});

connection.connect(err => {
    if (err) return console.error("MySQL ERROR:", err);
    console.log("Connected to MySQL");
});

/* ============================================================
   APP CONFIG
============================================================ */
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.urlencoded({ extended: false }));

app.use(session({
    secret: 'secret',
    resave: false,
    saveUninitialized: true,
    cookie: { maxAge: 1000 * 60 * 60 * 24 * 7 }
}));

app.use(flash());

/* ============================================================
   MIDDLEWARES
============================================================ */
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in to view this page');
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session.user.role === 'admin') return next();
    req.flash('error', 'Access denied');
    res.redirect('/shopping');
};

const validateRegistration = (req, res, next) => {
    const { username, email, password, address, contact } = req.body;

    if (!username || !email || !password || !address || !contact) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    next();
};

/* ============================================================
   TEMP REVIEW DATABASE (in-memory)
============================================================ */
let reviewsDB = {}; 
// Format: reviewsDB[productId] = [ {stars, comment, user} ]

/* ============================================================
   ROUTES
============================================================ */

/* HOME */
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

/* ADMIN INVENTORY */
app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query("SELECT * FROM products", (err, results) => {
        if (err) throw err;
        res.render('inventory', { products: results, user: req.session.user });
    });
});

/* REGISTER */
app.get('/register', (req, res) => {
    res.render('register', { messages: req.flash('error'), formData: req.flash('formData')[0] });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact } = req.body;
    const role = "user";

    const sql = `
        INSERT INTO users (username, email, password, address, contact, role)
        VALUES (?, ?, SHA1(?), ?, ?, ?)
    `;

    connection.query(sql, [username, email, password, address, contact, role], err => {
        if (err) throw err;
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

/* LOGIN */
app.get('/login', (req, res) => {
    res.render('login', {
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    const sql = "SELECT * FROM users WHERE email = ? AND password = SHA1(?)";
    connection.query(sql, [email, password], (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            req.session.user = results[0];
            return req.session.user.role === 'admin'
                ? res.redirect('/inventory')
                : res.redirect('/shopping');
        }

        req.flash('error', 'Invalid email or password.');
        res.redirect('/login');
    });
});

/* SHOPPING PAGE */
app.get('/shopping', checkAuthenticated, (req, res) => {
    const error = req.flash('error');

    connection.query('SELECT * FROM products', (errorDB, results) => {
        if (errorDB) throw errorDB;
        res.render('shopping', { 
            user: req.session.user, 
            products: results,
            error: error 
        });
    });
});

/* ADD TO CART (with stock check) */
app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const quantity = parseInt(req.body.quantity) || 1;

    connection.query(
        'SELECT * FROM products WHERE id = ?',
        [productId],
        (err, results) => {
            if (err) throw err;
            if (results.length === 0) return res.status(404).send("Product not found");

            const product = results[0];

            if (product.quantity === 0) {
                req.flash('error', `${product.productName} is out of stock.`);
                return res.redirect('/shopping');
            }

            if (quantity > product.quantity) {
                req.flash('error', `Not enough stock. Available: ${product.quantity}`);
                return res.redirect('/shopping');
            }

            if (!req.session.cart) req.session.cart = [];

            const existing = req.session.cart.find(
                item => item.productName === product.productName
            );

            if (existing && existing.quantity + quantity > product.quantity) {
                req.flash('error',
                    `You already have ${existing.quantity} in cart. Max allowed: ${product.quantity}`
                );
                return res.redirect('/shopping');
            }

            if (existing) {
                existing.quantity += quantity;
            } else {
                req.session.cart.push({
                    productName: product.productName,
                    price: product.price,
                    quantity,
                    image: product.image
                });
            }

            connection.query(
                'UPDATE products SET quantity = quantity - ? WHERE id = ?',
                [quantity, productId],
                err => {
                    if (err) throw err;
                    return res.redirect('/cart');
                }
            );
        }
    );
});

/* CART PAGE */
app.get('/cart', checkAuthenticated, (req, res) => {
    res.render('cart', { cart: req.session.cart || [], user: req.session.user });
});

/* CHECKOUT */
app.get('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    res.render('checkout', { cart, total, user: req.session.user });
});

/* DOWNLOAD RECEIPT */
app.get('/download-receipt/:orderId', checkAuthenticated, (req, res) => {
    const orderId = req.params.orderId;
    const userId = req.session.user.id;

    const sql = `
        SELECT o.id AS orderId, o.total, o.orderDate,
               oi.productName, oi.price, oi.quantity, oi.image
        FROM orders o
        JOIN order_items oi ON o.id = oi.orderId
        WHERE o.id = ? AND o.userId = ?
    `;

    connection.query(sql, [orderId, userId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send("Order not found");

        const doc = new PDFDocument();
        res.setHeader("Content-Disposition", `attachment; filename=receipt-${orderId}.pdf`);
        res.setHeader("Content-Type", "application/pdf");

        doc.pipe(res);

        doc.fontSize(20).text(`Receipt for Order #${orderId}`, { underline: true });
        doc.moveDown();
        doc.fontSize(12).text(`Order Date: ${results[0].orderDate}`);
        doc.moveDown();

        results.forEach(item =>
            doc.text(`${item.productName} x${item.quantity} — $${(item.price * item.quantity).toFixed(2)}`)
        );

        doc.moveDown();
        doc.fontSize(16).text(`Total Paid: $${Number(results[0].total).toFixed(2)}`);

        doc.end();
    });
});

/* PLACE ORDER */
app.get('/place-order', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/cart');

    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    const userId = req.session.user.id;

    connection.query(
        "INSERT INTO orders (userId, total) VALUES (?, ?)",
        [userId, total],
        (err, result) => {
            if (err) throw err;

            const orderId = result.insertId;

            const values = cart.map(i => [
                orderId, i.productName, i.price, i.quantity, i.image
            ]);

            connection.query(
                "INSERT INTO order_items (orderId, productName, price, quantity, image) VALUES ?",
                [values],
                () => {
                    req.session.cart = [];
                    res.redirect('/invoice/' + orderId);
                }
            );
        }
    );
});

/* INVOICE PAGE */
app.get('/invoice/:orderId', checkAuthenticated, (req, res) => {
    const orderId = req.params.orderId;
    const userId = req.session.user.id;

    const sql = `
        SELECT 
            o.id AS orderId, 
            o.total, 
            o.orderDate,
            oi.productName, 
            oi.price, 
            oi.quantity, 
            oi.image,
            u.username, 
            u.email, 
            u.address, 
            u.contact
        FROM orders o
        JOIN order_items oi ON o.id = oi.orderId
        JOIN users u ON o.userId = u.id
        WHERE o.id = ? AND o.userId = ?
    `;

    connection.query(sql, [orderId, userId], (err, results) => {
        if (err) throw err;

        if (results.length === 0) {
            return res.status(404).send("Invoice not found");
        }

        results.forEach(item => {
            item.price = Number(item.price);
            item.quantity = Number(item.quantity);
        });

        const order = {
            orderId: results[0].orderId,
            orderDate: results[0].orderDate,
            total: Number(results[0].total),
            user: {
                name: results[0].username,
                email: results[0].email,
                address: results[0].address,
                contact: results[0].contact
            },
            items: results
        };

        res.render("invoice", { order, user: req.session.user });
    });
});

/* ORDER HISTORY */
app.get('/order-history', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;

    const sql = `
        SELECT o.id AS orderId, o.total, o.orderDate,
               oi.productName, oi.price, oi.quantity, oi.image
        FROM orders o
        JOIN order_items oi ON o.id = oi.orderId
        WHERE o.userId = ?
        ORDER BY o.orderDate DESC
    `;

    connection.query(sql, [userId], (err, results) => {
        if (err) throw err;

        const grouped = {};

        results.forEach(row => {
            if (!grouped[row.orderId]) {
                grouped[row.orderId] = {
                    orderId: row.orderId,
                    orderDate: row.orderDate,
                    total: row.total,
                    items: []
                };
            }
            grouped[row.orderId].items.push(row);
        });

        res.render('orderHistory', {
            orders: Object.values(grouped),
            user: req.session.user
        });
    });
});

/* LOGOUT */
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

/* PRODUCT DETAILS */
app.get('/product/:id', checkAuthenticated, (req, res) => {
    const productId = req.params.id;

    connection.query("SELECT * FROM products WHERE id = ?", [productId], (err, results) => {
        if (results.length === 0) return res.status(404).send("Product not found");
        res.render('product', { product: results[0], user: req.session.user });
    });
});

/* ADD PRODUCT */
app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post('/addProduct', upload.single('image'), (req, res) => {
    const { name, quantity, price } = req.body;
    const image = req.file ? req.file.filename : null;

    const sql = `
        INSERT INTO products (productName, quantity, price, image)
        VALUES (?, ?, ?, ?)
    `;

    connection.query(sql, [name, quantity, price, image], () => {
        res.redirect('/inventory');
    });
});

/* UPDATE PRODUCT */
app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    const productId = req.params.id;

    connection.query("SELECT * FROM products WHERE id = ?", [productId], (err, results) => {
        if (results.length === 0) return res.status(404).send("Product not found");
        res.render('updateProduct', { product: results[0] });
    });
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const { name, quantity, price } = req.body;
    const id = req.params.id;

    let image = req.body.currentImage;
    if (req.file) image = req.file.filename;

    const sql = `
        UPDATE products SET productName=?, quantity=?, price=?, image=?
        WHERE id=?
    `;

    connection.query(sql, [name, quantity, price, image, id], () => {
        res.redirect('/inventory');
    });
});

/* DELETE PRODUCT */
app.get('/deleteProduct/:id', (req, res) => {
    const productId = req.params.id;

    connection.query("DELETE FROM products WHERE id = ?", [productId], () => {
        res.redirect('/inventory');
    });
});

/* ============================================================
   ADMIN — VIEW USER LIST
============================================================ */
app.get('/admin/users', checkAuthenticated, checkAdmin, (req, res) => {
    const sql = "SELECT id, username, email, address, contact, role FROM users";

    connection.query(sql, (err, users) => {
        if (err) throw err;

        res.render('userList', {
            users,
            user: req.session.user,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

/* ============================================================
   ADMIN — UPDATE USER ROLE
============================================================ */
app.post('/admin/users/:id/update-role', checkAuthenticated, checkAdmin, (req, res) => {
    const userId = req.params.id;
    const newRole = req.body.role;

    if (!['user', 'admin'].includes(newRole)) {
        req.flash('error', 'Invalid role selection.');
        return res.redirect('/admin/users');
    }

    const sql = "UPDATE users SET role = ? WHERE id = ?";
    connection.query(sql, [newRole, userId], (err) => {
        if (err) throw err;

        req.flash('success', 'User role updated successfully!');
        res.redirect('/admin/users');
    });
});

/* ============================================================
   ⭐⭐ REVIEWS — VIEW & SUBMIT
============================================================ */

// View reviews page
app.get("/reviews/:id", checkAuthenticated, (req, res) => {
    const productId = req.params.id;

    connection.query(
        "SELECT * FROM products WHERE id = ?",
        [productId],
        (err, result) => {
            if (err) throw err;
            if (result.length === 0) return res.send("Product not found");

            const product = result[0];
            const reviews = reviewsDB[productId] || [];

            let averageRating = 0;
            if (reviews.length > 0) {
                averageRating =
                    reviews.reduce((sum, r) => sum + r.stars, 0) / reviews.length;
                averageRating = averageRating.toFixed(1);
            }

            res.render("reviews", {
                product,
                reviews,
                averageRating
            });
        }
    );
});

// Submit a new review
app.post("/reviews/:id", checkAuthenticated, (req, res) => {
    const productId = req.params.id;
    const { stars, comment } = req.body;

    if (!reviewsDB[productId]) {
        reviewsDB[productId] = [];
    }

    reviewsDB[productId].push({
        stars: parseInt(stars),
        comment,
        user: req.session.user.username
    });

    res.redirect("/reviews/" + productId);
});


// ===============================
// ADMIN DASHBOARD
// ===============================
app.get('/admin/dashboard', checkAuthenticated, checkAdmin, (req, res) => {

    const sql = `
        SELECT 
            -- Total daily revenue
            (SELECT IFNULL(SUM(total), 0) FROM orders WHERE DATE(orderDate) = CURDATE()) AS dailyRevenue,

            -- Weekly revenue
            (SELECT IFNULL(SUM(total), 0) FROM orders 
             WHERE YEARWEEK(orderDate, 1) = YEARWEEK(CURDATE(), 1)) AS weeklyRevenue,

            -- Total orders today
            (SELECT COUNT(*) FROM orders WHERE DATE(orderDate) = CURDATE()) AS dailyOrders,

            -- Total orders this week
            (SELECT COUNT(*) FROM orders 
             WHERE YEARWEEK(orderDate, 1) = YEARWEEK(CURDATE(), 1)) AS weeklyOrders,

            -- Units sold today
            (SELECT IFNULL(SUM(quantity), 0) FROM order_items oi 
             JOIN orders o ON oi.orderId = o.id
             WHERE DATE(o.orderDate) = CURDATE()) AS unitsToday,

            -- Units sold this week
            (SELECT IFNULL(SUM(quantity), 0) FROM order_items oi 
             JOIN orders o ON oi.orderId = o.id
             WHERE YEARWEEK(o.orderDate, 1) = YEARWEEK(CURDATE(), 1)) AS unitsWeek,

            -- Total users
            (SELECT COUNT(*) FROM users) AS totalUsers,

            -- Total products
            (SELECT COUNT(*) FROM products) AS totalProducts
        ;
    `;

    connection.query(sql, (err, stats) => {
        if (err) throw err;

        // Query best-selling products (top 5)
        const sql2 = `
            SELECT productName, SUM(quantity) AS sold
            FROM order_items
            GROUP BY productName
            ORDER BY sold DESC
            LIMIT 5;
        `;

        connection.query(sql2, (err2, best) => {
            if (err2) throw err2;

            res.render('dashboard', {
                user: req.session.user,
                stats: stats[0],
                bestProducts: best
            });
        });
    });
});


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
