const checkAllowedAdmin = async (req, res, next) => {
    try {
        if (!req.user || req.user.role !== 'admin') {
            return res.status(403).json({ error: 'Доступ запрещен. Требуются права администратора.' });
        }
        next();
    } catch (error) {
        console.error('Ошибка при проверке прав администратора:', error);
        res.status(500).json({ error: 'Ошибка сервера при проверке прав' });
    }
};

module.exports = checkAllowedAdmin;