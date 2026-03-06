# Essence Luxury E-Commerce Platform

Un système e-commerce complet et professionnel pour la vente de parfums de luxe, développé en PHP avec une architecture orientée objet.

## 🏗️ Architecture

### Structure du projet

```
e-commerce/
├── config.php              # Configuration et connexion BD
├── index.php               # Page d'accueil (boutique)
├── admin.php               # Panneau d'administration
├── database.sql            # Schéma de base de données
└── classes/
    ├── Product.php         # Gestion des produits
    ├── Cart.php            # Gestion du panier
    ├── Auth.php            # Authentification & autorisation
    └── Order.php           # Gestion des commandes
```

## 🗄️ Base de données

Le système utilise **MySQL** avec 5 tables principales:

- **users**: Gestion des utilisateurs (clients et admins)
- **products**: Catalogue des produits
- **orders**: Historique des commandes
- **order_items**: Détail des articles par commande
- **reviews**: Avis clients (prêt pour extension)

## 🚀 Installation

### 1. Configuration MySQL

```bash
# Importer le schéma de base de données
mysql -u root < database.sql

# Utilisateur admin par défaut:
# Email: admin@essence-luxury.com
# Mot de passe: admin (à changer!)
```

### 2. Configuration PHP

Éditer `config.php` avec vos paramètres:

```php
define('DB_HOST', 'votre_host');
define('DB_USER', 'votre_user');
define('DB_PASS', 'votre_password');
define('DB_NAME', 'essence_luxury');
```

### 3. Lancer le serveur

```bash
# Avec PHP intégré:
php -S localhost:8000

# Accéder à:
# - Boutique: http://localhost:8000/index.php
# - Admin: http://localhost:8000/admin.php
```

## 📋 Fonctionnalités

### Côté Client (index.php)

✅ Consulter le catalogue de produits  
✅ Ajouter des produits au panier  
✅ S'inscrire et se connecter  
✅ Voir son panier  
✅ Accès au panneau admin pour les admins  

### Côté Admin (admin.php)

✅ Dashboard avec statistiques  
✅ Gestion complète des produits (CRUD)  
✅ Visualisation des commandes  
✅ Mise à jour du statut des commandes  
✅ Calcul automatique du revenu  

## 🔐 Sécurité

- Mots de passe hashés avec **bcrypt**
- Requêtes protégées avec **requêtes préparées**
- **Validation** et **sanitisation** des entrées
- Authentification par **session**
- Timeout de session : **1 heure**

## 💳 Classes principales

### Auth
```php
$auth = new Auth($pdo);
$auth->login($email, $password);
$auth->register($email, $password, $name);
$auth->isLoggedIn();
$auth->isAdmin();
```

### Product
```php
$product = new Product($pdo);
$product->getAll();
$product->getById($id);
$product->add($name, $description, $price, $stock, $category, $image_url);
$product->update($id, ...);
$product->delete($id);
$product->search($query);
```

### Cart
```php
$cart = new Cart($pdo);
$cart->add($product_id, $quantity);
$cart->remove($product_id);
$cart->getTotal();
$cart->getCount();
$cart->clear();
```

### Order
```php
$order = new Order($pdo);
$order->create($user_id, $items, $total, $shipping_address, $payment_method);
$order->getById($id);
$order->getByUserId($user_id);
$order->updateStatus($order_id, $status);
```

## 🔧 Extensions futures

- Système de paiement (Stripe, PayPal)
- Gestion des avis et notes produits
- Système de factures PDF
- Email de confirmation de commande
- Dashboard analytique avancée
- API REST complète
- Multi-langues

## 📝 Notes

- Les sessions sont utilisées pour le panier (sans persistance BD)
- Les mots de passe minimum: 8 caractères
- Format de prix: décimal (2 chiffres après la virgule)
- Les utilisateurs par défaut incluent un super-administrateur

## 📧 Support

Pour toute question: admin@essence-luxury.com

---

**Version**: 1.0  
**Créé**: février 2026  
**Technologie**: PHP 7.4+, MySQL 5.7+
