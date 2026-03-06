<?php
/**
 * API REST pour e-commerce
 * Retourne les données en JSON
 */

require_once 'config.php';

header('Content-Type: application/json; charset=utf-8');

$action = isset($_GET['action']) ? $_GET['action'] : '';

/**
 * Récupérer tous les produits
 */
if ($action === 'get_products') {
    try {
        $product = new Product($pdo);
        $products = $product->getAll();
        
        // Ajouter les images échappées pour la sécurité
        foreach ($products as &$prod) {
            $prod['image_url'] = htmlspecialchars($prod['image_url']);
            $prod['name'] = htmlspecialchars($prod['name']);
            $prod['category'] = htmlspecialchars($prod['category']);
        }
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $products,
            'count' => count($products),
            'timestamp' => time()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Erreur lors de la récupération des produits'
        ]);
    }
    exit;
}

/**
 * Récupérer un produit par ID
 */
if ($action === 'get_product') {
    $id = isset($_GET['id']) ? (int)$_GET['id'] : 0;
    
    if ($id === 0) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'ID invalide']);
        exit;
    }
    
    try {
        $product = new Product($pdo);
        $prod = $product->getById($id);
        
        if (!$prod) {
            http_response_code(404);
            echo json_encode(['success' => false, 'error' => 'Produit non trouvé']);
            exit;
        }
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $prod,
            'timestamp' => time()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Erreur serveur'
        ]);
    }
    exit;
}

/**
 * Rechercher des produits
 */
if ($action === 'search') {
    $query = isset($_GET['q']) ? $_GET['q'] : '';
    
    if (strlen($query) < 2) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Requête trop courte']);
        exit;
    }
    
    try {
        $product = new Product($pdo);
        $results = $product->search($query);
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $results,
            'count' => count($results),
            'timestamp' => time()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Erreur lors de la recherche'
        ]);
    }
    exit;
}

/**
 * Récupérer produits par catégorie
 */
if ($action === 'get_by_category') {
    $category = isset($_GET['category']) ? $_GET['category'] : '';
    
    if (empty($category)) {
        http_response_code(400);
        echo json_encode(['success' => false, 'error' => 'Catégorie manquante']);
        exit;
    }
    
    try {
        $product = new Product($pdo);
        $results = $product->getByCategory($category);
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'data' => $results,
            'count' => count($results),
            'timestamp' => time()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Erreur serveur'
        ]);
    }
    exit;
}

/**
 * Vérifier les mises à jour (pour actualisation automatique)
 */
if ($action === 'check_updates') {
    $last_check = isset($_GET['last_check']) ? (int)$_GET['last_check'] : 0;
    
    try {
        $stmt = $pdo->query("SELECT MAX(updated_at) as last_update FROM products");
        $result = $stmt->fetch();
        $last_update_str = $result['last_update'];
        
        // Convertir en timestamp
        $last_update = strtotime($last_update_str);
        
        // Si null ou erreur, utiliser le timestamp actuel
        if (!$last_update) {
            $last_update = time();
        }
        
        // Si un changement s'est produit depuis le dernier check
        $has_updates = $last_update > $last_check;
        
        http_response_code(200);
        echo json_encode([
            'success' => true,
            'has_updates' => $has_updates,
            'last_update' => $last_update,
            'timestamp' => time()
        ]);
    } catch (Exception $e) {
        http_response_code(500);
        echo json_encode([
            'success' => false,
            'error' => 'Erreur serveur'
        ]);
    }
    exit;
}

// Si aucune action valide
http_response_code(400);
echo json_encode([
    'success' => false,
    'error' => 'Action non reconnue'
]);
?>
