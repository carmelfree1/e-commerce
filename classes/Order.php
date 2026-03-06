<?php
/**
 * Classe Order - Gestion des commandes
 */

class Order {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    /**
     * Créer une nouvelle commande
     */
    public function create($user_id, $items, $total, $shipping_address, $payment_method) {
        try {
            $this->pdo->beginTransaction();

            // Insérer la commande
            $stmt = $this->pdo->prepare("
                INSERT INTO orders (user_id, total, status, shipping_address, payment_method, created_at)
                VALUES (:user_id, :total, 'pending', :shipping_address, :payment_method, NOW())
            ");

            $stmt->execute([
                ':user_id' => (int) $user_id,
                ':total' => (float) $total,
                ':shipping_address' => htmlspecialchars($shipping_address),
                ':payment_method' => htmlspecialchars($payment_method)
            ]);

            $order_id = $this->pdo->lastInsertId();

            // Insérer les articles de la commande
            $stmt = $this->pdo->prepare("
                INSERT INTO order_items (order_id, product_id, quantity, price)
                VALUES (:order_id, :product_id, :quantity, :price)
            ");

            foreach ($items as $product_id => $quantity) {
                $product_stmt = $this->pdo->prepare("SELECT price FROM products WHERE id = :id");
                $product_stmt->execute([':id' => $product_id]);
                $product = $product_stmt->fetch();

                if ($product) {
                    $stmt->execute([
                        ':order_id' => (int) $order_id,
                        ':product_id' => (int) $product_id,
                        ':quantity' => (int) $quantity,
                        ':price' => (float) $product['price']
                    ]);
                }
            }

            $this->pdo->commit();
            return $order_id;
        } catch (Exception $e) {
            $this->pdo->rollBack();
            return false;
        }
    }

    /**
     * Obtenir une commande par ID
     */
    public function getById($id) {
        $stmt = $this->pdo->prepare("SELECT * FROM orders WHERE id = :id");
        $stmt->execute([':id' => (int) $id]);
        return $stmt->fetch();
    }

    /**
     * Obtenir les commandes d'un utilisateur
     */
    public function getByUserId($user_id) {
        $stmt = $this->pdo->prepare("SELECT * FROM orders WHERE user_id = :user_id ORDER BY created_at DESC");
        $stmt->execute([':user_id' => (int) $user_id]);
        return $stmt->fetchAll();
    }

    /**
     * Obtenir toutes les commandes
     */
    public function getAll() {
        $stmt = $this->pdo->query("SELECT * FROM orders ORDER BY created_at DESC");
        return $stmt->fetchAll();
    }

    /**
     * Mettre à jour le statut de la commande
     */
    public function updateStatus($order_id, $status) {
        $stmt = $this->pdo->prepare("
            UPDATE orders 
            SET status = :status, updated_at = NOW()
            WHERE id = :id
        ");

        return $stmt->execute([
            ':id' => (int) $order_id,
            ':status' => htmlspecialchars($status)
        ]);
    }

    /**
     * Obtenir les articles d'une commande
     */
    public function getItems($order_id) {
        $stmt = $this->pdo->prepare("
            SELECT oi.*, p.name, p.image_url 
            FROM order_items oi
            JOIN products p ON oi.product_id = p.id
            WHERE oi.order_id = :order_id
        ");
        $stmt->execute([':order_id' => (int) $order_id]);
        return $stmt->fetchAll();
    }
}
?>
