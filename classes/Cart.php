<?php
/**
 * Classe Cart - Gestion du panier
 */

class Cart {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    /**
     * Initialiser le panier en session
     */
    public function initialize() {
        if (!isset($_SESSION['cart'])) {
            $_SESSION['cart'] = [];
        }
    }

    /**
     * Ajouter un produit au panier
     */
    public function add($product_id, $quantity = 1) {
        $this->initialize();
        
        if (isset($_SESSION['cart'][$product_id])) {
            $_SESSION['cart'][$product_id] += (int) $quantity;
        } else {
            $_SESSION['cart'][$product_id] = (int) $quantity;
        }
        
        return true;
    }

    /**
     * Retirer un produit du panier
     */
    public function remove($product_id) {
        $this->initialize();
        
        if (isset($_SESSION['cart'][$product_id])) {
            unset($_SESSION['cart'][$product_id]);
            return true;
        }
        
        return false;
    }

    /**
     * Mettre à jour la quantité
     */
    public function updateQuantity($product_id, $quantity) {
        $this->initialize();
        
        if (isset($_SESSION['cart'][$product_id])) {
            $_SESSION['cart'][$product_id] = max(0, (int) $quantity);
            return true;
        }
        
        return false;
    }

    /**
     * Obtenir le contenu du panier
     */
    public function getItems() {
        $this->initialize();
        return $_SESSION['cart'];
    }

    /**
     * Obtenir le total du panier
     */
    public function getTotal() {
        $this->initialize();
        $total = 0;
        
        foreach ($_SESSION['cart'] as $product_id => $quantity) {
            $stmt = $this->pdo->prepare("SELECT price FROM products WHERE id = :id");
            $stmt->execute([':id' => $product_id]);
            $product = $stmt->fetch();
            
            if ($product) {
                $total += $product['price'] * $quantity;
            }
        }
        
        return round($total, 2);
    }

    /**
     * Vider le panier
     */
    public function clear() {
        $_SESSION['cart'] = [];
        return true;
    }

    /**
     * Obtenir le nombre d'articles
     */
    public function getCount() {
        $this->initialize();
        return array_sum($_SESSION['cart']);
    }
}
?>
