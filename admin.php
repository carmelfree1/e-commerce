<?php
/**
 * Page d'administration - D.L.G Parfumerie
 * Design moderne avec backend PHP/MySQL
 */

require_once 'config.php';

// Initialiser les classes
$product = new Product($pdo);
$auth = new Auth($pdo);
$order = new Order($pdo);

$current_user = null;
$message = '';
$message_type = '';
$login_error = '';
$is_logged_in = false;

// Vérifier la connexion (inclure une page de login si nécessaire)
if ($auth->isLoggedIn() && $auth->isAdmin()) {
    $is_logged_in = true;
    $current_user = $auth->getCurrentUser();
}

/**
 * Traiter l'upload d'image
 */
function handle_image_upload($file_input_name) {
    $upload_dir = __DIR__ . '/uploads/';
    
    // Vérifier que le dossier existe
    if (!is_dir($upload_dir)) {
        mkdir($upload_dir, 0755, true);
    }
    
    // Vérifier si un fichier a été uploadé
    if (!isset($_FILES[$file_input_name]) || $_FILES[$file_input_name]['error'] !== UPLOAD_ERR_OK) {
        return null;
    }
    
    $file = $_FILES[$file_input_name];
    
    // Valider le type de fichier
    $allowed_types = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!in_array($file['type'], $allowed_types)) {
        return null;
    }
    
    // Valider la taille (max 5MB)
    if ($file['size'] > 5 * 1024 * 1024) {
        return null;
    }
    
    // Générer un nom de fichier unique
    $filename = 'product_' . uniqid() . '_' . time() . '.' . pathinfo($file['name'], PATHINFO_EXTENSION);
    $filepath = $upload_dir . $filename;
    
    // Sauvegarder le fichier
    if (move_uploaded_file($file['tmp_name'], $filepath)) {
        return 'uploads/' . $filename;
    }
    
    return null;
}

// Traitement des actions POST
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = isset($_POST['action']) ? $_POST['action'] : '';
    
    // Gestion de la connexion
    if ($action === 'login') {
        $email = $_POST['email'] ?? '';
        $password = $_POST['password'] ?? '';
        
        $login_result = $auth->login($email, $password);
        if ($login_result['success']) {
            // Vérifier si c'est un admin
            $current_user = $auth->getCurrentUser();
            if ($current_user && $current_user['role'] === 'admin') {
                $is_logged_in = true;
                $message = '✅ Connexion réussie!';
                $message_type = 'success';
            } else {
                $auth->logout();
                $login_error = 'Accès refusé: vous n\'êtes pas administrateur.';
            }
        } else {
            $login_error = $login_result['message'];
        }
    }
    elseif ($action === 'logout') {
        $auth->logout();
        $is_logged_in = false;
        header('Location: admin.php');
        exit;
    }
    // Traitement des produits (seulement si connecté)
    elseif ($is_logged_in && $action === 'add_product') {
        $name = $_POST['name'] ?? '';
        $description = $_POST['description'] ?? '';
        $price = $_POST['price'] ?? 0;
        $stock = $_POST['stock'] ?? 0;
        $category = $_POST['category'] ?? 'unisexe';
        $image_url = '';
        
        // Traiter l'upload d'image
        if (isset($_FILES['product_image']) && $_FILES['product_image']['error'] === UPLOAD_ERR_OK) {
            $uploaded_path = handle_image_upload('product_image');
            if ($uploaded_path) {
                $image_url = $uploaded_path;
            }
        }

        if ($product->add($name, $description, $price, $stock, $category, $image_url)) {
            $message = '✅ Produit ajouté avec succès!';
            $message_type = 'success';
        } else {
            $message = '✗ Erreur lors de l\'ajout du produit';
            $message_type = 'error';
        }
    }
    elseif ($is_logged_in && $action === 'edit_product') {
        $id = $_POST['id'] ?? 0;
        $name = $_POST['name'] ?? '';
        $description = $_POST['description'] ?? '';
        $price = $_POST['price'] ?? 0;
        $stock = $_POST['stock'] ?? 0;
        $category = $_POST['category'] ?? 'unisexe';
        $image_url = $_POST['current_image'] ?? '';
        
        // Traiter le nouvel upload d'image si présent
        if (isset($_FILES['product_image']) && $_FILES['product_image']['error'] === UPLOAD_ERR_OK) {
            $uploaded_path = handle_image_upload('product_image');
            if ($uploaded_path) {
                $image_url = $uploaded_path;
            }
        }

        if ($product->update($id, $name, $description, $price, $stock, $category, $image_url)) {
            $message = '✅ Produit modifié avec succès!';
            $message_type = 'success';
        } else {
            $message = '✗ Erreur lors de la mise à jour';
            $message_type = 'error';
        }
    }
    elseif ($is_logged_in && $action === 'delete_product') {
        $id = $_POST['id'] ?? 0;
        if ($product->delete($id)) {
            $message = '✅ Produit supprimé avec succès!';
            $message_type = 'success';
        } else {
            $message = '✗ Erreur lors de la suppression';
            $message_type = 'error';
        }
    }
}

// Obtenir les données pour le dashboard (seulement si connecté)
$all_products = [];
$all_orders = [];
$total_revenue = 0;
$total_stock = 0;
$avg_price = 0;

if ($is_logged_in) {
    $all_products = $product->getAll();
    $all_orders = $order->getAll();
    
    foreach ($all_products as $p) {
        $total_stock += $p['stock'];
    }
    foreach ($all_orders as $o) {
        if ($o['status'] !== 'cancelled') {
            $total_revenue += $o['total'];
        }
    }
    
    $avg_price = count($all_products) > 0 ? round(array_sum(array_column($all_products, 'price')) / count($all_products)) : 0;
}
?>
<!DOCTYPE html>
<html lang="fr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Admin - D.L.G Parfumerie</title>
    <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;500;600;700&family=Montserrat:wght@300;400;500;600&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="css/admin.css">
</head>
<body>
    <?php if (!$is_logged_in): ?>
        <!-- PAGE DE CONNEXION -->
        <div style="min-height: 100vh; display: flex; align-items: center; justify-content: center; background: linear-gradient(135deg, var(--primary) 0%, #2d2d2d 100%); padding: 1rem;">
            <div style="background: white; padding: clamp(1.5rem, 5%, 3rem); border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.2); width: 100%; max-width: 400px;">
                <h1 style="text-align: center; color: var(--primary); margin-bottom: 0.5rem; font-family: 'Cormorant Garamond', serif; font-size: clamp(1.5rem, 4vw, 2rem);">D.L.G Parfumerie</h1>
                <h2 style="text-align: center; color: var(--secondary); margin-bottom: 2rem; font-size: clamp(1rem, 2vw, 1.2rem);">Panneau Administrateur</h2>
                
                <?php if ($login_error): ?>
                    <div style="background: #fee; border: 2px solid #f88; color: #c00; padding: 1rem; border-radius: 8px; margin-bottom: 1.5rem; font-weight: 500;">
                        ⚠️ <?php echo htmlspecialchars($login_error); ?>
                    </div>
                <?php endif; ?>
                
                <form method="POST" action="admin.php" style="display: flex; flex-direction: column; gap: 1.5rem;">
                    <input type="hidden" name="action" value="login">
                    
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: var(--primary); font-weight: 600;">Email</label>
                        <input type="email" name="email" required placeholder="admin@essence-luxury.com" 
                               style="width: 100%; padding: 0.8rem; border: 2px solid #e0e0e0; border-radius: 8px; font-family: 'Montserrat', sans-serif; transition: border-color 0.3s;"
                               onfocus="this.style.borderColor='var(--secondary)'" 
                               onblur="this.style.borderColor='#e0e0e0'">
                    </div>
                    
                    <div>
                        <label style="display: block; margin-bottom: 0.5rem; color: var(--primary); font-weight: 600;">Mot de passe</label>
                        <input type="password" name="password" required placeholder="••••••••" 
                               style="width: 100%; padding: 0.8rem; border: 2px solid #e0e0e0; border-radius: 8px; font-family: 'Montserrat', sans-serif; transition: border-color 0.3s;"
                               onfocus="this.style.borderColor='var(--secondary)'" 
                               onblur="this.style.borderColor='#e0e0e0'">
                    </div>
                    
                    <button type="submit" style="background: linear-gradient(135deg, var(--primary) 0%, #2d2d2d 100%); color: white; border: none; padding: 0.8rem; border-radius: 8px; font-size: 1rem; font-weight: 600; cursor: pointer; transition: transform 0.3s;"
                            onmouseover="this.style.transform='scale(1.02)'" 
                            onmouseout="this.style.transform='scale(1)'">
                        🔐 Connexion
                    </button>
                </form>
            </div>
        </div>
    <?php else: ?>
        <!-- PANEL ADMIN (CONNECTÉ) -->
    <header>
        <div class="header-content">
            <div style="display: flex; align-items: center; gap: 1rem;">
                <div class="logo">ADMIN - D.L.G PARFUMERIE</div>
            </div>
            <div class="header-right">
                <div class="user-info">👤 <?php echo htmlspecialchars($current_user['name'] ?? 'Admin'); ?></div>
                <form method="POST" action="admin.php" style="margin: 0;">
                    <input type="hidden" name="action" value="logout">
                    <button type="submit" class="btn-logout">🚪 Déconnexion</button>
                </form>
            </div>
        </div>
    </header>

    <div class="container">
        <!-- Statistics -->
        <div class="stats-grid">
            <div class="stat-card">
                <div class="stat-icon">📦</div>
                <div class="stat-value"><?php echo count($all_products); ?></div>
                <div class="stat-label">Produits Total</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💰</div>
                <div class="stat-value"><?php echo number_format($avg_price, 0, ',', ' '); ?> CFA</div>
                <div class="stat-label">Prix Moyen</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">💵</div>
                <div class="stat-value"><?php echo number_format($total_revenue, 0, ',', ' '); ?> CFA</div>
                <div class="stat-label">Revenu Total</div>
            </div>
            <div class="stat-card">
                <div class="stat-icon">📈</div>
                <div class="stat-value"><?php echo $total_stock; ?></div>
                <div class="stat-label">Stock Total</div>
            </div>
        </div>

        <!-- Alert Messages -->
        <?php if ($message): ?>
            <div class="alert alert-<?php echo $message_type; ?>">
                <?php echo htmlspecialchars($message); ?>
            </div>
        <?php endif; ?>

        <!-- Main Content -->
        <div class="admin-grid">
            <!-- Product Form -->
            <div class="admin-form">
                <h2 class="section-title" id="formTitle">➕ Ajouter un Parfum</h2>
                <form method="POST" action="" id="productForm" enctype="multipart/form-data">
                    <input type="hidden" name="action" id="actionField" value="add_product">
                    <input type="hidden" name="id" id="productId" value="">
                    <input type="hidden" name="current_image" id="currentImage" value="">

                    <div class="form-group">
                        <label>Nom du Parfum *</label>
                        <input type="text" id="nameField" name="name" placeholder="Ex: Rose Éternelle" required>
                    </div>

                    <div class="form-group">
                        <label>Description *</label>
                        <textarea id="descriptionField" name="description" rows="3" placeholder="Décrivez le parfum..." required></textarea>
                    </div>

                    <div class="form-group">
                        <label>Catégorie *</label>
                        <select id="categoryField" name="category" required>
                            <option value="homme">Homme</option>
                            <option value="femme">Femme</option>
                            <option value="unisexe">Unisexe</option>
                        </select>
                    </div>

                    <div class="form-group">
                        <label>Prix (CFA) *</label>
                        <input type="number" id="priceField" name="price" placeholder="Ex: 45000" required min="0">
                    </div>

                    <div class="form-group">
                        <label>Stock *</label>
                        <input type="number" id="stockField" name="stock" placeholder="Ex: 50" required min="0">
                    </div>

                    <div class="form-group">
                        <label>Image du Produit 🖼️</label>
                        <div style="border: 2px dashed #EE1D52; border-radius: 8px; padding: 1.5rem; text-align: center; cursor: pointer; transition: all 0.3s; background: #fafafa;" id="dropZone">
                            <input type="file" id="imageField" name="product_image" accept="image/*" style="display: none;">
                            <div id="imagePreview" style="display: none; text-align: center;">
                                <img id="previewImg" src="" alt="Preview" style="max-width: 100%; max-height: 200px; border-radius: 8px; margin-bottom: 1rem;">
                                <p style="color: #666; margin-bottom: 0.5rem;" id="fileName"></p>
                                <button type="button" class="btn btn-small" onclick="document.getElementById('imageField').click(); return false;" style="background: var(--secondary); color: var(--primary);">Changer l'image</button>
                                <button type="button" class="btn btn-small" onclick="removeImage(); return false;" style="background: #e74c3c; color: white; margin-left: 0.5rem;">Supprimer</button>
                            </div>
                            <div id="imageUploadPrompt">
                                <p style="font-size: 2rem; margin-bottom: 0.5rem;">📸</p>
                                <p style="color: var(--secondary); font-weight: 600; margin-bottom: 0.5rem;">Cliquez ou glissez une image</p>
                                <p style="color: #999; font-size: 0.9rem;">PNG, JPG, GIF, WebP (max 5MB)</p>
                            </div>
                        </div>
                    </div>

                    <div style="display: flex; gap: 1rem;">
                        <button type="submit" class="btn btn-primary" id="submitBtn" style="flex: 1;">➕ Ajouter le Parfum</button>
                        <button type="button" class="btn" style="flex: 1; background: #95a5a6; color: white;" id="cancelBtn" onclick="resetForm()" style="display: none;">Annuler</button>
                    </div>
                </form>
            </div>

            <!-- Products List -->
            <div class="admin-products">
                <h2 class="section-title">📋 Gestion des Produits</h2>
                
                <!-- Search Bar -->
                <div class="admin-search-container">
                    <input type="text" id="adminSearchInput" class="admin-search-input" placeholder="🔍 Rechercher un produit..." onkeyup="filterAdminProducts()">
                </div>
                
                <?php if (empty($all_products)): ?>
                    <p style="text-align: center; color: #999; padding: 2rem;">Aucun produit pour le moment</p>
                <?php else: ?>
                    <div class="products-table">
                        <?php foreach ($all_products as $p): ?>
                            <div class="product-row" data-product-name="<?php echo strtolower($p['name']); ?>" data-product-desc="<?php echo strtolower($p['description']); ?>">
                                <div class="product-col-image">
                                    <?php if ($p['image_url']): ?>
                                        <img src="<?php echo htmlspecialchars($p['image_url']); ?>" alt="<?php echo htmlspecialchars($p['name']); ?>">
                                    <?php else: ?>
                                        <span style="font-size: 2.5rem;">🌸</span>
                                    <?php endif; ?>
                                </div>
                                <div class="product-col-info">
                                    <div class="product-name"><?php echo htmlspecialchars($p['name']); ?></div>
                                    <div class="product-desc"><?php echo htmlspecialchars(substr($p['description'], 0, 80)) . '...'; ?></div>
                                    <div class="product-meta">
                                        <span class="badge"><?php echo number_format($p['price'], 0, ',', ' '); ?> CFA</span>
                                        <span class="badge">📦 <?php echo $p['stock']; ?></span>
                                        <span class="badge"><?php echo ucfirst($p['category']); ?></span>
                                    </div>
                                </div>
                                <div class="product-col-actions">
                                    <button type="button" class="btn btn-edit btn-small" onclick="editProduct({id: <?php echo $p['id']; ?>, name: '<?php echo addslashes($p['name']); ?>', description: '<?php echo addslashes($p['description']); ?>', price: <?php echo $p['price']; ?>, stock: <?php echo $p['stock']; ?>, category: '<?php echo $p['category']; ?>', image_url: '<?php echo addslashes($p['image_url']); ?>'})">✏️ Modifier</button>
                                    <form method="POST" action="" style="display: inline;">
                                        <input type="hidden" name="action" value="delete_product">
                                        <input type="hidden" name="id" value="<?php echo $p['id']; ?>">
                                        <button type="submit" class="btn btn-delete btn-small" onclick="return confirm('Êtes-vous sûr de vouloir supprimer ce produit ?');">🗑️ Supprimer</button>
                                    </form>
                                </div>
                            </div>
                        <?php endforeach; ?>
                    </div>
                <?php endif; ?>
            </div>
        </div>
    </div>
    <?php endif; ?>

    <script>
        // Gestion de l'upload d'image
        const imageField = document.getElementById('imageField');
        const dropZone = document.getElementById('dropZone');
        const imagePreview = document.getElementById('imagePreview');
        const imageUploadPrompt = document.getElementById('imageUploadPrompt');
        const previewImg = document.getElementById('previewImg');
        const fileName = document.getElementById('fileName');

        // Clic sur la zone de drop
        dropZone.addEventListener('click', () => imageField.click());

        // Drag & Drop
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = 'var(--secondary)';
            dropZone.style.background = 'rgba(238, 29, 82, 0.1)';
        });

        dropZone.addEventListener('dragleave', () => {
            dropZone.style.borderColor = '#EE1D52';
            dropZone.style.background = '#fafafa';
        });

        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.style.borderColor = '#EE1D52';
            dropZone.style.background = '#fafafa';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                imageField.files = files;
                displayImagePreview();
            }
        });

        // Changement du fichier
        imageField.addEventListener('change', displayImagePreview);

        function displayImagePreview() {
            const file = imageField.files[0];
            if (file && file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    previewImg.src = e.target.result;
                    fileName.textContent = file.name;
                    imageUploadPrompt.style.display = 'none';
                    imagePreview.style.display = 'block';
                };
                reader.readAsDataURL(file);
            }
        }

        function removeImage() {
            imageField.value = '';
            imagePreview.style.display = 'none';
            imageUploadPrompt.style.display = 'block';
        }

        // Gestion du formulaire
        function resetForm() {
            document.getElementById('productForm').reset();
            document.getElementById('formTitle').textContent = '➕ Ajouter un Parfum';
            document.getElementById('actionField').value = 'add_product';
            document.getElementById('productId').value = '';
            document.getElementById('currentImage').value = '';
            document.getElementById('submitBtn').textContent = '➕ Ajouter le Parfum';
            document.getElementById('cancelBtn').style.display = 'none';
            removeImage();
        }

        function editProduct(product) {
            document.getElementById('formTitle').textContent = '✏️ Modifier un Parfum';
            document.getElementById('actionField').value = 'edit_product';
            document.getElementById('productId').value = product.id;
            document.getElementById('currentImage').value = product.image_url || '';
            
            document.getElementById('nameField').value = product.name;
            document.getElementById('descriptionField').value = product.description;
            document.getElementById('priceField').value = product.price;
            document.getElementById('stockField').value = product.stock;
            document.getElementById('categoryField').value = product.category;
            
            document.getElementById('submitBtn').textContent = '✏️ Modifier le Parfum';
            document.getElementById('cancelBtn').style.display = 'block';
            
            // Afficher l'image actuelle si elle existe
            if (product.image_url) {
                previewImg.src = product.image_url;
                fileName.textContent = 'Image actuelle';
                imageUploadPrompt.style.display = 'none';
                imagePreview.style.display = 'block';
            } else {
                removeImage();
            }
            
            // Scroller vers le formulaire
            document.getElementById('productForm').scrollIntoView({ behavior: 'smooth' });
        }

        // Recherche de produits admin
        function filterAdminProducts() {
            const searchTerm = document.getElementById('adminSearchInput').value.toLowerCase();
            const rows = document.querySelectorAll('.product-row');
            
            rows.forEach(row => {
                const name = row.dataset.productName || '';
                const desc = row.dataset.productDesc || '';
                
                if (name.includes(searchTerm) || desc.includes(searchTerm) || searchTerm === '') {
                    row.style.display = 'flex';
                } else {
                    row.style.display = 'none';
                }
            });
        }
    </script>
</body>
</html>
