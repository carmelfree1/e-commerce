<?php
/**
 * Classe Auth - Authentification et autorisation
 */

class Auth {
    private $pdo;

    public function __construct($pdo) {
        $this->pdo = $pdo;
    }

    /**
     * Enregistrer un nouvel utilisateur
     */
    public function register($email, $password, $name) {
        // Vérifier si l'email existe déjà
        $stmt = $this->pdo->prepare("SELECT id FROM users WHERE email = :email");
        $stmt->execute([':email' => $email]);
        
        if ($stmt->fetch()) {
            return ['success' => false, 'message' => 'Cet email est déjà enregistré'];
        }

        // Valider le mot de passe
        if (strlen($password) < PASSWORD_MIN_LENGTH) {
            return ['success' => false, 'message' => 'Le mot de passe doit contenir au moins ' . PASSWORD_MIN_LENGTH . ' caractères'];
        }

        // Insérer le nouvel utilisateur
        $hashed_password = password_hash($password, PASSWORD_BCRYPT);
        $stmt = $this->pdo->prepare("
            INSERT INTO users (email, password, name, role, created_at)
            VALUES (:email, :password, :name, 'customer', NOW())
        ");

        $stmt->execute([
            ':email' => htmlspecialchars($email),
            ':password' => $hashed_password,
            ':name' => htmlspecialchars($name)
        ]);

        return ['success' => true, 'message' => 'Inscription réussie'];
    }

    /**
     * Connexion utilisateur
     */
    public function login($email, $password) {
        $stmt = $this->pdo->prepare("SELECT * FROM users WHERE email = :email");
        $stmt->execute([':email' => $email]);
        $user = $stmt->fetch();

        if (!$user || !password_verify($password, $user['password'])) {
            return ['success' => false, 'message' => 'Email ou mot de passe incorrect'];
        }

        $_SESSION['user_id'] = $user['id'];
        $_SESSION['user_email'] = $user['email'];
        $_SESSION['user_name'] = $user['name'];
        $_SESSION['user_role'] = $user['role'];
        $_SESSION['login_time'] = time();

        return ['success' => true, 'message' => 'Connexion réussie'];
    }

    /**
     * Déconnexion
     */
    public function logout() {
        session_destroy();
        return true;
    }

    /**
     * Vérifier si l'utilisateur est connecté
     */
    public function isLoggedIn() {
        return isset($_SESSION['user_id']) && !$this->isSessionExpired();
    }

    /**
     * Vérifier si l'utilisateur est admin
     */
    public function isAdmin() {
        return $this->isLoggedIn() && $_SESSION['user_role'] === 'admin';
    }

    /**
     * Vérifier l'expiration de la session
     */
    public function isSessionExpired() {
        if (!isset($_SESSION['login_time'])) {
            return true;
        }

        if (time() - $_SESSION['login_time'] > SESSION_TIMEOUT) {
            session_destroy();
            return true;
        }

        $_SESSION['login_time'] = time();
        return false;
    }

    /**
     * Obtenir l'utilisateur actuel
     */
    public function getCurrentUser() {
        if (!$this->isLoggedIn()) {
            return null;
        }

        return [
            'id' => $_SESSION['user_id'],
            'email' => $_SESSION['user_email'],
            'name' => $_SESSION['user_name'],
            'role' => $_SESSION['user_role']
        ];
    }
}
?>
