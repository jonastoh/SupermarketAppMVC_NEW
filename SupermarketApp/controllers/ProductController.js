const Product = require('../models/ProductModel');

//Show inventory (admin)
exports.getAllProducts = (req, res) => {
    Product.getAll((error, results) => {
        if (error) throw error;
        res.render('inventory', { products: results, user: req.session.user });
    });
};

//Show single product (details page)
exports.getProductById = (req, res) => {
    const productId = req.params.id;
    Product.getById(productId, (error, results) => {
        if (error) throw error;
        if (results.length > 0) {
            res.render('product', { product: results[0], user: req.session.user });
        } else {
            res.status(404).send('Product not found');
        }
    });
};

//Render add form
exports.renderAddForm = (req, res) => {
    res.render('addProduct', { user: req.session.user });
};

//Add new product
exports.addProduct = (req, res) => {
    const { name, quantity, price } = req.body;
    const image = req.file ? req.file.filename : null;
    Product.add(name, quantity, price, image, (error, results) => {
        if (error) {
            console.error('Error adding product:', error);
            res.status(500).send('Error adding product');
        } else {
            res.redirect('/inventory');
        }
    });
};

//Render update form
exports.renderUpdateForm = (req, res) => {
    const productId = req.params.id;
    Product.getById(productId, (error, results) => {
        if (error) throw error;
        if (results.length > 0) {
            res.render('updateProduct', { product: results[0] });
        } else {
            res.status(404).send('Product not found');
        }
    });
};

//Update product
exports.updateProduct = (req, res) => {
    const productId = req.params.id;
    const { name, quantity, price } = req.body;
    let image = req.body.currentImage;
    if (req.file) image = req.file.filename;

    Product.update(productId, name, quantity, price, image, (error) => {
        if (error) {
            console.error('Error updating product:', error);
            res.status(500).send('Error updating product');
        } else {
            res.redirect('/inventory');
        }
    });
};

//Delete product
exports.deleteProduct = (req, res) => {
    const productId = req.params.id;
    Product.delete(productId, (error) => {
        if (error) {
            console.error('Error deleting product:', error);
            res.status(500).send('Error deleting product');
        } else {
            res.redirect('/inventory');
        }
    });
};

//Show shopping page for users
exports.renderShoppingPage = (req, res) => {
    Product.getAll((error, results) => {
        if (error) throw error;
        res.render('shopping', { user: req.session.user, products: results });
    });
};

//Fix for “argument handler must be a function”
module.exports = exports;
