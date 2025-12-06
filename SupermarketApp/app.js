const express = require('express');
const mysql = require('mysql2');
const session = require('express-session');
const flash = require('connect-flash');
const multer = require('multer');
const PDFDocument = require('pdfkit');

const app = express();

/* ============================================================
   FILE UPLOAD CONFIG
============================================================ */
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/images'),
    filename: (req, file, cb) => cb(null, file.originalname)
});
const upload = multer({ storage });

/* ============================================================
   DATABASE CONNECTION
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
   AUTH MIDDLEWARES
============================================================ */
const checkAuthenticated = (req, res, next) => {
    if (req.session.user) return next();
    req.flash('error', 'Please log in to access this page.');
    res.redirect('/login');
};

const checkAdmin = (req, res, next) => {
    if (req.session.user?.role === 'admin') return next();
    req.flash('error', 'Access denied.');
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
   TEMP REVIEW STORAGE
============================================================ */
let reviewsDB = {};

/* ============================================================
   HOME
============================================================ */
app.get('/', (req, res) => {
    res.render('index', { user: req.session.user });
});

/* ============================================================
   USER REGISTRATION
============================================================ */
app.get('/register', (req, res) => {
    res.render('register', {
        messages: req.flash('error'),
        formData: req.flash('formData')[0]
    });
});

app.post('/register', validateRegistration, (req, res) => {
    const { username, email, password, address, contact } = req.body;

    const sql = `
        INSERT INTO users (username, email, password, address, contact, role)
        VALUES (?, ?, SHA1(?), ?, ?, 'user')
    `;

    connection.query(sql, [username, email, password, address, contact], err => {
        if (err) throw err;
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
});

/* ============================================================
   LOGIN / LOGOUT
============================================================ */
app.get('/login', (req, res) => {
    res.render('login', {
        messages: req.flash('success'),
        errors: req.flash('error')
    });
});

app.post('/login', (req, res) => {
    const { email, password } = req.body;

    connection.query(
        "SELECT * FROM users WHERE email = ? AND password = SHA1(?)",
        [email, password],
        (err, results) => {
            if (err) throw err;

            if (results.length === 0) {
                req.flash('error', 'Invalid email or password.');
                return res.redirect('/login');
            }

            req.session.user = results[0];
            
            // FIXED → Admin goes to INVENTORY (your original behavior)
            if (req.session.user.role === "admin") {
                return res.redirect('/inventory');
            }

            return res.redirect('/shopping');
        }
    );
});

app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

/* ============================================================
   SHOPPING PAGE
============================================================ */
app.get('/shopping', checkAuthenticated, (req, res) => {
    connection.query("SELECT * FROM products", (err, results) => {
        if (err) throw err;
        res.render('shopping', {
            user: req.session.user,
            products: results,
            error: req.flash('error')
        });
    });
});

/* ============================================================
   CART SYSTEM
============================================================ */
app.post('/add-to-cart/:id', checkAuthenticated, (req, res) => {
    const productId = parseInt(req.params.id);
    const qtyRequested = parseInt(req.body.quantity) || 1;

    connection.query("SELECT * FROM products WHERE id = ?", [productId], (err, results) => {
        if (err) throw err;
        if (results.length === 0) return res.status(404).send("Product not found");

        const product = results[0];

        if (qtyRequested > product.quantity) {
            req.flash('error', `Only ${product.quantity} left in stock.`);
            return res.redirect('/shopping');
        }

        if (!req.session.cart) req.session.cart = [];

        const item = req.session.cart.find(i => i.productName === product.productName);

        if (item && item.quantity + qtyRequested > product.quantity) {
            req.flash('error', `Max allowed: ${product.quantity}.`);
            return res.redirect('/shopping');
        }

        if (item) item.quantity += qtyRequested;
        else req.session.cart.push({
            productName: product.productName,
            price: product.price,
            quantity: qtyRequested,
            image: product.image
        });

        connection.query(
            "UPDATE products SET quantity = quantity - ? WHERE id = ?",
            [qtyRequested, productId],
            () => res.redirect('/cart')
        );
    });
});

app.get('/cart', checkAuthenticated, (req, res) => {
    res.render('cart', { cart: req.session.cart || [], user: req.session.user });
});

/* ============================================================
   CHECKOUT & PAYMENT
============================================================ */
app.get('/checkout', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);
    res.render('checkout', { cart, total, user: req.session.user });
});

app.post('/process-payment', checkAuthenticated, (req, res) => {
    const { cardNumber, cardName, expiry, cvv } = req.body;
    if (!cardNumber || !cardName || !expiry || !cvv) {
        req.flash("error", "Payment information incomplete.");
        return res.redirect("/checkout");
    }
    res.redirect('/place-order');
});

/* ============================================================
   PLACE ORDER → SAVE TO DB
============================================================ */
app.get('/place-order', checkAuthenticated, (req, res) => {
    const cart = req.session.cart || [];
    if (cart.length === 0) return res.redirect('/cart');

    const userId = req.session.user.id;
    const total = cart.reduce((s, i) => s + i.price * i.quantity, 0);

    connection.query(
        "INSERT INTO orders (userId, total) VALUES (?, ?)",
        [userId, total],
        (err, result) => {
            if (err) throw err;

            const orderId = result.insertId;
            const values = cart.map(i => [orderId, i.productName, i.price, i.quantity, i.image]);

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

/* ============================================================
   DOWNLOAD PDF RECEIPT
============================================================ */
app.get('/download-receipt/:orderId', checkAuthenticated, (req, res) => {
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
            u.username,
            u.email,
            u.address,
            u.contact
        FROM orders o
        JOIN order_items oi ON o.id = oi.orderId
        JOIN users u ON o.userId = u.id
        WHERE o.id = ? AND o.userId = ?
    `;

    connection.query(sql, [orderId, userId], (err, rows) => {
        if (err) throw err;
        if (rows.length === 0) return res.status(404).send("Order not found");

        // Convert values to numbers
        rows.forEach(i => {
            i.price = Number(i.price);
            i.quantity = Number(i.quantity);
        });

        const order = rows[0];
        order.total = Number(order.total); // FIX: convert for .toFixed()

        // Start PDF
        const doc = new PDFDocument({ margin: 40 });

        res.setHeader("Content-Disposition", `attachment; filename=receipt-${orderId}.pdf`);
        res.setHeader("Content-Type", "application/pdf");

        doc.pipe(res);

        /* ============================
           HEADER SECTION
        ============================ */
        doc.fontSize(24).fillColor("#333").text("SUPERMARKET APP", { align: "center" });
        doc.moveDown(0.3);
        doc.fontSize(10).text("123 Market Street, Singapore", { align: "center" });
        doc.text("Phone: +65 6000 0000", { align: "center" });
        doc.moveDown(1);

        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#aaaaaa");
        doc.moveDown(1);

        /* ============================
           ORDER SUMMARY
        ============================ */
        doc.fontSize(16).fillColor("#000").text(`Receipt for Order #${order.orderId}`, { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12).text(`Order Date: ${order.orderDate}`);
        doc.text(`Customer: ${order.username}`);
        doc.text(`Email: ${order.email}`);
        doc.text(`Address: ${order.address}`);
        doc.text(`Contact: ${order.contact}`);
        doc.moveDown(1);

        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#cccccc");
        doc.moveDown(1);

        /* ============================
           ITEM TABLE HEADER
        ============================ */
        doc.fontSize(14).text("Items Purchased", { underline: true });
        doc.moveDown(0.5);

        doc.fontSize(12).text("Item", 40, doc.y, { continued: true });
        doc.text("Qty", 250, doc.y, { continued: true });
        doc.text("Price", 320, doc.y, { continued: true });
        doc.text("Total", 400, doc.y);

        doc.moveDown(0.3);
        doc.moveTo(40, doc.y).lineTo(550, doc.y).stroke("#cccccc");
        doc.moveDown(0.5);

        /* ============================
           ITEM LOOP
        ============================ */
        rows.forEach(item => {
            const lineTotal = (item.price * item.quantity).toFixed(2);

            doc.text(item.productName, 40, doc.y, { width: 180 });
            doc.text(item.quantity.toString(), 250, doc.y);
            doc.text(`$${item.price.toFixed(2)}`, 320, doc.y);
            doc.text(`$${lineTotal}`, 400, doc.y);

            doc.moveDown(0.6);
        });

        /* ============================
           TOTAL BOX
        ============================ */
        doc.moveDown(1);
        doc.moveTo(300, doc.y).lineTo(550, doc.y).stroke("#888");
        doc.moveDown(0.3);

        doc.fontSize(14).fillColor("#000").text(
            `TOTAL PAID: $${order.total.toFixed(2)}`,
            300,
            doc.y,
            { align: "right" }
        );

        doc.moveDown(2);

        /* ============================
           FOOTER
        ============================ */
        doc.fontSize(11).fillColor("#555").text("Thank you for shopping with us!", { align: "center" });
        doc.fontSize(10).text("Have a great day!", { align: "center" });

        doc.end();
    });
});

/* ============================================================
   INVOICE PAGE
============================================================ */
app.get('/invoice/:orderId', checkAuthenticated, (req, res) => {
    const userId = req.session.user.id;
    const orderId = req.params.orderId;

    const sql = `
        SELECT 
            o.id AS orderId, o.total, o.orderDate,
            oi.productName, oi.price, oi.quantity, oi.image,
            u.username, u.email, u.address, u.contact
        FROM orders o
        JOIN order_items oi ON o.id = oi.orderId
        JOIN users u ON o.userId = u.id
        WHERE o.id = ? AND o.userId = ?
    `;

    connection.query(sql, [orderId, userId], (err, results) => {
        if (err || results.length === 0) return res.status(404).send("Invoice not found");

        results.forEach(i => {
            i.price = Number(i.price);
            i.quantity = Number(i.quantity);
        });

        const order = {
            orderId,
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

/* ============================================================
   ORDER HISTORY
============================================================ */
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

    connection.query(sql, [userId], (err, rows) => {
        if (err) throw err;

        const grouped = {};
        rows.forEach(r => {
            if (!grouped[r.orderId]) {
                grouped[r.orderId] = {
                    orderId: r.orderId,
                    orderDate: r.orderDate,
                    total: r.total,
                    items: []
                };
            }
            grouped[r.orderId].items.push(r);
        });

        res.render('orderHistory', {
            orders: Object.values(grouped),
            user: req.session.user
        });
    });
});

/* ============================================================
   PRODUCT CRUD (ADMIN)
============================================================ */
app.get('/inventory', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query("SELECT * FROM products", (err, products) => {
        if (err) throw err;
        res.render('inventory', { products, user: req.session.user });
    });
});

app.get('/addProduct', checkAuthenticated, checkAdmin, (req, res) => {
    res.render('addProduct', { user: req.session.user });
});

app.post('/addProduct', upload.single('image'), (req, res) => {
    const { name, quantity, price, category } = req.body;
    const image = req.file?.filename || null;

    const sql = `
        INSERT INTO products (productName, quantity, price, category, image)
        VALUES (?, ?, ?, ?, ?)
    `;

    connection.query(sql, [name, quantity, price, category, image], err => {
        if (err) return res.send("Error adding product.");
        res.redirect('/inventory');
    });
});

app.get('/updateProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query(
        "SELECT * FROM products WHERE id = ?",
        [req.params.id],
        (err, results) => {
            if (err || results.length === 0) return res.status(404).send("Product not found");
            res.render('editProduct', { product: results[0], user: req.session.user });
        }
    );
});

app.post('/updateProduct/:id', upload.single('image'), (req, res) => {
    const { name, quantity, price, currentImage } = req.body;
    const id = req.params.id;

    const image = req.file?.filename || currentImage;

    const sql = `
        UPDATE products 
        SET productName = ?, quantity = ?, price = ?, image = ?
        WHERE id = ?
    `;

    connection.query(sql, [name, quantity, price, image, id], () => {
        res.redirect('/inventory');
    });
});


app.get('/deleteProduct/:id', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query("DELETE FROM products WHERE id = ?", [req.params.id], () => {
        res.redirect('/inventory');
    });
});

/* ============================================================
   USER MANAGEMENT (ADMIN)
============================================================ */
app.get('/admin/users', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query("SELECT id, username, email, address, contact, role FROM users", (err, users) => {
        if (err) throw err;
        res.render('userList', {
            users,
            user: req.session.user,
            messages: req.flash('success'),
            errors: req.flash('error')
        });
    });
});

app.post('/admin/users/:id/update-role', checkAuthenticated, checkAdmin, (req, res) => {
    const { role } = req.body;
    if (!['user', 'admin'].includes(role)) {
        req.flash('error', 'Invalid role.');
        return res.redirect('/admin/users');
    }

    connection.query(
        "UPDATE users SET role = ? WHERE id = ?",
        [role, req.params.id],
        () => {
            req.flash('success', 'User role updated.');
            res.redirect('/admin/users');
        }
    );
});

app.post('/admin/users/:id/delete', checkAuthenticated, checkAdmin, (req, res) => {
    connection.query("DELETE FROM users WHERE id = ?", [req.params.id], () => {
        req.flash('success', 'User deleted.');
        res.redirect('/admin/users');
    });
});

/* ============================================================
   REVIEWS FEATURE
============================================================ */
app.get("/reviews/:id", checkAuthenticated, (req, res) => {
    connection.query("SELECT * FROM products WHERE id = ?", [req.params.id], (err, results) => {
        if (err || results.length === 0) return res.send("Product not found");

        const product = results[0];
        const reviews = reviewsDB[req.params.id] || [];

        const averageRating = reviews.length
            ? (reviews.reduce((s, r) => s + r.stars, 0) / reviews.length).toFixed(1)
            : 0;

        res.render("reviews", { product, reviews, averageRating });
    });
});

app.post("/reviews/:id", checkAuthenticated, (req, res) => {
    const { stars, comment } = req.body;

    if (!reviewsDB[req.params.id]) reviewsDB[req.params.id] = [];

    reviewsDB[req.params.id].push({
        stars: parseInt(stars),
        comment,
        user: req.session.user.username
    });

    res.redirect("/reviews/" + req.params.id);
});

/* ============================================================
   ADMIN DASHBOARD
============================================================ */
app.get('/admin/dashboard', checkAuthenticated, checkAdmin, (req, res) => {
    const statsQuery = `
        SELECT 
            (SELECT IFNULL(SUM(total), 0) FROM orders WHERE DATE(orderDate) = CURDATE()) AS dailyRevenue,
            (SELECT IFNULL(SUM(total), 0) FROM orders WHERE YEARWEEK(orderDate,1)=YEARWEEK(CURDATE(),1)) AS weeklyRevenue,
            (SELECT COUNT(*) FROM orders WHERE DATE(orderDate) = CURDATE()) AS dailyOrders,
            (SELECT COUNT(*) FROM orders WHERE YEARWEEK(orderDate,1)=YEARWEEK(CURDATE(),1)) AS weeklyOrders,
            (SELECT IFNULL(SUM(quantity),0) FROM order_items oi JOIN orders o ON oi.orderId=o.id WHERE DATE(orderDate)=CURDATE()) AS unitsToday,
            (SELECT IFNULL(SUM(quantity),0) FROM order_items oi JOIN orders o ON oi.orderId=o.id WHERE YEARWEEK(orderDate,1)=YEARWEEK(CURDATE(),1)) AS unitsWeek,
            (SELECT COUNT(*) FROM users) AS totalUsers,
            (SELECT COUNT(*) FROM products) AS totalProducts
    `;

    const topProductsQuery = `
        SELECT productName, SUM(quantity) AS sold
        FROM order_items
        GROUP BY productName
        ORDER BY sold DESC
        LIMIT 5
    `;

    connection.query(statsQuery, (err, stats) => {
        if (err) throw err;

        connection.query(topProductsQuery, (err2, bestProducts) => {
            if (err2) throw err2;

            res.render('dashboard', {
                user: req.session.user,
                stats: stats[0],
                bestProducts
            });
        });
    });
});

/* ============================================================
   USER PROFILE
============================================================ */
app.get('/profile', checkAuthenticated, (req, res) => {
    connection.query("SELECT * FROM users WHERE id = ?", [req.session.user.id], (err, result) => {
        if (err) throw err;
        res.render('userprofile', {
            user: req.session.user,
            profile: result[0],
            message: req.flash('success'),
            error: req.flash('error')
        });
    });
});

app.post('/profile/update-info', checkAuthenticated, (req, res) => {
    const { username, email, address, contact } = req.body;

    const sql = `
        UPDATE users SET username=?, email=?, address=?, contact=? WHERE id=?
    `;

    connection.query(sql, [username, email, address, contact, req.session.user.id], err => {
        if (err) throw err;

        Object.assign(req.session.user, { username, email, address, contact });

        req.flash('success', 'Profile updated successfully');
        res.redirect('/profile');
    });
});

app.post('/profile/change-password', checkAuthenticated, (req, res) => {
    const { oldPassword, newPassword } = req.body;

    connection.query(
        "SELECT * FROM users WHERE id = ? AND password = SHA1(?)",
        [req.session.user.id, oldPassword],
        (err, result) => {
            if (err) throw err;

            if (result.length === 0) {
                req.flash('error', 'Old password is incorrect.');
                return res.redirect('/profile');
            }

            connection.query(
                "UPDATE users SET password = SHA1(?) WHERE id = ?",
                [newPassword, req.session.user.id],
                () => {
                    req.flash('success', 'Password updated successfully!');
                    res.redirect('/profile');
                }
            );
        }
    );
});

/* ============================================================
   START SERVER
============================================================ */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

