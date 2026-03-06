<?php
/**
 * Configuration Essence Luxury E-commerce
 */

// Paramètres de base de données
define('DB_HOST', 'localhost');
define('DB_USER', 'root');
define('DB_PASS', '');
define('DB_NAME', 'essence_luxury');

// Paramètres du site
define('SITE_NAME', 'D.L.G parfumerie');
define('SITE_URL', 'http://localhost/e-commerce');
define('ADMIN_EMAIL', 'admin@dlg-parfumerie.com');

// Sécurité
define('SESSION_TIMEOUT', 3600); // 1 heure
define('PASSWORD_MIN_LENGTH', 8);

// Connexion à la base de données
try {
    $pdo = new PDO(
        "mysql:host=" . DB_HOST . ";dbname=" . DB_NAME . ";charset=utf8mb4",
        DB_USER,
        DB_PASS,
        [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]
    );
} catch (PDOException $e) {
    die("Erreur de connexion à la base de données: " . $e->getMessage());
}

// Démarrage de la session
if (session_status() == PHP_SESSION_NONE) {
    session_start();
}

// Fonction pour inclure les fichiers de classe
function autoload_class($class) {
    $file = __DIR__ . '/classes/' . $class . '.php';
    if (file_exists($file)) {
        require_once $file;
    }
}

spl_autoload_register('autoload_class');
?>
