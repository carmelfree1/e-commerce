<?php
/**
 * Page d'accueil - D.L.G Parfumerie
 * Design luxe avec backend PHP/MySQL
 */

require_once 'config.php';

// Initialiser les classes
$product = new Product($pdo);
$auth = new Auth($pdo);

// Obtenir l'utilisateur actuel
$current_user = $auth->getCurrentUser();

// Obtenir les produits depuis la BD
$all_products = $product->getAll();

// Traitement des actions
$action = isset($_POST['action']) ? $_POST['action'] : '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if ($action === 'logout') {
        $auth->logout();
        header('Location: index.php');
        exit;
    }
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>D.L.G Parfumerie - Parfums de Luxe</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <header>
        <div class="container">
            <div class="header-top">
                <div class="logo-brand" id="logoBrand">
                    <img src="images/logo.png" alt="D.L.G Parfumerie" class="logo-image">
                    <h1 class="logo">D.L.G PARFUMERIE</h1>
                </div>
                
                <div class="header-actions">
                    <button class="theme-toggle" id="themeToggle" title="Mode sombre/clair">🌙</button>
                    <button class="cart-btn btn-primary" onclick="openCart()" title="Panier">
                        🛒
                        <span class="cart-count" id="cartCount">0</span>
                    </button>
                </div>
            </div>

            <!-- Menu Catégories -->
            <nav class="category-menu">
                <a href="#" class="category-link active" data-category="tous">NOUVEAU</a>
                <a href="#" class="category-link" data-category="femme">FEMME</a>
                <a href="#" class="category-link" data-category="homme">HOMME</a>
                <a href="#" class="category-link" data-category="unisexe">UNISEXE</a>
            </nav>
        </div>
    </header>

    <section class="products-section">
        <div class="container">
            <!-- Barre de recherche -->
            <div class="search-bar-container">
                <input type="text" id="searchInput" class="search-input" placeholder="🔍 Rechercher par nom..." onkeyup="searchProducts()">
            </div>

            <!-- Tri -->
            <div class="filters-bar">
                <div class="filters-right">
                    <label>Trier par:</label>
                    <select id="sortBy" onchange="sortProducts(this.value)">
                        <option value="recommende">Recommandé</option>
                        <option value="nouveau">Nouveau</option>
                        <option value="prix-asc">Prix ↑</option>
                        <option value="prix-desc">Prix ↓</option>
                    </select>
                </div>
            </div>

            <div class="products-grid" id="productsGrid"></div>
        </div>
    </section>

    <!-- Cart Modal -->
    <div class="modal" id="cartModal">
        <div class="modal-content">
            <div class="modal-header">
                <h2 class="modal-title">Mon Panier</h2>
                <button class="close-modal" onclick="closeCart()">×</button>
            </div>
            <div class="modal-body">
                <div id="cartItems"></div>
                <div id="checkoutSection" style="display: none;">
                    <div class="cart-total">
                        <div class="total-row">
                            <span>Total:</span>
                            <span class="total-amount" id="cartTotal">0 CFA</span>
                        </div>
                    </div>

                    <form class="checkout-form" id="checkoutForm" style="margin-top: 2rem;">
                        <h3 style="margin-bottom: 1rem; color: var(--primary);">📋 Adresse de Livraison</h3>
                        
                        <div class="form-group">
                            <label>Nom complet *</label>
                            <input type="text" id="customerName" required>
                        </div>

                        <div class="form-group">
                            <label>Téléphone *</label>
                            <input type="tel" id="customerPhone" placeholder="+225 00000000" required>
                        </div>

                        <div class="form-group">
                            <label>Adresse de livraison *</label>
                            <textarea id="customerAddress" rows="2" required></textarea>
                        </div>

                        <div class="form-group">
                            <label>Ville *</label>
                            <input type="text" id="customerCity" required>
                        </div>

                        <div class="form-group">
                            <label>Email</label>
                            <input type="email" id="customerEmail">
                        </div>

                        <div class="form-group">
                            <label>Notes supplémentaires</label>
                            <textarea id="customerNotes" rows="2" placeholder="Instructions spéciales..."></textarea>
                        </div>

                        <button type="submit" class="whatsapp-btn" id="submitOrderBtn">
                            ✅ Valider la commande
                        </button>
                    </form>
                </div>
            </div>
        </div>
    </div>

    <script>
        let productsData = <?php echo json_encode($all_products); ?>;
        let cart = JSON.parse(localStorage.getItem('cart')) || [];
        let filteredProducts = [...productsData];

        // Ajouter les event listeners pour les catégories
        document.querySelectorAll('.category-link').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                document.querySelectorAll('.category-link').forEach(l => l.classList.remove('active'));
                link.classList.add('active');
                const category = link.dataset.category;
                filterByCategory(category);
            });
        });

        function searchProducts() {
            const searchTerm = document.getElementById('searchInput').value.toLowerCase();
            if (searchTerm === '') {
                filterByCategory(document.querySelector('.category-link.active').dataset.category);
            } else {
                const currentCategory = document.querySelector('.category-link.active').dataset.category;
                let categoryProducts = currentCategory === 'tous' ? 
                    productsData : 
                    productsData.filter(p => p.category.toLowerCase() === currentCategory);
                
                filteredProducts = categoryProducts.filter(p => 
                    p.name.toLowerCase().includes(searchTerm) ||
                    p.description.toLowerCase().includes(searchTerm)
                );
                displayProducts();
            }
        }

        function filterByCategory(category) {
            if (category === 'tous') {
                filteredProducts = [...productsData];
            } else {
                filteredProducts = productsData.filter(p => p.category.toLowerCase() === category);
            }
            displayProducts();
        }

        function sortProducts(sortBy) {
            switch(sortBy) {
                case 'prix-asc':
                    filteredProducts.sort((a, b) => parseInt(a.price) - parseInt(b.price));
                    break;
                case 'prix-desc':
                    filteredProducts.sort((a, b) => parseInt(b.price) - parseInt(a.price));
                    break;
                case 'nouveau':
                    filteredProducts.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
                    break;
                default:
                    filteredProducts = [...productsData];
            }
            displayProducts();
        }

        function displayProducts() {
            const grid = document.getElementById('productsGrid');
            grid.innerHTML = filteredProducts.map(product => `
                <div class="product-card">
                    <div class="product-image">
                        ${product.image_url ? 
                            `<img src="${product.image_url}" alt="${product.name}">` : 
                            `🌸`
                        }
                    </div>
                    <div class="product-info">
                        <div class="product-category">${product.category}</div>
                        <h3 class="product-name">${product.name}</h3>
                        <p class="product-description">${product.description.substring(0, 80)}...</p>
                        <div class="product-footer">
                            <span class="product-price">${parseInt(product.price).toLocaleString()} CFA</span>
                            <button class="add-to-cart" onclick="addToCart(${product.id})">+</button>
                        </div>
                    </div>
                </div>
            `).join('');
        }

        function addToCart(productId) {
            const product = productsData.find(p => p.id === productId);
            const existingItem = cart.find(item => item.id === productId);

            if (existingItem) {
                // Vérifier que la quantité ne dépasse pas le stock
                if (existingItem.quantity < product.stock) {
                    existingItem.quantity++;
                    saveCart();
                    updateCartCount();
                    showNotification('✅ Quantité augmentée');
                } else {
                    showNotification('⚠️ Stock insuffisant');
                }
            } else {
                cart.push({ ...product, quantity: 1 });
                saveCart();
                updateCartCount();
                showNotification('✅ Produit ajouté au panier');
            }
        }

        function saveCart() {
            localStorage.setItem('cart', JSON.stringify(cart));
        }

        function updateCartCount() {
            const count = cart.reduce((sum, item) => sum + item.quantity, 0);
            document.getElementById('cartCount').textContent = count;
        }

        function displayCart() {
            const cartItems = document.getElementById('cartItems');
            const checkoutSection = document.getElementById('checkoutSection');

            if (cart.length === 0) {
                cartItems.innerHTML = '<div class="cart-empty">🛒 Votre panier est vide</div>';
                checkoutSection.style.display = 'none';
                return;
            }

            cartItems.innerHTML = cart.map(item => `
                <div class="cart-item">
                    <div class="cart-item-image">
                        ${item.image_url ? 
                            `<img src="${item.image_url}" alt="${item.name}">` : 
                            `🌸`
                        }
                    </div>
                    <div class="cart-item-details">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-price">${parseInt(item.price).toLocaleString()} CFA</div>
                        <div style="margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                            <button class="btn-quantity" onclick="decrementFromCart(${item.id})">−</button>
                            <span style="min-width: 30px; text-align: center;"><strong>${item.quantity}</strong></span>
                            <button class="btn-quantity" onclick="incrementCart(${item.id}, ${item.stock})">+</button>
                            <span style="font-size: 0.85rem; color: #666;">(Stock: ${item.stock})</span>
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="removeFromCart(${item.id})">🗑️</button>
                </div>
            `).join('');

            const total = cart.reduce((sum, item) => sum + (parseInt(item.price) * item.quantity), 0);
            document.getElementById('cartTotal').textContent = total.toLocaleString() + ' CFA';
            checkoutSection.style.display = 'block';
        }

        function removeFromCart(productId) {
            cart = cart.filter(item => item.id !== productId);
            saveCart();
            displayCart();
            updateCartCount();
        }

        function decrementFromCart(productId) {
            const item = cart.find(item => item.id === productId);
            if (item) {
                if (item.quantity > 1) {
                    item.quantity--;
                } else {
                    cart = cart.filter(i => i.id !== productId);
                }
                saveCart();
                displayCart();
                updateCartCount();
            }
        }

        function incrementCart(productId, maxStock) {
            const item = cart.find(item => item.id === productId);
            if (item && item.quantity < maxStock) {
                item.quantity++;
                saveCart();
                displayCart();
                updateCartCount();
            } else if (item && item.quantity >= maxStock) {
                showNotification('⚠️ Stock insuffisant');
            }
        }

        function openCart() {
            displayCart();
            document.getElementById('cartModal').classList.add('active');
        }

        function closeCart() {
            document.getElementById('cartModal').classList.remove('active');
        }

        function showNotification(message) {
            const notification = document.createElement('div');
            notification.textContent = message;
            notification.style.cssText = `
                position: fixed;
                top: 100px;
                right: 20px;
                background: var(--primary);
                color: white;
                padding: 1rem 2rem;
                border-radius: 50px;
                box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
                z-index: 3000;
                font-weight: 500;
            `;
            document.body.appendChild(notification);

            setTimeout(() => {
                notification.remove();
            }, 3000);
        }

        displayProducts();
        updateCartCount();

        window.onclick = function(event) {
            const modal = document.getElementById('cartModal');
            if (event.target === modal) {
                closeCart();
            }
        }

        // Checkout - WhatsApp Integration
        document.getElementById('checkoutForm').addEventListener('submit', function(e) {
            e.preventDefault();

            if (cart.length === 0) {
                showNotification('❌ Votre panier est vide!');
                return;
            }

            const name = document.getElementById('customerName').value.trim();
            const phone = document.getElementById('customerPhone').value.trim();
            const address = document.getElementById('customerAddress').value.trim();
            const city = document.getElementById('customerCity').value.trim();
            const email = document.getElementById('customerEmail').value.trim();
            const notes = document.getElementById('customerNotes').value.trim();

            if (!name || !phone || !address || !city) {
                showNotification('⚠️ Veuillez remplir tous les champs obligatoires');
                return;
            }

            // Créer le message WhatsApp
            let message = `🌟 *NOUVELLE COMMANDE - D.L.G PARFUMERIE* 🌟\n\n`;
            message += `👤 *CLIENT*\n`;
            message += `Nom: ${name}\n`;
            message += `Téléphone: ${phone}\n`;
            message += `Email: ${email || 'Non fourni'}\n`;
            message += `Adresse: ${address}\n`;
            message += `Ville: ${city}\n\n`;
            
            message += `🛍️ *PRODUITS COMMANDÉS*\n`;
            message += `${'─'.repeat(40)}\n`;

            let total = 0;
            cart.forEach((item, index) => {
                const subtotal = parseInt(item.price) * item.quantity;
                total += subtotal;
                message += `\n${index + 1}. *${item.name}*\n`;
                message += `   Quantité: ${item.quantity}\n`;
                message += `   Prix unitaire: ${parseInt(item.price).toLocaleString()} CFA\n`;
                message += `   Sous-total: ${subtotal.toLocaleString()} CFA\n`;
            });

            message += `\n${'─'.repeat(40)}\n`;
            message += `💰 *TOTAL: ${total.toLocaleString()} CFA*\n`;

            if (notes) {
                message += `\n📝 *Notes spéciales:*\n${notes}\n`;
            }

            message += `\n✅ Commande envoyée via D.L.G Parfumerie`;

            // Numéro WhatsApp (à remplacer par votre numéro)
            // Format: code pays + numero (sans + ni espaces)
            // Exemples:
            // Côte d'Ivoire: 2250123456789
            // France: 33612345678
            // Sénégal: 221701234567
            const whatsappNumber = '2250758254641'; // Numéro WhatsApp D.L.G Parfumerie
            
            // Afficher une notification de chargement
            showNotification('⏳ Traitement de votre commande...');
            
            // Encoder le message pour WhatsApp
            const encodedMessage = encodeURIComponent(message);
            const whatsappUrl = `https://wa.me/${whatsappNumber}?text=${encodedMessage}`;

            // Ouvrir WhatsApp discrètement après 2 secondes
            setTimeout(() => {
                window.open(whatsappUrl, '_blank');
                
                // Vider le panier et réinitialiser le formulaire
                cart = [];
                saveCart();
                updateCartCount();
                document.getElementById('checkoutForm').reset();
                displayCart();
                closeCart();
                
                // Afficher une confirmation finale
                showNotification('✅ Votre commande a été reçue avec succès!');
            }, 2000);
        });

        // ===== THEME TOGGLE =====
        const themeToggle = document.getElementById('themeToggle');
        const htmlElement = document.documentElement;

        // Vérifier la préférence sauvegardée ou système
        const savedTheme = localStorage.getItem('theme');
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        const initialTheme = savedTheme || (prefersDark ? 'dark' : 'light');

        // Appliquer le thème initial
        if (initialTheme === 'dark') {
            document.body.classList.add('dark-mode');
            themeToggle.textContent = '☀️';
        } else {
            document.body.classList.remove('dark-mode');
            themeToggle.textContent = '🌙';
        }

        // Gérer le clic sur le toggle
        themeToggle.addEventListener('click', () => {
            document.body.classList.toggle('dark-mode');
            const isDark = document.body.classList.contains('dark-mode');
            
            // Mettre à jour l'icône
            themeToggle.textContent = isDark ? '☀️' : '🌙';
            
            // Sauvegarder la préférence
            localStorage.setItem('theme', isDark ? 'dark' : 'light');
        });

        // ===== ACTUALISATION AUTOMATIQUE CÔTÉ CLIENT =====
        let lastCheckTime = Math.floor(Date.now() / 1000);
        
        /**
         * Vérifier les mises à jour des produits
         */
        function checkForUpdates() {
            fetch(`api.php?action=check_updates&last_check=${lastCheckTime}`)
                .then(response => response.json())
                .then(data => {
                    if (data.success && data.has_updates) {
                        console.log('🔄 Mises à jour détectées, rafraîchissement des produits...');
                        loadProductsFromServer();
                    }
                    lastCheckTime = data.timestamp;
                })
                .catch(error => console.error('Erreur lors de la vérification:', error));
        }

        /**
         * Charger les produits depuis le serveur
         */
        function loadProductsFromServer() {
            fetch('api.php?action=get_products')
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        // Mettre à jour les données globales
                        productsData = data.data;
                        filteredProducts = [...productsData];
                        
                        // Rafraîchir l'affichage
                        displayProducts();
                        updateCartCount();
                        
                        console.log('✅ Produits actualisés (' + data.count + ' produits)');
                    }
                })
                .catch(error => console.error('Erreur lors du chargement:', error));
        }

        // Vérifier les mises à jour toutes les 2 secondes
        setInterval(checkForUpdates, 2000);

        // Charger les produits au démarrage
        displayProducts();
    </script>

    <!-- FOOTER / CONTACT -->
    <footer>
        <div class="container">
            <div class="footer-content">
                <!-- À Propos -->
                <div class="footer-section">
                    <h3>🌹 D.L.G PARFUMERIE</h3>
                    <p>Découvrez notre collection exclusive de parfums de luxe, soigneusement sélectionnés pour sublimer votre élégance naturelle.</p>
                    <p style="font-size: 0.9rem; color: #999; margin-top: 1rem;">© 2026 D.L.G Parfumerie. Tous droits réservés.</p>
                </div>

                <!-- Contact -->
                <div class="footer-section">
                    <h3>📞 Contact</h3>
                    <div class="contact-info">
                        <div class="contact-item">
                            <span class="contact-icon">📱</span>
                            <div class="contact-details">
                                <strong>Téléphone / WhatsApp</strong>
                                <a href="tel:+2250758254641">+225 07 58 25 46 41</a>
                            </div>
                        </div>
                        <div class="contact-item">
                            <span class="contact-icon">📧</span>
                            <div class="contact-details">
                                <strong>Email</strong>
                                <a href="mailto:contact@dlg-parfumerie.com">contact@dlg-parfumerie.com</a>
                            </div>
                        </div>
                        <div class="contact-item">
                            <span class="contact-icon">📍</span>
                            <div class="contact-details">
                                <strong>Adresse</strong>
                                <span>Bouafle, Côte d'Ivoire</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Horaires -->
                <div class="footer-section">
                    <h3>🕐 Horaires</h3>
                    <ul>
                        <li><strong>Lundi - Samedi</strong><br>08:00 - 21:00</li>
                        <li><strong>Dimanche</strong><br>12:00 - 21:00</li>
                    </ul>
                    <div style="margin-top: 2rem;">
                        <p style="font-size: 0.9rem; color: #999;">Consultations en ligne 24h/24</p>
                    </div>
                </div>

                <!-- Informations -->
                <div class="footer-section">
                    <h3>✨ Avantages</h3>
                    <ul>
                        <li>Produits 100% Authentiques</li>
                        <li>Livraison Rapide</li>
                        <li>Paiement Sécurisé</li>
                        <li>Consulting Gratuit</li>
                        <li>Service Client Réactif</li>
                    </ul>
                </div>
            </div>

            <!-- Divider & Social -->
            <div class="footer-divider">
                <div class="social-links">
                    <a href="https://wa.me/2250758254641" title="WhatsApp" class="social-whatsapp">
                        <svg width="24px" height="24px" viewBox="-3.52 -3.52 39.04 39.04" fill="none" xmlns="http://www.w3.org/2000/svg"><path fill-rule="evenodd" clip-rule="evenodd" d="M16 31C23.732 31 30 24.732 30 17C30 9.26801 23.732 3 16 3C8.26801 3 2 9.26801 2 17C2 19.5109 2.661 21.8674 3.81847 23.905L2 31L9.31486 29.3038C11.3014 30.3854 13.5789 31 16 31ZM16 28.8462C22.5425 28.8462 27.8462 23.5425 27.8462 17C27.8462 10.4576 22.5425 5.15385 16 5.15385C9.45755 5.15385 4.15385 10.4576 4.15385 17C4.15385 19.5261 4.9445 21.8675 6.29184 23.7902L5.23077 27.7692L9.27993 26.7569C11.1894 28.0746 13.5046 28.8462 16 28.8462Z" fill="#BFC8D0"></path><path d="M28 16C28 22.6274 22.6274 28 16 28C13.4722 28 11.1269 27.2184 9.19266 25.8837L5.09091 26.9091L6.16576 22.8784C4.80092 20.9307 4 18.5589 4 16C4 9.37258 9.37258 4 16 4C22.6274 4 28 9.37258 28 16Z" fill="url(#paint0_linear_87_7264)"></path><path fill-rule="evenodd" clip-rule="evenodd" d="M16 30C23.732 30 30 23.732 30 16C30 8.26801 23.732 2 16 2C8.26801 2 2 8.26801 2 16C2 18.5109 2.661 20.8674 3.81847 22.905L2 30L9.31486 28.3038C11.3014 29.3854 13.5789 30 16 30ZM16 27.8462C22.5425 27.8462 27.8462 22.5425 27.8462 16C27.8462 9.45755 22.5425 4.15385 16 4.15385C9.45755 4.15385 4.15385 9.45755 4.15385 16C4.15385 18.5261 4.9445 20.8675 6.29184 22.7902L5.23077 26.7692L9.27993 25.7569C11.1894 27.0746 13.5046 27.8462 16 27.8462Z" fill="white"></path><path d="M12.5 9.49989C12.1672 8.83131 11.6565 8.8905 11.1407 8.8905C10.2188 8.8905 8.78125 9.99478 8.78125 12.05C8.78125 13.7343 9.52345 15.578 12.0244 18.3361C14.438 20.9979 17.6094 22.3748 20.2422 22.3279C22.875 22.2811 23.4167 20.0154 23.4167 19.2503C23.4167 18.9112 23.2062 18.742 23.0613 18.696C22.1641 18.2654 20.5093 17.4631 20.1328 17.3124C19.7563 17.1617 19.5597 17.3656 19.4375 17.4765C19.0961 17.8018 18.4193 18.7608 18.1875 18.9765C17.9558 19.1922 17.6103 19.083 17.4665 19.0015C16.9374 18.7892 15.5029 18.1511 14.3595 17.0426C12.9453 15.6718 12.8623 15.2001 12.5959 14.7803C12.3828 14.4444 12.5392 14.2384 12.6172 14.1483C12.9219 13.7968 13.3426 13.254 13.5313 12.9843C13.7199 12.7145 13.5702 12.305 13.4803 12.05C13.0938 10.953 12.7663 10.0347 12.5 9.49989Z" fill="white"></path><defs><linearGradient id="paint0_linear_87_7264" x1="26.5" y1="7" x2="4" y2="28" gradientUnits="userSpaceOnUse"><stop stop-color="#5BD066"></stop><stop offset="1" stop-color="#27B43E"></stop></linearGradient></defs></svg>
                        <span>WhatsApp</span>
                    </a>
                    <a href="https://www.tiktok.com/@d.l.gparfumerie?_r=1&_t=ZS-93oIlqDwDm0" title="TikTok" class="social-tiktok">
                        <svg width="24px" height="24px" viewBox="-5.12 -5.12 42.24 42.24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M8.45095 19.7926C8.60723 18.4987 9.1379 17.7743 10.1379 17.0317C11.5688 16.0259 13.3561 16.5948 13.3561 16.5948V13.2197C13.7907 13.2085 14.2254 13.2343 14.6551 13.2966V17.6401C14.6551 17.6401 12.8683 17.0712 11.4375 18.0775C10.438 18.8196 10.1815 19.5446 10.0256 20.8385C9.74562 21.5411 9.87747 22.4595 10.4847 23.2536C10.3345 23.1766 10.1815 23.0889 10.0256 22.9905C8.68807 22.0923 8.44444 20.7449 8.45095 19.7926ZM22.0352 6.97898C21.0509 5.90039 20.6786 4.81139 20.5441 4.04639H21.7823C21.7823 4.04639 21.5354 6.05224 23.3347 8.02482L23.3597 8.05134C22.8747 7.7463 22.43 7.38624 22.0352 6.97898ZM28 10.0369V14.293C28 14.293 26.42 14.2312 25.2507 13.9337C23.6179 13.5176 22.5685 12.8795 22.5685 12.8795C22.5685 12.8795 21.8436 12.4245 21.785 12.3928V21.1817C21.785 21.6711 21.651 22.8932 21.2424 23.9125C20.709 25.246 19.8859 26.1212 19.7345 26.3001C19.7345 26.3001 18.7334 27.4832 16.9672 28.28C15.3752 28.9987 13.9774 28.9805 13.5596 28.9987C13.5596 28.9987 11.1434 29.0944 8.96915 27.6814C8.49898 27.3699 8.06011 27.0172 7.6582 26.6277L7.66906 26.6355C9.84383 28.0485 12.2595 27.9528 12.2595 27.9528C12.6779 27.9346 14.0756 27.9528 15.6671 27.2341C17.4317 26.4374 18.4344 25.2543 18.4344 25.2543C18.5842 25.0754 19.4111 24.2001 19.9423 22.8662C20.3498 21.8474 20.4849 20.6247 20.4849 20.1354V11.3475C20.5435 11.3797 21.2679 11.8347 21.2679 11.8347C21.2679 11.8347 22.3179 12.4734 23.9506 12.8889C25.1204 13.1864 26.7 13.2483 26.7 13.2483V9.91314C27.2404 10.0343 27.7011 10.0671 28 10.0369Z" fill="#EE1D52"></path><path d="M26.7009 9.91314V13.2472C26.7009 13.2472 25.1213 13.1853 23.9515 12.8879C22.3188 12.4718 21.2688 11.8337 21.2688 11.8337C21.2688 11.8337 20.5444 11.3787 20.4858 11.3464V20.1364C20.4858 20.6258 20.3518 21.8484 19.9432 22.8672C19.4098 24.2012 18.5867 25.0764 18.4353 25.2553C18.4353 25.2553 17.4337 26.4384 15.668 27.2352C14.0765 27.9539 12.6788 27.9357 12.2604 27.9539C12.2604 27.9539 9.84473 28.0496 7.66995 26.6366L7.6591 26.6288C7.42949 26.4064 7.21336 26.1717 7.01177 25.9257C6.31777 25.0795 5.89237 24.0789 5.78547 23.7934C5.78529 23.7922 5.78529 23.791 5.78547 23.7898C5.61347 23.2937 5.25209 22.1022 5.30147 20.9482C5.38883 18.9122 6.10507 17.6625 6.29444 17.3494C6.79597 16.4957 7.44828 15.7318 8.22233 15.0919C8.90538 14.5396 9.6796 14.1002 10.5132 13.7917C11.4144 13.4295 12.3794 13.2353 13.3565 13.2197V16.5948C13.3565 16.5948 11.5691 16.028 10.1388 17.0317C9.13879 17.7743 8.60812 18.4987 8.45185 19.7926C8.44534 20.7449 8.68897 22.0923 10.0254 22.991C10.1813 23.0898 10.3343 23.1775 10.4845 23.2541C10.7179 23.5576 11.0021 23.8221 11.3255 24.0368C12.631 24.8632 13.7249 24.9209 15.1238 24.3842C16.0565 24.0254 16.7586 23.2167 17.0842 22.3206C17.2888 21.7611 17.2861 21.1978 17.2861 20.6154V4.04639H20.5417C20.6763 4.81139 21.0485 5.90039 22.0328 6.97898C22.4276 7.38624 22.8724 7.7463 23.3573 8.05134C23.5006 8.19955 24.2331 8.93231 25.1734 9.38216C25.6596 9.61469 26.1722 9.79285 26.7009 9.91314Z" fill="#000000"></path><path d="M4.48926 22.7568V22.7594L4.57004 22.9784C4.56076 22.9529 4.53074 22.8754 4.48926 22.7568Z" fill="#69C9D0"></path><path d="M10.5128 13.7916C9.67919 14.1002 8.90498 14.5396 8.22192 15.0918C7.44763 15.7332 6.79548 16.4987 6.29458 17.354C6.10521 17.6661 5.38897 18.9168 5.30161 20.9528C5.25223 22.1068 5.61361 23.2983 5.78561 23.7944C5.78543 23.7956 5.78543 23.7968 5.78561 23.798C5.89413 24.081 6.31791 25.0815 7.01191 25.9303C7.2135 26.1763 7.42963 26.4111 7.65924 26.6334C6.92357 26.1457 6.26746 25.5562 5.71236 24.8839C5.02433 24.0451 4.60001 23.0549 4.48932 22.7626C4.48919 22.7605 4.48919 22.7584 4.48932 22.7564V22.7527C4.31677 22.2571 3.95431 21.0651 4.00477 19.9096C4.09213 17.8736 4.80838 16.6239 4.99775 16.3108C5.4985 15.4553 6.15067 14.6898 6.92509 14.0486C7.608 13.4961 8.38225 13.0567 9.21598 12.7484C9.73602 12.5416 10.2778 12.3891 10.8319 12.2934C11.6669 12.1537 12.5198 12.1415 13.3588 12.2575V13.2196C12.3808 13.2349 11.4148 13.4291 10.5128 13.7916Z" fill="#69C9D0"></path><path d="M20.5438 4.04635H17.2881V20.6159C17.2881 21.1983 17.2881 21.76 17.0863 22.3211C16.7575 23.2167 16.058 24.0253 15.1258 24.3842C13.7265 24.923 12.6326 24.8632 11.3276 24.0368C11.0036 23.823 10.7187 23.5594 10.4844 23.2567C11.5962 23.8251 12.5913 23.8152 13.8241 23.341C14.7558 22.9821 15.4563 22.1734 15.784 21.2774C15.9891 20.7178 15.9864 20.1546 15.9864 19.5726V3H20.4819C20.4819 3 20.4315 3.41188 20.5438 4.04635ZM26.7002 8.99104V9.9131C26.1725 9.79263 25.6609 9.61447 25.1755 9.38213C24.2352 8.93228 23.5026 8.19952 23.3594 8.0513C23.5256 8.1559 23.6981 8.25106 23.8759 8.33629C25.0192 8.88339 26.1451 9.04669 26.7002 8.99104Z" fill="#69C9D0"></path></svg>
                        <span>TikTok</span>
                    </a>
                </div>
                <p style="margin-top: 1.5rem;">Suivez-nous sur les réseaux sociaux</p>
            </div>
        </div>
    </footer>

</body>
</html>
