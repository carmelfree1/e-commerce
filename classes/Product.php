<?php
/**
 * Classe Product - Gestion des produits
 */

class Product {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    /**
     * Récupérer tous les produits
     */
    public function getAll() {
        $stmt = $this->pdo->query("SELECT * FROM products ORDER BY name ASC");
        return $stmt->fetchAll();
    }

    /**
     * Récupérer un produit par ID
     */
    public function getById($id) {
        $stmt = $this->pdo->prepare("SELECT * FROM products WHERE id = :id");
        $stmt->execute([':id' => $id]);
        return $stmt->fetch();
    }

    /**
     * Ajouter un nouveau produit
     */
    public function add($name, $description, $price, $stock, $category, $image_url) {
        $stmt = $this->pdo->prepare("
            INSERT INTO products (name, description, price, stock, category, image_url, created_at)
            VALUES (:name, :description, :price, :stock, :category, :image_url, NOW())
        ");
        
        return $stmt->execute([
            ':name' => htmlspecialchars($name),
            ':description' => htmlspecialchars($description),
            ':price' => (float) $price,
            ':stock' => (int) $stock,
            ':category' => htmlspecialchars($category),
            ':image_url' => htmlspecialchars($image_url)
        ]);
    }

    /**
     * Mettre à jour un produit
     */
    public function update($id, $name, $description, $price, $stock, $category, $image_url) {
        $stmt = $this->pdo->prepare("
            UPDATE products 
            SET name = :name, description = :description, price = :price, 
                stock = :stock, category = :category, image_url = :image_url, updated_at = NOW()
            WHERE id = :id
        ");
        
        return $stmt->execute([
            ':id' => (int) $id,
            ':name' => htmlspecialchars($name),
            ':description' => htmlspecialchars($description),
            ':price' => (float) $price,
            ':stock' => (int) $stock,
            ':category' => htmlspecialchars($category),
            ':image_url' => htmlspecialchars($image_url)
        ]);
    }

    /**
     * Supprimer un produit
     */
    public function delete($id) {
        $stmt = $this->pdo->prepare("DELETE FROM products WHERE id = :id");
        return $stmt->execute([':id' => (int) $id]);
    }

    /**
     * Obtenir les produits par catégorie
     */
    public function getByCategory($category) {
        $stmt = $this->pdo->prepare("SELECT * FROM products WHERE category = :category ORDER BY name ASC");
        $stmt->execute([':category' => htmlspecialchars($category)]);
        return $stmt->fetchAll();
    }

    /**
     * Rechercher des produits
     */
    public function search($query) {
        $search = '%' . htmlspecialchars($query) . '%';
        $stmt = $this->pdo->prepare("
            SELECT * FROM products 
            WHERE name LIKE :query OR description LIKE :query 
            ORDER BY name ASC
        ");
        $stmt->execute([':query' => $search]);
        return $stmt->fetchAll();
    }
}
?>
