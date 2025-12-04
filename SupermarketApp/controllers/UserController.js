const User = require('../models/UserModel');
const connection = require('../db');   // If your db.js exports the MySQL connection

// ===============================
// REGISTER PAGE
// ===============================
exports.renderRegister = (req, res) => {
    res.render('register', { 
        messages: req.flash('error'), 
        formData: req.flash('formData')[0] 
    });
};

// Handle registration
exports.registerUser = (req, res) => {
    const { username, email, password, address, contact, role } = req.body;

    if (!username || !email || !password || !address || !contact || !role) {
        req.flash('error', 'All fields are required.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    if (password.length < 6) {
        req.flash('error', 'Password must be at least 6 characters.');
        req.flash('formData', req.body);
        return res.redirect('/register');
    }

    User.add(username, email, password, address, contact, role, (err) => {
        if (err) throw err;
        req.flash('success', 'Registration successful! Please log in.');
        res.redirect('/login');
    });
};

// ===============================
// LOGIN PAGE
// ===============================
exports.renderLogin = (req, res) => {
    res.render('login', { 
        messages: req.flash('success'), 
        errors: req.flash('error') 
    });
};

exports.loginUser = (req, res) => {
    const { email, password } = req.body;

    if (!email || !password) {
        req.flash('error', 'All fields are required.');
        return res.redirect('/login');
    }

    User.getByCredentials(email, password, (err, results) => {
        if (err) throw err;

        if (results.length > 0) {
            req.session.user = results[0];
            req.flash('success', 'Login successful!');

            return req.session.user.role === 'admin'
                ? res.redirect('/inventory')
                : res.redirect('/shopping');
        }

        req.flash('error', 'Invalid email or password.');
        res.redirect('/login');
    });
};

// ===============================
// LOGOUT
// ===============================
exports.logoutUser = (req, res) => {
    req.session.destroy();
    res.redirect('/');
};

// ===============================
// STEP 1 — ADMIN: VIEW ALL USERS
// ===============================
exports.getAllUsers = (req, res) => {
    const sql = `SELECT id, username, email, address, contact, role FROM users`;

    connection.query(sql, (err, results) => {
        if (err) throw err;

        res.render("userList", {
            users: results,
            user: req.session.user,
            messages: req.flash("success")
        });
    });
};

// ===============================
// STEP 1 — ADMIN: UPDATE USER ROLE
// ===============================
exports.updateUserRole = (req, res) => {
    const userId = req.params.id;
    const { role } = req.body;

    const sql = "UPDATE users SET role = ? WHERE id = ?";

    connection.query(sql, [role, userId], (err) => {
        if (err) throw err;

        req.flash("success", "User role updated successfully!");
        res.redirect("/admin/users");
    });
};

// Export fixes
module.exports = exports;
